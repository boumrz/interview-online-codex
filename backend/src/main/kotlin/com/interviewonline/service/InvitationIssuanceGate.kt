package com.interviewonline.service

import com.interviewonline.model.User
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

@Component
class InvitationIssuanceGate(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val rateLimiter: InvitationRateLimiter,
    private val featureGate: TeamWorkspaceFeatureGate,
    private val transactionGuard: InvitationTransactionGuard,
) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun admit(actor: User, teamId: String) {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = teamRepository.lockById(teamId)?.takeIf { it.state == "ACTIVE" }
            ?: throw secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == "ACTIVE" }
            ?: throw secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
        if (team.ownerUserId != actorId && membership.role != "ADMIN") {
            throw secure(HttpStatus.FORBIDDEN, "INVITATION_MANAGEMENT_FORBIDDEN", "Недостаточно прав")
        }
        rateLimiter.consumeIssueInCurrentTransaction(team.id)
    }
}
