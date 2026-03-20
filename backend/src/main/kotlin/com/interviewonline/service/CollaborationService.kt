package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.ws.CandidateKeyPayload
import com.interviewonline.ws.CursorPayload
import com.interviewonline.ws.ParticipantPayload
import com.interviewonline.ws.RealtimeEventRequest
import com.interviewonline.ws.RoomRealtimePayload
import com.interviewonline.ws.WsOutgoingMessage
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

@Service
class CollaborationService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val notesLockMillis = 3_000L
    private val keyEventBroadcastThrottleMs = 100L

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
        var lastCodeUpdatedBySessionId: String? = null,
        var currentStep: Int,
        var notes: String,
        var notesLockedBySessionId: String? = null,
        var notesLockedByDisplayName: String? = null,
        var notesLockedUntilEpochMs: Long? = null,
        val cursorsBySessionId: MutableMap<String, CursorState> = ConcurrentHashMap(),
        var lastCandidateKey: CandidateKeyPayload? = null,
        var lastCandidateKeyAtEpochMs: Long = 0L,
    )

    private data class CursorState(
        var lineNumber: Int,
        var column: Int,
    )

    private val roomSockets = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()
    private val roomSseConnections = ConcurrentHashMap<String, MutableSet<String>>()
    private val wsConnections = ConcurrentHashMap<String, WebSocketSession>()
    private val sseConnections = ConcurrentHashMap<String, SseEmitter>()
    private val participants = ConcurrentHashMap<String, ParticipantMeta>()
    private val roomState = ConcurrentHashMap<String, RealtimeState>()
    private val connectionByRoomSession = ConcurrentHashMap<String, String>()

    fun bootstrapRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
    }

    fun syncFromRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
        broadcastState(room.inviteCode)
    }

    @Transactional
    fun joinRoom(
        inviteCode: String,
        socket: WebSocketSession,
        sessionId: String,
        displayName: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ) {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomState.computeIfAbsent(inviteCode) {
            toRealtimeState(room)
        }

        wsConnections[socket.id] = socket
        roomSockets.computeIfAbsent(inviteCode) { ConcurrentHashMap.newKeySet() }.add(socket)
        evictDuplicateSession(inviteCode, sessionId, socket.id)

        val role = resolveRole(room, ownerToken, interviewerToken, user)
        participants[socket.id] = ParticipantMeta(
            inviteCode = inviteCode,
            sessionId = sessionId,
            displayName = displayName,
            role = role,
            presenceStatus = PresenceStatus.ACTIVE,
        )
        connectionByRoomSession[roomSessionKey(inviteCode, sessionId)] = socket.id
        broadcastState(inviteCode)
    }

    @Transactional
    fun joinRoomSse(
        inviteCode: String,
        sessionId: String,
        displayName: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): SseEmitter {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomState.computeIfAbsent(inviteCode) {
            toRealtimeState(room)
        }

        val connectionId = sseConnectionId(sessionId)
        val emitter = SseEmitter(0L)
        sseConnections[connectionId] = emitter
        roomSseConnections.computeIfAbsent(inviteCode) { ConcurrentHashMap.newKeySet() }.add(connectionId)
        evictDuplicateSession(inviteCode, sessionId, connectionId)

        val role = resolveRole(room, ownerToken, interviewerToken, user)
        participants[connectionId] = ParticipantMeta(
            inviteCode = inviteCode,
            sessionId = sessionId,
            displayName = displayName,
            role = role,
            presenceStatus = PresenceStatus.ACTIVE,
        )
        connectionByRoomSession[roomSessionKey(inviteCode, sessionId)] = connectionId

        emitter.onCompletion { leaveRoomConnection(connectionId) }
        emitter.onTimeout { leaveRoomConnection(connectionId) }
        emitter.onError { leaveRoomConnection(connectionId) }

        broadcastState(inviteCode)
        return emitter
    }

    fun leaveRoom(socket: WebSocketSession) {
        leaveRoomConnection(socket.id)
    }

    fun leaveRoomConnection(connectionId: String) {
        val inviteCode = detachConnection(connectionId, closeTransport = false)
        if (inviteCode != null) {
            broadcastState(inviteCode)
        }
    }

    @Transactional
    fun handleRealtimeEvent(inviteCode: String, request: RealtimeEventRequest) {
        val connectionId = requireConnectionId(inviteCode, request.sessionId)
        when (request.type) {
            "code_update" -> updateCode(connectionId, request.code.orEmpty())
            "language_update" -> updateLanguage(connectionId, request.language.orEmpty())
            "next_step" -> nextStep(connectionId)
            "set_step" -> setStep(connectionId, request.stepIndex ?: -1)
            "notes_update" -> updateNotes(connectionId, request.notes.orEmpty())
            "presence_update" -> updatePresence(connectionId, request.presenceStatus)
            "cursor_update" -> updateCursor(connectionId, request.lineNumber, request.column)
            "yjs_update" -> relayYjsUpdate(connectionId, request.yjsUpdate.orEmpty())
            "key_press" -> trackKeyPress(
                connectionId = connectionId,
                key = request.key,
                keyCode = request.keyCode,
                ctrlKey = request.ctrlKey ?: false,
                altKey = request.altKey ?: false,
                shiftKey = request.shiftKey ?: false,
                metaKey = request.metaKey ?: false,
            )
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный тип сообщения: ${request.type}")
        }
    }

    fun updateCode(socket: WebSocketSession, code: String) {
        updateCode(socket.id, code)
    }

    private fun updateCode(connectionId: String, code: String) {
        val participant = participants[connectionId] ?: return
        markParticipantActive(participant)
        roomState[participant.inviteCode]?.apply {
            this.code = code
            this.lastCodeUpdatedBySessionId = participant.sessionId
        }
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.code = code
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    fun relayYjsUpdate(socket: WebSocketSession, yjsUpdate: String) {
        relayYjsUpdate(socket.id, yjsUpdate)
    }

    private fun relayYjsUpdate(connectionId: String, yjsUpdate: String) {
        val participant = participants[connectionId] ?: return
        if (yjsUpdate.isBlank()) return
        markParticipantActive(participant)
        broadcastTransportMessage(
            inviteCode = participant.inviteCode,
            type = "yjs_update",
            payload = mapOf(
                "sessionId" to participant.sessionId,
                "yjsUpdate" to yjsUpdate,
            ),
            excludeConnectionId = connectionId,
        )
    }

    fun updateLanguage(socket: WebSocketSession, language: String) {
        updateLanguage(socket.id, language)
    }

    private fun updateLanguage(connectionId: String, language: String) {
        val participant = participants[connectionId] ?: return
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
        updateNotes(socket.id, notes)
    }

    private fun updateNotes(connectionId: String, notes: String) {
        val participant = participants[connectionId] ?: return
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
        updatePresence(socket.id, presenceStatus)
    }

    private fun updatePresence(connectionId: String, presenceStatus: String?) {
        val participant = participants[connectionId] ?: return
        val nextStatus = PresenceStatus.fromWire(presenceStatus)
        if (participant.presenceStatus == nextStatus) return
        participant.presenceStatus = nextStatus
        broadcastState(participant.inviteCode)
    }

    fun updateCursor(socket: WebSocketSession, lineNumber: Int?, column: Int?) {
        updateCursor(socket.id, lineNumber, column)
    }

    private fun updateCursor(connectionId: String, lineNumber: Int?, column: Int?) {
        val participant = participants[connectionId] ?: return
        val nextLine = (lineNumber ?: 1).coerceAtLeast(1)
        val nextColumn = (column ?: 1).coerceAtLeast(1)

        val state = roomState[participant.inviteCode] ?: return
        val currentCursor = state.cursorsBySessionId[participant.sessionId]
        if (currentCursor != null && currentCursor.lineNumber == nextLine && currentCursor.column == nextColumn) {
            return
        }

        state.cursorsBySessionId[participant.sessionId] = CursorState(
            lineNumber = nextLine,
            column = nextColumn,
        )
        markParticipantActive(participant)
        broadcastState(participant.inviteCode)
    }

    fun trackKeyPress(
        socket: WebSocketSession,
        key: String?,
        keyCode: String?,
        ctrlKey: Boolean,
        altKey: Boolean,
        shiftKey: Boolean,
        metaKey: Boolean,
    ) {
        trackKeyPress(socket.id, key, keyCode, ctrlKey, altKey, shiftKey, metaKey)
    }

    private fun trackKeyPress(
        connectionId: String,
        key: String?,
        keyCode: String?,
        ctrlKey: Boolean,
        altKey: Boolean,
        shiftKey: Boolean,
        metaKey: Boolean,
    ) {
        val participant = participants[connectionId] ?: return
        if (participant.role != RoomRole.CANDIDATE) return

        val normalizedKey = key.orEmpty().trim().take(32)
        val normalizedCode = keyCode.orEmpty().trim().take(32)
        if (normalizedKey.isBlank() && normalizedCode.isBlank()) return

        val state = roomState[participant.inviteCode] ?: return
        val now = Instant.now().toEpochMilli()
        if (now - state.lastCandidateKeyAtEpochMs < keyEventBroadcastThrottleMs) {
            return
        }

        state.lastCandidateKey = CandidateKeyPayload(
            sessionId = participant.sessionId,
            displayName = participant.displayName,
            key = normalizedKey.ifBlank { "Unknown" },
            keyCode = normalizedCode.ifBlank { "Unknown" },
            ctrlKey = ctrlKey,
            altKey = altKey,
            shiftKey = shiftKey,
            metaKey = metaKey,
            timestampEpochMs = now,
        )
        state.lastCandidateKeyAtEpochMs = now
        markParticipantActive(participant)
        broadcastState(participant.inviteCode)
    }

    @Transactional
    fun nextStep(socket: WebSocketSession) {
        nextStep(socket.id)
    }

    private fun nextStep(connectionId: String) {
        val participant = participants[connectionId] ?: return
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
        setStep(socket.id, stepIndex)
    }

    private fun setStep(connectionId: String, stepIndex: Int) {
        val participant = participants[connectionId] ?: return
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
        val connectionIds = participants.entries
            .asSequence()
            .filter { it.value.inviteCode == inviteCode }
            .map { it.key }
            .toList()
        connectionIds.forEach { connectionId ->
            detachConnection(connectionId, closeTransport = true)
        }
        roomSockets.remove(inviteCode)
        roomSseConnections.remove(inviteCode)
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
        val roomParticipants = participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .sortedBy { it.displayName.lowercase() }
            .distinctBy { it.sessionId }
            .toList()
        val participantsPayload = roomParticipants
            .map { ParticipantPayload(it.sessionId, it.displayName, it.role.wireValue, it.presenceStatus.wireValue) }
        val roleBySessionId = roomParticipants.associate { it.sessionId to it.role.wireValue }
        val displayNameBySessionId = roomParticipants.associate { it.sessionId to it.displayName }
        val cursorsPayload = state.cursorsBySessionId.entries
            .asSequence()
            .mapNotNull { (sessionId, cursor) ->
                val role = roleBySessionId[sessionId] ?: return@mapNotNull null
                val displayName = displayNameBySessionId[sessionId] ?: return@mapNotNull null
                CursorPayload(
                    sessionId = sessionId,
                    displayName = displayName,
                    role = role,
                    lineNumber = cursor.lineNumber,
                    column = cursor.column,
                )
            }
            .toList()

        val sockets = roomSockets[inviteCode]?.toList().orEmpty()
        sockets.filterNotNull().forEach { socket ->
            val connectionId = socket.id
            val participant = participants[connectionId]
            if (participant == null) {
                detachConnection(connectionId, closeTransport = false)
                return@forEach
            }
            try {
                val payload = buildPayload(inviteCode, state, participantsPayload, cursorsPayload, participant)
                val message = WsOutgoingMessage(type = "state_sync", payload = payload)
                if (socket.isOpen) {
                    synchronized(socket) {
                        if (socket.isOpen) {
                            socket.sendMessage(TextMessage(objectMapper.writeValueAsString(message)))
                        }
                    }
                }
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast room state via websocket", ex)
                detachConnection(connectionId, closeTransport = true)
            }
        }

        val sseConnectionIds = roomSseConnections[inviteCode]?.toList().orEmpty()
        sseConnectionIds.forEach { connectionId ->
            val participant = participants[connectionId]
            val emitter = sseConnections[connectionId]
            if (participant == null || emitter == null) {
                detachConnection(connectionId, closeTransport = false)
                return@forEach
            }
            try {
                val payload = buildPayload(inviteCode, state, participantsPayload, cursorsPayload, participant)
                val message = WsOutgoingMessage(type = "state_sync", payload = payload)
                emitter.send(
                    SseEmitter.event()
                        .data(objectMapper.writeValueAsString(message)),
                )
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast room state via sse", ex)
                detachConnection(connectionId, closeTransport = true)
            }
        }
    }

    private fun broadcastTransportMessage(
        inviteCode: String,
        type: String,
        payload: Any,
        excludeConnectionId: String? = null,
    ) {
        val faultProfile = realtimeFaultInjectionService.profileFor(inviteCode)
        if (faultProfile != null && faultProfile.latencyMs > 0) {
            Thread.sleep(faultProfile.latencyMs.toLong())
        }
        if (realtimeFaultInjectionService.shouldDropMessage(inviteCode)) {
            logger.info("Fault injection dropped realtime transport message for room {}", inviteCode)
            return
        }

        val message = WsOutgoingMessage(type = type, payload = payload)
        val encoded = objectMapper.writeValueAsString(message)

        val sockets = roomSockets[inviteCode]?.toList().orEmpty()
        sockets.filterNotNull().forEach { socket ->
            val connectionId = socket.id
            if (excludeConnectionId != null && excludeConnectionId == connectionId) return@forEach
            if (participants[connectionId] == null) {
                detachConnection(connectionId, closeTransport = false)
                return@forEach
            }
            try {
                sendWsMessage(socket, encoded)
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast realtime transport message via websocket", ex)
                detachConnection(connectionId, closeTransport = true)
            }
        }

        val sseConnectionIds = roomSseConnections[inviteCode]?.toList().orEmpty()
        sseConnectionIds.forEach { connectionId ->
            if (excludeConnectionId != null && excludeConnectionId == connectionId) return@forEach
            val emitter = sseConnections[connectionId]
            if (participants[connectionId] == null || emitter == null) {
                detachConnection(connectionId, closeTransport = false)
                return@forEach
            }
            try {
                sendSseMessage(emitter, encoded)
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast realtime transport message via sse", ex)
                detachConnection(connectionId, closeTransport = true)
            }
        }
    }

    private fun sendWsMessage(socket: WebSocketSession, encodedMessage: String) {
        if (!socket.isOpen) return
        synchronized(socket) {
            if (socket.isOpen) {
                socket.sendMessage(TextMessage(encodedMessage))
            }
        }
    }

    private fun sendSseMessage(emitter: SseEmitter, encodedMessage: String) {
        emitter.send(
            SseEmitter.event()
                .data(encodedMessage),
        )
    }

    private fun buildPayload(
        inviteCode: String,
        state: RealtimeState,
        participantsPayload: List<ParticipantPayload>,
        cursorsPayload: List<CursorPayload>,
        participant: ParticipantMeta,
    ): RoomRealtimePayload {
        return RoomRealtimePayload(
            inviteCode = inviteCode,
            language = state.language,
            code = state.code,
            lastCodeUpdatedBySessionId = state.lastCodeUpdatedBySessionId,
            currentStep = state.currentStep,
            notes = state.notes,
            participants = participantsPayload,
            isOwner = participant.isOwner,
            role = participant.role.wireValue,
            canManageRoom = participant.canManageRoom,
            notesLockedBySessionId = state.notesLockedBySessionId,
            notesLockedByDisplayName = state.notesLockedByDisplayName,
            notesLockedUntilEpochMs = state.notesLockedUntilEpochMs,
            cursors = cursorsPayload,
            lastCandidateKey = state.lastCandidateKey,
        )
    }

    private fun setStepInternal(inviteCode: String, room: Room, stepIndex: Int) {
        room.currentStep = stepIndex
        room.code = room.tasks[stepIndex].starterCode
        roomRepository.save(room)
        val currentState = roomState[inviteCode]
        roomState[inviteCode] = RealtimeState(
            language = room.language,
            code = room.code,
            lastCodeUpdatedBySessionId = null,
            currentStep = room.currentStep,
            notes = room.notes.orEmpty(),
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
            cursorsBySessionId = currentState?.cursorsBySessionId ?: ConcurrentHashMap(),
            lastCandidateKey = currentState?.lastCandidateKey,
            lastCandidateKeyAtEpochMs = currentState?.lastCandidateKeyAtEpochMs ?: 0L,
        )
        broadcastState(inviteCode)
    }

    private fun markParticipantActive(participant: ParticipantMeta) {
        if (participant.presenceStatus != PresenceStatus.ACTIVE) {
            participant.presenceStatus = PresenceStatus.ACTIVE
        }
    }

    private fun evictDuplicateSession(inviteCode: String, sessionId: String, currentConnectionId: String) {
        val duplicateConnectionIds = participants.entries
            .asSequence()
            .filter { (connectionId, participant) ->
                connectionId != currentConnectionId &&
                    participant.inviteCode == inviteCode &&
                    participant.sessionId == sessionId
            }
            .map { it.key }
            .toList()

        if (duplicateConnectionIds.isEmpty()) return

        duplicateConnectionIds.forEach { connectionId ->
            detachConnection(connectionId, closeTransport = true)
        }
    }

    private fun requireConnectionId(inviteCode: String, sessionId: String): String {
        if (sessionId.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Отсутствует sessionId")
        }

        val key = roomSessionKey(inviteCode, sessionId)
        val connectionId = connectionByRoomSession[key]
            ?: throw ApiException(HttpStatus.FORBIDDEN, "Нет активного подключения для этой сессии")
        val participant = participants[connectionId]
        if (participant == null || participant.inviteCode != inviteCode || participant.sessionId != sessionId) {
            connectionByRoomSession.remove(key, connectionId)
            throw ApiException(HttpStatus.FORBIDDEN, "Нет активного подключения для этой сессии")
        }
        return connectionId
    }

    private fun detachConnection(connectionId: String, closeTransport: Boolean): String? {
        val participant = participants.remove(connectionId)
        val inviteCode = participant?.inviteCode

        if (participant != null) {
            connectionByRoomSession.remove(roomSessionKey(participant.inviteCode, participant.sessionId), connectionId)
            roomState[participant.inviteCode]?.let { state ->
                state.cursorsBySessionId.remove(participant.sessionId)
                if (state.lastCandidateKey?.sessionId == participant.sessionId) {
                    state.lastCandidateKey = null
                    state.lastCandidateKeyAtEpochMs = 0L
                }
            }
        }

        wsConnections.remove(connectionId)?.let { socket ->
            if (inviteCode != null) {
                roomSockets[inviteCode]?.remove(socket)
            } else {
                roomSockets.values.forEach { it.remove(socket) }
            }
            if (closeTransport) {
                runCatching {
                    if (socket.isOpen) {
                        socket.close()
                    }
                }
            }
        }

        sseConnections.remove(connectionId)?.let { emitter ->
            if (inviteCode != null) {
                roomSseConnections[inviteCode]?.remove(connectionId)
            } else {
                roomSseConnections.values.forEach { it.remove(connectionId) }
            }
            if (closeTransport) {
                runCatching { emitter.complete() }
            }
        }

        if (inviteCode != null) {
            roomSseConnections[inviteCode]?.remove(connectionId)
        } else {
            roomSseConnections.values.forEach { it.remove(connectionId) }
        }

        return inviteCode
    }

    private fun roomSessionKey(inviteCode: String, sessionId: String): String {
        return "$inviteCode::$sessionId"
    }

    private fun sseConnectionId(sessionId: String): String {
        return "sse:$sessionId"
    }

    private fun resolveRole(room: Room, ownerToken: String?, interviewerToken: String?, user: User?): RoomRole {
        if (room.ownerUser != null) {
            val hasValidInterviewerToken =
                !interviewerToken.isNullOrBlank() && room.interviewerSessionToken == interviewerToken
            if (user == null) {
                return if (hasValidInterviewerToken) RoomRole.INTERVIEWER else RoomRole.CANDIDATE
            }

            val roomId = room.id ?: return if (hasValidInterviewerToken) RoomRole.INTERVIEWER else RoomRole.CANDIDATE
            val userId = user.id ?: return if (hasValidInterviewerToken) RoomRole.INTERVIEWER else RoomRole.CANDIDATE
            if (room.ownerUser?.id == userId) return RoomRole.OWNER

            val participant = roomParticipantRepository.findByRoomIdAndUserId(roomId, userId)
            if (participant != null) return RoomRole.INTERVIEWER

            if (hasValidInterviewerToken) {
                roomParticipantRepository.save(
                    RoomParticipant(
                        room = room,
                        user = user,
                        role = "interviewer",
                    ),
                )
                return RoomRole.INTERVIEWER
            }
            return RoomRole.CANDIDATE
        }

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
            lastCodeUpdatedBySessionId = null,
            currentStep = room.currentStep,
            notes = room.notes.orEmpty(),
            notesLockedBySessionId = null,
            notesLockedByDisplayName = null,
            notesLockedUntilEpochMs = null,
        )
    }
}
