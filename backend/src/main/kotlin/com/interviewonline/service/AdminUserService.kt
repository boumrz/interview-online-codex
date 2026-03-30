package com.interviewonline.service

import com.interviewonline.dto.AdminUserDto
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.repository.UserTaskCategoryRepository
import com.interviewonline.repository.UserTaskTemplateRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter

@Service
class AdminUserService(
    private val userRepository: UserRepository,
    private val userSessionRepository: UserSessionRepository,
    private val userTaskTemplateRepository: UserTaskTemplateRepository,
    private val userTaskCategoryRepository: UserTaskCategoryRepository,
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val collaborationService: CollaborationService,
) {
    companion object {
        private const val ROLE_ADMIN = "admin"
        private const val ROLE_USER = "user"
        private const val PRIMARY_ADMIN_NICKNAME = "boumrz"
    }

    @Transactional(readOnly = true)
    fun listUsers(currentUser: User): List<AdminUserDto> {
        requireAdmin(currentUser)
        return userRepository.findAllByOrderByCreatedAtDesc().map { it.toDto() }
    }

    @Transactional
    fun updateRole(currentUser: User, targetUserId: String, role: String): AdminUserDto {
        requireAdmin(currentUser)
        val normalizedRole = normalizeRole(role)
        val target = userRepository.findById(targetUserId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
        }
        if (target.nickname.equals(PRIMARY_ADMIN_NICKNAME, ignoreCase = true) && normalizedRole != ROLE_ADMIN) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя снять права администратора у системного администратора")
        }
        target.role = normalizedRole
        return userRepository.save(target).toDto()
    }

    @Transactional
    fun deleteUser(currentUser: User, targetUserId: String) {
        requireAdmin(currentUser)
        if (currentUser.id == targetUserId) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя удалить собственный аккаунт")
        }

        val target = userRepository.findById(targetUserId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
        }
        if (target.nickname.equals(PRIMARY_ADMIN_NICKNAME, ignoreCase = true)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нельзя удалить системного администратора")
        }

        val ownedRooms = roomRepository.findByOwnerUserId(targetUserId)
        ownedRooms.forEach { room ->
            val roomId = room.id
            if (!roomId.isNullOrBlank()) {
                roomParticipantRepository.deleteAllByRoomId(roomId)
            }
            roomRepository.delete(room)
            collaborationService.closeRoom(room.inviteCode)
        }

        roomParticipantRepository.deleteAllByUserId(targetUserId)
        userSessionRepository.deleteAllByUserId(targetUserId)
        userTaskTemplateRepository.deleteAllByOwnerUserId(targetUserId)
        userTaskCategoryRepository.deleteAllByOwnerUserId(targetUserId)
        userRepository.delete(target)
    }

    private fun requireAdmin(user: User) {
        if (user.role != ROLE_ADMIN) {
            throw ApiException(HttpStatus.FORBIDDEN, "Требуются права администратора")
        }
    }

    private fun normalizeRole(role: String): String {
        return when (role.trim().lowercase()) {
            ROLE_ADMIN -> ROLE_ADMIN
            ROLE_USER -> ROLE_USER
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Поддерживаются только роли: user, admin")
        }
    }

    private fun User.toDto(): AdminUserDto {
        return AdminUserDto(
            id = id!!,
            nickname = nickname,
            role = role,
            createdAt = DateTimeFormatter.ISO_INSTANT.format(createdAt),
        )
    }
}
