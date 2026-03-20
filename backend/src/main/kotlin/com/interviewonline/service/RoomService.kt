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
        val language = request.language.ifBlank { "javascript" }.lowercase()
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
        room.code = tasks.firstOrNull()?.starterCode.orEmpty()
        val saved = roomRepository.save(room)
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(saved, includeOwnerToken = true, includeInterviewerToken = true)
    }

    @Transactional
    fun createUserRoom(request: CreateRoomRequest, user: User): RoomResponse {
        val language = request.language.ifBlank { "javascript" }.lowercase()
        val selectedTasks = userTaskService.resolveTasksForRoom(user, request.taskIds, language)
        val room = Room(
            title = request.title,
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = user,
            language = language,
        )
        val tasks = if (selectedTasks.isEmpty()) {
            taskTemplateService.defaultRoomTasks(language).toMutableList()
        } else {
            selectedTasks.mapIndexed { index, task ->
                RoomTask(
                    stepIndex = index,
                    title = task.title,
                    description = task.description,
                    starterCode = task.starterCode,
                    language = task.language,
                    categoryName = task.language,
                )
            }.toMutableList()
        }
        tasks.forEach { it.room = room }
        room.tasks = tasks
        room.code = tasks.firstOrNull()?.starterCode.orEmpty()
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
        room.currentStep = (room.currentStep + 1).coerceAtMost(maxStep)
        room.code = room.tasks[room.currentStep].starterCode
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
        return RoomResponse(
            id = room.id!!,
            title = room.title,
            inviteCode = room.inviteCode,
            language = room.language,
            currentStep = room.currentStep,
            code = room.code,
            notes = room.notes.orEmpty(),
            ownerToken = if (includeOwnerToken) room.ownerSessionToken else null,
            interviewerToken = if (includeInterviewerToken) room.interviewerSessionToken else null,
            tasks = room.tasks.map {
                RoomTaskDto(
                    stepIndex = it.stepIndex,
                    title = it.title,
                    description = it.description,
                    starterCode = it.starterCode,
                    language = it.language,
                    categoryName = it.categoryName,
                )
            },
        )
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
