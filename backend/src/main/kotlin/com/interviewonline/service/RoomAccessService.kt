package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service

@Service
class RoomAccessService(
    private val roomParticipantRepository: RoomParticipantRepository,
) {
    enum class RoomRole(val wireValue: String) {
        OWNER("owner"),
        INTERVIEWER("interviewer"),
        CANDIDATE("candidate");

        val canManageRoom: Boolean
            get() = this == OWNER || this == INTERVIEWER

        val canGrantAccess: Boolean
            get() = this == OWNER
    }

    data class RoomAccess(
        val role: RoomRole,
    ) {
        val isOwner: Boolean
            get() = role == RoomRole.OWNER

        val canManageRoom: Boolean
            get() = role.canManageRoom

        val canGrantAccess: Boolean
            get() = role.canGrantAccess
    }

    fun resolveAccess(
        room: Room,
        user: User?,
        ownerToken: String? = null,
        interviewerToken: String? = null,
    ): RoomAccess {
        val ownerId = room.ownerUser?.id
        val userId = user?.id
        if (ownerId != null && userId != null && ownerId == userId) {
            return RoomAccess(RoomRole.OWNER)
        }

        if (room.id != null && userId != null) {
            val participant = roomParticipantRepository.findByRoomIdAndUserId(room.id!!, userId)
            if (participant != null) {
                return RoomAccess(normalizeRole(participant.role))
            }
        }

        return when {
            !ownerToken.isNullOrBlank() && room.ownerSessionToken == ownerToken ->
                RoomAccess(RoomRole.OWNER)
            room.ownerUser == null &&
                !interviewerToken.isNullOrBlank() &&
                room.interviewerSessionToken == interviewerToken ->
                RoomAccess(RoomRole.INTERVIEWER)
            else -> RoomAccess(RoomRole.CANDIDATE)
        }
    }

    fun requireManager(
        room: Room,
        user: User?,
        ownerToken: String? = null,
        interviewerToken: String? = null,
    ): RoomAccess {
        val access = resolveAccess(room, user, ownerToken, interviewerToken)
        if (!access.canManageRoom) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только интервьюер может выполнить это действие")
        }
        return access
    }

    fun requireGrantAccess(
        room: Room,
        user: User?,
        ownerToken: String? = null,
        interviewerToken: String? = null,
    ): RoomAccess {
        val access = resolveAccess(room, user, ownerToken, interviewerToken)
        if (!access.canGrantAccess) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только администратор комнаты может управлять доступом")
        }
        return access
    }

    fun normalizeRole(rawRole: String?): RoomRole {
        return when (rawRole?.trim()?.lowercase()) {
            RoomRole.OWNER.wireValue -> RoomRole.OWNER
            RoomRole.INTERVIEWER.wireValue -> RoomRole.INTERVIEWER
            else -> RoomRole.CANDIDATE
        }
    }
}
