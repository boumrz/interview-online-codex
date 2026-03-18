package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.ws.ParticipantPayload
import com.interviewonline.ws.RoomRealtimePayload
import com.interviewonline.ws.WsOutgoingMessage
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

@Service
class CollaborationService(
    private val roomRepository: RoomRepository,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val notesLockMillis = 3_000L

    private enum class RoomRole(val wireValue: String) {
        OWNER("owner"),
        INTERVIEWER("interviewer"),
        CANDIDATE("candidate");

        val canManageRoom: Boolean
            get() = this == OWNER || this == INTERVIEWER
    }

    private enum class PresenceStatus(val wireValue: String) {
        ACTIVE("active"),
        AWAY("away");

        companion object {
            fun fromWire(value: String?): PresenceStatus {
                return when (value?.trim()?.lowercase()) {
                    AWAY.wireValue -> AWAY
                    else -> ACTIVE
                }
            }
        }
    }

    private data class ParticipantMeta(
        val inviteCode: String,
        val sessionId: String,
        val displayName: String,
        val role: RoomRole,
        var presenceStatus: PresenceStatus,
    ) {
        val isOwner: Boolean
            get() = role == RoomRole.OWNER
        val canManageRoom: Boolean
            get() = role.canManageRoom
    }

    private data class RealtimeState(
        var language: String,
        var code: String,
        var currentStep: Int,
        var notes: String,
        var notesLockedBySessionId: String? = null,
        var notesLockedByDisplayName: String? = null,
        var notesLockedUntilEpochMs: Long? = null,
    )

    private val roomSockets = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()
    private val participants = ConcurrentHashMap<String, ParticipantMeta>()
    private val roomState = ConcurrentHashMap<String, RealtimeState>()

    fun bootstrapRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
    }

    fun syncFromRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
        broadcastState(room.inviteCode)
    }

    fun joinRoom(
        inviteCode: String,
        socket: WebSocketSession,
        sessionId: String,
        displayName: String,
        ownerToken: String?,
        interviewerToken: String?,
    ) {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomState.computeIfAbsent(inviteCode) {
            toRealtimeState(room)
        }
        roomSockets.computeIfAbsent(inviteCode) { ConcurrentHashMap.newKeySet() }.add(socket)
        evictDuplicateSession(inviteCode, sessionId, socket.id)
        val role = resolveRole(room, ownerToken, interviewerToken)
        participants[socket.id] = ParticipantMeta(
            inviteCode = inviteCode,
            sessionId = sessionId,
            displayName = displayName,
            role = role,
            presenceStatus = PresenceStatus.ACTIVE,
        )
        broadcastState(inviteCode)
    }

    fun leaveRoom(socket: WebSocketSession) {
        val participant = participants.remove(socket.id) ?: return
        roomSockets[participant.inviteCode]?.remove(socket)
        broadcastState(participant.inviteCode)
    }

    fun updateCode(socket: WebSocketSession, code: String) {
        val participant = participants[socket.id] ?: return
        markParticipantActive(participant)
        roomState[participant.inviteCode]?.code = code
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.code = code
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    fun updateLanguage(socket: WebSocketSession, language: String) {
        val participant = participants[socket.id] ?: return
        markParticipantActive(participant)
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может менять язык")
        }
        roomState[participant.inviteCode]?.language = language
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.language = language
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    fun updateNotes(socket: WebSocketSession, notes: String) {
        val participant = participants[socket.id] ?: return
        markParticipantActive(participant)
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может редактировать заметки")
        }
        val lockUntil = Instant.now().toEpochMilli() + notesLockMillis
        roomState[participant.inviteCode]?.apply {
            this.notes = notes
            this.notesLockedBySessionId = participant.sessionId
            this.notesLockedByDisplayName = participant.displayName
            this.notesLockedUntilEpochMs = lockUntil
        }
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.notes = notes
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    fun updatePresence(socket: WebSocketSession, presenceStatus: String?) {
        val participant = participants[socket.id] ?: return
        val nextStatus = PresenceStatus.fromWire(presenceStatus)
        if (participant.presenceStatus == nextStatus) return
        participant.presenceStatus = nextStatus
        broadcastState(participant.inviteCode)
    }

    @Transactional
    fun nextStep(socket: WebSocketSession) {
        val participant = participants[socket.id] ?: return
        markParticipantActive(participant)
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может переключать шаги")
        }
        val room = roomRepository.findByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        val maxStep = room.tasks.size - 1
        setStepInternal(participant.inviteCode, room, (room.currentStep + 1).coerceAtMost(maxStep))
    }

    @Transactional
    fun setStep(socket: WebSocketSession, stepIndex: Int) {
        val participant = participants[socket.id] ?: return
        markParticipantActive(participant)
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может переключать шаги")
        }
        val room = roomRepository.findByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        if (stepIndex < 0 || stepIndex >= room.tasks.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Номер шага вне диапазона")
        }
        setStepInternal(participant.inviteCode, room, stepIndex)
    }

    fun closeRoom(inviteCode: String) {
        roomState.remove(inviteCode)
        roomSockets.remove(inviteCode)?.forEach { socket ->
            try {
                if (socket.isOpen) {
                    socket.close()
                }
            } catch (_: Exception) {
            }
        }
        participants.entries.removeIf { it.value.inviteCode == inviteCode }
    }

    private fun broadcastState(inviteCode: String) {
        val faultProfile = realtimeFaultInjectionService.profileFor(inviteCode)
        if (faultProfile != null && faultProfile.latencyMs > 0) {
            Thread.sleep(faultProfile.latencyMs.toLong())
        }
        if (realtimeFaultInjectionService.shouldDropMessage(inviteCode)) {
            logger.info("Fault injection dropped realtime broadcast for room {}", inviteCode)
            return
        }

        val state = roomState[inviteCode] ?: return
        val sockets = roomSockets[inviteCode]?.toList().orEmpty()
        if (sockets.isEmpty()) return
        val participantsPayload = participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .sortedBy { it.displayName.lowercase() }
            .distinctBy { it.sessionId }
            .map { ParticipantPayload(it.sessionId, it.displayName, it.presenceStatus.wireValue) }
            .toList()
        sockets.filterNotNull().forEach { socket ->
            try {
                val participant = participants[socket.id]
                val payload = RoomRealtimePayload(
                    inviteCode = inviteCode,
                    language = state.language,
                    code = state.code,
                    currentStep = state.currentStep,
                    notes = state.notes,
                    participants = participantsPayload,
                    isOwner = participant?.isOwner == true,
                    role = participant?.role?.wireValue ?: RoomRole.CANDIDATE.wireValue,
                    canManageRoom = participant?.canManageRoom == true,
                    notesLockedBySessionId = state.notesLockedBySessionId,
                    notesLockedByDisplayName = state.notesLockedByDisplayName,
                    notesLockedUntilEpochMs = state.notesLockedUntilEpochMs,
                )
                val message = WsOutgoingMessage(type = "state_sync", payload = payload)
                if (socket.isOpen) {
                    synchronized(socket) {
                        if (socket.isOpen) {
                            socket.sendMessage(TextMessage(objectMapper.writeValueAsString(message)))
                        }
                    }
                }
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast room state", ex)
                roomSockets[inviteCode]?.remove(socket)
                participants.remove(socket.id)
            }
        }
    }

    private fun setStepInternal(inviteCode: String, room: Room, stepIndex: Int) {
        room.currentStep = stepIndex
        room.code = room.tasks[stepIndex].starterCode
        roomRepository.save(room)
        val currentState = roomState[inviteCode]
        roomState[inviteCode] = RealtimeState(
            language = room.language,
            code = room.code,
            currentStep = room.currentStep,
            notes = room.notes.orEmpty(),
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
        )
        broadcastState(inviteCode)
    }

    private fun markParticipantActive(participant: ParticipantMeta) {
        if (participant.presenceStatus != PresenceStatus.ACTIVE) {
            participant.presenceStatus = PresenceStatus.ACTIVE
        }
    }

    private fun evictDuplicateSession(inviteCode: String, sessionId: String, currentSocketId: String) {
        val duplicateSocketIds = participants.entries
            .asSequence()
            .filter { (socketId, participant) ->
                socketId != currentSocketId &&
                    participant.inviteCode == inviteCode &&
                    participant.sessionId == sessionId
            }
            .map { it.key }
            .toList()

        if (duplicateSocketIds.isEmpty()) return

        val socketsInRoom = roomSockets[inviteCode]
        duplicateSocketIds.forEach { socketId ->
            participants.remove(socketId)
            val oldSocket = socketsInRoom?.firstOrNull { it.id == socketId }
            if (oldSocket != null) {
                socketsInRoom.remove(oldSocket)
                runCatching {
                    if (oldSocket.isOpen) {
                        oldSocket.close()
                    }
                }
            }
        }
    }

    private fun resolveRole(room: Room, ownerToken: String?, interviewerToken: String?): RoomRole {
        return when {
            !ownerToken.isNullOrBlank() && room.ownerSessionToken == ownerToken -> RoomRole.OWNER
            !interviewerToken.isNullOrBlank() && room.interviewerSessionToken == interviewerToken -> RoomRole.INTERVIEWER
            else -> RoomRole.CANDIDATE
        }
    }

    private fun toRealtimeState(room: Room): RealtimeState {
        return RealtimeState(
            language = room.language,
            code = room.code,
            currentStep = room.currentStep,
            notes = room.notes.orEmpty(),
            notesLockedBySessionId = null,
            notesLockedByDisplayName = null,
            notesLockedUntilEpochMs = null,
        )
    }
}
