package com.interviewonline.service

import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.RoomTaskDto
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter
import java.util.UUID

@Service
class RoomService(
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val taskTemplateService: TaskTemplateService,
    private val collaborationService: CollaborationService,
    private val userTaskService: UserTaskService,
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
        return toRoomResponse(saved, includeOwnerToken = true, includeInterviewerToken = true)
    }

    @Transactional
    fun createUserRoom(request: CreateRoomRequest, user: User): RoomResponse {
        val language = normalizeLanguage(request.language.ifBlank { "nodejs" })
        val selectedTasks = userTaskService.resolveTasksForRoom(user, request.taskIds, language)
        if (selectedTasks.isEmpty()) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "В банке нет задач для выбранного языка. Добавьте задачи и повторите создание комнаты",
            )
        }
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
                language = normalizeLanguage(task.language),
                categoryName = normalizeLanguage(task.language),
            )
        }.toMutableList()
        tasks.forEach { it.room = room }
        room.tasks = tasks
        initializeCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(saved, includeOwnerToken = true, includeInterviewerToken = true)
    }

    @Transactional
    fun getByInviteCode(inviteCode: String, ownerToken: String?, interviewerToken: String?, user: User?): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.ownerUser != null) {
            val hasValidInterviewerToken =
                !interviewerToken.isNullOrBlank() && room.interviewerSessionToken == interviewerToken
            var hasInterviewerAccess = user?.let { isParticipant(room, it) } ?: false
            val isOwnerUser = user?.id != null && room.ownerUser?.id == user.id
            val canClaimInterviewerAccess =
                user != null &&
                    hasValidInterviewerToken &&
                    !hasInterviewerAccess &&
                    !isOwnerUser

            if (canClaimInterviewerAccess) {
                ensureParticipant(room, user!!)
                hasInterviewerAccess = true
            }

            val hasGuestInterviewerAccess = user == null && hasValidInterviewerToken
            val includeInterviewerToken = isOwnerUser || hasInterviewerAccess || hasGuestInterviewerAccess
            return toRoomResponse(room, includeOwnerToken = false, includeInterviewerToken = includeInterviewerToken)
        }

        val hasInterviewerAccess = !interviewerToken.isNullOrBlank() && room.interviewerSessionToken == interviewerToken
        val includeInterviewerToken = room.ownerSessionToken == ownerToken || hasInterviewerAccess
        return toRoomResponse(room, includeOwnerToken = false, includeInterviewerToken = includeInterviewerToken)
    }

    @Transactional(readOnly = true)
    fun getByInviteCodeEntity(inviteCode: String): Room {
        return roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
    }

    @Transactional
    fun nextStep(inviteCode: String, ownerToken: String): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        verifyOwner(room, ownerToken)
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        val maxStep = room.tasks.size - 1
        saveCurrentStepSnapshot(room)
        room.currentStep = (room.currentStep + 1).coerceAtMost(maxStep)
        applyCurrentStepSnapshot(room)
        val saved = roomRepository.save(room)
        collaborationService.syncFromRoom(saved)
        return toRoomResponse(saved, includeOwnerToken = false, includeInterviewerToken = false)
    }

    @Transactional(readOnly = true)
    fun listRoomsForUser(user: User): List<RoomSummaryDto> {
        val userId = user.id!!
        val ownedRooms = roomRepository.findByOwnerUserId(userId)
        val participantRooms = roomParticipantRepository.findAllByUserId(userId)
            .mapNotNull { it.room }

        val merged = linkedMapOf<String, Pair<Room, String>>()
        ownedRooms.forEach { room ->
            merged[room.id!!] = room to "owner"
        }
        participantRooms.forEach { room ->
            val roomId = room.id ?: return@forEach
            if (!merged.containsKey(roomId)) {
                merged[roomId] = room to "participant"
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
                    ownerToken = if (accessRole == "owner") room.ownerSessionToken else null,
                    interviewerToken = room.interviewerSessionToken,
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
            ownerToken = saved.ownerSessionToken,
            interviewerToken = saved.interviewerSessionToken,
        )
    }

    @Transactional
    fun deleteRoomForUser(user: User, roomId: String) {
        val room = roomRepository.findByIdAndOwnerUserId(roomId, user.id!!)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        val inviteCode = room.inviteCode
        roomRepository.delete(room)
        collaborationService.closeRoom(inviteCode)
    }

    fun verifyOwner(room: Room, ownerToken: String?) {
        if (ownerToken.isNullOrBlank() || room.ownerSessionToken != ownerToken) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только владелец комнаты может выполнить это действие")
        }
    }

    private fun toRoomResponse(room: Room, includeOwnerToken: Boolean, includeInterviewerToken: Boolean): RoomResponse {
        val activeTask = room.tasks.getOrNull(room.currentStep)
        val activeLanguage = normalizeLanguage(activeTask?.solutionLanguage?.ifBlank { null } ?: room.language)
        val activeCode = activeTask?.solutionCode ?: room.code.ifBlank { activeTask?.starterCode.orEmpty() }
        val activeNotes = room.notes.orEmpty().ifBlank { activeTask?.interviewerNotes.orEmpty() }

        return RoomResponse(
            id = room.id!!,
            title = room.title,
            inviteCode = room.inviteCode,
            language = activeLanguage,
            currentStep = room.currentStep,
            code = activeCode,
            notes = activeNotes,
            ownerToken = if (includeOwnerToken) room.ownerSessionToken else null,
            interviewerToken = if (includeInterviewerToken) room.interviewerSessionToken else null,
            tasks = room.tasks.map {
                RoomTaskDto(
                    stepIndex = it.stepIndex,
                    title = it.title,
                    description = it.description,
                    starterCode = it.starterCode,
                    language = normalizeLanguage(it.language),
                    categoryName = it.categoryName?.let(::normalizeLanguage),
                    score = it.score,
                )
            },
        )
    }

    private fun initializeCurrentStepSnapshot(room: Room) {
        val firstTask = room.tasks.getOrNull(room.currentStep) ?: room.tasks.firstOrNull() ?: return
        firstTask.solutionCode = firstTask.solutionCode ?: firstTask.starterCode
        firstTask.solutionLanguage = firstTask.solutionLanguage?.ifBlank { null } ?: firstTask.language
        if (room.notes.isNullOrBlank() && !firstTask.interviewerNotes.isNullOrBlank()) {
            room.notes = firstTask.interviewerNotes
        }
        room.tasks.forEach { it.interviewerNotes = null }
        room.code = firstTask.solutionCode.orEmpty()
        room.language = normalizeLanguage(firstTask.solutionLanguage.orEmpty().ifBlank { firstTask.language })
    }

    private fun saveCurrentStepSnapshot(room: Room) {
        val currentTask = room.tasks.getOrNull(room.currentStep) ?: return
        currentTask.solutionCode = room.code
        currentTask.solutionLanguage = normalizeLanguage(room.language)
        if (room.notes.isNullOrBlank() && !currentTask.interviewerNotes.isNullOrBlank()) {
            room.notes = currentTask.interviewerNotes
        }
        room.tasks.forEach { it.interviewerNotes = null }
    }

    private fun applyCurrentStepSnapshot(room: Room) {
        val currentTask = room.tasks.getOrNull(room.currentStep) ?: return
        room.code = currentTask.solutionCode ?: currentTask.starterCode
        room.language = normalizeLanguage(currentTask.solutionLanguage?.ifBlank { null } ?: currentTask.language)
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

    private fun ensureParticipant(room: Room, user: User) {
        val roomId = room.id ?: return
        val userId = user.id ?: return
        if (room.ownerUser?.id == userId) return
        val existing = roomParticipantRepository.findByRoomIdAndUserId(roomId, userId)
        if (existing != null) return
        roomParticipantRepository.save(
            RoomParticipant(
                room = room,
                user = user,
                role = "interviewer",
            ),
        )
    }

    private fun isParticipant(room: Room, user: User): Boolean {
        val roomId = room.id ?: return false
        val userId = user.id ?: return false
        return roomParticipantRepository.findByRoomIdAndUserId(roomId, userId) != null
    }
}
