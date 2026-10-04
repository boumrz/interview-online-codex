package com.interviewonline.service

import com.interviewonline.dto.HiringManagerPreviewResponse
import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.model.User
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class HiringManagerPreviewService(
    private val userRepository: UserRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val teamRepository: TeamRepository,
) {
    @Transactional(readOnly = true)
    fun resolve(request: ResolveHiringManagerPreviewRequest, actor: User): HiringManagerPreviewResponse {
        val normalizedId = canonicalInvitationId(request.invitationId)
        request.teamId?.let { teamId ->
            requireTeamScope(actor, teamId)
            val membership = membershipRepository.findByTeamIdAndUserId(teamId, normalizedId)
            if (membership != null && membership.state !in setOf("LEFT", "REMOVED")) throw unavailable()
        }
        val user = userRepository.findById(normalizedId).orElse(null)
            ?.takeIf { it.isHr }
            ?: throw unavailable()

        return HiringManagerPreviewResponse(
            normalizedId = normalizedId,
            displayName = user.displayName.orEmpty(),
        )
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
