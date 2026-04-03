package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.ws.CandidateKeyPayload
import com.interviewonline.ws.CursorPayload
import com.interviewonline.ws.NoteMessagePayload
import com.interviewonline.ws.ParticipantPayload
import com.interviewonline.ws.RealtimeEventRequest
import com.interviewonline.ws.RoomRealtimePayload
import com.interviewonline.ws.WsOutgoingMessage
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.time.Instant
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

@Service
class CollaborationService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val userRepository: UserRepository,
    private val roomAccessService: RoomAccessService,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val notesLockMillis = 3_000L
    private val keyEventBroadcastThrottleMs = 20L
    private val candidateKeyHistoryMaxSize = 50
    private val notesHistoryLimit = 500
    private val maxYjsDocumentBase64Chars = 400_000
    private val maxAwarenessUpdateBase64Chars = 24_000

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
        val userId: String?,
        var role: RoomAccessService.RoomRole,
        var presenceStatus: PresenceStatus,
    ) {
        val isOwner: Boolean
            get() = role == RoomAccessService.RoomRole.OWNER
        val canManageRoom: Boolean
            get() = role.canManageRoom
        val canGrantAccess: Boolean
            get() = role.canGrantAccess
    }

    private data class RealtimeState(
        var language: String,
        var code: String,
        var lastCodeUpdatedBySessionId: String? = null,
        var yjsDocumentBase64: String? = null,
        var lastYjsSequence: Long = 0,
        var currentStep: Int,
        var notes: String,
        val notesMessages: MutableList<NoteMessagePayload> = mutableListOf(),
        var briefingMarkdown: String = "",
        var notesLockedBySessionId: String? = null,
        var notesLockedByDisplayName: String? = null,
        var notesLockedUntilEpochMs: Long? = null,
        val taskScoresByStepIndex: MutableMap<Int, Int?> = Collections.synchronizedMap(mutableMapOf()),
        val cursorsBySessionId: MutableMap<String, CursorState> = ConcurrentHashMap(),
        val lastCursorSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val lastCodeSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val lastYjsSnapshotSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val grantedRoleBySessionId: MutableMap<String, RoomAccessService.RoomRole> = ConcurrentHashMap(),
        var lastCandidateKey: CandidateKeyPayload? = null,
        val candidateKeyHistory: MutableList<CandidateKeyPayload> = mutableListOf(),
        var lastCandidateKeyAtEpochMs: Long = 0L,
    )

    private data class CursorState(
        var lineNumber: Int,
        var column: Int,
        var selectionStartLineNumber: Int? = null,
        var selectionStartColumn: Int? = null,
        var selectionEndLineNumber: Int? = null,
        var selectionEndColumn: Int? = null,
    )

    private data class NotesThreadPayload(
        val version: Int = 1,
        val messages: List<NoteMessagePayload> = emptyList(),
    )

    private val roomSseConnections = ConcurrentHashMap<String, MutableSet<String>>()
    private val sseConnections = ConcurrentHashMap<String, SseEmitter>()
    private val participants = ConcurrentHashMap<String, ParticipantMeta>()
    private val roomState = ConcurrentHashMap<String, RealtimeState>()
    private val connectionByRoomSession = ConcurrentHashMap<String, String>()
    private val yjsStateBroadcastScheduler = Executors.newSingleThreadScheduledExecutor()
    private val pendingYjsStateBroadcastByRoom = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val roomCodeDbSaveScheduler = Executors.newSingleThreadScheduledExecutor()
    private val pendingRoomCodeDbSaveByRoom = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val latestCodeForDebouncedDbSaveByRoom = ConcurrentHashMap<String, String>()

    fun bootstrapRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
    }

    fun syncFromRoom(room: Room) {
        val currentState = roomState[room.inviteCode]
        val nextState = toRealtimeState(room)
        roomState[room.inviteCode] = nextState.copy(
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
            cursorsBySessionId = currentState?.cursorsBySessionId ?: ConcurrentHashMap(),
            lastCursorSequenceBySessionId = currentState?.lastCursorSequenceBySessionId ?: ConcurrentHashMap(),
            lastCodeSequenceBySessionId = currentState?.lastCodeSequenceBySessionId ?: ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = currentState?.lastYjsSnapshotSequenceBySessionId ?: ConcurrentHashMap(),
            grantedRoleBySessionId = currentState?.grantedRoleBySessionId ?: ConcurrentHashMap(),
            lastYjsSequence = currentState?.lastYjsSequence ?: 0,
            yjsDocumentBase64 = currentState?.yjsDocumentBase64,
            lastCandidateKey = currentState?.lastCandidateKey,
            candidateKeyHistory = currentState?.candidateKeyHistory?.toMutableList() ?: mutableListOf(),
            lastCandidateKeyAtEpochMs = currentState?.lastCandidateKeyAtEpochMs ?: 0L,
        )
        broadcastState(room.inviteCode)
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
        @Suppress("UNUSED_VARIABLE")
        val legacyInterviewerToken = interviewerToken
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val state = roomState.computeIfAbsent(inviteCode) { toRealtimeState(room) }

        val connectionId = sseConnectionId(sessionId)
        val emitter = SseEmitter(0L)
        val resolvedRole = resolveRole(room, ownerToken, user)
        val roleOverride = state.grantedRoleBySessionId[sessionId]
        val effectiveRole = if (resolvedRole == RoomAccessService.RoomRole.OWNER) resolvedRole else roleOverride ?: resolvedRole

        participants[connectionId] = ParticipantMeta(
            inviteCode = inviteCode,
            sessionId = sessionId,
            displayName = displayName.trim().ifBlank { "Участник" }.take(64),
            userId = user?.id,
            role = effectiveRole,
            presenceStatus = PresenceStatus.ACTIVE,
        )
        connectionByRoomSession[roomSessionKey(inviteCode, sessionId)] = connectionId
        sseConnections[connectionId] = emitter
        roomSseConnections.computeIfAbsent(inviteCode) { ConcurrentHashMap.newKeySet() }.add(connectionId)
        evictDuplicateSession(inviteCode, sessionId, connectionId)

        emitter.onCompletion { leaveRoomConnection(connectionId) }
        emitter.onTimeout { leaveRoomConnection(connectionId) }
        emitter.onError { leaveRoomConnection(connectionId) }

        broadcastState(inviteCode)
        return emitter
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
            "code_update" -> updateCode(connectionId, request.code.orEmpty(), request.codeSequence)
            "language_update" -> updateLanguage(connectionId, request.language.orEmpty())
            "next_step" -> nextStep(connectionId)
            "set_step" -> setStep(connectionId, request.stepIndex ?: -1)
            "task_rating_update" -> updateTaskRating(connectionId, request.stepIndex, request.rating)
            "notes_update" -> updateNotes(connectionId, request.notes.orEmpty())
            "note_message" -> appendNoteMessage(
                connectionId = connectionId,
                noteId = request.noteId,
                noteText = request.noteText,
                noteTimestampEpochMs = request.noteTimestampEpochMs,
            )
            "presentation_markdown_update", "briefing_markdown_update" ->
                updateBriefingMarkdown(connectionId, request.briefingMarkdown ?: request.presentationMarkdown.orEmpty())
            "presence_update" -> updatePresence(connectionId, request.presenceStatus)
            "cursor_update" -> updateCursor(
                connectionId = connectionId,
                lineNumber = request.lineNumber,
                column = request.column,
                selectionStartLineNumber = request.selectionStartLineNumber,
                selectionStartColumn = request.selectionStartColumn,
                selectionEndLineNumber = request.selectionEndLineNumber,
                selectionEndColumn = request.selectionEndColumn,
                cursorSequence = request.cursorSequence,
            )
            "awareness_update" -> relayAwarenessUpdate(connectionId, request.awarenessUpdate.orEmpty())
            "yjs_update" -> relayYjsUpdate(
                connectionId = connectionId,
                yjsUpdate = request.yjsUpdate.orEmpty(),
                syncKey = request.syncKey,
                codeSnapshot = request.code,
                yjsClientSequence = request.yjsClientSequence,
                yjsDocumentBase64 = request.yjsDocumentBase64,
            )
            "request_state_sync" -> sendStateToConnection(connectionId)
            "grant_interviewer_access" -> updateParticipantRoomRole(
                connectionId = connectionId,
                targetSessionId = request.targetSessionId,
                targetUserId = request.targetUserId,
                targetRole = RoomAccessService.RoomRole.INTERVIEWER,
            )
            "revoke_interviewer_access" -> updateParticipantRoomRole(
                connectionId = connectionId,
                targetSessionId = request.targetSessionId,
                targetUserId = request.targetUserId,
                targetRole = RoomAccessService.RoomRole.CANDIDATE,
            )
            "participant_role_update" -> updateParticipantRoomRole(
                connectionId = connectionId,
                targetSessionId = request.targetSessionId,
                targetUserId = request.targetUserId,
                targetRole = roomAccessService.normalizeRole(request.role),
            )
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

    private fun sendStateToConnection(connectionId: String) {
        val participant = participants[connectionId] ?: return
        val inviteCode = participant.inviteCode
        val state = roomState[inviteCode] ?: return
        val emitter = sseConnections[connectionId] ?: return

        val roomParticipants = participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .sortedBy { it.displayName.lowercase() }
            .distinctBy { it.sessionId }
            .toList()
        val participantsPayload = roomParticipants.map { participantMetaToPayload(it) }
        val participantBySessionId = roomParticipants.associateBy { it.sessionId }
        val cursorsPayload = state.cursorsBySessionId.entries
            .asSequence()
            .mapNotNull { (sessionId, cursor) ->
                val participantMeta = participantBySessionId[sessionId] ?: return@mapNotNull null
                CursorPayload(
                    sessionId = sessionId,
                    displayName = participantMeta.displayName,
                    role = participantMeta.role.wireValue,
                    cursorSequence = state.lastCursorSequenceBySessionId[sessionId],
                    lineNumber = cursor.lineNumber,
                    column = cursor.column,
                    selectionStartLineNumber = cursor.selectionStartLineNumber,
                    selectionStartColumn = cursor.selectionStartColumn,
                    selectionEndLineNumber = cursor.selectionEndLineNumber,
                    selectionEndColumn = cursor.selectionEndColumn,
                )
            }
            .toList()

        try {
            val payload = buildPayload(inviteCode, state, participantsPayload, cursorsPayload, participant)
            val message = WsOutgoingMessage(type = "state_sync", payload = payload)
            sendSseMessage(emitter, objectMapper.writeValueAsString(message))
        } catch (ex: Exception) {
            logger.warn("Failed to send room state via sse", ex)
            detachConnection(connectionId, closeTransport = true)
        }
    }

    private fun updateCode(connectionId: String, code: String, codeSequence: Long?) {
        val participant = participants[connectionId] ?: return
        val state = roomState[participant.inviteCode] ?: return
        synchronized(state) {
            if (codeSequence != null) {
                val lastSequence = state.lastCodeSequenceBySessionId[participant.sessionId]
                if (lastSequence != null && codeSequence <= lastSequence) {
                    logger.debug(
                        "Skipping stale code_update for room {} session {}: sequence {} <= {}",
                        participant.inviteCode,
                        participant.sessionId,
                        codeSequence,
                        lastSequence,
                    )
                    return
                }
                state.lastCodeSequenceBySessionId[participant.sessionId] = codeSequence
            }
            state.code = code
            state.lastCodeUpdatedBySessionId = participant.sessionId
        }
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.code = code
            it.tasks.getOrNull(it.currentStep)?.solutionCode = code
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    private fun relayAwarenessUpdate(connectionId: String, awarenessBase64: String) {
        val participant = participants[connectionId] ?: return
        val trimmed = awarenessBase64.trim()
        if (trimmed.isEmpty() || trimmed.length > maxAwarenessUpdateBase64Chars) {
            return
        }
        broadcastTransportMessage(
            inviteCode = participant.inviteCode,
            type = "awareness_update",
            payload = mapOf(
                "sessionId" to participant.sessionId,
                "awarenessUpdate" to trimmed,
            ),
            excludeConnectionId = connectionId,
        )
    }

    private fun relayYjsUpdate(
        connectionId: String,
        yjsUpdate: String,
        syncKey: String?,
        codeSnapshot: String?,
        yjsClientSequence: Long?,
        yjsDocumentBase64: String?,
    ) {
        val participant = participants[connectionId] ?: return
        val state = roomState[participant.inviteCode] ?: return

        val trimmedDocCandidate = yjsDocumentBase64?.trim().orEmpty()
        val safeDocSnap =
            if (trimmedDocCandidate.isNotEmpty() && trimmedDocCandidate.length <= maxYjsDocumentBase64Chars) trimmedDocCandidate else null

        fun resolveOutboundSyncKey(): String? {
            val normalizedSyncKey = syncKey?.trim().orEmpty()
            val expectedSyncKey = "${participant.inviteCode}:${state.currentStep}:${state.language}"
            if (normalizedSyncKey.isNotEmpty() && normalizedSyncKey != expectedSyncKey) {
                logger.debug(
                    "Dropping stale yjs update for room {} session {}: syncKey {} != {}",
                    participant.inviteCode,
                    participant.sessionId,
                    normalizedSyncKey,
                    expectedSyncKey,
                )
                return null
            }
            return if (normalizedSyncKey.isNotEmpty()) normalizedSyncKey else expectedSyncKey
        }

        fun tryApplyCodeSnapshot(): String? {
            if (codeSnapshot == null) return null
            val canApplySnapshot = if (yjsClientSequence != null) {
                val lastSnapshotSequence = state.lastYjsSnapshotSequenceBySessionId[participant.sessionId]
                if (lastSnapshotSequence != null && yjsClientSequence < lastSnapshotSequence) {
                    logger.debug(
                        "Skipping stale yjs snapshot for room {} session {}: clientSequence {} < {}",
                        participant.inviteCode,
                        participant.sessionId,
                        yjsClientSequence,
                        lastSnapshotSequence,
                    )
                    false
                } else {
                    state.lastYjsSnapshotSequenceBySessionId[participant.sessionId] = yjsClientSequence
                    true
                }
            } else {
                true
            }
            if (!canApplySnapshot) return null
            state.code = codeSnapshot
            state.lastCodeUpdatedBySessionId = participant.sessionId
            return codeSnapshot
        }

        if (yjsUpdate.isBlank()) {
            if (safeDocSnap == null) return
            var acceptedCodeSnapshot: String? = null
            synchronized(state) {
                if (resolveOutboundSyncKey() == null) return
                state.yjsDocumentBase64 = safeDocSnap
                acceptedCodeSnapshot = tryApplyCodeSnapshot()
            }
            if (acceptedCodeSnapshot != null) {
                scheduleDebouncedRoomCodeSave(participant.inviteCode, acceptedCodeSnapshot!!)
            }
            scheduleStateBroadcastFromYjs(participant.inviteCode)
            return
        }

        var acceptedCodeSnapshot: String? = null
        synchronized(state) {
            if (resolveOutboundSyncKey() == null) return
            if (safeDocSnap != null) {
                state.yjsDocumentBase64 = safeDocSnap
                acceptedCodeSnapshot = tryApplyCodeSnapshot()
            }
            state.lastYjsSequence += 1
        }

        if (acceptedCodeSnapshot != null) {
            scheduleDebouncedRoomCodeSave(participant.inviteCode, acceptedCodeSnapshot!!)
        }

        scheduleStateBroadcastFromYjs(participant.inviteCode)

        val outboundSyncKey = resolveOutboundSyncKey() ?: return
        broadcastTransportMessage(
            inviteCode = participant.inviteCode,
            type = "yjs_update",
            payload = mapOf(
                "sessionId" to participant.sessionId,
                "yjsUpdate" to yjsUpdate,
                "syncKey" to outboundSyncKey,
                "yjsSequence" to state.lastYjsSequence,
            ),
            excludeConnectionId = connectionId,
        )
    }

    private fun scheduleDebouncedRoomCodeSave(inviteCode: String, code: String) {
        latestCodeForDebouncedDbSaveByRoom[inviteCode] = code
        pendingRoomCodeDbSaveByRoom.remove(inviteCode)?.cancel(false)
        val next = roomCodeDbSaveScheduler.schedule({
            pendingRoomCodeDbSaveByRoom.remove(inviteCode)
            val latest = latestCodeForDebouncedDbSaveByRoom.remove(inviteCode) ?: return@schedule
            try {
                roomRepository.findWithTasksByInviteCode(inviteCode)?.let { room ->
                    room.code = latest
                    room.tasks.getOrNull(room.currentStep)?.solutionCode = latest
                    roomRepository.save(room)
                }
            } catch (ex: Exception) {
                logger.warn("Debounced room code save failed for {}", inviteCode, ex)
            }
        }, 750, TimeUnit.MILLISECONDS)
        pendingRoomCodeDbSaveByRoom[inviteCode] = next
    }

    private fun scheduleStateBroadcastFromYjs(inviteCode: String) {
        pendingYjsStateBroadcastByRoom.remove(inviteCode)?.cancel(false)
        val next = yjsStateBroadcastScheduler.schedule({
            pendingYjsStateBroadcastByRoom.remove(inviteCode)
            broadcastState(inviteCode)
        }, 110, TimeUnit.MILLISECONDS)
        pendingYjsStateBroadcastByRoom[inviteCode] = next
    }

    private fun updateLanguage(connectionId: String, language: String) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может менять язык")
        }
        val normalizedLanguage = normalizeLanguage(language)
        roomState[participant.inviteCode]?.language = normalizedLanguage
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.language = normalizedLanguage
            it.tasks.getOrNull(it.currentStep)?.solutionLanguage = normalizedLanguage
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    private fun updateNotes(connectionId: String, notes: String) {
        val participant = participants[connectionId] ?: return
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
            it.tasks.forEach { task -> task.interviewerNotes = null }
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    private fun appendNoteMessage(
        connectionId: String,
        noteId: String?,
        noteText: String?,
        noteTimestampEpochMs: Long?,
    ) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может писать в чат заметок")
        }
        val text = noteText.orEmpty().trim()
        if (text.isBlank()) return

        val inviteCode = participant.inviteCode
        val state = roomState[inviteCode] ?: return
        val nextMessage = NoteMessagePayload(
            id = noteId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
            sessionId = participant.sessionId,
            displayName = participant.displayName,
            role = participant.role.wireValue,
            text = text,
            timestampEpochMs = noteTimestampEpochMs ?: Instant.now().toEpochMilli(),
        )

        synchronized(state) {
            state.notesMessages.add(nextMessage)
            if (state.notesMessages.size > notesHistoryLimit) {
                val overflow = state.notesMessages.size - notesHistoryLimit
                repeat(overflow) {
                    state.notesMessages.removeAt(0)
                }
            }
        }

        roomRepository.findByInviteCode(inviteCode)?.let {
            it.interviewerChat = serializeNotesMessages(state.notesMessages)
            roomRepository.save(it)
        }
        broadcastState(inviteCode)
    }

    private fun updateBriefingMarkdown(connectionId: String, markdown: String) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может редактировать markdown")
        }
        val normalized = markdown.replace("\u0000", "").take(120_000)
        roomState[participant.inviteCode]?.briefingMarkdown = normalized
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.briefingMarkdown = normalized
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    private fun updateTaskRating(connectionId: String, stepIndex: Int?, rating: Int?) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может выставлять оценку по шагу")
        }

        val normalizedRating = when {
            rating == null || rating <= 0 -> null
            rating in 1..5 -> rating
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Оценка должна быть в диапазоне 1..5")
        }

        val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач")
        }

        val targetStep = stepIndex ?: room.currentStep
        if (targetStep < 0 || targetStep >= room.tasks.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Номер шага вне диапазона")
        }

        room.tasks[targetStep].score = normalizedRating
        roomRepository.save(room)
        roomState[participant.inviteCode]?.taskScoresByStepIndex?.set(targetStep, normalizedRating)
        broadcastState(participant.inviteCode)
    }

    private fun updatePresence(connectionId: String, presenceStatus: String?) {
        val participant = participants[connectionId] ?: return
        val nextStatus = PresenceStatus.fromWire(presenceStatus)
        if (participant.presenceStatus == nextStatus) return
        participant.presenceStatus = nextStatus
        broadcastState(participant.inviteCode)
    }

    @Transactional
    fun syncParticipantPermissions(inviteCode: String, targetUserId: String) {
        val room = roomRepository.findByInviteCode(inviteCode) ?: return
        val nextRole = resolveStoredRole(room, targetUserId)
        val affectedSessionIds = participants.values
            .filter { it.inviteCode == inviteCode && it.userId == targetUserId }
            .onEach { it.role = nextRole }
            .map { it.sessionId }
            .toSet()
        roomState[inviteCode]?.grantedRoleBySessionId?.let { overrides ->
            affectedSessionIds.forEach { overrides.remove(it) }
        }
        broadcastState(inviteCode)
    }

    private fun updateParticipantRoomRole(
        connectionId: String,
        targetSessionId: String?,
        targetUserId: String?,
        targetRole: RoomAccessService.RoomRole,
    ) {
        val participant = participants[connectionId] ?: return
        if (!participant.canGrantAccess) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только администратор комнаты может управлять доступом")
        }

        val room = roomRepository.findByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val roomId = room.id ?: throw ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Комната не сохранена")
        val state = roomState[participant.inviteCode]

        val activeTarget = targetSessionId?.let { sessionId ->
            participants.values.firstOrNull { it.inviteCode == participant.inviteCode && it.sessionId == sessionId }
        }
        if (activeTarget?.role == RoomAccessService.RoomRole.OWNER) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя менять роль администратора комнаты")
        }

        val resolvedTargetUserId = targetUserId?.trim().orEmpty().ifBlank { activeTarget?.userId.orEmpty() }
        if (resolvedTargetUserId.isNotBlank() && room.ownerUser?.id == resolvedTargetUserId) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя менять роль администратора комнаты")
        }

        when (targetRole) {
            RoomAccessService.RoomRole.OWNER ->
                throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя назначать администратора через realtime")
            RoomAccessService.RoomRole.INTERVIEWER -> {
                if (resolvedTargetUserId.isNotBlank()) {
                    val existing = roomParticipantRepository.findByRoomIdAndUserId(roomId, resolvedTargetUserId)
                    if (existing == null) {
                        val targetUser = userRepository.findById(resolvedTargetUserId).orElseThrow {
                            ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
                        }
                        roomParticipantRepository.save(
                            RoomParticipant(
                                room = room,
                                user = targetUser,
                                role = RoomAccessService.RoomRole.INTERVIEWER.wireValue,
                            ),
                        )
                    } else {
                        existing.role = RoomAccessService.RoomRole.INTERVIEWER.wireValue
                        roomParticipantRepository.save(existing)
                    }
                } else {
                    val target = activeTarget
                        ?: throw ApiException(HttpStatus.BAD_REQUEST, "Участник не найден в активной комнате")
                    target.role = RoomAccessService.RoomRole.INTERVIEWER
                    state?.grantedRoleBySessionId?.set(target.sessionId, RoomAccessService.RoomRole.INTERVIEWER)
                }
            }
            RoomAccessService.RoomRole.CANDIDATE -> {
                if (resolvedTargetUserId.isNotBlank()) {
                    roomParticipantRepository.deleteByRoomIdAndUserId(roomId, resolvedTargetUserId)
                } else {
                    val target = activeTarget
                        ?: throw ApiException(HttpStatus.BAD_REQUEST, "Участник не найден в активной комнате")
                    target.role = RoomAccessService.RoomRole.CANDIDATE
                    state?.grantedRoleBySessionId?.set(target.sessionId, RoomAccessService.RoomRole.CANDIDATE)
                }
            }
        }

        if (resolvedTargetUserId.isNotBlank()) {
            syncParticipantPermissions(participant.inviteCode, resolvedTargetUserId)
            return
        }
        broadcastState(participant.inviteCode)
    }

    private fun updateCursor(
        connectionId: String,
        lineNumber: Int?,
        column: Int?,
        selectionStartLineNumber: Int?,
        selectionStartColumn: Int?,
        selectionEndLineNumber: Int?,
        selectionEndColumn: Int?,
        cursorSequence: Long?,
    ) {
        val participant = participants[connectionId] ?: return
        val nextLine = (lineNumber ?: 1).coerceAtLeast(1)
        val nextColumn = (column ?: 1).coerceAtLeast(1)
        val hasCompleteSelection =
            selectionStartLineNumber != null &&
                selectionStartColumn != null &&
                selectionEndLineNumber != null &&
                selectionEndColumn != null
        val nextSelectionStartLine = if (hasCompleteSelection) selectionStartLineNumber!!.coerceAtLeast(1) else null
        val nextSelectionStartColumn = if (hasCompleteSelection) selectionStartColumn!!.coerceAtLeast(1) else null
        val nextSelectionEndLine = if (hasCompleteSelection) selectionEndLineNumber!!.coerceAtLeast(1) else null
        val nextSelectionEndColumn = if (hasCompleteSelection) selectionEndColumn!!.coerceAtLeast(1) else null

        val state = roomState[participant.inviteCode] ?: return
        var appliedCursorSequence: Long? = null
        synchronized(state) {
            if (cursorSequence != null) {
                val lastSequence = state.lastCursorSequenceBySessionId[participant.sessionId]
                if (lastSequence != null && cursorSequence <= lastSequence) {
                    logger.debug(
                        "Skipping stale cursor_update for room {} session {}: sequence {} <= {}",
                        participant.inviteCode,
                        participant.sessionId,
                        cursorSequence,
                        lastSequence,
                    )
                    return
                }
                state.lastCursorSequenceBySessionId[participant.sessionId] = cursorSequence
                appliedCursorSequence = cursorSequence
            }

            val currentCursor = state.cursorsBySessionId[participant.sessionId]
            if (
                currentCursor != null &&
                currentCursor.lineNumber == nextLine &&
                currentCursor.column == nextColumn &&
                currentCursor.selectionStartLineNumber == nextSelectionStartLine &&
                currentCursor.selectionStartColumn == nextSelectionStartColumn &&
                currentCursor.selectionEndLineNumber == nextSelectionEndLine &&
                currentCursor.selectionEndColumn == nextSelectionEndColumn
            ) {
                return
            }

            state.cursorsBySessionId[participant.sessionId] = CursorState(
                lineNumber = nextLine,
                column = nextColumn,
                selectionStartLineNumber = nextSelectionStartLine,
                selectionStartColumn = nextSelectionStartColumn,
                selectionEndLineNumber = nextSelectionEndLine,
                selectionEndColumn = nextSelectionEndColumn,
            )
            if (appliedCursorSequence == null) {
                appliedCursorSequence = state.lastCursorSequenceBySessionId[participant.sessionId]
            }
        }
        broadcastTransportMessage(
            inviteCode = participant.inviteCode,
            type = "cursor_update",
            payload = mapOf(
                "sessionId" to participant.sessionId,
                "displayName" to participant.displayName,
                "role" to participant.role.wireValue,
                "cursorSequence" to appliedCursorSequence,
                "lineNumber" to nextLine,
                "column" to nextColumn,
                "selectionStartLineNumber" to nextSelectionStartLine,
                "selectionStartColumn" to nextSelectionStartColumn,
                "selectionEndLineNumber" to nextSelectionEndLine,
                "selectionEndColumn" to nextSelectionEndColumn,
            ),
            excludeConnectionId = connectionId,
        )
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
        if (participant.role != RoomAccessService.RoomRole.CANDIDATE) return

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
        state.lastCandidateKey?.let { event ->
            state.candidateKeyHistory.add(event)
            if (state.candidateKeyHistory.size > candidateKeyHistoryMaxSize) {
                val overflow = state.candidateKeyHistory.size - candidateKeyHistoryMaxSize
                repeat(overflow) {
                    state.candidateKeyHistory.removeAt(0)
                }
            }
        }
        state.lastCandidateKeyAtEpochMs = now

        val keyEvent = state.lastCandidateKey ?: return
        val managerConnectionIds = participants.entries
            .asSequence()
            .filter { (_, meta) -> meta.inviteCode == participant.inviteCode && meta.canManageRoom }
            .map { (id, _) -> id }
            .toSet()
        if (managerConnectionIds.isEmpty()) {
            return
        }
        broadcastTransportMessage(
            inviteCode = participant.inviteCode,
            type = "candidate_key",
            payload = keyEvent,
            includeConnectionIds = managerConnectionIds,
        )
    }

    private fun nextStep(connectionId: String) {
        val participant = participants[connectionId] ?: return
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

    private fun setStep(connectionId: String, stepIndex: Int) {
        val participant = participants[connectionId] ?: return
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
        pendingYjsStateBroadcastByRoom.remove(inviteCode)?.cancel(false)
        pendingRoomCodeDbSaveByRoom.remove(inviteCode)?.cancel(false)
        latestCodeForDebouncedDbSaveByRoom.remove(inviteCode)
        roomState.remove(inviteCode)
        val connectionIds = participants.entries
            .asSequence()
            .filter { it.value.inviteCode == inviteCode }
            .map { it.key }
            .toList()
        connectionIds.forEach { connectionId ->
            detachConnection(connectionId, closeTransport = true)
        }
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
        val participantsPayload = roomParticipants.map { participantMetaToPayload(it) }
        val participantBySessionId = roomParticipants.associateBy { it.sessionId }
        val cursorsPayload = state.cursorsBySessionId.entries
            .asSequence()
            .mapNotNull { (sessionId, cursor) ->
                val participantMeta = participantBySessionId[sessionId] ?: return@mapNotNull null
                CursorPayload(
                    sessionId = sessionId,
                    displayName = participantMeta.displayName,
                    role = participantMeta.role.wireValue,
                    cursorSequence = state.lastCursorSequenceBySessionId[sessionId],
                    lineNumber = cursor.lineNumber,
                    column = cursor.column,
                    selectionStartLineNumber = cursor.selectionStartLineNumber,
                    selectionStartColumn = cursor.selectionStartColumn,
                    selectionEndLineNumber = cursor.selectionEndLineNumber,
                    selectionEndColumn = cursor.selectionEndColumn,
                )
            }
            .toList()

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
        includeConnectionIds: Set<String>? = null,
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

        val sseConnectionIds = roomSseConnections[inviteCode]?.toList().orEmpty()
        sseConnectionIds.forEach { connectionId ->
            if (excludeConnectionId != null && excludeConnectionId == connectionId) return@forEach
            if (includeConnectionIds != null && !includeConnectionIds.contains(connectionId)) return@forEach
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
            yjsDocumentBase64 = state.yjsDocumentBase64,
            lastYjsSequence = state.lastYjsSequence,
            currentStep = state.currentStep,
            notes = state.notes,
            notesMessages = state.notesMessages.toList(),
            briefingMarkdown = state.briefingMarkdown,
            participants = participantsPayload,
            isOwner = participant.isOwner,
            role = participant.role.wireValue,
            canManageRoom = participant.canManageRoom,
            canGrantAccess = participant.canGrantAccess,
            notesLockedBySessionId = state.notesLockedBySessionId,
            notesLockedByDisplayName = state.notesLockedByDisplayName,
            notesLockedUntilEpochMs = state.notesLockedUntilEpochMs,
            taskScores = state.taskScoresByStepIndex.toMap(),
            cursors = cursorsPayload,
            lastCandidateKey = state.lastCandidateKey,
            candidateKeyHistory = state.candidateKeyHistory.toList(),
        )
    }

    private fun parseNotesMessages(rawChatJson: String?, legacyNotes: String?): MutableList<NoteMessagePayload> {
        val chat = rawChatJson.orEmpty().trim()
        if (chat.isNotBlank()) {
            val parsed = runCatching {
                val root = objectMapper.readTree(chat)
                val messagesNode = when {
                    root.isArray -> root
                    root.isObject && root.has("messages") -> root["messages"]
                    else -> null
                }
                if (messagesNode == null || !messagesNode.isArray) {
                    emptyList()
                } else {
                    messagesNode.mapNotNull { node ->
                        runCatching { objectMapper.treeToValue(node, NoteMessagePayload::class.java) }.getOrNull()
                    }
                }
            }.getOrElse { emptyList() }
            if (parsed.isNotEmpty()) {
                return parsed.toMutableList()
            }
        }

        val legacy = legacyNotes.orEmpty().trim()
        if (legacy.isBlank()) {
            return mutableListOf()
        }

        return mutableListOf(
            NoteMessagePayload(
                id = "legacy-${legacy.hashCode()}",
                sessionId = "legacy-notes",
                displayName = "Старые заметки",
                role = RoomAccessService.RoomRole.INTERVIEWER.wireValue,
                text = legacy,
                timestampEpochMs = 0L,
            ),
        )
    }

    private fun serializeNotesMessages(messages: List<NoteMessagePayload>): String {
        return objectMapper.writeValueAsString(NotesThreadPayload(messages = messages))
    }

    private fun setStepInternal(inviteCode: String, room: Room, stepIndex: Int) {
        val currentState = roomState[inviteCode]
        val currentTask = room.tasks.getOrNull(room.currentStep)
        currentTask?.let { current ->
            current.solutionCode = currentState?.code ?: room.code
            current.solutionLanguage = normalizeLanguage(currentState?.language ?: room.language)
        }
        if (room.notes.isNullOrBlank()) {
            room.notes = currentTask?.interviewerNotes?.takeIf { it.isNotBlank() }
                ?: currentState?.notes.orEmpty()
        }
        room.tasks.forEach { it.interviewerNotes = null }

        room.currentStep = stepIndex
        val nextTask = room.tasks[stepIndex]
        room.language = normalizeLanguage(nextTask.solutionLanguage?.ifBlank { null } ?: nextTask.language)
        room.code = nextTask.solutionCode ?: nextTask.starterCode
        roomRepository.save(room)

        roomState[inviteCode] = RealtimeState(
            language = normalizeLanguage(room.language),
            code = room.code,
            lastCodeUpdatedBySessionId = null,
            yjsDocumentBase64 = null,
            lastYjsSequence = 0,
            currentStep = room.currentStep,
            notes = room.notes.orEmpty(),
            notesMessages = currentState?.notesMessages?.toMutableList()
                ?: parseNotesMessages(room.interviewerChat, room.notes),
            briefingMarkdown = currentState?.briefingMarkdown ?: room.briefingMarkdown.orEmpty(),
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
            taskScoresByStepIndex = buildTaskScores(room),
            cursorsBySessionId = currentState?.cursorsBySessionId ?: ConcurrentHashMap(),
            lastCursorSequenceBySessionId = currentState?.lastCursorSequenceBySessionId ?: ConcurrentHashMap(),
            lastCodeSequenceBySessionId = currentState?.lastCodeSequenceBySessionId ?: ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = currentState?.lastYjsSnapshotSequenceBySessionId ?: ConcurrentHashMap(),
            lastCandidateKey = currentState?.lastCandidateKey,
            candidateKeyHistory = currentState?.candidateKeyHistory?.toMutableList() ?: mutableListOf(),
            lastCandidateKeyAtEpochMs = currentState?.lastCandidateKeyAtEpochMs ?: 0L,
        )
        broadcastState(inviteCode)
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
                state.lastCursorSequenceBySessionId.remove(participant.sessionId)
                state.lastCodeSequenceBySessionId.remove(participant.sessionId)
                state.lastYjsSnapshotSequenceBySessionId.remove(participant.sessionId)
                if (state.lastCandidateKey?.sessionId == participant.sessionId) {
                    state.candidateKeyHistory.removeAll { it.sessionId == participant.sessionId }
                    state.lastCandidateKey = state.candidateKeyHistory.lastOrNull()
                    state.lastCandidateKeyAtEpochMs = state.lastCandidateKey?.timestampEpochMs ?: 0L
                } else if (state.candidateKeyHistory.isNotEmpty()) {
                    state.candidateKeyHistory.removeAll { it.sessionId == participant.sessionId }
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
        return "sse:$sessionId:${UUID.randomUUID()}"
    }

    private fun participantMetaToPayload(meta: ParticipantMeta): ParticipantPayload {
        val isAuthenticated = !meta.userId.isNullOrBlank()
        return ParticipantPayload(
            sessionId = meta.sessionId,
            displayName = meta.displayName,
            userId = meta.userId,
            role = meta.role.wireValue,
            presenceStatus = meta.presenceStatus.wireValue,
            isAuthenticated = isAuthenticated,
            canBeGrantedInterviewerAccess = meta.role != RoomAccessService.RoomRole.OWNER,
        )
    }

    private fun resolveRole(room: Room, ownerToken: String?, user: User?): RoomAccessService.RoomRole {
        return roomAccessService.resolveAccess(room, user, ownerToken, null).role
    }

    private fun resolveStoredRole(room: Room, userId: String): RoomAccessService.RoomRole {
        if (room.ownerUser?.id == userId) {
            return RoomAccessService.RoomRole.OWNER
        }
        val roomId = room.id ?: return RoomAccessService.RoomRole.CANDIDATE
        val participant = roomParticipantRepository.findByRoomIdAndUserId(roomId, userId)
        return roomAccessService.normalizeRole(participant?.role)
    }

    private fun buildTaskScores(room: Room): MutableMap<Int, Int?> {
        val scores: MutableMap<Int, Int?> = Collections.synchronizedMap(mutableMapOf())
        room.tasks.forEach { task ->
            scores[task.stepIndex] = task.score
        }
        return scores
    }

    private fun toRealtimeState(room: Room): RealtimeState {
        val currentTask = room.tasks.getOrNull(room.currentStep)
        val language = normalizeLanguage(currentTask?.solutionLanguage?.ifBlank { null } ?: room.language)
        val code = currentTask?.solutionCode ?: room.code.ifBlank { currentTask?.starterCode.orEmpty() }
        val notes = room.notes.orEmpty().ifBlank { currentTask?.interviewerNotes.orEmpty() }
        return RealtimeState(
            language = language,
            code = code,
            lastCodeUpdatedBySessionId = null,
            yjsDocumentBase64 = null,
            lastYjsSequence = 0,
            currentStep = room.currentStep,
            notes = notes,
            notesMessages = parseNotesMessages(room.interviewerChat, notes),
            briefingMarkdown = room.briefingMarkdown.orEmpty(),
            notesLockedBySessionId = null,
            notesLockedByDisplayName = null,
            notesLockedUntilEpochMs = null,
            taskScoresByStepIndex = buildTaskScores(room),
            lastCursorSequenceBySessionId = ConcurrentHashMap(),
            lastCodeSequenceBySessionId = ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = ConcurrentHashMap(),
        )
    }

    private fun normalizeLanguage(language: String): String {
        return when (language.trim().lowercase()) {
            "javascript", "typescript", "nodejs" -> "nodejs"
            "python" -> "python"
            "kotlin" -> "kotlin"
            "java" -> "java"
            "sql" -> "sql"
            else -> "nodejs"
        }
    }
}
