package com.interviewonline.service

import com.interviewonline.dto.HiringManagerPreviewResponse
import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.model.User
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.RoomRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class HiringManagerPreviewService(
    private val userRepository: UserRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val teamRepository: TeamRepository,
    private val roomRepository: RoomRepository,
    private val roomAccessService: RoomAccessService,
    private val collaborationService: CollaborationService,
) {
    @Transactional(readOnly = true)
    fun resolve(request: ResolveHiringManagerPreviewRequest, actor: User): HiringManagerPreviewResponse {
        request.teamId?.let { requireTeamScope(actor, it) }
        return resolveTarget(request, request.teamId)
    }

    @Transactional(readOnly = true)
    fun resolveInRoom(
        inviteCode: String,
        request: ResolveHiringManagerPreviewRequest,
        actor: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
    ): HiringManagerPreviewResponse {
        if (request.teamId != null) throw ApiException(HttpStatus.BAD_REQUEST, "Команда определяется по интервью")
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        roomAccessService.requireManager(room, actor, ownerToken, interviewerToken,
            if (actor == null) collaborationService.resolveRoleByEventToken(inviteCode, eventToken, anonymousOnly = true) else null)
        return resolveTarget(request, room.teamId)
    }

    private fun resolveTarget(request: ResolveHiringManagerPreviewRequest, teamId: String?): HiringManagerPreviewResponse {
        val user = if (request.nickname != null) {
            userRepository.findByNickname(canonicalNickname(request.nickname))
        } else {
            userRepository.findById(canonicalInvitationId(request.invitationId.orEmpty())).orElse(null)
        }?.takeIf { it.isHr } ?: throw unavailable()
        val normalizedId = requireNotNull(user.id)
        teamId?.let {
            val membership = membershipRepository.findByTeamIdAndUserId(it, normalizedId)
            if (membership != null && membership.state !in setOf("LEFT", "REMOVED")) throw unavailable()
        }

        return HiringManagerPreviewResponse(
            normalizedId = normalizedId,
            displayName = user.displayName.orEmpty(),
        )
    }

    private fun canonicalNickname(rawNickname: String): String {
        val nickname = rawNickname.trim()
        if (nickname.length !in 3..32 || nickname.any { it.isWhitespace() }) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Введите ник от 3 до 32 символов без пробелов")
        }
        return nickname
    }

    @Transactional(readOnly = true)
    fun options(actor: User, teamId: String?): List<HiringManagerPreviewResponse> {
        teamId?.let { requireTeamScope(actor, it) }
        return emptyList()
    }

    private fun requireTeamScope(actor: User, teamId: String) {
        if (teamRepository.findById(teamId).orElse(null)?.state != "ACTIVE" ||
            !membershipRepository.existsByTeamIdAndUserIdAndState(teamId, requireNotNull(actor.id), "ACTIVE")
        ) throw unavailable()
    }

    private fun canonicalInvitationId(rawInvitationId: String): String {
        val normalized = rawInvitationId.trim()
        val parsed = runCatching { UUID.fromString(normalized) }.getOrNull()
        if (normalized.isBlank() || parsed == null || !parsed.toString().equals(normalized, ignoreCase = true)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некорректный идентификатор нанимающего")
        }
        return parsed.toString()
    }

    private fun unavailable(): ApiException = ApiException(
        HttpStatus.NOT_FOUND,
        "Нанимающий не найден или недоступен",
    )
}
