package com.interviewonline.service

import com.interviewonline.dto.HrManagerDto
import com.interviewonline.dto.HrTrackingDto
import com.interviewonline.dto.InterviewMetadataDto
import com.interviewonline.dto.InterviewMetadataUpdateRequest
import com.interviewonline.model.Room
import com.interviewonline.model.RoomHrAssignment
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.User
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockByInviteCode
import com.interviewonline.repository.UserRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import java.util.UUID

@Service
class RoomHrTrackingService(
    private val roomRepository: RoomRepository,
    private val assignmentRepository: RoomHrAssignmentRepository,
    private val participantRepository: RoomParticipantRepository,
    private val userRepository: UserRepository,
    private val roomAccessService: RoomAccessService,
    private val collaborationService: CollaborationService,
) {
    @Transactional(readOnly = true)
    fun getMetadata(
        inviteCode: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): InterviewMetadataDto {
        val room = requireRoom(inviteCode)
        roomAccessService.requireManager(
            room,
            user,
            ownerToken,
            interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        return room.toMetadataDto()
    }

    @Transactional
    fun updateMetadata(
        inviteCode: String,
        request: InterviewMetadataUpdateRequest,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): InterviewMetadataDto {
        if (request.revision < 0) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная ревизия метаданных")
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        roomAccessService.requireManager(
            room,
            user,
            ownerToken,
            interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        if (room.interviewMetadataRevision != request.revision) {
            throw ApiException(HttpStatus.CONFLICT, "Метаданные уже изменены другим менеджером")
        }
        room.candidateName = normalizeText(request.candidateName, "Имя кандидата")
        room.position = normalizeText(request.position, "Позиция")
        room.scheduledAt = parseScheduledAt(request.scheduledAt)
        room.interviewMetadataRevision += 1
        return roomRepository.save(room).toMetadataDto()
    }

    @Transactional(readOnly = true)
    fun listManagers(
        inviteCode: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): List<HrManagerDto> {
        val room = requireRoom(inviteCode)
        roomAccessService.requireManager(
            room,
            user,
            ownerToken,
            interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        return currentManagers(room)
    }

    fun invite(
        inviteCode: String,
        rawTargetUserId: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): List<HrManagerDto> {
        return collaborationService.mutateRoomPermissions(inviteCode) {
            val result = inviteInTransaction(inviteCode, rawTargetUserId, user, ownerToken, interviewerToken, eventToken)
            RoomPermissionMutation(result, setOf(UUID.fromString(rawTargetUserId.trim()).toString()))
        }
    }

    private fun inviteInTransaction(
        inviteCode: String,
        rawTargetUserId: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): List<HrManagerDto> {
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        roomAccessService.requireManager(
            room,
            user,
            ownerToken,
            interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        val targetId = canonicalUuidOrNotFound(rawTargetUserId)
        val target = userRepository.lockById(targetId)
            ?.takeIf { it.isHr }
            ?: throw hrNotFound()
        assignHiringManager(room, target)
        return currentManagers(room)
    }

    /**
     * Applies the established invitation persistence semantics while the
     * authenticated room-creation transaction is still private.
     */
    fun assignHiringManagersOnRoomCreation(room: Room, targets: List<User>) {
        targets.forEach { target -> assignHiringManager(room, target) }
    }

    fun remove(
        inviteCode: String,
        rawTargetUserId: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ) {
        collaborationService.mutateRoomPermissions(inviteCode) {
            val room = roomRepository.lockByInviteCode(inviteCode)
                ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
            if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
            roomAccessService.requireManager(
                room, user, ownerToken, interviewerToken,
                collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
            )
            val targetId = canonicalUuidOrNotFound(rawTargetUserId)
            if (room.ownerUser?.id == targetId) {
                throw ApiException(HttpStatus.FORBIDDEN, "Нельзя снять роль владельца комнаты")
            }
            val target = userRepository.lockById(targetId) ?: throw hrNotFound()
            val roomId = requireNotNull(room.id)
            val membership = participantRepository.findByRoomIdAndUserId(roomId, targetId)
            val hasTrackedAssignment = assignmentRepository.existsByRoomIdAndUserId(roomId, targetId)
            // Legacy rooms may have persisted only the interviewer membership.
            // Preserve their removal and retry semantics without letting an
            // ordinary interviewer be treated as a hiring manager.
            val hasHiringManagerMembership = target.isHr && membership?.role in setOf("interviewer", "candidate")
            if (!hasTrackedAssignment && !hasHiringManagerMembership) {
                throw hrNotFound()
            }
            // Keep a durable candidate override: deleting it could restore access
            // through a previous room credential or automatic HR tracking.
            if (membership == null) {
                participantRepository.save(RoomParticipant(room = room, user = target, role = "candidate"))
            } else if (membership.role != "candidate") {
                membership.role = "candidate"
                participantRepository.save(membership)
            }
            RoomPermissionMutation(Unit, setOf(targetId))
        }
    }

    fun track(
        inviteCode: String,
        user: User,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): HrTrackingDto {
        return collaborationService.mutateRoomPermissions(inviteCode) {
            trackInTransaction(inviteCode, user, ownerToken, interviewerToken, eventToken)
        }
    }

    private fun trackInTransaction(
        inviteCode: String,
        user: User,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): RoomPermissionMutation<HrTrackingDto> {
        val stored = userRepository.findById(requireNotNull(user.id)).orElseThrow {
            ApiException(HttpStatus.UNAUTHORIZED, "Пользователь не найден")
        }
        if (!stored.isHr) throw ApiException(HttpStatus.FORBIDDEN, "Требуется профиль нанимающего")
        val room = roomRepository.lockByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        val access = roomAccessService.requireManager(
            room,
            stored,
            ownerToken,
            interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        val roomId = requireNotNull(room.id)
        val grantsMembership = !access.isOwner &&
            participantRepository.findByRoomIdAndUserId(roomId, requireNotNull(stored.id)) == null
        if (grantsMembership) {
            participantRepository.save(RoomParticipant(room = room, user = stored, role = "interviewer"))
        }
        ensureAssignment(room, stored)
        return RoomPermissionMutation(HrTrackingDto(roomId), if (grantsMembership) setOf(requireNotNull(stored.id)) else emptySet())
    }

    private fun currentManagers(room: Room): List<HrManagerDto> {
        val roomId = requireNotNull(room.id)
        val interviewerIds = participantRepository.findAllByRoomIdOrderByCreatedAtAsc(roomId)
            .filter { it.role == "interviewer" }
            .mapNotNull { it.user?.id }
            .toSet()
        val ownerId = room.ownerUser?.id
        return assignmentRepository.findAllByRoomIdOrderByCreatedAtAscIdAsc(roomId)
            .filter { assignment ->
                val assigned = assignment.user
                assigned?.isHr == true && (assigned.id == ownerId || assigned.id in interviewerIds)
            }
            .map { assignment ->
                val assigned = requireNotNull(assignment.user)
                HrManagerDto(
                    userId = requireNotNull(assigned.id),
                    displayName = assigned.displayName.orEmpty(),
                    isOwner = assigned.id == ownerId,
                )
            }
    }

    private fun ensureAssignment(room: Room, user: User) {
        val roomId = requireNotNull(room.id)
        val userId = requireNotNull(user.id)
        if (!assignmentRepository.existsByRoomIdAndUserId(roomId, userId)) {
            assignmentRepository.save(RoomHrAssignment(room = room, user = user))
        }
    }

    private fun assignHiringManager(room: Room, target: User) {
        val targetId = requireNotNull(target.id)
        val roomId = requireNotNull(room.id)
        if (room.ownerUser?.id != targetId) {
            val existing = participantRepository.findByRoomIdAndUserId(roomId, targetId)
            if (existing == null) {
                participantRepository.save(RoomParticipant(room = room, user = target, role = "interviewer"))
            } else if (existing.role != "interviewer") {
                existing.role = "interviewer"
                participantRepository.save(existing)
            }
        }
        ensureAssignment(room, target)
    }

    private fun requireRoom(inviteCode: String): Room = roomRepository.findByInviteCode(inviteCode)
        ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")

    private fun normalizeText(value: String?, label: String): String? {
        val normalized = value?.trim()?.ifBlank { null } ?: return null
        if (normalized.codePointCount(0, normalized.length) > 200) {
            throw ApiException(HttpStatus.BAD_REQUEST, "$label не может быть длиннее 200 символов")
        }
        return normalized
    }

    private fun parseScheduledAt(value: String?): Instant? {
        val normalized = value?.trim()?.ifBlank { null } ?: return null
        return try {
            OffsetDateTime.parse(normalized).toInstant()
        } catch (_: DateTimeParseException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Запланированное время должно содержать часовой пояс")
        }
    }

    private fun canonicalUuidOrNotFound(raw: String): String = try {
        UUID.fromString(raw.trim()).toString()
    } catch (_: IllegalArgumentException) {
        throw hrNotFound()
    }

    private fun hrNotFound() = ApiException(HttpStatus.NOT_FOUND, "Нанимающий с таким ID не найден")

    private fun Room.toMetadataDto() = InterviewMetadataDto(
        candidateName = candidateName,
        position = position,
        scheduledAt = scheduledAt?.toString(),
        revision = interviewMetadataRevision,
    )
}
