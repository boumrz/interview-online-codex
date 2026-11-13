package com.interviewonline.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.RoomWhiteboardChangedDto
import com.interviewonline.dto.RoomWhiteboardDto
import com.interviewonline.dto.RoomWhiteboardOperationDto
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
import java.util.UUID

@Service
class RoomWhiteboardService(
    private val rooms: RoomRepository,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val accessService: RoomAccessService,
    private val collaboration: CollaborationService,
    private val gate: RoomWhiteboardFeatureGate,
    private val validator: RoomWhiteboardValidator,
    private val canvasTaskScope: RoomCanvasTaskScope,
    transactionManager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(transactionManager)
    data class Credentials(val user: User?, val ownerToken: String?, val interviewerToken: String?, val eventToken: String?, val sessionId: String?)

    fun get(inviteCode: String, credentials: Credentials, requestedTaskId: String?): RoomWhiteboardDto {
        gate.requireEnabled()
        return requireNotNull(transaction.execute {
            val room = rooms.lockForSharedReadByInviteCode(inviteCode) ?: throw missingRoom()
            requireNotArchived(room)
            val liveRole = credentials.sessionId?.let {
                collaboration.resolveDiagramParticipantRole(room, it, credentials.eventToken, credentials.user, failureCode = "ROOM_EVENT_CAPABILITY_STALE")
            }
            val role = liveRole ?: accessService.resolveAccess(room, credentials.user, credentials.ownerToken, credentials.interviewerToken).role
            val taskId = canvasTaskScope.resolve(room, requestedTaskId, role.canManageRoom)
            snapshot(room, taskId).copy(canEdit = liveRole != null && canEdit(room, role))
        })
    }

    fun change(inviteCode: String, credentials: Credentials, body: JsonNode, requestedTaskId: String?): RoomWhiteboardOperationDto {
        gate.requireEnabled()
        val request = validator.readRequest(body)
        val outcome = requireNotNull(transaction.execute {
            val room = rooms.lockByInviteCode(inviteCode) ?: throw missingRoom()
            requireNotArchived(room)
            val sessionId = credentials.sessionId?.takeIf { it.isNotBlank() && it.length <= 255 } ?: throw denied()
            // The same admitted SSE capability and freshly resolved role protect
            // both room canvases; a UI flag or owner header cannot grant writes.
            val role = collaboration.resolveDiagramParticipantRole(room, sessionId, credentials.eventToken, credentials.user, failureCode = "ROOM_EVENT_CAPABILITY_STALE")
            if (room.status == "frozen") throw ApiException(HttpStatus.CONFLICT, "Комната недоступна для изменений", code = "ROOM_FROZEN")
            if (!canEdit(room, role)) throw ApiException(HttpStatus.FORBIDDEN, "Интервью доступно только для просмотра", code = "ROOM_READ_ONLY")
            val taskId = canvasTaskScope.resolve(room, requestedTaskId, role.canManageRoom)
            val current = snapshot(room, taskId)
            if (request.boardId != current.boardId) throw ApiException(HttpStatus.CONFLICT, "Доска относится к другой задаче или комнате", code = "WHITEBOARD_DOCUMENT_MISMATCH")
            val intent = mapper.writeValueAsString(validator.canonical(mapper.valueToTree<JsonNode>(request)))
            val fingerprint = MessageDigest.getInstance("SHA-256").digest("$sessionId\n$intent".toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
            val receipt = jdbc.query("SELECT sequence,fingerprint FROM room_whiteboard_operations WHERE board_id=? AND operation_id=?",
                { result, _ -> result.getLong("sequence") to result.getString("fingerprint") }, current.boardId, request.operationId).firstOrNull()
            if (receipt != null) {
                if (receipt.second != fingerprint) throw ApiException(HttpStatus.CONFLICT, "Идентификатор изменения уже использован", code = "WHITEBOARD_OPERATION_REUSED")
                return@execute RoomWhiteboardOperationDto(current.boardId, receipt.first, request.operationId, taskId) to false
            }
            if (request.baseSequence > current.sequence || current.sequence == Long.MAX_VALUE) throw conflict(current.sequence)
            val merged = current.elements.associateByTo(linkedMapOf()) { it.path("id").asText() }
            var changed = false
            request.elements.forEach { incoming ->
                val previous = merged[incoming.path("id").asText()]
                if (previous == null || wins(incoming, previous)) {
                    merged[incoming.path("id").asText()] = incoming
                    changed = true
                }
            }
            val elements = merged.values.toList()
            validator.validateScene(elements)
            val next = current.sequence + if (changed) 1 else 0
            if (changed) jdbc.update("""INSERT INTO room_whiteboards(room_id,task_id,id,sequence,elements) VALUES (?,?,?,?,?)
                ON CONFLICT (room_id,task_id) DO UPDATE SET sequence=EXCLUDED.sequence,elements=EXCLUDED.elements,updated_at=CURRENT_TIMESTAMP""".trimIndent(),
                room.id, taskId, current.boardId, next, mapper.writeValueAsString(elements))
            jdbc.update("INSERT INTO room_whiteboard_operations(room_id,board_id,operation_id,sequence,fingerprint) VALUES (?,?,?,?,?)",
                room.id, current.boardId, request.operationId, next, fingerprint)
            RoomWhiteboardOperationDto(current.boardId, next, request.operationId, taskId) to changed
        })
        // Publishing occurs after the transaction, room lock and DB connection
        // have been released; slow SSE clients cannot hold a write transaction.
        if (outcome.second) collaboration.broadcastWhiteboardChanged(inviteCode, RoomWhiteboardChangedDto(outcome.first.boardId, outcome.first.sequence, outcome.first.taskId))
        return outcome.first
    }

    private fun wins(incoming: JsonNode, previous: JsonNode): Boolean {
        val incomingVersion = incoming.path("version").asLong()
        val previousVersion = previous.path("version").asLong()
        return incomingVersion > previousVersion || (incomingVersion == previousVersion && incoming.path("versionNonce").asLong() < previous.path("versionNonce").asLong())
    }

    private fun snapshot(room: Room, taskId: String?): RoomWhiteboardDto {
        val stored = jdbc.query("SELECT id,sequence,elements FROM room_whiteboards WHERE room_id=? AND task_id IS NOT DISTINCT FROM ?",
            { result, _ -> RoomWhiteboardDto(result.getString("id"), result.getLong("sequence"), mapper.readTree(result.getString("elements")).toList(), false, taskId) },
            room.id, taskId).firstOrNull()
        if (stored != null) return stored
        val seed = if (taskId == null) "room-whiteboard:${room.id}" else "room-whiteboard:${room.id}:task:$taskId"
        return RoomWhiteboardDto(UUID.nameUUIDFromBytes(seed.toByteArray(StandardCharsets.UTF_8)).toString(), 0, emptyList(), false, taskId)
    }

    private fun canEdit(room: Room, role: RoomAccessService.RoomRole) = room.status != "frozen" && room.archivedAt == null && (room.status != "finished" || role.canManageRoom)
    private fun requireNotArchived(room: Room) {
        if (room.archivedAt != null) throw ApiException(if (room.teamId == null) HttpStatus.GONE else HttpStatus.NOT_FOUND, "Комната недоступна", code = "ROOM_ACCESS_DENIED")
    }
    private fun conflict(sequence: Long) = ApiException(HttpStatus.CONFLICT, "Доска уже изменилась. Восстановите актуальное состояние.", code = "WHITEBOARD_VERSION_CONFLICT", currentRevision = sequence)
    private fun denied() = ApiException(HttpStatus.FORBIDDEN, "Нет действующего подключения к комнате", code = "ROOM_ACCESS_DENIED")
    private fun missingRoom() = ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
}
