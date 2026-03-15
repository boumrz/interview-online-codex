package com.interviewonline.service

import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.RoomTaskDto
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter
import java.util.UUID

@Service
class RoomService(
    private val roomRepository: RoomRepository,
    private val taskTemplateService: TaskTemplateService,
    private val collaborationService: CollaborationService,
    private val userTaskService: UserTaskService,
) {
    @Transactional
    fun createGuestRoom(request: CreateGuestRoomRequest): RoomResponse {
        val language = request.language.ifBlank { "javascript" }.lowercase()
        val room = Room(
            title = request.title.ifBlank { "Комната собеседования" },
            inviteCode = "r-${UUID.randomUUID().toString().take(8)}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            language = language,
        )
        val tasks = taskTemplateService.defaultRoomTasks(language).toMutableList()
        tasks.forEach { it.room = room }
        room.tasks = tasks
        room.code = tasks.firstOrNull()?.starterCode.orEmpty()
        val saved = roomRepository.save(room)
        collaborationService.bootstrapRoom(saved)
        return toRoomResponse(saved, includeOwnerToken = true)
    }

    @Transactional
    fun createUserRoom(request: CreateRoomRequest, user: User): RoomResponse {
        val language = request.language.ifBlank { "javascript" }.lowercase()
        val selectedTasks = userTaskService.resolveTasksForRoom(user, request.taskIds, language)
        val room = Room(
            title = request.title,
            inviteCode = "r-${UUID.randomUUID().toString().take(8)}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
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
        return toRoomResponse(saved, includeOwnerToken = true)
    }

    @Transactional(readOnly = true)
    fun getByInviteCode(inviteCode: String): RoomResponse {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        return toRoomResponse(room, includeOwnerToken = false)
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
        return toRoomResponse(saved, includeOwnerToken = false)
    }

    @Transactional(readOnly = true)
    fun listRoomsForUser(user: User): List<RoomSummaryDto> {
        return roomRepository.findByOwnerUserId(user.id!!)
            .sortedByDescending { it.createdAt }
            .map {
            RoomSummaryDto(
                id = it.id!!,
                title = it.title,
                inviteCode = it.inviteCode,
                language = it.language,
                createdAt = DateTimeFormatter.ISO_INSTANT.format(it.createdAt),
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
            createdAt = DateTimeFormatter.ISO_INSTANT.format(saved.createdAt),
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

    private fun toRoomResponse(room: Room, includeOwnerToken: Boolean): RoomResponse {
        return RoomResponse(
            id = room.id!!,
            title = room.title,
            inviteCode = room.inviteCode,
            language = room.language,
            currentStep = room.currentStep,
            code = room.code,
            ownerToken = if (includeOwnerToken) room.ownerSessionToken else null,
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
}
