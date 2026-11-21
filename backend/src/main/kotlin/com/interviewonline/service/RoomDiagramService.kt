package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.RoomDiagramChangedDto
import com.interviewonline.dto.RoomDiagramChangeRequest
import com.interviewonline.dto.RoomDiagramDto
import com.interviewonline.dto.RoomDiagramOperationDto
import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockByInviteCode
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.ResultSet
import java.util.UUID

@Service
class RoomDiagramService(
    private val rooms: RoomRepository,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val accessService: RoomAccessService,
    private val collaboration: CollaborationService,
    private val storage: RoomCanvasStorage,
    private val validator: RoomDiagramValidator,
    private val taskScope: RoomCanvasTaskScope,
    transactionManager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(transactionManager)

    data class Credentials(
        val user: User?,
        val ownerToken: String?,
        val interviewerToken: String?,
        val eventToken: String?,
        val sessionId: String?,
    )

    fun get(inviteCode: String, credentials: Credentials, afterSequence: Long?, taskId: String? = null): RoomDiagramDto {
        storage.requireSupported()
        if (afterSequence != null && afterSequence < 0) throw invalid("Некорректная последовательность схемы")
        return requireNotNull(transaction.execute {
            val room = rooms.lockForSharedReadByInviteCode(inviteCode) ?: throw missingRoom()
            requireNotArchived(room)
            val liveRole = credentials.sessionId?.let {
                collaboration.resolveCanvasParticipant(room, it, credentials.eventToken, credentials.user).role
            }
            val role = liveRole ?: accessService.resolveAccess(room, credentials.user,
                credentials.ownerToken, credentials.interviewerToken).role
            val scope = taskScope.resolve(room, taskId, role.canManageRoom)
            val current = snapshot(room, scope)
            if (afterSequence != null && afterSequence > current.sequence) throw conflict(current.sequence)
            val outsideRecoveryWindow = afterSequence != null && current.sequence - afterSequence > RECOVERY_WINDOW
            val recoveryBytes = if (!outsideRecoveryWindow && afterSequence != null && afterSequence < current.sequence) {
                jdbc.queryForObject("""SELECT COALESCE(sum(octet_length(xml)+COALESCE(octet_length(patch),0)),0)
                    FROM room_diagram_operations WHERE diagram_id=? AND sequence>? AND sequence<=?""".trimIndent(),
                    Long::class.java, current.diagramId, afterSequence, current.sequence) ?: 0L
            } else 0L
            val oversizedRecovery = recoveryBytes + current.xml.toByteArray(StandardCharsets.UTF_8).size > MAX_RECOVERY_BYTES
            val operations = if (!outsideRecoveryWindow && !oversizedRecovery && afterSequence != null && afterSequence < current.sequence) {
                jdbc.query("""SELECT * FROM room_diagram_operations
                    WHERE diagram_id=? AND sequence>? AND sequence<=? ORDER BY sequence""".trimIndent(),
                    { result, _ -> operation(result, current.diagramId) }, current.diagramId, afterSequence, current.sequence)
            } else emptyList()
            val needsSnapshot = outsideRecoveryWindow || oversizedRecovery || operations.any { it.xml == null } ||
                (afterSequence != null && current.sequence - afterSequence != operations.size.toLong())
            current.copy(
                canEdit = liveRole != null && canEdit(room, role),
                operations = if (needsSnapshot) emptyList() else operations,
                requiresSnapshot = needsSnapshot,
            )
        })
    }

    fun change(inviteCode: String, credentials: Credentials, request: RoomDiagramChangeRequest, taskId: String? = null): RoomDiagramOperationDto {
        storage.requireSupported()
        val proposedCells = validator.validate(request)
        val outcome = requireNotNull(transaction.execute {
            val room = rooms.lockByInviteCode(inviteCode) ?: throw missingRoom()
            requireNotArchived(room)
            val sessionId = credentials.sessionId?.takeIf { it.isNotBlank() && it.length <= 255 }
                ?: throw denied()
            val actor = collaboration.resolveCanvasParticipant(room, sessionId, credentials.eventToken, credentials.user)
            val role = actor.role
            if (room.status == "frozen") throw ApiException(HttpStatus.CONFLICT, "Комната недоступна для изменений", code = "ROOM_FROZEN")
            if (!canEdit(room, role)) throw ApiException(HttpStatus.FORBIDDEN, "Интервью доступно только для просмотра", code = "ROOM_READ_ONLY")
            val scope = taskScope.resolve(room, taskId, role.canManageRoom)
            val current = snapshot(room, scope)
            if (request.diagramId != current.diagramId) throw ApiException(HttpStatus.CONFLICT, "Схема относится к другому холсту", code = "DIAGRAM_DOCUMENT_MISMATCH")
            val fingerprint = fingerprint(sessionId, request)
            val receipt = jdbc.query("SELECT * FROM room_diagram_operations WHERE diagram_id=? AND operation_id=?",
                { result, _ -> result.getString("fingerprint") to operation(result, current.diagramId) }, current.diagramId, request.operationId).firstOrNull()
            if (receipt != null) {
                if (receipt.first != fingerprint) throw ApiException(HttpStatus.CONFLICT, "Идентификатор изменения уже использован", code = "DIAGRAM_OPERATION_REUSED")
                return@execute Triple(receipt.second, null, null)
            }
            if (request.baseSequence != current.sequence || current.sequence == Long.MAX_VALUE) throw conflict(current.sequence)
            val next = current.sequence + 1
            jdbc.update("""INSERT INTO room_diagrams(room_id,task_id,id,sequence,xml) VALUES (?,?,?,?,?)
                ON CONFLICT (room_id,task_id) DO UPDATE SET sequence=EXCLUDED.sequence,xml=EXCLUDED.xml,updated_at=CURRENT_TIMESTAMP""".trimIndent(),
                room.id, scope, current.diagramId, next, request.xml)
            jdbc.update("""INSERT INTO room_diagram_operations(room_id,diagram_id,operation_id,sequence,session_id,fingerprint,xml,patch,checksum)
                VALUES (?,?,?,?,?,?,?,?,?)""".trimIndent(), room.id, current.diagramId, request.operationId, next, sessionId, fingerprint,
                request.xml, request.patch?.let(mapper::writeValueAsString), request.checksum)
            // Keep a bounded incremental window while retaining the durable
            // receipts. Older readers recover from the canonical XML snapshot.
            jdbc.update("UPDATE room_diagram_operations SET xml=NULL,patch=NULL,checksum=NULL WHERE diagram_id=? AND sequence<=? AND xml IS NOT NULL",
                current.diagramId, next - RECOVERY_WINDOW)
            val activity = if (!role.canManageRoom && request.xml != current.xml && validator.cellsChanged(current.xml, proposedCells)) {
                collaboration.recordCanvasActivity(room, actor, CollaborationService.CanvasActivity.DIAGRAM_EDIT)
            } else null
            Triple(
                RoomDiagramOperationDto(current.diagramId, next, request.operationId, sessionId, request.xml, request.patch, request.checksum),
                RoomDiagramChangedDto(current.diagramId, next, scope), activity,
            )
        })
        // TransactionTemplate has returned and released its Room row lock and
        // connection before any potentially slow SSE client receives data.
        val (operation, changed, activity) = outcome
        changed?.let { collaboration.broadcastDiagramChanged(inviteCode, it) }
        activity?.let { collaboration.publishCandidateActivity(inviteCode, it) }
        return operation
    }

    private fun snapshot(room: Room, taskId: String?): RoomDiagramDto = jdbc.query(
        "SELECT id,sequence,xml FROM room_diagrams WHERE room_id=? AND task_id IS NOT DISTINCT FROM ?",
        { result, _ -> RoomDiagramDto(result.getString("id"), result.getLong("sequence"), result.getString("xml"), false, taskId) }, room.id, taskId,
    ).firstOrNull() ?: RoomDiagramDto(
        UUID.nameUUIDFromBytes((if (taskId == null) "room-diagram:${room.id}" else "task-diagram:$taskId")
            .toByteArray(StandardCharsets.UTF_8)).toString(), 0, EMPTY_XML, false, taskId,
    )

    private fun operation(result: ResultSet, diagramId: String) = RoomDiagramOperationDto(
        diagramId = diagramId,
        sequence = result.getLong("sequence"),
        operationId = result.getString("operation_id"),
        sessionId = result.getString("session_id"),
        xml = result.getString("xml"),
        patch = result.getString("patch")?.let(mapper::readTree),
        checksum = result.getString("checksum"),
    )

    private fun canEdit(room: Room, role: RoomAccessService.RoomRole) = room.status != "frozen" &&
        room.archivedAt == null && (room.status != "finished" || role.canManageRoom)

    private fun requireNotArchived(room: Room) {
        if (room.archivedAt != null) throw ApiException(if (room.teamId == null) HttpStatus.GONE else HttpStatus.NOT_FOUND,
            "Комната недоступна", code = "ROOM_ACCESS_DENIED")
    }

    private fun fingerprint(sessionId: String, request: RoomDiagramChangeRequest): String {
        // The baseline and XML can change during an unaccepted CAS retry. The
        // original patch identifies that intent; XML-only updates identify XML.
        val intent = request.patch?.let(mapper::writeValueAsString) ?: request.xml
        return MessageDigest.getInstance("SHA-256").digest("$sessionId\n$intent".toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun invalid(message: String) = ApiException(HttpStatus.BAD_REQUEST, message, code = "DIAGRAM_INVALID_DOCUMENT")
    private fun denied() = ApiException(HttpStatus.FORBIDDEN, "Нет действующего подключения к комнате", code = "ROOM_ACCESS_DENIED")
    private fun conflict(sequence: Long) = ApiException(HttpStatus.CONFLICT, "Схема уже изменена. Восстановите актуальное состояние.",
        code = "DIAGRAM_VERSION_CONFLICT", currentRevision = sequence)
    private fun missingRoom() = ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")

    private companion object {
        const val MAX_RECOVERY_BYTES = 4_000_000L
        const val RECOVERY_WINDOW = 128L
        const val EMPTY_XML = "<mxfile><diagram id=\"room-diagram\" name=\"Архитектура\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel></diagram></mxfile>"
    }
}
