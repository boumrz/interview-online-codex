package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.RoomStatus
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service

@Service
class RoomAccessService(
    private val roomParticipantRepository: RoomParticipantRepository,
    private val teamMembershipRepository: TeamMembershipRepository,
    private val teamRepository: TeamRepository,
    private val teamRoomLineageService: TeamRoomLineageService,
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

    fun requirePersonalScope(room: Room) {
        if (room.teamId != null) {
            throw roomNotFound()
        }
    }

    fun resolveAccess(
        room: Room,
        user: User?,
        ownerToken: String? = null,
        interviewerToken: String? = null,
        realtimeRoleOverride: RoomRole? = null,
    ): RoomAccess {
        if (room.teamId != null) {
            if (!ownerToken.isNullOrBlank() || !interviewerToken.isNullOrBlank()) throw roomNotFound()
            return resolveTeamAccess(room, user)
        }
        if (room.archivedAt != null) {
            throw ApiException(HttpStatus.GONE, "Комната архивирована")
        }
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
            // Fallback for guest participants whose role was granted via the
            // realtime channel. The in-memory role is trusted only after all
            // credential-based checks have failed (owner token, DB record, etc.).
            realtimeRoleOverride != null ->
                RoomAccess(realtimeRoleOverride)
            else -> RoomAccess(RoomRole.CANDIDATE)
        }
    }

    fun requireManager(
        room: Room,
        user: User?,
        ownerToken: String? = null,
        interviewerToken: String? = null,
        realtimeRoleOverride: RoomRole? = null,
    ): RoomAccess {
        val access = resolveAccess(room, user, ownerToken, interviewerToken, realtimeRoleOverride)
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

    private fun resolveTeamAccess(room: Room, user: User?): RoomAccess {
        val teamId = room.teamId ?: throw roomNotFound()
        if (!teamRoomLineageService.isCanonical(room)) {
            throw roomNotFound()
        }
        if (room.archivedAt != null) throw roomNotFound()
        teamRepository.findById(teamId).orElse(null)?.takeIf { it.state == ACTIVE }
            ?: throw roomNotFound()
        val roomId = room.id ?: throw roomNotFound()
        val userId = user?.id
        val membership = userId?.let { teamMembershipRepository.findByTeamIdAndUserId(teamId, it) }
        val participant = userId?.let { roomParticipantRepository.findByRoomIdAndUserId(roomId, it) }
        if (membership != null && (membership.state != ACTIVE || participant == null)) throw roomNotFound()
        if (participant != null && membership == null) throw roomNotFound()
        val role = participant?.let { normalizeRole(it.role) } ?: RoomRole.CANDIDATE
        if (room.status == RoomStatus.FROZEN.wireValue && role == RoomRole.CANDIDATE) {
            throw roomNotFound()
        }
        return RoomAccess(role)
    }

    private fun roomNotFound() = ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")

    private companion object {
        const val ACTIVE = "ACTIVE"
    }
}
