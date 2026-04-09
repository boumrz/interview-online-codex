package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.AddRoomTasksRequest
import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.RoomAccessMemberDto
import com.interviewonline.dto.RoomNoteMessageDto
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.RoomTaskDto
import com.interviewonline.dto.UpdateRoomParticipantRoleRequest
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.ws.NoteMessagePayload
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter
import java.util.UUID

@Service
class RoomService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val userRepository: UserRepository,
    private val roomAccessService: RoomAccessService,
    private val taskTemplateService: TaskTemplateService,
    private val collaborationService: CollaborationService,
    private val userTaskService: UserTaskService,
    private val objectMapper: ObjectMapper,
) {
    @Transactional
    fun createGuestRoom(request: CreateGuestRoomRequest): RoomResponse {
        val language = normalizeLanguage(request.language.ifBlank { "nodejs" })
        val room = Room(
            title = request.title.ifBlank { "Комната собеседования" },
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            language = language,
        )
        val tasks = taskTemplateService.defaultRoomTasks(language).toMutableList()
        tasks.forEach { it.room = room }
        room.tasks = tasks
        initializeCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(
            room = saved,
            access = roomAccessService.resolveAccess(saved, null, saved.ownerSessionToken, null),
            includeOwnerToken = true,
            includeInterviewerToken = false,
        )
    }

    @Transactional
    fun createUserRoom(request: CreateRoomRequest, user: User): RoomResponse {
        val language = normalizeLanguage(request.language.ifBlank { "nodejs" })
        val selectedTasks = userTaskService.resolveTasksForRoom(user, request.taskIds, language)
        val room = Room(
            title = request.title,
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = user,
            language = language,
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
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(
            room = saved,
            access = roomAccessService.resolveAccess(saved, user),
            includeOwnerToken = false,
            includeInterviewerToken = false,
        )
    }

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

    @Transactional(readOnly = true)
    fun getByInviteCodeEntity(inviteCode: String): Room {
        return roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
    }

    @Transactional
    fun nextStep(inviteCode: String, ownerToken: String?, interviewerToken: String?, user: User?): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken)
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        val maxStep = room.tasks.size - 1
        saveCurrentStepSnapshot(room)
        room.currentStep = (room.currentStep + 1).coerceAtMost(maxStep)
        applyCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    @Transactional
    fun addTasksToRoom(
        inviteCode: String,
        request: AddRoomTasksRequest,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val access = roomAccessService.requireManager(room, user, ownerToken, interviewerToken)

        val requestedTaskIds = request.taskIds
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
        val customTasks = request.customTasks.map { raw ->
            val title = raw.title.trim()
            val description = raw.description.trim()
            if (title.isBlank() || description.isBlank()) {
                throw ApiException(
                    HttpStatus.BAD_REQUEST,
                    "У новой задачи должны быть заполнены название и описание",
                )
            }
            RoomCustomTaskDraft(
                title = title,
                description = description,
                starterCode = raw.starterCode.replace("\r\n", "\n"),
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
            userTaskService.resolveTasksForRoom(authorizedUser, requestedTaskIds, roomLanguage)
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
            val signature = normalizeTaskSignature(task.title, task.description, task.starterCode, roomLanguage)
            if (existingSignatures.contains(signature)) return@forEach
            existingSignatures.add(signature)
            tasksToAppend += RoomTask(
                stepIndex = -1,
                title = task.title,
                description = task.description,
                starterCode = task.starterCode,
                briefingMarkdown = null,
                language = roomLanguage,
                categoryName = roomLanguage,
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
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, access = access, includeOwnerToken = false, includeInterviewerToken = false)
    }

    private data class RoomCustomTaskDraft(
        val title: String,
        val description: String,
        val starterCode: String,
    )

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
        ownedRooms.forEach { room ->
            merged[room.id!!] = room to "owner"
        }
        participantRooms.forEach { (room, participantRole) ->
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
                )
            }
    }

    @Transactional
    fun updateRoomForUser(user: User, roomId: String, request: UpdateRoomRequest): RoomSummaryDto {
        val room = roomRepository.findByIdAndOwnerUserId(roomId, user.id!!)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
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
        )
    }

    @Transactional
    fun deleteRoomForUser(user: User, roomId: String) {
        val room = roomRepository.findByIdAndOwnerUserId(roomId, user.id!!)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val inviteCode = room.inviteCode
        room.id?.let {
            roomParticipantRepository.deleteAllByRoomId(it)
            roomParticipantRepository.flush()
        }
        roomRepository.delete(room)
        collaborationService.closeRoom(inviteCode)
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

    @Transactional
    fun updateParticipantRole(
        inviteCode: String,
        request: UpdateRoomParticipantRoleRequest,
        targetUserId: String,
        ownerToken: String?,
        interviewerToken: String?,
        user: User?,
    ): List<RoomAccessMemberDto> {
        val room = roomRepository.findByInviteCode(inviteCode)
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
                roomParticipantRepository.deleteByRoomIdAndUserId(roomId, targetUserId)
            }
        }

        collaborationService.syncParticipantPermissions(inviteCode, targetUserId)
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
        room.briefingMarkdown = currentTask.briefingMarkdown.orEmpty()
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
}
