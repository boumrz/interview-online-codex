package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import com.interviewonline.ws.CandidateKeyPayload
import com.interviewonline.ws.CursorPayload
import com.interviewonline.ws.NoteMessagePayload
import com.interviewonline.ws.ManagerWorkspacePayload
import com.interviewonline.ws.ParticipantPayload
import com.interviewonline.ws.PersonalNoteEntryPayload
import com.interviewonline.ws.RealtimeEventRequest
import com.interviewonline.ws.RoomRealtimePayload
import com.interviewonline.ws.RoomTaskPayload
import com.interviewonline.ws.VerdictSetPayload
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

internal fun isHeartbeatOnlyYjsUpdate(yjsUpdate: String?): Boolean {
    return yjsUpdate.isNullOrBlank()
}

@Service
class CollaborationService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val userRepository: UserRepository,
    private val roomAccessService: RoomAccessService,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val objectMapper: ObjectMapper,
    private val keystrokePersistenceService: KeystrokePersistenceService,
    private val roomProductMetricsProjector: RoomProductMetricsProjector,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val notesLockMillis = 3_000L
    private val candidateKeyHistoryMaxSize = 50
    private val notesHistoryLimit = 500
    private val privateNotesHistoryLimit = 2_000
    private val privateNotesBlockNameMaxChars = 80
    private val privateNotesTextMaxChars = 8_000
    private val maxYjsDocumentBase64Chars = 400_000
    private val maxAwarenessUpdateBase64Chars = 24_000
    private val appliedOperationIdTtlMillis = 15 * 60_000L
    private val appliedOperationIdCacheMaxSize = 20_000
    private val yjsSequenceAuthorHistoryLimit = 4_096L

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
        val participantId: String?,
        val eventToken: String,
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

    private data class RoomStreamAdmission(
        val room: Room,
        val resolvedRole: RoomAccessService.RoomRole,
    )

    private data class RealtimeState(
        var language: String,
        var code: String,
        var lastCodeUpdatedBySessionId: String? = null,
        var yjsDocumentBase64: String? = null,
        var lastYjsSequence: Long = 0,
        var lastIncrementalYjsSessionId: String? = null,
        var currentStep: Int,
        /** Immutable identity of the task that owns this public realtime state. */
        var publishedTaskId: String? = null,
        var notes: String,
        val notesMessages: MutableList<NoteMessagePayload> = mutableListOf(),
        /**
         * Room-wide private notes per author (each interviewer/owner has their own
         * stream). Replaces the legacy per-step segregation.
         */
        val privateNotesByAuthor: MutableMap<String, MutableList<PersonalNoteEntryPayload>> = ConcurrentHashMap(),
        var briefingMarkdown: String = "",
        val tasks: MutableList<RoomTaskPayload> = mutableListOf(),
        var notesLockedBySessionId: String? = null,
        var notesLockedByDisplayName: String? = null,
        var notesLockedUntilEpochMs: Long? = null,
        val taskScoresByStepIndex: MutableMap<Int, Int?> = Collections.synchronizedMap(mutableMapOf()),
        val cursorsBySessionId: MutableMap<String, CursorState> = ConcurrentHashMap(),
        val lastCursorSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val lastCodeSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val lastYjsSnapshotSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val lastClientEventSequenceBySessionId: MutableMap<String, Long> = ConcurrentHashMap(),
        val appliedOperationIds: MutableMap<String, Long> = ConcurrentHashMap(),
        val yjsSequenceAuthorBySequence: MutableMap<Long, String> = ConcurrentHashMap(),
        val grantedRoleBySessionId: MutableMap<String, RoomAccessService.RoomRole> = ConcurrentHashMap(),
        var lastCandidateKey: CandidateKeyPayload? = null,
        val candidateKeyHistory: MutableList<CandidateKeyPayload> = mutableListOf(),
        var lastCandidateKeyAtEpochMs: Long = 0L,
        var verdict: String? = null,
        var verdictComment: String? = null,
        var status: String = "active",
        var finishedAt: Long? = null,
        /** Cached Room.id (UUID) to avoid DB lookup on every keystroke event. */
        val roomId: String,
    )

    private data class CursorState(
        var lineNumber: Int,
        var column: Int,
        var selectionStartLineNumber: Int? = null,
        var selectionStartColumn: Int? = null,
        var selectionEndLineNumber: Int? = null,
        var selectionEndColumn: Int? = null,
    )

    /** A room-level shared preparation workspace, visible only to managers who opened it. */
    private data class ManagerWorkspaceKey(
        val inviteCode: String,
        val taskId: String,
    )

    private data class ManagerWorkspaceState(
        val roomId: String,
        var stepIndex: Int,
        val title: String,
        var language: String,
        var code: String,
        var briefingMarkdown: String,
        var focusMode: Boolean,
        var revision: Long,
        var yjsDocumentBase64: String? = null,
        var yjsSequence: Long = 0,
        val appliedOperationIds: MutableMap<String, Long> = ConcurrentHashMap(),
    )

    /** A delayed public-code persistence operation is always tied to its source task. */
    private data class PendingRoomCodeSave(
        val taskId: String,
        val code: String,
    )

    /**
     * Payload-структуры (`NotesThreadPayload`, `RoomPrivateNotesPayload`,
     * `RoomPrivateNotesAuthorPayload`) живут в файле `PrivateNotesPayloads.kt`
     * того же пакета — используются и сервисом, и [PrivateNotesSerialization].
     */

    private val roomSseConnections = ConcurrentHashMap<String, MutableSet<String>>()
    private val sseConnections = ConcurrentHashMap<String, SseEmitter>()
    private val participants = ConcurrentHashMap<String, ParticipantMeta>()
    private val roomState = ConcurrentHashMap<String, RealtimeState>()
    /** One inactive preparation scope may be open per SSE connection. */
    private val managerWorkspaceSubscriptionByConnection = ConcurrentHashMap<String, ManagerWorkspaceKey>()
    private val managerWorkspaceState = ConcurrentHashMap<ManagerWorkspaceKey, ManagerWorkspaceState>()
    /** Serialises manager drafts, public mutations, and publication for one room. */
    private val managerWorkspaceRoomLocks = ConcurrentHashMap<String, Any>()
    private val connectionByRoomSession = ConcurrentHashMap<String, String>()
    private val sseHeartbeatScheduler = Executors.newSingleThreadScheduledExecutor()
    private val yjsStateBroadcastScheduler = Executors.newSingleThreadScheduledExecutor()
    private val pendingYjsStateBroadcastByRoom = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val roomCodeDbSaveScheduler = Executors.newSingleThreadScheduledExecutor()
    private val pendingRoomCodeDbSaveByRoom = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val latestCodeForDebouncedDbSaveByRoom = ConcurrentHashMap<String, PendingRoomCodeSave>()
    private val roomCandidateKeyHistorySaveScheduler = Executors.newSingleThreadScheduledExecutor()
    private val pendingCandidateKeyHistorySaveByRoom = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val latestCandidateKeyHistoryJsonByRoom = ConcurrentHashMap<String, String>()

    init {
        sseHeartbeatScheduler.scheduleWithFixedDelay(
            { sendSseHeartbeats() },
            5,
            5,
            TimeUnit.SECONDS,
        )
    }

    fun bootstrapRoom(room: Room) {
        roomState[room.inviteCode] = toRealtimeState(room)
    }

    fun syncFromRoom(room: Room) {
        val currentState = roomState[room.inviteCode]
        val nextState = toRealtimeState(room)
        val continuingSamePublishedStep = currentState?.currentStep == nextState.currentStep
        val mergedCandidateKeyHistory = CandidateKeyHistoryHelpers.merge(
            inMemory = currentState?.candidateKeyHistory.orEmpty(),
            persisted = nextState.candidateKeyHistory,
        )
        val mergedLastCandidateKey = mergedCandidateKeyHistory.lastOrNull()
        roomState[room.inviteCode] = nextState.copy(
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
            cursorsBySessionId = currentState?.cursorsBySessionId ?: ConcurrentHashMap(),
            lastCursorSequenceBySessionId = currentState?.lastCursorSequenceBySessionId ?: ConcurrentHashMap(),
            lastCodeSequenceBySessionId = currentState?.lastCodeSequenceBySessionId ?: ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = currentState?.lastYjsSnapshotSequenceBySessionId ?: ConcurrentHashMap(),
            lastClientEventSequenceBySessionId = currentState?.lastClientEventSequenceBySessionId ?: ConcurrentHashMap(),
            grantedRoleBySessionId = currentState?.grantedRoleBySessionId ?: ConcurrentHashMap(),
            lastYjsSequence = if (continuingSamePublishedStep) currentState?.lastYjsSequence ?: 0 else nextState.lastYjsSequence,
            yjsDocumentBase64 = if (continuingSamePublishedStep) currentState?.yjsDocumentBase64 else nextState.yjsDocumentBase64,
            lastCandidateKey = mergedLastCandidateKey,
            candidateKeyHistory = mergedCandidateKeyHistory.toMutableList(),
            lastCandidateKeyAtEpochMs = mergedLastCandidateKey?.timestampEpochMs ?: 0L,
            verdict = nextState.verdict,
            verdictComment = nextState.verdictComment,
            status = nextState.status,
            finishedAt = nextState.finishedAt,
        )
        if (mergedCandidateKeyHistory.isNotEmpty()) {
            scheduleCandidateKeyHistorySave(room.inviteCode, mergedCandidateKeyHistory)
        }
        room.tasks.firstOrNull { it.stepIndex == room.currentStep }?.let { publishedTask ->
            cleanupPublishedManagerWorkspace(room.inviteCode, publishedTask)
        }
        broadcastState(room.inviteCode)
    }

    /**
     * Advances the public task through the same room-level transition boundary
     * as realtime manager actions.  The legacy REST endpoint delegates here so
     * that a pending public edit is saved against its source task before the
     * newly published task becomes visible.
     */
    fun advancePublishedStep(inviteCode: String): Room {
        synchronized(managerWorkspaceRoomLock(inviteCode)) {
            val room = roomRepository.findWithTasksByInviteCode(inviteCode)
                ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
            if (room.tasks.isEmpty()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
            }
            setStepInternal(inviteCode, room, (room.currentStep + 1).coerceAtMost(room.tasks.lastIndex))
            return room
        }
    }

    /**
     * Keeps an already-open manager scope in sync after a manager uses the
     * REST recovery/save route. The route is deliberately scoped and never
     * calls [broadcastState], so candidates do not receive this data.
     */
    fun syncManagerWorkspaceFromTask(room: Room, task: RoomTask) {
        if (task.stepIndex == room.currentStep) return
        val key = managerWorkspaceKey(room.inviteCode, task)
        val replacement = managerWorkspaceStateFromTask(room, task)
        managerWorkspaceState[key] = replacement
        broadcastManagerWorkspaceSync(key, replacement)
    }

    /**
     * Verifies that the caller could open the realtime stream without creating
     * an SSE connection, participant, event token, or in-memory room state.
     */
    @Transactional(readOnly = true)
    fun canOpenRoomStream(
        inviteCode: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): Boolean {
        // The live stream currently preserves this legacy parameter but does
        // not use it in role resolution; retain that exact behavior here.
        @Suppress("UNUSED_VARIABLE")
        val legacyInterviewerToken = interviewerToken
        return findRoomStreamAdmission(inviteCode, ownerToken, user) != null
    }

    @Transactional
    fun joinRoomSse(
        inviteCode: String,
        sessionId: String,
        participantId: String?,
        displayName: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): SseEmitter {
        @Suppress("UNUSED_VARIABLE")
        val legacyInterviewerToken = interviewerToken
        val admission = findRoomStreamAdmission(inviteCode, ownerToken, user)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val room = admission.room
        val state = roomState.computeIfAbsent(inviteCode) { toRealtimeState(room) }

        val connectionId = sseConnectionId(sessionId)
        val emitter = SseEmitter(0L)
        val resolvedRole = admission.resolvedRole
        val normalizedParticipantId = ParticipantIdentity.normalizeParticipantId(participantId)
        val identityRoleOverride = resolveIdentityRoleOverride(
            inviteCode = inviteCode,
            userId = user?.id,
            sessionId = sessionId,
            participantId = normalizedParticipantId,
        )
        val roleOverride = state.grantedRoleBySessionId[sessionId]
        val effectiveRole = if (resolvedRole == RoomAccessService.RoomRole.OWNER) {
            resolvedRole
        } else {
            roleOverride ?: identityRoleOverride ?: resolvedRole
        }

        participants[connectionId] = ParticipantMeta(
            inviteCode = inviteCode,
            sessionId = sessionId,
            participantId = normalizedParticipantId,
            eventToken = "evt_${UUID.randomUUID()}",
            displayName = displayName.trim().ifBlank { "Участник" }.take(64),
            userId = user?.id,
            role = effectiveRole,
            presenceStatus = PresenceStatus.ACTIVE,
        )
        room.id?.let { roomId ->
            roomProductMetricsProjector.recordParticipantJoin(roomId, effectiveRole)
        }
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
        val eventReceivedAt = System.currentTimeMillis()
        val requiresEventToken =
            request.type != "request_state_sync" &&
                request.type != "presence_update" &&
                request.type != "leave_room"
        val connectionId = requireConnectionId(
            inviteCode = inviteCode,
            sessionId = request.sessionId,
            eventToken = request.eventToken,
            requireEventToken = requiresEventToken,
        )
        if (request.type == "leave_room") {
            leaveRoomConnection(connectionId)
            return
        }
        val participant = participants[connectionId] ?: return
        val state = roomState[participant.inviteCode] ?: return
        if (request.type == "yjs_update" && !markOperationApplied(state, request.operationId)) {
            logger.debug(
                "Skipping duplicate realtime operation for room {} session {} operationId={}",
                participant.inviteCode,
                participant.sessionId,
                request.operationId,
            )
            return
        }
        if (requiresEventToken) {
            val clientEventSequence = request.clientEventSequence
            if (clientEventSequence != null) {
                synchronized(state) {
                    val lastSequence = state.lastClientEventSequenceBySessionId[participant.sessionId]
                    if (lastSequence != null && clientEventSequence <= lastSequence) {
                        logger.debug(
                            "Skipping stale realtime event for room {} session {}: clientSequence {} <= {}",
                            participant.inviteCode,
                            participant.sessionId,
                            clientEventSequence,
                            lastSequence,
                        )
                        throw ApiException(HttpStatus.CONFLICT, "Устаревшая последовательность события для сессии")
                    }
                    state.lastClientEventSequenceBySessionId[participant.sessionId] = clientEventSequence
                }
            }
        }
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
            "private_note_entry" -> appendPrivateNoteEntry(
                connectionId = connectionId,
                noteId = request.privateNoteId,
                noteText = request.privateNoteText,
                blockName = request.privateNoteBlockName,
                blockStepIndex = request.privateNoteBlockStepIndex,
                noteTimestampEpochMs = request.privateNoteTimestampEpochMs,
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
                baseServerYjsSequence = request.baseServerYjsSequence,
                yjsDocumentBase64 = request.yjsDocumentBase64,
                eventReceivedAt = eventReceivedAt,
            )
            "manager_workspace_open" -> openManagerWorkspace(connectionId, request.stepIndex)
            "manager_workspace_close" -> closeManagerWorkspace(connectionId)
            "manager_workspace_yjs_update" -> if (!shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, request.stepIndex)) {
                relayManagerWorkspaceYjsUpdate(
                    connectionId = connectionId,
                    stepIndex = request.stepIndex,
                    yjsUpdate = request.yjsUpdate.orEmpty(),
                    codeSnapshot = request.code,
                    yjsDocumentBase64 = request.yjsDocumentBase64,
                    baseServerYjsSequence = request.baseServerYjsSequence,
                    operationId = request.operationId,
                )
            }
            "manager_workspace_briefing_update" -> if (!shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, request.stepIndex)) {
                updateManagerWorkspaceBriefing(
                    connectionId = connectionId,
                    stepIndex = request.stepIndex,
                    markdown = request.briefingMarkdown ?: request.value.orEmpty(),
                    revision = request.revision,
                )
            }
            "manager_workspace_language_update" -> if (!shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, request.stepIndex)) {
                updateManagerWorkspaceLanguage(
                    connectionId = connectionId,
                    stepIndex = request.stepIndex,
                    language = request.language ?: request.value.orEmpty(),
                    revision = request.revision,
                )
            }
            "manager_workspace_focus_mode_update" -> if (!shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, request.stepIndex)) {
                updateManagerWorkspaceFocusMode(
                    connectionId = connectionId,
                    stepIndex = request.stepIndex,
                    focusMode = request.focusMode,
                    revision = request.revision,
                )
            }
            "manager_workspace_awareness_update" -> if (!shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, request.stepIndex)) {
                relayManagerWorkspaceAwareness(
                    connectionId = connectionId,
                    stepIndex = request.stepIndex,
                    awarenessBase64 = request.awarenessUpdate.orEmpty(),
                )
            }
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
                eventKind = request.eventKind,
                pasteLength = request.pasteLength,
                pastePreview = request.pastePreview,
                sourceEventId = request.sourceEventId,
            )
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный тип сообщения: ${request.type}")
        }
    }

    private fun sendStateToConnection(connectionId: String) {
        val participant = participants[connectionId] ?: return
        val inviteCode = participant.inviteCode
        val state = roomState[inviteCode] ?: return
        val emitter = sseConnections[connectionId] ?: return

        val roomParticipants = aggregateRoomParticipants(inviteCode)
        val participantsPayload = roomParticipants.map { participantMetaToPayload(it) }
        val participantBySessionId = roomParticipants.associateBy { it.sessionId }
        val cursorsPayload = buildCursorsPayload(state, participantBySessionId)

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
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            val state = roomState[participant.inviteCode] ?: return
            val taskId = synchronized(state) {
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
                state.publishedTaskId ?: return
            }
            roomRepository.findWithTasksByInviteCode(participant.inviteCode)?.let { room ->
                val sourceTask = room.tasks.firstOrNull { it.id == taskId } ?: return@let
                sourceTask.solutionCode = code
                if (room.currentStep == sourceTask.stepIndex) {
                    room.code = code
                }
                roomRepository.save(room)
            }
        }
        val roomId = roomState[participant.inviteCode]?.roomId.orEmpty()
        if (participant.role == RoomAccessService.RoomRole.CANDIDATE && roomId.isNotBlank()) {
            roomProductMetricsProjector.recordMeaningfulCandidateActivity(roomId)
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
                "userId" to participant.userId,
                "participantId" to participant.participantId,
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
        baseServerYjsSequence: Long?,
        yjsDocumentBase64: String?,
        eventReceivedAt: Long = System.currentTimeMillis(),
    ) {
        val participant = participants[connectionId] ?: return
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            relayYjsUpdateLocked(
                connectionId = connectionId,
                yjsUpdate = yjsUpdate,
                syncKey = syncKey,
                codeSnapshot = codeSnapshot,
                yjsClientSequence = yjsClientSequence,
                baseServerYjsSequence = baseServerYjsSequence,
                yjsDocumentBase64 = yjsDocumentBase64,
                eventReceivedAt = eventReceivedAt,
            )
        }
    }

    private fun relayYjsUpdateLocked(
        connectionId: String,
        yjsUpdate: String,
        syncKey: String?,
        codeSnapshot: String?,
        yjsClientSequence: Long?,
        baseServerYjsSequence: Long?,
        yjsDocumentBase64: String?,
        eventReceivedAt: Long,
    ) {
        val participant = participants[connectionId] ?: return
        val state = roomState[participant.inviteCode] ?: return

        val trimmedDocCandidate = yjsDocumentBase64?.trim().orEmpty()
        val safeDocSnap =
            if (trimmedDocCandidate.isNotEmpty() && trimmedDocCandidate.length <= maxYjsDocumentBase64Chars) trimmedDocCandidate else null
        val normalizedBaseServerYjsSequence = baseServerYjsSequence?.coerceAtLeast(0)

        if (isHeartbeatOnlyYjsUpdate(yjsUpdate) && safeDocSnap == null) {
            logger.debug(
                "Ignoring heartbeat-only yjs update without full snapshot for room {} session {}",
                participant.inviteCode,
                participant.sessionId,
            )
            return
        }

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
                if (lastSnapshotSequence != null && yjsClientSequence <= lastSnapshotSequence) {
                    logger.debug(
                        "Skipping stale yjs snapshot for room {} session {}: clientSequence {} <= {}",
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
            val acceptedCodeSnapshot = synchronized(state) {
                if (resolveOutboundSyncKey() == null) return
                val currentSequence = state.lastYjsSequence
                val canSessionPublishSnapshotOnly =
                    currentSequence == 0L || state.lastIncrementalYjsSessionId == participant.sessionId
                if (!canSessionPublishSnapshotOnly) {
                    logger.debug(
                        "Rejecting snapshot-only yjs payload from non-authoritative session for room {} session {}: currentSequence={} lastIncrementalSession={}",
                        participant.inviteCode,
                        participant.sessionId,
                        currentSequence,
                        state.lastIncrementalYjsSessionId,
                    )
                    return
                }
                val canApplySnapshot =
                    normalizedBaseServerYjsSequence != null && normalizedBaseServerYjsSequence >= currentSequence
                if (!canApplySnapshot) {
                    logger.debug(
                        "Rejecting stale Yjs snapshot-only payload for room {} session {}: baseServerYjsSequence={} < current={}",
                        participant.inviteCode,
                        participant.sessionId,
                        normalizedBaseServerYjsSequence,
                        currentSequence,
                    )
                    return
                }
                state.yjsDocumentBase64 = safeDocSnap
                tryApplyCodeSnapshot()
            }
            if (acceptedCodeSnapshot != null) {
                scheduleDebouncedRoomCodeSave(participant.inviteCode, acceptedCodeSnapshot)
            }
            scheduleStateBroadcastFromYjs(participant.inviteCode)
            return
        }

        var acceptedCodeSnapshot: String? = null
        var shouldBroadcastStateFromYjs = safeDocSnap == null
        synchronized(state) {
            if (resolveOutboundSyncKey() == null) return
            if (safeDocSnap != null) {
                val currentSequence = state.lastYjsSequence
                val canApplySnapshot =
                    normalizedBaseServerYjsSequence != null &&
                        (
                            normalizedBaseServerYjsSequence >= currentSequence ||
                                canAcceptStaleSnapshotForLocalOnlyGap(
                                    state = state,
                                    baseServerYjsSequence = normalizedBaseServerYjsSequence,
                                    currentServerYjsSequence = currentSequence,
                                    sessionId = participant.sessionId,
                                )
                            )
                if (canApplySnapshot) {
                    state.yjsDocumentBase64 = safeDocSnap
                    acceptedCodeSnapshot = tryApplyCodeSnapshot()
                    shouldBroadcastStateFromYjs = true
                } else {
                    logger.debug(
                        "Rejecting stale Yjs full snapshot for room {} session {}: baseServerYjsSequence={} < current={}",
                        participant.inviteCode,
                        participant.sessionId,
                        normalizedBaseServerYjsSequence,
                        currentSequence,
                    )
                }
            }
            state.lastYjsSequence += 1
            state.lastIncrementalYjsSessionId = participant.sessionId
            state.yjsSequenceAuthorBySequence[state.lastYjsSequence] = participant.sessionId
            pruneYjsSequenceAuthorHistory(state, state.lastYjsSequence)
        }

        if (acceptedCodeSnapshot != null) {
            scheduleDebouncedRoomCodeSave(participant.inviteCode, acceptedCodeSnapshot!!)
        }

        if (shouldBroadcastStateFromYjs) {
            scheduleStateBroadcastFromYjs(participant.inviteCode)
        }

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
        if (participant.role == RoomAccessService.RoomRole.CANDIDATE && state.roomId.isNotBlank()) {
            roomProductMetricsProjector.recordMeaningfulCandidateActivity(state.roomId)
        }
        logger.info(
            "yjs_relay_latency room={} seq={} relay_ms={}",
            participant.inviteCode,
            state.lastYjsSequence,
            System.currentTimeMillis() - eventReceivedAt,
        )
    }

    private fun scheduleDebouncedRoomCodeSave(inviteCode: String, code: String) {
        val sourceTaskId = roomState[inviteCode]?.publishedTaskId ?: return
        scheduleDebouncedRoomCodeSave(inviteCode, sourceTaskId, code)
    }

    private fun scheduleDebouncedRoomCodeSave(inviteCode: String, taskId: String, code: String) {
        latestCodeForDebouncedDbSaveByRoom[inviteCode] = PendingRoomCodeSave(taskId = taskId, code = code)
        pendingRoomCodeDbSaveByRoom.remove(inviteCode)?.cancel(false)
        val next = roomCodeDbSaveScheduler.schedule({
            pendingRoomCodeDbSaveByRoom.remove(inviteCode)
            val latest = latestCodeForDebouncedDbSaveByRoom.remove(inviteCode) ?: return@schedule
            try {
                synchronized(managerWorkspaceRoomLock(inviteCode)) {
                    roomRepository.findWithTasksByInviteCode(inviteCode)?.let { room ->
                        val sourceTask = room.tasks.firstOrNull { it.id == latest.taskId } ?: return@let
                        sourceTask.solutionCode = latest.code
                        if (room.currentStep == sourceTask.stepIndex) {
                            room.code = latest.code
                        }
                        roomRepository.save(room)
                    }
                }
            } catch (ex: Exception) {
                logger.warn("Debounced room code save failed for {}", inviteCode, ex)
            }
        }, 750, TimeUnit.MILLISECONDS)
        pendingRoomCodeDbSaveByRoom[inviteCode] = next
    }

    private fun scheduleCandidateKeyHistorySave(inviteCode: String, history: List<CandidateKeyPayload>) {
        val serializedHistory = CandidateKeyHistoryHelpers.serialize(history, objectMapper)
        latestCandidateKeyHistoryJsonByRoom[inviteCode] = serializedHistory
        pendingCandidateKeyHistorySaveByRoom.remove(inviteCode)?.cancel(false)
        val next = roomCandidateKeyHistorySaveScheduler.schedule({
            pendingCandidateKeyHistorySaveByRoom.remove(inviteCode)
            val latest = latestCandidateKeyHistoryJsonByRoom.remove(inviteCode) ?: return@schedule
            try {
                roomRepository.findByInviteCode(inviteCode)?.let { room ->
                    room.candidateKeyHistory = latest
                    roomRepository.save(room)
                }
            } catch (ex: Exception) {
                logger.warn("Debounced candidate key history save failed for {}", inviteCode, ex)
            }
        }, 260, TimeUnit.MILLISECONDS)
        pendingCandidateKeyHistorySaveByRoom[inviteCode] = next
    }

    private fun scheduleStateBroadcastFromYjs(inviteCode: String) {
        pendingYjsStateBroadcastByRoom.remove(inviteCode)?.cancel(false)
        val next = yjsStateBroadcastScheduler.schedule({
            pendingYjsStateBroadcastByRoom.remove(inviteCode)
            broadcastState(inviteCode)
        }, 110, TimeUnit.MILLISECONDS)
        pendingYjsStateBroadcastByRoom[inviteCode] = next
    }

    private fun openManagerWorkspace(connectionId: String, requestedStepIndex: Int?) {
        if (shouldIgnoreLatePublishedManagerWorkspaceEvent(connectionId, requestedStepIndex)) return
        val participant = participants[connectionId] ?: return
        requireManagerParticipant(participant)
        val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°")
        val stepIndex = requestedStepIndex ?: throw ApiException(HttpStatus.BAD_REQUEST, "РќРµ РїРµСЂРµРґР°РЅ РЅРѕРјРµСЂ С€Р°РіР°")
        val task = requireInactiveTask(room, stepIndex)
        val key = managerWorkspaceKey(participant.inviteCode, task)
        val workspace = managerWorkspaceState.computeIfAbsent(key) { managerWorkspaceStateFromTask(room, task) }
        workspace.stepIndex = task.stepIndex
        managerWorkspaceSubscriptionByConnection[connectionId] = key
        sendManagerWorkspaceSync(connectionId, workspace)
    }

    private fun shouldIgnoreLatePublishedManagerWorkspaceEvent(
        connectionId: String,
        requestedStepIndex: Int?,
    ): Boolean {
        val participant = participants[connectionId] ?: return false
        requireManagerParticipant(participant)
        val stepIndex = requestedStepIndex ?: return false
        val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode) ?: return false
        if (stepIndex != room.currentStep) return false
        managerWorkspaceSubscriptionByConnection.remove(connectionId)
        return true
    }

    private fun closeManagerWorkspace(connectionId: String) {
        val participant = participants[connectionId] ?: return
        requireManagerParticipant(participant)
        val existing = managerWorkspaceSubscriptionByConnection[connectionId] ?: return
        managerWorkspaceSubscriptionByConnection.remove(connectionId, existing)
    }

    private fun updateManagerWorkspaceBriefing(
        connectionId: String,
        stepIndex: Int?,
        markdown: String,
        revision: Long?,
    ) {
        val (key, workspace) = requireManagerWorkspaceSubscription(connectionId, stepIndex)
        val normalized = markdown.replace("\u0000", "").take(120_000)
        synchronized(managerWorkspaceRoomLock(key.inviteCode)) {
            synchronized(workspace) {
                requireWorkspaceRevision(connectionId, workspace, revision)
                workspace.briefingMarkdown = normalized
                workspace.revision += 1
                persistManagerWorkspace(key, workspace)
            }
        }
        broadcastManagerWorkspaceSync(key, workspace)
    }

    private fun updateManagerWorkspaceLanguage(
        connectionId: String,
        stepIndex: Int?,
        language: String,
        revision: Long?,
    ) {
        val (key, workspace) = requireManagerWorkspaceSubscription(connectionId, stepIndex)
        synchronized(managerWorkspaceRoomLock(key.inviteCode)) {
            synchronized(workspace) {
                requireWorkspaceRevision(connectionId, workspace, revision)
                workspace.language = normalizeLanguage(language)
                workspace.revision += 1
                persistManagerWorkspace(key, workspace)
            }
        }
        broadcastManagerWorkspaceSync(key, workspace)
    }

    private fun updateManagerWorkspaceFocusMode(
        connectionId: String,
        stepIndex: Int?,
        focusMode: Boolean?,
        revision: Long?,
    ) {
        val (key, workspace) = requireManagerWorkspaceSubscription(connectionId, stepIndex)
        val nextFocusMode = focusMode ?: throw ApiException(HttpStatus.BAD_REQUEST, "РќРµ РїРµСЂРµРґР°РЅ focusMode")
        synchronized(managerWorkspaceRoomLock(key.inviteCode)) {
            synchronized(workspace) {
                requireWorkspaceRevision(connectionId, workspace, revision)
                workspace.focusMode = nextFocusMode
                workspace.revision += 1
                persistManagerWorkspace(key, workspace)
            }
        }
        broadcastManagerWorkspaceSync(key, workspace)
    }

    private fun relayManagerWorkspaceYjsUpdate(
        connectionId: String,
        stepIndex: Int?,
        yjsUpdate: String,
        codeSnapshot: String?,
        yjsDocumentBase64: String?,
        baseServerYjsSequence: Long?,
        operationId: String?,
    ) {
        val participant = participants[connectionId] ?: return
        val (key, workspace) = requireManagerWorkspaceSubscription(connectionId, stepIndex)
        val trimmedUpdate = yjsUpdate.trim()
        val document = yjsDocumentBase64?.trim()?.takeIf { it.isNotEmpty() }
        if (document != null && document.length > maxYjsDocumentBase64Chars) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Yjs document is too large")
        }
        if (trimmedUpdate.isEmpty() && document == null) return

        var yjsSequence: Long
        synchronized(managerWorkspaceRoomLock(key.inviteCode)) {
            synchronized(workspace) {
                val hasMismatchedBase =
                    baseServerYjsSequence == null ||
                        baseServerYjsSequence != workspace.yjsSequence
                if (hasMismatchedBase) {
                    // A full Yjs document is authoritative only at the exact
                    // server sequence it was built from. Reject both stale and
                    // future bases; the client merges this canonical snapshot
                    // with its local Y.Doc and retries from this sequence.
                    sendManagerWorkspaceSync(connectionId, workspace, recovery = true)
                    throw ApiException(
                        HttpStatus.CONFLICT,
                        "Manager workspace Yjs snapshot requires resynchronisation",
                    )
                }
                if (!markOperationApplied(workspace.appliedOperationIds, operationId)) return
                if (document != null) {
                    workspace.yjsDocumentBase64 = document
                    codeSnapshot?.let { workspace.code = it }
                }
                workspace.yjsSequence += 1
                yjsSequence = workspace.yjsSequence
                persistManagerWorkspace(key, workspace)
            }
        }

        // Do not echo to candidates or to managers editing a different task.
        broadcastManagerWorkspaceTransport(
            key = key,
            type = "manager_workspace_yjs_update",
            payload = mapOf(
                "stepIndex" to workspace.stepIndex,
                "sessionId" to participant.sessionId,
                "yjsUpdate" to yjsUpdate,
                "yjsSequence" to yjsSequence,
            ),
            excludeConnectionId = connectionId,
        )
        // The incremental event is low-latency, while this authoritative full
        // snapshot lets every subscribed manager converge after a concurrent
        // write or an empty heartbeat update. Candidates never subscribe to
        // this channel.
        broadcastManagerWorkspaceSync(key, workspace)
    }

    private fun relayManagerWorkspaceAwareness(
        connectionId: String,
        stepIndex: Int?,
        awarenessBase64: String,
    ) {
        val participant = participants[connectionId] ?: return
        val (key, workspace) = requireManagerWorkspaceSubscription(connectionId, stepIndex)
        val trimmed = awarenessBase64.trim()
        if (trimmed.isEmpty() || trimmed.length > maxAwarenessUpdateBase64Chars) return
        broadcastManagerWorkspaceTransport(
            key = key,
            type = "manager_workspace_awareness_update",
            payload = mapOf(
                "stepIndex" to workspace.stepIndex,
                "sessionId" to participant.sessionId,
                "userId" to participant.userId,
                "participantId" to participant.participantId,
                "awarenessUpdate" to trimmed,
            ),
            excludeConnectionId = connectionId,
        )
    }

    private fun requireManagerWorkspaceSubscription(
        connectionId: String,
        requestedStepIndex: Int?,
    ): Pair<ManagerWorkspaceKey, ManagerWorkspaceState> {
        val participant = participants[connectionId]
            ?: throw ApiException(HttpStatus.FORBIDDEN, "РќРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ РїРѕРґРєР»СЋС‡РµРЅРёСЏ")
        requireManagerParticipant(participant)
        val stepIndex = requestedStepIndex ?: throw ApiException(HttpStatus.BAD_REQUEST, "РќРµ РїРµСЂРµРґР°РЅ РЅРѕРјРµСЂ С€Р°РіР°")
        val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°")
        val task = requireInactiveTask(room, stepIndex)
        val key = managerWorkspaceKey(participant.inviteCode, task)
        if (managerWorkspaceSubscriptionByConnection[connectionId] != key) {
            throw ApiException(HttpStatus.FORBIDDEN, "Р Р°Р±РѕС‡РµРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ Р·Р°РґР°С‡Рё РЅРµ РѕС‚РєСЂС‹С‚Рѕ")
        }
        val workspace = managerWorkspaceState[key]
            ?: throw ApiException(HttpStatus.CONFLICT, "Р Р°Р±РѕС‡РµРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ Р±С‹Р»Рѕ РѕР±РЅРѕРІР»РµРЅРѕ")
        return key to workspace
    }

    private fun requireWorkspaceRevision(
        connectionId: String,
        workspace: ManagerWorkspaceState,
        revision: Long?,
    ) {
        if (revision == workspace.revision) return
        sendManagerWorkspaceSync(connectionId, workspace)
        throw ApiException(HttpStatus.CONFLICT, "Р§РµСЂРЅРѕРІРёРє Р·Р°РґР°С‡Рё РёР·РјРµРЅРёР»СЃСЏ; РІС‹РїРѕР»РЅРµРЅР° СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ")
    }

    private fun requireManagerParticipant(participant: ParticipantMeta) {
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "РўРѕР»СЊРєРѕ РёРЅС‚РµСЂРІСЊСЋРµСЂ РјРѕР¶РµС‚ РѕС‚РєСЂС‹РІР°С‚СЊ РїРѕРґРіРѕС‚РѕРІРєСѓ Р·Р°РґР°С‡Рё")
        }
    }

    private fun requireInactiveTask(room: Room, stepIndex: Int): RoomTask {
        if (stepIndex < 0 || stepIndex >= room.tasks.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "РќРѕРјРµСЂ С€Р°РіР° РІРЅРµ РґРёР°РїР°Р·РѕРЅР°")
        }
        if (stepIndex == room.currentStep) {
            throw ApiException(HttpStatus.BAD_REQUEST, "РћРїСѓР±Р»РёРєРѕРІР°РЅРЅР°СЏ Р·Р°РґР°С‡Р° РёСЃРїРѕР»СЊР·СѓРµС‚ РѕР±С‰РёР№ РєР°РЅР°Р»")
        }
        return room.tasks.firstOrNull { it.stepIndex == stepIndex }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")
    }

    private fun updateLanguage(connectionId: String, language: String) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может менять язык")
        }
        val normalizedLanguage = normalizeLanguage(language)
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            val state = roomState[participant.inviteCode] ?: return
            val taskId = synchronized(state) {
                state.language = normalizedLanguage
                val currentTaskIndex = state.tasks.indexOfFirst { it.stepIndex == state.currentStep }
                if (currentTaskIndex >= 0) {
                    state.tasks[currentTaskIndex] = state.tasks[currentTaskIndex].copy(language = normalizedLanguage)
                }
                state.publishedTaskId ?: return
            }
            roomRepository.findWithTasksByInviteCode(participant.inviteCode)?.let { room ->
                val sourceTask = room.tasks.firstOrNull { it.id == taskId } ?: return@let
                sourceTask.solutionLanguage = normalizedLanguage
                if (room.currentStep == sourceTask.stepIndex) {
                    room.language = normalizedLanguage
                }
                roomRepository.save(room)
            }
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
            it.interviewerChat = PrivateNotesSerialization.serializeChatMessages(state.notesMessages, objectMapper)
            roomRepository.save(it)
        }
        broadcastState(inviteCode)
    }

    private fun appendPrivateNoteEntry(
        connectionId: String,
        noteId: String?,
        noteText: String?,
        blockName: String?,
        blockStepIndex: Int?,
        noteTimestampEpochMs: Long?,
    ) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может вести личные заметки")
        }

        val normalizedText = noteText.orEmpty().replace("\u0000", "").trim().take(privateNotesTextMaxChars)
        if (normalizedText.isBlank()) return

        val inviteCode = participant.inviteCode
        val room = roomRepository.findWithTasksByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val authorKey = resolvePrivateNotesAuthorKey(participant)
        val normalizedBlockName = blockName
            ?.replace("\u0000", "")
            ?.trim()
            ?.take(privateNotesBlockNameMaxChars)
            ?.ifBlank { null }
        val normalizedBlockStepIndex = blockStepIndex
            ?.takeIf { it >= 0 && it < room.tasks.size.coerceAtLeast(1) }
        val normalizedTimestamp = noteTimestampEpochMs
            ?.takeIf { it >= 0 }
            ?: Instant.now().toEpochMilli()

        val notesByAuthor = parseRoomPrivateNotes(room)
        val authorNotes = (notesByAuthor[authorKey] ?: mutableListOf()).toMutableList()
        val nextEntry = PersonalNoteEntryPayload(
            id = noteId?.trim()?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
            text = normalizedText,
            blockName = normalizedBlockName,
            blockStepIndex = normalizedBlockStepIndex,
            timestampEpochMs = normalizedTimestamp,
        )
        authorNotes.add(nextEntry)
        if (authorNotes.size > privateNotesHistoryLimit) {
            val overflow = authorNotes.size - privateNotesHistoryLimit
            repeat(overflow) {
                authorNotes.removeAt(0)
            }
        }
        notesByAuthor[authorKey] = authorNotes

        room.privateNotesJson = serializeRoomPrivateNotes(notesByAuthor)
        roomRepository.save(room)

        roomState[inviteCode]?.let { state ->
            synchronized(state) {
                state.privateNotesByAuthor[authorKey] = authorNotes.toMutableList()
            }
        }
        broadcastState(inviteCode)
    }

    private fun updateBriefingMarkdown(connectionId: String, markdown: String) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может редактировать markdown")
        }
        val normalized = markdown.replace("\u0000", "").take(120_000)
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            val state = roomState[participant.inviteCode] ?: return
            val taskId = synchronized(state) {
                state.briefingMarkdown = normalized
                state.publishedTaskId ?: return
            }
            roomRepository.findWithTasksByInviteCode(participant.inviteCode)?.let { room ->
                val sourceTask = room.tasks.firstOrNull { it.id == taskId } ?: return@let
                sourceTask.briefingMarkdown = normalized
                if (room.currentStep == sourceTask.stepIndex) {
                    room.briefingMarkdown = normalized
                }
                roomRepository.save(room)
            }
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
        roomState[participant.inviteCode]?.let { state ->
            state.taskScoresByStepIndex[targetStep] = normalizedRating
            val taskPosition = state.tasks.indexOfFirst { task -> task.stepIndex == targetStep }
            if (taskPosition >= 0) {
                state.tasks[taskPosition] = state.tasks[taskPosition].copy(score = normalizedRating)
            }
        }
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
    /**
     * Resolves the in-memory realtime role for a connection identified by its
     * server-assigned event token. Used by REST endpoints that need to honour
     * roles granted to guest (unauthenticated) participants via the realtime
     * channel — those participants have no JWT and no DB participant record.
     *
     * Returns null when the token is blank or no matching connection is found.
     */
    fun resolveRoleByEventToken(inviteCode: String, eventToken: String?): RoomAccessService.RoomRole? {
        if (eventToken.isNullOrBlank()) return null
        return participants.values
            .firstOrNull { it.inviteCode == inviteCode && it.eventToken == eventToken }
            ?.role
    }

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
                    val targets = resolveGuestRoleTargets(participant.inviteCode, target)
                    targets.forEach { guestTarget ->
                        guestTarget.role = RoomAccessService.RoomRole.INTERVIEWER
                        state?.grantedRoleBySessionId?.set(
                            guestTarget.sessionId,
                            RoomAccessService.RoomRole.INTERVIEWER,
                        )
                    }
                }
            }
            RoomAccessService.RoomRole.CANDIDATE -> {
                if (resolvedTargetUserId.isNotBlank()) {
                    roomParticipantRepository.deleteByRoomIdAndUserId(roomId, resolvedTargetUserId)
                } else {
                    val target = activeTarget
                        ?: throw ApiException(HttpStatus.BAD_REQUEST, "Участник не найден в активной комнате")
                    val targets = resolveGuestRoleTargets(participant.inviteCode, target)
                    targets.forEach { guestTarget ->
                        guestTarget.role = RoomAccessService.RoomRole.CANDIDATE
                        state?.grantedRoleBySessionId?.set(
                            guestTarget.sessionId,
                            RoomAccessService.RoomRole.CANDIDATE,
                        )
                    }
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
                "userId" to participant.userId,
                "participantId" to participant.participantId,
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
        eventKind: String? = null,
        pasteLength: Int? = null,
        pastePreview: String? = null,
        sourceEventId: String? = null,
    ) {
        val participant = participants[connectionId] ?: return
        if (participant.role != RoomAccessService.RoomRole.CANDIDATE) return

        val normalizedEventKind = CandidateKeyHistoryHelpers.normalizeEventKind(eventKind)
        val isSyntheticEvent = normalizedEventKind != "keydown"
        val normalizedKey = CandidateKeyHistoryHelpers.normalizeIncomingKey(key)
        val normalizedCode = CandidateKeyHistoryHelpers.normalizeIncomingKeyCode(keyCode)
        val normalizedSourceEventId = normalizeSourceEventId(sourceEventId)
        // Синтетические события (blur/visibility) могут не нести key/keyCode,
        // но всё равно важны для лога — пропускаем фильтр пустоты.
        if (!isSyntheticEvent && normalizedKey.isBlank() && normalizedCode.isBlank()) return

        val state = roomState[participant.inviteCode] ?: return
        // Hold the in-memory room monitor only for metadata/history. The durable
        // database acceptance below may wait on the room row, so doing it while
        // synchronized(state) would delay independent Yjs/code collaboration.
        val roomId = synchronized(state) {
            state.roomId.takeIf { it.isNotBlank() }
                ?: throw ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Room activity state has no persisted room ID")
        }
        val acceptance = keystrokePersistenceService.accept(
            roomId = roomId,
            payload = CandidateKeyPayload(
                sessionId = participant.sessionId,
                displayName = participant.displayName,
                key = when {
                    normalizedKey.isNotEmpty() -> normalizedKey
                    normalizedCode.isNotEmpty() -> normalizedCode
                    isSyntheticEvent -> ""
                    else -> "Unknown"
                },
                keyCode = when {
                    normalizedCode.isNotEmpty() -> normalizedCode
                    normalizedKey.isNotEmpty() -> normalizedKey
                    isSyntheticEvent -> ""
                    else -> "Unknown"
                },
                ctrlKey = ctrlKey,
                altKey = altKey,
                shiftKey = shiftKey,
                metaKey = metaKey,
                timestampEpochMs = 0,
                eventKind = normalizedEventKind,
                pasteLength = CandidateKeyHistoryHelpers.sanitizePasteLength(pasteLength),
                pastePreview = CandidateKeyHistoryHelpers.sanitizePastePreview(pastePreview),
                sourceEventId = normalizedSourceEventId,
            ),
        )
        if (!acceptance.created) return
        val keyEvent = acceptance.payload
        val historySnapshot = synchronized(state) {
            state.lastCandidateKey = keyEvent
            state.candidateKeyHistory.add(keyEvent)
            val canonicalHistory = CandidateKeyHistoryHelpers.canonicalize(state.candidateKeyHistory)
            state.candidateKeyHistory.clear()
            state.candidateKeyHistory.addAll(canonicalHistory)
            state.lastCandidateKey = canonicalHistory.lastOrNull()
            if (state.candidateKeyHistory.size > candidateKeyHistoryMaxSize) {
                val overflow = state.candidateKeyHistory.size - candidateKeyHistoryMaxSize
                repeat(overflow) {
                    state.candidateKeyHistory.removeAt(0)
                }
            }
            state.candidateKeyHistory.toList()
        }

        scheduleCandidateKeyHistorySave(participant.inviteCode, historySnapshot)
        if (normalizedEventKind == "keydown" || normalizedEventKind == "paste") {
            roomProductMetricsProjector.recordMeaningfulCandidateActivity(roomId)
        }

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

    private fun normalizeSourceEventId(rawSourceEventId: String?): String {
        val candidate = rawSourceEventId?.trim().orEmpty()
        if (candidate.isBlank()) return UUID.randomUUID().toString()
        return runCatching { UUID.fromString(candidate).toString() }
            .getOrElse {
                throw ApiException(HttpStatus.BAD_REQUEST, "sourceEventId must be a UUID")
            }
    }

    private fun nextStep(connectionId: String) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может переключать шаги")
        }
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode)
                ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
            if (room.tasks.isEmpty()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
            }
            val maxStep = room.tasks.size - 1
            setStepInternal(participant.inviteCode, room, (room.currentStep + 1).coerceAtMost(maxStep))
        }
    }

    private fun setStep(connectionId: String, stepIndex: Int) {
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может переключать шаги")
        }
        synchronized(managerWorkspaceRoomLock(participant.inviteCode)) {
            val room = roomRepository.findWithTasksByInviteCode(participant.inviteCode)
                ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
            if (room.tasks.isEmpty()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
            }
            if (stepIndex < 0 || stepIndex >= room.tasks.size) {
                throw ApiException(HttpStatus.BAD_REQUEST, "Номер шага вне диапазона")
            }
            setStepInternal(participant.inviteCode, room, stepIndex)
        }
    }

    fun broadcastVerdictSet(
        inviteCode: String,
        verdict: String,
        verdictComment: String?,
        finishedAt: Long,
    ) {
        // Update in-memory state so that any state_sync requested by clients
        // AFTER receiving this event reflects the committed verdict immediately.
        roomState[inviteCode]?.let { state ->
            state.verdict = verdict
            state.verdictComment = verdictComment
            state.status = "finished"
            state.finishedAt = finishedAt
        }
        val payload = VerdictSetPayload(
            verdict = verdict,
            verdictComment = verdictComment,
            finishedAt = finishedAt,
        )
        broadcastTransportMessage(
            inviteCode = inviteCode,
            type = "verdict_set",
            payload = payload,
        )
    }

    fun closeRoom(inviteCode: String) {
        pendingYjsStateBroadcastByRoom.remove(inviteCode)?.cancel(false)
        pendingRoomCodeDbSaveByRoom.remove(inviteCode)?.cancel(false)
        latestCodeForDebouncedDbSaveByRoom.remove(inviteCode)
        pendingCandidateKeyHistorySaveByRoom.remove(inviteCode)?.cancel(false)
        latestCandidateKeyHistoryJsonByRoom.remove(inviteCode)
        roomState.remove(inviteCode)
        managerWorkspaceState.keys
            .filter { it.inviteCode == inviteCode }
            .forEach { managerWorkspaceState.remove(it) }
        managerWorkspaceRoomLocks.remove(inviteCode)
        managerWorkspaceSubscriptionByConnection.entries
            .filter { it.value.inviteCode == inviteCode }
            .forEach { (connectionId, key) -> managerWorkspaceSubscriptionByConnection.remove(connectionId, key) }
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
        val roomParticipants = aggregateRoomParticipants(inviteCode)
        val participantsPayload = roomParticipants.map { participantMetaToPayload(it) }
        val participantBySessionId = roomParticipants.associateBy { it.sessionId }
        val cursorsPayload = buildCursorsPayload(state, participantBySessionId)

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

    private fun sendSseHeartbeats() {
        val activeRooms = roomSseConnections.entries
            .asSequence()
            .filter { it.value.isNotEmpty() }
            .map { it.key }
            .toList()
        if (activeRooms.isEmpty()) return
        val payload = mapOf("ts" to Instant.now().toEpochMilli())
        activeRooms.forEach { inviteCode ->
            runCatching {
                broadcastTransportMessage(
                    inviteCode = inviteCode,
                    type = "heartbeat",
                    payload = payload,
                )
            }.onFailure { ex ->
                logger.debug("SSE heartbeat sweep failed for room {}", inviteCode, ex)
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

    private fun sendManagerWorkspaceSync(
        connectionId: String,
        workspace: ManagerWorkspaceState,
        recovery: Boolean = false,
    ) {
        val emitter = sseConnections[connectionId] ?: return
        val participant = participants[connectionId] ?: return
        if (!participant.canManageRoom) return
        val payload = managerWorkspacePayload(workspace, recovery = recovery)
        try {
            sendSseMessage(emitter, objectMapper.writeValueAsString(WsOutgoingMessage("manager_workspace_sync", payload)))
        } catch (ex: Exception) {
            logger.warn("Failed to send manager workspace sync", ex)
            detachConnection(connectionId, closeTransport = true)
        }
    }

    private fun broadcastManagerWorkspaceSync(key: ManagerWorkspaceKey, workspace: ManagerWorkspaceState) {
        broadcastManagerWorkspaceTransport(key, "manager_workspace_sync", managerWorkspacePayload(workspace))
    }

    private fun broadcastManagerWorkspaceTransport(
        key: ManagerWorkspaceKey,
        type: String,
        payload: Any,
        excludeConnectionId: String? = null,
    ) {
        val subscribers = managerWorkspaceSubscriptionByConnection.entries
            .asSequence()
            .filter { it.value == key }
            .map { it.key }
            .filter { connectionId -> participants[connectionId]?.canManageRoom == true }
            .toSet()
        if (subscribers.isEmpty()) return
        broadcastTransportMessage(
            inviteCode = key.inviteCode,
            type = type,
            payload = payload,
            excludeConnectionId = excludeConnectionId,
            includeConnectionIds = subscribers,
        )
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
        val personalNotes = buildParticipantPersonalNotes(state, participant)
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
            personalNotes = personalNotes,
            briefingMarkdown = state.briefingMarkdown,
            participants = participantsPayload,
            isOwner = participant.isOwner,
            role = participant.role.wireValue,
            canManageRoom = participant.canManageRoom,
            canGrantAccess = participant.canGrantAccess,
            eventToken = participant.eventToken,
            notesLockedBySessionId = state.notesLockedBySessionId,
            notesLockedByDisplayName = state.notesLockedByDisplayName,
            notesLockedUntilEpochMs = state.notesLockedUntilEpochMs,
            tasks = state.tasks.toList(),
            taskScores = state.taskScoresByStepIndex.toMap(),
            cursors = cursorsPayload,
            lastCandidateKey = if (participant.canManageRoom) state.lastCandidateKey else null,
            candidateKeyHistory = if (participant.canManageRoom) state.candidateKeyHistory.toList() else null,
            verdict = state.verdict,
            verdictComment = state.verdictComment,
            status = state.status,
            finishedAt = state.finishedAt,
        )
    }

    private fun buildParticipantPersonalNotes(
        state: RealtimeState,
        participant: ParticipantMeta,
    ): List<PersonalNoteEntryPayload> {
        if (!participant.canManageRoom) return emptyList()
        val authorKey = resolvePrivateNotesAuthorKey(participant)
        if (authorKey.isBlank()) return emptyList()
        return state.privateNotesByAuthor[authorKey].orEmpty()
            .asSequence()
            .filter { it.text.trim().isNotEmpty() }
            .sortedWith(compareBy<PersonalNoteEntryPayload> { it.timestampEpochMs }.thenBy { it.id })
            .toList()
    }

    private fun resolvePrivateNotesAuthorKey(participant: ParticipantMeta): String {
        val normalizedUserId = participant.userId?.trim().orEmpty()
        if (normalizedUserId.isNotBlank()) return "u:$normalizedUserId"
        val normalizedParticipantId = participant.participantId?.trim().orEmpty()
        if (normalizedParticipantId.isNotBlank()) return "p:$normalizedParticipantId"
        return "s:${participant.sessionId.trim()}"
    }

    /**
     * Loads private notes for the room. New room-level storage in
     * `Room.privateNotesJson` is the source of truth. If the room still carries
     * the legacy per-task storage (each task's `privateNotesJson`), we migrate it
     * once: flatten all entries into a single per-author stream, tagging each
     * entry with `blockStepIndex` of the source task, and persist the result on
     * the room. This keeps existing interviewer notes after the upgrade.
     *
     * Pure-сериализация и one-shot миграция вынесены в [PrivateNotesSerialization].
     * Здесь остаётся ровно тот побочный эффект, который и должен жить в
     * сервисе: запись результата миграции в БД через [roomRepository].
     */
    private fun parseRoomPrivateNotes(room: Room): MutableMap<String, MutableList<PersonalNoteEntryPayload>> {
        val rawRoom = room.privateNotesJson.orEmpty().trim()
        if (rawRoom.isNotBlank()) {
            val parsed = runCatching {
                objectMapper.readValue(rawRoom, RoomPrivateNotesPayload::class.java)
            }.getOrNull()
            if (parsed != null) {
                return PrivateNotesSerialization.readAuthorsPayload(
                    parsed.authors,
                    historyLimit = privateNotesHistoryLimit,
                    blockNameMaxChars = privateNotesBlockNameMaxChars,
                    textMaxChars = privateNotesTextMaxChars,
                )
            }
        }

        val migrated = PrivateNotesSerialization.migrateLegacyTaskPrivateNotes(
            room,
            objectMapper,
            historyLimit = privateNotesHistoryLimit,
            blockNameMaxChars = privateNotesBlockNameMaxChars,
            textMaxChars = privateNotesTextMaxChars,
        )
        if (migrated.isNotEmpty()) {
            room.privateNotesJson = serializeRoomPrivateNotes(migrated)
            // Wipe legacy per-task storage so it does not migrate again on next read.
            room.tasks.forEach { it.privateNotesJson = null }
            roomRepository.save(room)
        }
        return migrated
    }

    private fun serializeRoomPrivateNotes(
        authors: Map<String, List<PersonalNoteEntryPayload>>,
    ): String = PrivateNotesSerialization.serializeRoomPrivateNotes(
        authors,
        objectMapper,
        historyLimit = privateNotesHistoryLimit,
        blockNameMaxChars = privateNotesBlockNameMaxChars,
        textMaxChars = privateNotesTextMaxChars,
    )

    private fun setStepInternal(inviteCode: String, room: Room, stepIndex: Int) {
        val persistedRoomId = requirePersistedRoomId(room)
        val currentState = roomState[inviteCode]
        val currentTask = room.tasks.getOrNull(room.currentStep)
        currentTask?.let { current ->
            current.solutionCode = currentState?.code ?: room.code
            current.solutionLanguage = normalizeLanguage(currentState?.language ?: room.language)
            current.briefingMarkdown = currentState?.briefingMarkdown ?: current.briefingMarkdown
            // Once this public task becomes inactive, managers must resume the
            // exact document they just edited, not the older draft snapshot
            // that was used when the task was first published.
            current.workspaceYjsDocumentBase64 = currentState?.yjsDocumentBase64
                ?: current.workspaceYjsDocumentBase64
            current.workspaceYjsSequence = currentState?.lastYjsSequence
                ?: current.workspaceYjsSequence
        }
        if (room.notes.isNullOrBlank()) {
            room.notes = currentTask?.interviewerNotes?.takeIf { it.isNotBlank() }
                ?: currentState?.notes.orEmpty()
        }
        room.tasks.forEach { it.interviewerNotes = null }

        val nextTask = room.tasks[stepIndex]
        // Publication copies the exact durable manager workspace under the
        // room lock.  A concurrent scoped update cannot interleave between the
        // copy and Room.currentStep becoming public.
        managerWorkspaceState[managerWorkspaceKey(inviteCode, nextTask)]?.let { workspace ->
            synchronized(workspace) {
                nextTask.solutionCode = workspace.code
                nextTask.solutionLanguage = workspace.language
                nextTask.briefingMarkdown = workspace.briefingMarkdown
                nextTask.workspaceFocusMode = workspace.focusMode
                nextTask.workspaceRevision = workspace.revision
                nextTask.workspaceYjsDocumentBase64 = workspace.yjsDocumentBase64
                nextTask.workspaceYjsSequence = workspace.yjsSequence
            }
        }
        room.currentStep = stepIndex
        room.language = normalizeLanguage(nextTask.solutionLanguage?.ifBlank { null } ?: nextTask.language)
        room.code = nextTask.solutionCode ?: nextTask.starterCode
        room.briefingMarkdown = withTaskFocusMarker(nextTask.briefingMarkdown.orEmpty(), taskFocusMode(nextTask))
        roomRepository.save(room)
        val mergedCandidateKeyHistory = CandidateKeyHistoryHelpers.merge(
            inMemory = currentState?.candidateKeyHistory.orEmpty(),
            persisted = CandidateKeyHistoryHelpers.parse(room.candidateKeyHistory, objectMapper),
        )
        val mergedLastCandidateKey = mergedCandidateKeyHistory.lastOrNull()
        val taskPayloads = buildTaskPayloads(room)

        roomState[inviteCode] = RealtimeState(
            language = normalizeLanguage(room.language),
            code = room.code,
            lastCodeUpdatedBySessionId = null,
            yjsDocumentBase64 = nextTask.workspaceYjsDocumentBase64,
            lastYjsSequence = nextTask.workspaceYjsSequence,
            lastIncrementalYjsSessionId = null,
            currentStep = room.currentStep,
            publishedTaskId = nextTask.id,
            notes = room.notes.orEmpty(),
            notesMessages = currentState?.notesMessages?.toMutableList()
                ?: PrivateNotesSerialization.parseChatMessages(room.interviewerChat, room.notes, objectMapper),
            privateNotesByAuthor = currentState?.privateNotesByAuthor ?: parseRoomPrivateNotes(room),
            briefingMarkdown = withTaskFocusMarker(
                nextTask.briefingMarkdown?.takeIf { it.isNotBlank() } ?: nextTask.description,
                taskFocusMode(nextTask),
            ),
            tasks = taskPayloads,
            notesLockedBySessionId = currentState?.notesLockedBySessionId,
            notesLockedByDisplayName = currentState?.notesLockedByDisplayName,
            notesLockedUntilEpochMs = currentState?.notesLockedUntilEpochMs,
            taskScoresByStepIndex = buildTaskScores(room),
            cursorsBySessionId = currentState?.cursorsBySessionId ?: ConcurrentHashMap(),
            lastCursorSequenceBySessionId = currentState?.lastCursorSequenceBySessionId ?: ConcurrentHashMap(),
            lastCodeSequenceBySessionId = currentState?.lastCodeSequenceBySessionId ?: ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = currentState?.lastYjsSnapshotSequenceBySessionId ?: ConcurrentHashMap(),
            lastClientEventSequenceBySessionId = currentState?.lastClientEventSequenceBySessionId ?: ConcurrentHashMap(),
            grantedRoleBySessionId = currentState?.grantedRoleBySessionId ?: ConcurrentHashMap(),
            lastCandidateKey = mergedLastCandidateKey,
            candidateKeyHistory = mergedCandidateKeyHistory.toMutableList(),
            lastCandidateKeyAtEpochMs = mergedLastCandidateKey?.timestampEpochMs ?: 0L,
            verdict = room.verdict,
            verdictComment = room.verdictComment,
            status = room.status ?: "active",
            finishedAt = room.finishedAt?.toEpochMilli(),
            roomId = persistedRoomId,
        )
        cleanupPublishedManagerWorkspace(inviteCode, nextTask)
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

    private fun requireConnectionId(
        inviteCode: String,
        sessionId: String,
        eventToken: String?,
        requireEventToken: Boolean,
    ): String {
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
        if (requireEventToken) {
            val providedToken = eventToken?.trim().orEmpty()
            if (providedToken.isBlank() || participant.eventToken != providedToken) {
                throw ApiException(HttpStatus.FORBIDDEN, "Недействительный eventToken для этой сессии")
            }
        }
        return connectionId
    }

    private fun detachConnection(connectionId: String, closeTransport: Boolean): String? {
        val participant = participants.remove(connectionId)
        val inviteCode = participant?.inviteCode
        managerWorkspaceSubscriptionByConnection.remove(connectionId)

        if (participant != null) {
            connectionByRoomSession.remove(roomSessionKey(participant.inviteCode, participant.sessionId), connectionId)
            roomState[participant.inviteCode]?.let { state ->
                state.cursorsBySessionId.remove(participant.sessionId)
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

    private fun markOperationApplied(state: RealtimeState, operationIdRaw: String?): Boolean {
        val operationId = operationIdRaw?.trim().orEmpty()
        if (operationId.isEmpty()) return true

        val now = Instant.now().toEpochMilli()
        val staleBefore = now - appliedOperationIdTtlMillis
        synchronized(state) {
            if (state.appliedOperationIds.containsKey(operationId)) {
                return false
            }

            if (state.appliedOperationIds.isNotEmpty()) {
                val staleIds = state.appliedOperationIds.entries
                    .asSequence()
                    .filter { it.value < staleBefore }
                    .map { it.key }
                    .toList()
                staleIds.forEach { staleId ->
                    state.appliedOperationIds.remove(staleId)
                }
            }

            state.appliedOperationIds[operationId] = now
            val overflow = state.appliedOperationIds.size - appliedOperationIdCacheMaxSize
            if (overflow > 0) {
                val oldestIds = state.appliedOperationIds.entries
                    .sortedBy { it.value }
                    .take(overflow)
                    .map { it.key }
                oldestIds.forEach { staleId ->
                    state.appliedOperationIds.remove(staleId)
                }
            }
        }
        return true
    }

    private fun canAcceptStaleSnapshotForLocalOnlyGap(
        state: RealtimeState,
        baseServerYjsSequence: Long,
        currentServerYjsSequence: Long,
        sessionId: String,
    ): Boolean {
        if (baseServerYjsSequence >= currentServerYjsSequence) return true
        if (baseServerYjsSequence < 0) return false
        var sequence = baseServerYjsSequence + 1
        while (sequence <= currentServerYjsSequence) {
            val authorSessionId = state.yjsSequenceAuthorBySequence[sequence] ?: return false
            if (authorSessionId != sessionId) return false
            sequence += 1
        }
        return true
    }

    private fun pruneYjsSequenceAuthorHistory(state: RealtimeState, currentServerYjsSequence: Long) {
        val minSequenceToKeep = (currentServerYjsSequence - yjsSequenceAuthorHistoryLimit).coerceAtLeast(0)
        if (state.yjsSequenceAuthorBySequence.isEmpty()) return
        val staleSequences = state.yjsSequenceAuthorBySequence.keys
            .filter { it < minSequenceToKeep }
        if (staleSequences.isEmpty()) return
        staleSequences.forEach { staleSequence ->
            state.yjsSequenceAuthorBySequence.remove(staleSequence)
        }
    }

    /**
     * Domain-shortcut для [ParticipantIdentity.participantIdentityKey] под
     * приватный nested-тип [ParticipantMeta]. Все остальные хелперы
     * (`normalizeParticipantId`, `rolePriority`, перегрузка по userId/participantId/sessionId)
     * вызываются напрямую из [ParticipantIdentity] без обёрток.
     */
    private fun participantIdentityKey(meta: ParticipantMeta): String =
        ParticipantIdentity.participantIdentityKey(meta.userId, meta.participantId, meta.sessionId)

    private fun aggregateParticipantGroup(group: List<ParticipantMeta>): ParticipantMeta {
        val representative = group
            .sortedWith(
                compareByDescending<ParticipantMeta> { ParticipantIdentity.rolePriority(it.role) }
                    .thenByDescending { if (it.presenceStatus == PresenceStatus.ACTIVE) 1 else 0 }
                    .thenBy { it.displayName.lowercase() }
                    .thenBy { it.sessionId },
            )
            .first()
        val mergedRole = group.maxByOrNull { ParticipantIdentity.rolePriority(it.role) }?.role ?: representative.role
        val mergedPresence =
            if (group.any { it.presenceStatus == PresenceStatus.ACTIVE }) PresenceStatus.ACTIVE else PresenceStatus.AWAY
        return representative.copy(
            role = mergedRole,
            presenceStatus = mergedPresence,
        )
    }

    private fun aggregateRoomParticipants(inviteCode: String): List<ParticipantMeta> {
        val roomParticipants = participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .toList()
        if (roomParticipants.isEmpty()) return emptyList()

        return roomParticipants
            .groupBy { participantIdentityKey(it) }
            .values
            .map { aggregateParticipantGroup(it) }
            .sortedBy { it.displayName.lowercase() }
    }

    private fun buildCursorsPayload(
        state: RealtimeState,
        participantBySessionId: Map<String, ParticipantMeta>,
    ): List<CursorPayload> {
        return state.cursorsBySessionId.entries
            .asSequence()
            .mapNotNull { (sessionId, cursor) ->
                val participantMeta = participantBySessionId[sessionId] ?: return@mapNotNull null
                CursorPayload(
                    sessionId = sessionId,
                    displayName = participantMeta.displayName,
                    userId = participantMeta.userId,
                    participantId = participantMeta.participantId,
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
    }

    private fun resolveIdentityRoleOverride(
        inviteCode: String,
        userId: String?,
        participantId: String?,
        sessionId: String,
    ): RoomAccessService.RoomRole? {
        val identityKey = ParticipantIdentity.participantIdentityKey(userId, participantId, sessionId)
        return participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .filter { participantIdentityKey(it) == identityKey }
            .map { it.role }
            .maxByOrNull { ParticipantIdentity.rolePriority(it) }
    }

    private fun resolveGuestRoleTargets(inviteCode: String, target: ParticipantMeta): List<ParticipantMeta> {
        val normalizedTargetParticipantId =
            ParticipantIdentity.normalizeParticipantId(target.participantId) ?: return listOf(target)
        val sameGuestTargets = participants.values
            .asSequence()
            .filter { it.inviteCode == inviteCode }
            .filter { it.userId.isNullOrBlank() }
            .filter { ParticipantIdentity.normalizeParticipantId(it.participantId) == normalizedTargetParticipantId }
            .toList()
        if (sameGuestTargets.isEmpty()) return listOf(target)
        return sameGuestTargets
    }

    private fun participantMetaToPayload(meta: ParticipantMeta): ParticipantPayload {
        val isAuthenticated = !meta.userId.isNullOrBlank()
        return ParticipantPayload(
            sessionId = meta.sessionId,
            displayName = meta.displayName,
            userId = meta.userId,
            participantId = meta.participantId,
            role = meta.role.wireValue,
            presenceStatus = meta.presenceStatus.wireValue,
            isAuthenticated = isAuthenticated,
            canBeGrantedInterviewerAccess = meta.role != RoomAccessService.RoomRole.OWNER,
        )
    }

    private fun resolveRole(room: Room, ownerToken: String?, user: User?): RoomAccessService.RoomRole {
        return roomAccessService.resolveAccess(room, user, ownerToken, null).role
    }

    private fun findRoomStreamAdmission(
        inviteCode: String,
        ownerToken: String?,
        user: User?,
    ): RoomStreamAdmission? {
        val room = roomRepository.findByInviteCode(inviteCode) ?: return null
        return RoomStreamAdmission(
            room = room,
            resolvedRole = resolveRole(room, ownerToken, user),
        )
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

    private fun managerWorkspaceKey(inviteCode: String, task: RoomTask): ManagerWorkspaceKey =
        ManagerWorkspaceKey(
            inviteCode = inviteCode,
            taskId = requireNotNull(task.id) { "Manager workspace task must be persisted" },
        )

    private fun managerWorkspaceStateFromTask(room: Room, task: RoomTask): ManagerWorkspaceState =
        ManagerWorkspaceState(
            roomId = room.id.orEmpty(),
            stepIndex = task.stepIndex,
            title = task.title,
            language = normalizeLanguage(task.solutionLanguage?.ifBlank { null } ?: task.language),
            code = task.solutionCode ?: task.starterCode,
            briefingMarkdown = task.briefingMarkdown?.takeIf { it.isNotBlank() } ?: task.description,
            focusMode = taskFocusMode(task),
            revision = task.workspaceRevision,
            yjsDocumentBase64 = task.workspaceYjsDocumentBase64,
            yjsSequence = task.workspaceYjsSequence,
        )

    private fun managerWorkspaceRoomLock(inviteCode: String): Any =
        managerWorkspaceRoomLocks.computeIfAbsent(inviteCode) { Any() }

    private fun managerWorkspacePayload(
        workspace: ManagerWorkspaceState,
        recovery: Boolean = false,
    ): ManagerWorkspacePayload =
        ManagerWorkspacePayload(
            stepIndex = workspace.stepIndex,
            title = workspace.title,
            language = workspace.language,
            code = workspace.code,
            briefingMarkdown = workspace.briefingMarkdown,
            focusMode = workspace.focusMode,
            revision = workspace.revision,
            yjsDocumentBase64 = workspace.yjsDocumentBase64,
            yjsSequence = workspace.yjsSequence,
            recovery = recovery,
        )

    /** Writes only RoomTask fields; it never mutates the published Room state. */
    private fun persistManagerWorkspace(key: ManagerWorkspaceKey, workspace: ManagerWorkspaceState) {
        val room = roomRepository.findWithTasksByInviteCode(key.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°")
        val task = room.tasks.firstOrNull { it.id == key.taskId }
            ?: throw ApiException(HttpStatus.CONFLICT, "Manager workspace task was changed")
        if (task.stepIndex == room.currentStep) {
            throw ApiException(HttpStatus.CONFLICT, "Manager workspace task is now published")
        }
        task.solutionCode = workspace.code
        task.solutionLanguage = workspace.language
        task.briefingMarkdown = workspace.briefingMarkdown
        task.workspaceFocusMode = workspace.focusMode
        task.workspaceRevision = workspace.revision
        task.workspaceYjsDocumentBase64 = workspace.yjsDocumentBase64
        task.workspaceYjsSequence = workspace.yjsSequence
        roomRepository.saveAndFlush(room)
    }

    private fun cleanupPublishedManagerWorkspace(inviteCode: String, publishedTask: RoomTask) {
        val key = managerWorkspaceKey(inviteCode, publishedTask)
        managerWorkspaceState.remove(key)
        managerWorkspaceSubscriptionByConnection.entries
            .filter { it.value == key }
            .forEach { (connectionId, _) -> managerWorkspaceSubscriptionByConnection.remove(connectionId, key) }
    }

    private fun taskFocusMode(task: RoomTask): Boolean =
        task.workspaceFocusMode ?: task.briefingMarkdown.orEmpty().trimStart().startsWith(BRIEFING_FOCUS_ON_MARKER)

    private fun withTaskFocusMarker(markdown: String, focusMode: Boolean): String {
        val clean = markdown.removePrefix(BRIEFING_FOCUS_ON_MARKER).removePrefix("\n")
        return if (focusMode) "$BRIEFING_FOCUS_ON_MARKER\n$clean" else clean
    }

    private fun markOperationApplied(
        appliedOperationIds: MutableMap<String, Long>,
        operationIdRaw: String?,
    ): Boolean {
        val operationId = operationIdRaw?.trim().orEmpty()
        if (operationId.isEmpty()) return true
        val now = Instant.now().toEpochMilli()
        val staleBefore = now - appliedOperationIdTtlMillis
        if (appliedOperationIds.containsKey(operationId)) return false
        appliedOperationIds.entries
            .filter { it.value < staleBefore }
            .map { it.key }
            .forEach { appliedOperationIds.remove(it) }
        appliedOperationIds[operationId] = now
        val overflow = appliedOperationIds.size - appliedOperationIdCacheMaxSize
        if (overflow > 0) {
            appliedOperationIds.entries.sortedBy { it.value }.take(overflow).forEach { appliedOperationIds.remove(it.key) }
        }
        return true
    }

    private fun buildTaskPayloads(room: Room): MutableList<RoomTaskPayload> {
        return room.tasks
            .sortedBy { it.stepIndex }
            .map { task ->
                RoomTaskPayload(
                    stepIndex = task.stepIndex,
                    title = task.title,
                    description = task.description,
                    starterCode = task.starterCode,
                    language = normalizeLanguage(task.language),
                    categoryName = task.categoryName?.takeIf { it.isNotBlank() }?.let(::normalizeLanguage),
                    score = task.score,
                    sourceTaskTemplateId = task.sourceTaskTemplateId,
                )
            }
            .toMutableList()
    }

    private fun toRealtimeState(room: Room): RealtimeState {
        val persistedRoomId = requirePersistedRoomId(room)
        val currentTask = room.tasks.getOrNull(room.currentStep)
        val language = normalizeLanguage(currentTask?.solutionLanguage?.ifBlank { null } ?: room.language)
        val code = currentTask?.solutionCode ?: room.code.ifBlank { currentTask?.starterCode.orEmpty() }
        val notes = room.notes.orEmpty().ifBlank { currentTask?.interviewerNotes.orEmpty() }
        val candidateKeyHistory = CandidateKeyHistoryHelpers.parse(room.candidateKeyHistory, objectMapper)
        val lastCandidateKey = candidateKeyHistory.lastOrNull()
        val taskPayloads = buildTaskPayloads(room)
        return RealtimeState(
            language = language,
            code = code,
            lastCodeUpdatedBySessionId = null,
            yjsDocumentBase64 = currentTask?.workspaceYjsDocumentBase64,
            lastYjsSequence = currentTask?.workspaceYjsSequence ?: 0,
            lastIncrementalYjsSessionId = null,
            currentStep = room.currentStep,
            publishedTaskId = currentTask?.id,
            notes = notes,
            notesMessages = PrivateNotesSerialization.parseChatMessages(room.interviewerChat, notes, objectMapper),
            privateNotesByAuthor = parseRoomPrivateNotes(room),
            briefingMarkdown = withTaskFocusMarker(
                currentTask?.briefingMarkdown?.takeIf { it.isNotBlank() } ?: currentTask?.description.orEmpty(),
                currentTask?.let(::taskFocusMode) ?: false,
            ),
            tasks = taskPayloads,
            notesLockedBySessionId = null,
            notesLockedByDisplayName = null,
            notesLockedUntilEpochMs = null,
            taskScoresByStepIndex = buildTaskScores(room),
            lastCursorSequenceBySessionId = ConcurrentHashMap(),
            lastCodeSequenceBySessionId = ConcurrentHashMap(),
            lastYjsSnapshotSequenceBySessionId = ConcurrentHashMap(),
            lastClientEventSequenceBySessionId = ConcurrentHashMap(),
            lastCandidateKey = lastCandidateKey,
            candidateKeyHistory = candidateKeyHistory.toMutableList(),
            lastCandidateKeyAtEpochMs = lastCandidateKey?.timestampEpochMs ?: 0L,
            verdict = room.verdict,
            verdictComment = room.verdictComment,
            status = room.status ?: "active",
            finishedAt = room.finishedAt?.toEpochMilli(),
            roomId = persistedRoomId,
        )
    }

    private fun requirePersistedRoomId(room: Room): String =
        room.id?.takeIf { it.isNotBlank() }
            ?: throw ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Room has no persisted Room ID")

    private companion object {
        const val BRIEFING_FOCUS_ON_MARKER = "<!--briefing:focus=on-->"
    }

}
