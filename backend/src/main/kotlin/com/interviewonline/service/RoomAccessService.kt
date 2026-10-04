package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomHrAssignmentRepository
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
    private val hrAssignmentRepository: RoomHrAssignmentRepository,
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
        if (room.archivedAt != null) throw roomNotFound()
        // The shared link always admits a candidate. Team lineage and current
        // membership determine management authority, never public admission.
        if (!teamRoomLineageService.isCanonical(room) ||
            teamRepository.findById(teamId).orElse(null)?.state != ACTIVE
        ) return RoomAccess(RoomRole.CANDIDATE)
        val roomId = room.id ?: throw roomNotFound()
        val userId = user?.id
        val membership = userId?.let { teamMembershipRepository.findByTeamIdAndUserId(teamId, it) }
        if (membership?.state == ACTIVE) {
            return RoomAccess(if (room.ownerUser?.id == userId) RoomRole.OWNER else RoomRole.INTERVIEWER)
        }
        // An old assignment must not restore privileges after membership ends.
        if (membership != null) {
            val assignment = userId?.let { hrAssignmentRepository.findByRoomIdAndUserId(roomId, it) }
            if (membership.state !in setOf("LEFT", "REMOVED") || user?.isHr != true ||
                assignment == null || assignment.createdAt <= membership.updatedAt
            ) return RoomAccess(RoomRole.CANDIDATE)
        }
        val participant = userId?.let { roomParticipantRepository.findByRoomIdAndUserId(roomId, it) }
        return RoomAccess(
            if (participant?.role == RoomRole.INTERVIEWER.wireValue) RoomRole.INTERVIEWER else RoomRole.CANDIDATE,
        )
    }

    private fun roomNotFound() = ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")

    private companion object {
        const val ACTIVE = "ACTIVE"
    }
}
