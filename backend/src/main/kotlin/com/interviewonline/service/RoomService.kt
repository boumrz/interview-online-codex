package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.AddRoomTasksRequest
import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.KeystrokeEventDto
import com.interviewonline.dto.RoomAccessMemberDto
import com.interviewonline.dto.RoomNoteMessageDto
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.RoomTaskDto
import com.interviewonline.dto.RoomTaskWorkspaceDto
import com.interviewonline.dto.UpdateRoomParticipantRoleRequest
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.dto.SetVerdictRequest
import com.interviewonline.dto.UpdateRoomTaskRequest
import com.interviewonline.dto.UpdateRoomTaskWorkspaceRequest
import com.interviewonline.model.Room
import com.interviewonline.model.VerdictValue
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockById
import com.interviewonline.repository.lockByInviteCode
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import com.interviewonline.ws.NoteMessagePayload
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

@Service
class RoomService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val roomKeystrokeEventRepository: RoomKeystrokeEventRepository,
    private val roomHrAssignmentRepository: RoomHrAssignmentRepository,
    private val userRepository: UserRepository,
    private val roomAccessService: RoomAccessService,
    private val taskTemplateService: TaskTemplateService,
    private val collaborationService: CollaborationService,
    private val roomProductMetricsProjector: RoomProductMetricsProjector,
    private val userTaskService: UserTaskService,
    private val roomHrTrackingService: RoomHrTrackingService,
    private val objectMapper: ObjectMapper,
) {
    /**
     * Creates a "quick" room from the landing page.
     *
     * - If [user] is null we keep the guest flow: anonymous owner identified
     *   by a session token (legacy behaviour).
     * - If [user] is present (the visitor was already signed in when they
     *   pressed "Создать комнату"), we still seed the room with default
     *   tasks for the chosen language, but bind it to the user via
     *   `ownerUser`. This is what makes the room show up in their
     *   "Мои комнаты" — previously we always created an anonymous room and
     *   the authenticated user lost it after navigating away.
     */
    @Transactional
    fun createGuestRoom(request: CreateGuestRoomRequest, user: User? = null): RoomResponse {
        val language = normalizeLanguage(request.language.ifBlank { "nodejs" })
        val room = Room(
            title = request.title.ifBlank { "Комната собеседования" },
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = user,
            language = language,
        )
        val tasks = taskTemplateService.defaultRoomTasks(language).toMutableList()
        tasks.forEach { it.room = room }
        room.tasks = tasks
        initializeCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        roomProductMetricsProjector.recordRoomCreated(saved, RoomProductMetricsProjector.SOURCE_GUEST)
        collaborationService.bootstrapRoom(saved)
        // Authenticated owner uses a Bearer token, so we don't have to
        // expose the session-token fallback to the client.
        val isLegacyAnonymousOwner = user == null
        val access = if (isLegacyAnonymousOwner) {
            roomAccessService.resolveAccess(saved, null, saved.ownerSessionToken, null)
        } else {
            roomAccessService.resolveAccess(saved, user)
        }
        return toRoomResponse(
            room = saved,
            access = access,
            includeOwnerToken = isLegacyAnonymousOwner,
            includeInterviewerToken = false,
        )
    }

    @Transactional
    fun createUserRoom(request: CreateRoomRequest, user: User): RoomResponse {
        val selectedTasks = userTaskService.resolveTasksForRoom(user, request.taskIds)
        val hiringManagers = resolveHiringManagersForCreation(request.hiringManagerIds)
        val initialRoomLanguage = normalizeLanguage(selectedTasks.firstOrNull()?.language ?: "nodejs")
        val room = Room(
            title = request.title,
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = user,
            language = initialRoomLanguage,
        )
        val tasks = selectedTasks.mapIndexed { index, task ->
            RoomTask(
                stepIndex = index,
                title = task.title,
                description = task.description,
                starterCode = task.starterCode,
                briefingMarkdown = null,
                language = normalizeLanguage(task.language),
                categoryName = normalizeLanguage(task.language),
                sourceTaskTemplateId = task.id,
            )
        }.toMutableList()
        tasks.forEach { it.room = room }
        room.tasks = tasks
        initializeCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        roomHrTrackingService.assignHiringManagersOnRoomCreation(saved, hiringManagers)
        roomProductMetricsProjector.recordRoomCreated(saved, RoomProductMetricsProjector.SOURCE_DASHBOARD)
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(
            room = saved,
            access = roomAccessService.resolveAccess(saved, user),
            includeOwnerToken = false,
            includeInterviewerToken = false,
        )
    }

    private fun resolveHiringManagersForCreation(rawIds: List<String>?): List<User> {
        val targetIds = rawIds.orEmpty()
            .map(::canonicalHiringManagerIdOrNotFound)
            .distinct()
            .sorted()
        return targetIds.map { targetId ->
            userRepository.lockById(targetId)
                ?.takeIf { it.isHr }
                ?: throw hiringManagerNotFound()
        }
    }

    private fun canonicalHiringManagerIdOrNotFound(rawId: String): String {
        val normalized = rawId.trim()
        val parsed = runCatching { UUID.fromString(normalized) }.getOrNull()
        if (parsed == null || !parsed.toString().equals(normalized, ignoreCase = true)) {
            throw hiringManagerNotFound()
        }
        return parsed.toString()
    }

    private fun hiringManagerNotFound(): ApiException = ApiException(
        HttpStatus.NOT_FOUND,
        "Указанный нанимающий не найден или недоступен",
    )

    @Transactional
    fun getByInviteCode(inviteCode: String, ownerToken: String?, interviewerToken: String?, user: User?): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val access = roomAccessService.resolveAccess(room, user, ownerToken, interviewerToken)
        val exposeLegacyTokens = room.ownerUser == null
        return toRoomResponse(
            room = room,
            access = access,
            includeOwnerToken = exposeLegacyTokens && access.isOwner,
            includeInterviewerToken = false,
        )
    }

    /**
     * Returns a manager-only, persisted snapshot for an individual task.
     *
     * Unlike the normal room response this endpoint is never broadcast over
     * SSE: it lets an interviewer inspect a locally selected non-published
     * task without exposing its solution or briefing to candidates.
     */
    @Transactional(readOnly = true)
    fun getTaskWorkspace(
        inviteCode: String,
        stepIndex: Int,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomTaskWorkspaceDto {
        val room = roomRepository.findWithTasksByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        roomAccessService.requireManager(room, user, ownerToken, interviewerToken, realtimeRole)
        val task = room.tasks.firstOrNull { it.stepIndex == stepIndex }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")

        return RoomTaskWorkspaceDto(
            stepIndex = task.stepIndex,
            title = task.title,
            language = normalizeLanguage(task.solutionLanguage?.ifBlank { null } ?: task.language),
            code = task.solutionCode ?: task.starterCode,
            briefingMarkdown = task.briefingMarkdown?.takeIf { it.isNotBlank() } ?: task.description,
            revision = task.workspaceRevision,
            yjsDocumentBase64 = task.workspaceYjsDocumentBase64,
            yjsSequence = task.workspaceYjsSequence,
            focusMode = taskFocusMode(task),
        )
    }

    /**
     * REST recovery/save path for a manager-selected inactive task.  It is
     * intentionally task-scoped: none of these values is copied into Room
     * until a manager explicitly publishes that step.
     */
    @Transactional
    fun updateTaskWorkspace(
        inviteCode: String,
        stepIndex: Int,
        request: UpdateRoomTaskWorkspaceRequest,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomTaskWorkspaceDto {
        val locked = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (locked.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        val room = roomRepository.findWithTasksByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        roomAccessService.requireManager(room, user, ownerToken, interviewerToken, realtimeRole)
        if (stepIndex == room.currentStep) {
            throw ApiException(HttpStatus.BAD_REQUEST, "РћРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹Р№ С€Р°Рі РёР·РјРµРЅСЏРµС‚СЃСЏ С‡РµСЂРµР· РѕР±С‰РµРµ СЂР°Р±РѕС‡РµРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ")
        }
        val task = room.tasks.firstOrNull { it.stepIndex == stepIndex }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

        val requestedRevision = request.revision
        if (requestedRevision != null && requestedRevision != task.workspaceRevision) {
            throw ApiException(HttpStatus.CONFLICT, "Р§РµСЂРЅРѕРІРёРє Р·Р°РґР°С‡Рё РёР·РјРµРЅРёР»СЃСЏ; РїРѕР»СѓС‡РёС‚Рµ Р°РєС‚СѓР°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ")
        }

        var changedNonCrdt = false
        request.code?.let { task.solutionCode = it }
        request.language?.let {
            task.solutionLanguage = normalizeLanguage(it)
            changedNonCrdt = true
        }
        request.briefingMarkdown?.let {
            task.briefingMarkdown = it
            changedNonCrdt = true
        }
        request.focusMode?.let {
            task.workspaceFocusMode = it
            changedNonCrdt = true
        }
        request.yjsDocumentBase64?.trim()?.takeIf { it.isNotEmpty() }?.let { task.workspaceYjsDocumentBase64 = it }
        request.yjsSequence?.let { task.workspaceYjsSequence = it.coerceAtLeast(task.workspaceYjsSequence) }
        if (changedNonCrdt || request.code != null || request.yjsDocumentBase64 != null) {
            task.workspaceRevision += 1
        }
        val saved = roomRepository.saveAndFlush(room)
        val savedTask = saved.tasks.first { it.stepIndex == stepIndex }
        collaborationService.syncManagerWorkspaceFromTask(saved, savedTask)
        return taskWorkspaceDto(savedTask)
    }

    @Transactional(readOnly = true)
    fun getByInviteCodeEntity(inviteCode: String): Room {
        return roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
    }

    @Transactional
    fun nextStep(inviteCode: String, ownerToken: String?, interviewerToken: String?, user: User?): RoomResponse {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken)
        val saved = collaborationService.advancePublishedStep(inviteCode)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    @Transactional
    fun addTasksToRoom(
        inviteCode: String,
        request: AddRoomTasksRequest,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomResponse {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken, realtimeRole)

        val requestedTaskIds = request.taskIds
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
        val customTasks = request.customTasks.map { raw ->
            val title = raw.title.trim()
            val description = raw.description.trim()
            if (title.isBlank()) {
                throw ApiException(
                    HttpStatus.BAD_REQUEST,
                    "У новой задачи должно быть заполнено название",
                )
            }
            RoomCustomTaskDraft(
                title = title,
                description = description,
                starterCode = raw.starterCode.replace("\r\n", "\n"),
                language = raw.language?.trim()?.takeIf { it.isNotBlank() },
            )
        }

        if (requestedTaskIds.isEmpty() && customTasks.isEmpty()) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "Передайте хотя бы один taskId или customTasks",
            )
        }

        val roomLanguage = normalizeLanguage(room.language)
        val selectedTasks = if (requestedTaskIds.isNotEmpty()) {
            val authorizedUser = user ?: throw ApiException(
                HttpStatus.UNAUTHORIZED,
                "Для добавления задач из банка нужна авторизация",
            )
            userTaskService.resolveTasksForRoom(authorizedUser, requestedTaskIds)
        } else {
            emptyList()
        }

        val existingTemplateIds = room.tasks
            .mapNotNull { it.sourceTaskTemplateId?.trim() }
            .filter { it.isNotBlank() }
            .toMutableSet()
        val existingSignatures = room.tasks
            .map { normalizeTaskSignature(it.title, it.description, it.starterCode, it.language) }
            .toMutableSet()

        val tasksToAppend = mutableListOf<RoomTask>()

        selectedTasks.forEach { task ->
            val taskId = task.id ?: return@forEach
            val signature = normalizeTaskSignature(task.title, task.description, task.starterCode, task.language)
            if (existingTemplateIds.contains(taskId) || existingSignatures.contains(signature)) {
                return@forEach
            }
            existingTemplateIds.add(taskId)
            existingSignatures.add(signature)
            tasksToAppend += RoomTask(
                stepIndex = -1,
                title = task.title,
                description = task.description,
                starterCode = task.starterCode,
                briefingMarkdown = null,
                language = normalizeLanguage(task.language),
                categoryName = normalizeLanguage(task.language),
                sourceTaskTemplateId = task.id,
            )
        }

        customTasks.forEach { task ->
            // Allow per-task language override; fall back to the room language
            // when the client didn't pick one. Always normalize to one of the
            // supported languages so storage stays consistent.
            val taskLanguage = normalizeLanguage(task.language ?: roomLanguage)
            val signature = normalizeTaskSignature(task.title, task.description, task.starterCode, taskLanguage)
            if (existingSignatures.contains(signature)) return@forEach
            existingSignatures.add(signature)
            tasksToAppend += RoomTask(
                stepIndex = -1,
                title = task.title,
                description = task.description,
                starterCode = task.starterCode,
                briefingMarkdown = null,
                language = taskLanguage,
                categoryName = taskLanguage,
                sourceTaskTemplateId = null,
            )
        }

        val hadNoTasksBeforeAppend = room.tasks.isEmpty()
        if (tasksToAppend.isNotEmpty()) {
            val baseStepIndex = room.tasks.size
            tasksToAppend.forEachIndexed { index, task ->
                task.stepIndex = baseStepIndex + index
                task.room = room
                room.tasks.add(
                    task,
                )
            }
            if (hadNoTasksBeforeAppend) {
                room.currentStep = 0
                initializeCurrentStepSnapshot(room)
            } else if (room.currentStep >= room.tasks.size) {
                room.currentStep = 0
            }
        }

        val saved = roomRepository.save(room)
        if (tasksToAppend.isNotEmpty()) {
            roomProductMetricsProjector.recordPreparation(saved.id.orEmpty())
        }
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    private data class RoomCustomTaskDraft(
        val title: String,
        val description: String,
        val starterCode: String,
        /** Null means "fall back to the current room language". */
        val language: String?,
    )

    /**
     * In-room task title edit (PATCH semantics). Behaviour-preserving:
     *   - Doesn't touch step ordering, language, briefing, snapshots.
     *   - Persists rename and rebroadcasts the room snapshot so all clients
     *     instantly see the new title in their step list/sidebar.
     */
    @Transactional
    fun updateRoomTask(
        inviteCode: String,
        stepIndex: Int,
        request: UpdateRoomTaskRequest,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomResponse {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken, realtimeRole)
        val task = room.tasks.firstOrNull { it.stepIndex == stepIndex }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")

        val newTitle = request.title?.trim()
        if (newTitle != null) {
            if (newTitle.isEmpty()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "Название задачи не может быть пустым")
            }
            task.title = newTitle
        }

        val saved = roomRepository.save(room)
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    /**
     * Remove a single task from the room and re-pack `stepIndex` so the
     * remaining tasks stay 0..N-1 contiguous. If the deleted step was the
     * current one, we move to the previous step (or step 0) and re-apply
     * the snapshot so the editor doesn't end up pointing into a stale slot.
     */
    @Transactional
    fun removeRoomTask(
        inviteCode: String,
        stepIndex: Int,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomResponse {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken, realtimeRole)
        if (room.tasks.size <= 1) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "В комнате должна остаться хотя бы одна задача",
            )
        }
        val target = room.tasks.firstOrNull { it.stepIndex == stepIndex }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")

        val wasCurrent = room.currentStep == stepIndex
        if (wasCurrent) {
            // Persist whatever the live editor is showing into the *current*
            // task before we drop it, so unrelated state (notes/briefing
            // attached to the room itself) doesn't leak into the next step.
            saveCurrentStepSnapshot(room)
        }

        room.tasks.remove(target)
        // Re-sequence remaining tasks 0..N-1 so the UI keeps numeric order.
        room.tasks.sortBy { it.stepIndex }
        room.tasks.forEachIndexed { index, t -> t.stepIndex = index }

        val maxStep = room.tasks.size - 1
        room.currentStep = when {
            room.currentStep > maxStep -> maxStep
            wasCurrent -> (stepIndex - 1).coerceAtLeast(0)
            room.currentStep > stepIndex -> room.currentStep - 1
            else -> room.currentStep
        }
        applyCurrentStepSnapshot(room)

        val saved = roomRepository.save(room)
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    @Transactional(readOnly = true)
    fun listRoomsForUser(user: User): List<RoomSummaryDto> {
        val userId = user.id!!
        val ownedRooms = roomRepository.findByOwnerUserId(userId)
        val participantRooms = roomParticipantRepository.findAllByUserId(userId)
            .mapNotNull { participant ->
                val room = participant.room ?: return@mapNotNull null
                room to roomAccessService.normalizeRole(participant.role).wireValue
            }

        val merged = linkedMapOf<String, Pair<Room, String>>()
        ownedRooms.filter { it.archivedAt == null }.forEach { room ->
            merged[room.id!!] = room to "owner"
        }
        participantRooms.filter { (room) -> room.archivedAt == null }.forEach { (room, participantRole) ->
            val roomId = room.id ?: return@forEach
            if (!merged.containsKey(roomId)) {
                merged[roomId] = room to participantRole
            }
        }

        return merged.values
            .sortedByDescending { (room) -> room.createdAt }
            .map { (room, accessRole) ->
                RoomSummaryDto(
                    id = room.id!!,
                    title = room.title,
                    inviteCode = room.inviteCode,
                    language = room.language,
                    accessRole = accessRole,
                    createdAt = DateTimeFormatter.ISO_INSTANT.format(room.createdAt),
                    ownerToken = if (accessRole == "owner" && room.ownerUser == null) room.ownerSessionToken else null,
                    interviewerToken = null,
                    verdict = room.verdict,
                    status = room.status ?: "active",
                )
            }
    }

    @Transactional
    fun updateRoomForUser(user: User, roomId: String, request: UpdateRoomRequest): RoomSummaryDto {
        val room = roomRepository.lockById(roomId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.ownerUser?.id != user.id) throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        val title = request.title.trim()
        if (title.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название комнаты не может быть пустым")
        }
        room.title = title
        val saved = roomRepository.save(room)
        return RoomSummaryDto(
            id = saved.id!!,
            title = saved.title,
            inviteCode = saved.inviteCode,
            language = saved.language,
            accessRole = "owner",
            createdAt = DateTimeFormatter.ISO_INSTANT.format(saved.createdAt),
            ownerToken = null,
            interviewerToken = null,
            verdict = saved.verdict,
            status = saved.status ?: "active",
        )
    }

    @Transactional
    fun deleteRoomForUser(user: User, roomId: String): Boolean {
        val room = roomRepository.lockById(roomId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.ownerUser?.id != user.id) throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val inviteCode = room.inviteCode
        if (roomHrAssignmentRepository.existsByRoomId(roomId)) {
            if (room.archivedAt == null) {
                room.archivedAt = Instant.now()
                roomRepository.save(room)
            }
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCommit() = collaborationService.closeRoom(inviteCode)
            })
            return true
        }
        room.id?.let {
            // Delete related rows that have no JPA cascade configured.
            // The V5 migration adds a DB-level FK ON DELETE CASCADE for PG;
            // this explicit delete also covers H2 (Flyway-disabled local profile).
            roomKeystrokeEventRepository.deleteByRoomId(it)
            roomParticipantRepository.deleteAllByRoomId(it)
            roomHrAssignmentRepository.deleteAllByRoomId(it)
            roomParticipantRepository.flush()
            roomProductMetricsProjector.deleteProjection(it)
        }
        roomRepository.delete(room)
        collaborationService.closeRoom(inviteCode)
        return false
    }

    @Transactional
    fun setVerdict(
        inviteCode: String,
        request: SetVerdictRequest,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): RoomResponse {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")

        // eventToken lets a guest interviewer (promoted via realtime channel, no DB record)
        // submit the verdict using the role that was granted in-session.
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        val access = roomAccessService.resolveAccess(room, user, ownerToken, interviewerToken, realtimeRole)
        if (!access.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Недостаточно прав для выставления вердикта")
        }

        // Allow updating the verdict even on a finished room (interviewer can correct mistakes).

        val verdictValue = VerdictValue.fromWire(request.verdict)
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестное значение вердикта: ${request.verdict}")

        room.verdict = verdictValue.wireValue
        room.verdictComment = request.verdictComment?.take(2000)
        room.status = "finished"
        val verdictSavedAt = Instant.now()
        if (room.finishedAt == null) room.finishedAt = verdictSavedAt

        roomRepository.save(room)
        roomProductMetricsProjector.recordVerdictSaved(room.id.orEmpty(), verdictSavedAt)

        // Capture values for use in the after-commit callback (room fields may change).
        val broadcastVerdict = verdictValue.wireValue
        val broadcastComment = room.verdictComment
        val broadcastFinishedAt = room.finishedAt!!.toEpochMilli()
        val broadcastInviteCode = inviteCode

        // Broadcast AFTER the transaction commits so clients never see
        // verdict_set before the DB row is durable.
        TransactionSynchronizationManager.registerSynchronization(
            object : TransactionSynchronization {
                override fun afterCommit() {
                    collaborationService.broadcastVerdictSet(
                        inviteCode = broadcastInviteCode,
                        verdict = broadcastVerdict,
                        verdictComment = broadcastComment,
                        finishedAt = broadcastFinishedAt,
                    )
                }
            }
        )

        return toRoomResponse(
            room = room,
            access = access,
            includeOwnerToken = false,
            includeInterviewerToken = false,
        )
    }

    /**
     * Returns all keystroke events for the room, ordered by timestamp.
     * Requires canManageRoom (owner / interviewer). Supports eventToken so that
     * guest interviewers promoted via the realtime channel can also export logs.
     */
    @Transactional(readOnly = true)
    fun getKeystrokeEvents(
        inviteCode: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
        eventToken: String? = null,
    ): List<KeystrokeEventDto> {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val realtimeRole = collaborationService.resolveRoleByEventToken(inviteCode, eventToken)
        val access = roomAccessService.resolveAccess(room, user, ownerToken, interviewerToken, realtimeRole)
        if (!access.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Недостаточно прав")
        }
        return roomKeystrokeEventRepository
            .findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(room.id!!)
            .map { e ->
                KeystrokeEventDto(
                    id = e.id!!,
                    sessionId = e.sessionId,
                    displayName = e.displayName,
                    keyValue = e.keyValue,
                    keyCode = e.keyCode,
                    ctrlKey = e.ctrlKey,
                    altKey = e.altKey,
                    shiftKey = e.shiftKey,
                    metaKey = e.metaKey,
                    eventKind = e.eventKind,
                    pasteLength = e.pasteLength,
                    pastePreview = e.pastePreview,
                    timestampEpochMs = e.timestampEpochMs,
                    sourceEventId = e.sourceEventId,
                    acceptedSequence = e.acceptedSequence,
                )
            }
    }

    fun verifyManager(room: Room, user: User?, ownerToken: String?, interviewerToken: String?): RoomAccessService.RoomAccess {
        return roomAccessService.requireManager(room, user, ownerToken, interviewerToken)
    }

    @Transactional(readOnly = true)
    fun listAccessMembers(inviteCode: String, ownerToken: String?, interviewerToken: String?, user: User?): List<RoomAccessMemberDto> {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomAccessService.requireManager(room, user, ownerToken, interviewerToken)
        return buildAccessMembers(room)
    }

    fun updateParticipantRole(
        inviteCode: String,
        request: UpdateRoomParticipantRoleRequest,
        targetUserId: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): List<RoomAccessMemberDto> {
        return collaborationService.mutateRoomPermissions(inviteCode) {
            RoomPermissionMutation(
                updateParticipantRoleInTransaction(inviteCode, request, targetUserId, ownerToken, interviewerToken, user),
                setOf(targetUserId),
            )
        }
    }

    private fun updateParticipantRoleInTransaction(
        inviteCode: String,
        request: UpdateRoomParticipantRoleRequest,
        targetUserId: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): List<RoomAccessMemberDto> {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomAccessService.requireGrantAccess(room, user, ownerToken, interviewerToken)
        val roomId = room.id ?: throw ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Комната не сохранена")
        if (room.ownerUser?.id == targetUserId) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя менять роль администратора комнаты")
        }

        when (roomAccessService.normalizeRole(request.role)) {
            RoomAccessService.RoomRole.OWNER ->
                throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя назначать владельца через этот endpoint")
            RoomAccessService.RoomRole.INTERVIEWER -> {
                val existing = roomParticipantRepository.findByRoomIdAndUserId(roomId, targetUserId)
                val targetUser = userRepository.findById(targetUserId).orElseThrow {
                    ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
                }
                if (existing == null) {
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
            }
            RoomAccessService.RoomRole.CANDIDATE -> {
                val targetUser = userRepository.findById(targetUserId).orElseThrow {
                    ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
                }
                val existing = roomParticipantRepository.findByRoomIdAndUserId(roomId, targetUserId)
                if (roomHrAssignmentRepository.existsByRoomIdAndUserId(roomId, targetUserId)) {
                    if (existing == null) {
                        roomParticipantRepository.save(RoomParticipant(room = room, user = targetUser, role = "candidate"))
                    } else {
                        existing.role = "candidate"
                        roomParticipantRepository.save(existing)
                    }
                } else {
                    roomParticipantRepository.deleteByRoomIdAndUserId(roomId, targetUserId)
                }
            }
        }

        return buildAccessMembers(room)
    }

    private fun toRoomResponse(
        room: Room,
        access: RoomAccessService.RoomAccess,
        includeOwnerToken: Boolean,
        includeInterviewerToken: Boolean,
    ): RoomResponse {
        val activeTask = room.tasks.getOrNull(room.currentStep)
        val activeLanguage = normalizeLanguage(activeTask?.solutionLanguage?.ifBlank { null } ?: room.language)
        val activeCode = activeTask?.solutionCode ?: room.code.ifBlank { activeTask?.starterCode.orEmpty() }
        val activeNotes = room.notes.orEmpty().ifBlank { activeTask?.interviewerNotes.orEmpty() }
        val notesMessages = parseNotesMessages(room.interviewerChat, activeNotes)

        return RoomResponse(
            id = room.id!!,
            title = room.title,
            inviteCode = room.inviteCode,
            language = activeLanguage,
            currentStep = room.currentStep,
            code = activeCode,
            notes = activeNotes,
            notesMessages = notesMessages.map { note ->
                RoomNoteMessageDto(
                    id = note.id,
                    sessionId = note.sessionId,
                    displayName = note.displayName,
                    role = note.role,
                    text = note.text,
                    timestampEpochMs = note.timestampEpochMs,
                )
            },
            briefingMarkdown = activeTask?.briefingMarkdown?.takeIf { it.isNotBlank() } ?: activeTask?.description.orEmpty(),
            ownerToken = if (includeOwnerToken) room.ownerSessionToken else null,
            interviewerToken = if (includeInterviewerToken) room.interviewerSessionToken else null,
            role = access.role.wireValue,
            isOwner = access.isOwner,
            canManageRoom = access.canManageRoom,
            canGrantAccess = access.canGrantAccess,
            accessMembers = if (access.canManageRoom) buildAccessMembers(room) else emptyList(),
            tasks = room.tasks.map {
                RoomTaskDto(
                    stepIndex = it.stepIndex,
                    title = it.title,
                    description = it.description,
                    starterCode = it.starterCode,
                    language = normalizeLanguage(it.language),
                    categoryName = it.categoryName?.let(::normalizeLanguage),
                    score = it.score,
                    sourceTaskTemplateId = it.sourceTaskTemplateId,
                )
            },
            verdict = room.verdict,
            verdictComment = room.verdictComment,
            status = room.status ?: "active",
            finishedAt = room.finishedAt?.toString(),
        )
    }

    private fun initializeCurrentStepSnapshot(room: Room) {
        val firstTask = room.tasks.getOrNull(room.currentStep) ?: room.tasks.firstOrNull() ?: return
        firstTask.solutionCode = firstTask.solutionCode ?: firstTask.starterCode
        firstTask.solutionLanguage = firstTask.solutionLanguage?.ifBlank { null } ?: firstTask.language
        if (firstTask.briefingMarkdown.isNullOrBlank() && !room.briefingMarkdown.isNullOrBlank()) {
            firstTask.briefingMarkdown = room.briefingMarkdown
        }
        if (room.notes.isNullOrBlank() && !firstTask.interviewerNotes.isNullOrBlank()) {
            room.notes = firstTask.interviewerNotes
        }
        room.tasks.forEach { it.interviewerNotes = null }
        room.code = firstTask.solutionCode.orEmpty()
        room.language = normalizeLanguage(firstTask.solutionLanguage.orEmpty().ifBlank { firstTask.language })
        room.briefingMarkdown = firstTask.briefingMarkdown.orEmpty()
    }

    private fun saveCurrentStepSnapshot(room: Room) {
        val currentTask = room.tasks.getOrNull(room.currentStep) ?: return
        currentTask.solutionCode = room.code
        currentTask.solutionLanguage = normalizeLanguage(room.language)
        currentTask.briefingMarkdown = room.briefingMarkdown.orEmpty()
        if (room.notes.isNullOrBlank() && !currentTask.interviewerNotes.isNullOrBlank()) {
            room.notes = currentTask.interviewerNotes
        }
        room.tasks.forEach { it.interviewerNotes = null }
    }

    private fun applyCurrentStepSnapshot(room: Room) {
        val currentTask = room.tasks.getOrNull(room.currentStep) ?: return
        room.code = currentTask.solutionCode ?: currentTask.starterCode
        room.language = normalizeLanguage(currentTask.solutionLanguage?.ifBlank { null } ?: currentTask.language)
        room.briefingMarkdown = withTaskFocusMarker(currentTask.briefingMarkdown.orEmpty(), taskFocusMode(currentTask))
    }

    private fun taskWorkspaceDto(task: RoomTask): RoomTaskWorkspaceDto = RoomTaskWorkspaceDto(
        stepIndex = task.stepIndex,
        title = task.title,
        language = normalizeLanguage(task.solutionLanguage?.ifBlank { null } ?: task.language),
        code = task.solutionCode ?: task.starterCode,
        briefingMarkdown = task.briefingMarkdown?.takeIf { it.isNotBlank() } ?: task.description,
        revision = task.workspaceRevision,
        yjsDocumentBase64 = task.workspaceYjsDocumentBase64,
        yjsSequence = task.workspaceYjsSequence,
        focusMode = taskFocusMode(task),
    )

    private fun taskFocusMode(task: RoomTask): Boolean =
        task.workspaceFocusMode ?: task.briefingMarkdown.orEmpty().trimStart().startsWith(BRIEFING_FOCUS_ON_MARKER)

    private fun withTaskFocusMarker(markdown: String, focusMode: Boolean): String {
        val clean = markdown.removePrefix(BRIEFING_FOCUS_ON_MARKER).removePrefix("\n")
        return if (focusMode) "$BRIEFING_FOCUS_ON_MARKER\n$clean" else clean
    }


    private fun normalizeTaskSignature(title: String, description: String, starterCode: String, language: String): String {
        val normalizedLanguage = normalizeLanguage(language)
        val normalizedTitle = title.trim().lowercase()
        val normalizedDescription = description.replace("\r\n", "\n").trim()
        val normalizedStarterCode = starterCode.replace("\r\n", "\n").trim()
        return listOf(normalizedLanguage, normalizedTitle, normalizedDescription, normalizedStarterCode).joinToString("::")
    }

    private fun buildAccessMembers(room: Room): List<RoomAccessMemberDto> {
        val roomId = room.id ?: return emptyList()
        val members = mutableListOf<RoomAccessMemberDto>()
        room.ownerUser?.id?.let { ownerId ->
            members += RoomAccessMemberDto(
                userId = ownerId,
                displayName = room.ownerUser?.displayName.orEmpty().ifBlank { "Администратор" },
                role = RoomAccessService.RoomRole.OWNER.wireValue,
                isOwner = true,
            )
        }
        members += roomParticipantRepository.findAllByRoomIdOrderByCreatedAtAsc(roomId)
            .mapNotNull { participant ->
                val memberUser = participant.user ?: return@mapNotNull null
                val memberUserId = memberUser.id ?: return@mapNotNull null
                if (room.ownerUser?.id == memberUserId) return@mapNotNull null
                RoomAccessMemberDto(
                    userId = memberUserId,
                    displayName = memberUser.displayName.orEmpty().ifBlank { "Участник" },
                    role = roomAccessService.normalizeRole(participant.role).wireValue,
                    isOwner = false,
                )
            }
        return members.sortedWith(compareByDescending<RoomAccessMemberDto> { it.isOwner }.thenBy { it.displayName.lowercase() })
    }

    private fun parseNotesMessages(rawChatJson: String?, legacyNotes: String): List<NoteMessagePayload> {
        val chatJson = rawChatJson.orEmpty().trim()
        if (chatJson.isNotBlank()) {
            runCatching {
                val root = objectMapper.readTree(chatJson)
                val messagesNode = when {
                    root.isArray -> root
                    root.isObject && root.has("messages") -> root["messages"]
                    else -> null
                }
                if (messagesNode != null && messagesNode.isArray) {
                    return messagesNode.mapNotNull { node ->
                        runCatching { objectMapper.treeToValue(node, NoteMessagePayload::class.java) }.getOrNull()
                    }
                }
            }
        }

        val fallback = legacyNotes.trim()
        if (fallback.isBlank()) return emptyList()
        return listOf(
            NoteMessagePayload(
                id = "legacy-${fallback.hashCode()}",
                sessionId = "legacy-notes",
                displayName = "История заметок",
                role = RoomAccessService.RoomRole.INTERVIEWER.wireValue,
                text = fallback,
                timestampEpochMs = 0L,
            ),
        )
    }

    private companion object {
        const val BRIEFING_FOCUS_ON_MARKER = "<!--briefing:focus=on-->"
    }
}
