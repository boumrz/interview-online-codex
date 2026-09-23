package com.interviewonline.service

import com.interviewonline.repository.TeamInvitationRepository
import com.interviewonline.repository.TeamRepository
import org.springframework.core.env.Environment
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.temporal.ChronoUnit

@Service
class InvitationExpiryCleanupCommand(
    private val teamRepository: TeamRepository,
    private val invitationRepository: TeamInvitationRepository,
    private val databaseTime: DatabaseTimeSource,
    private val transactionGuard: InvitationTransactionGuard,
    private val lifecycleBarrier: InvitationLifecycleBarrier,
    private val environment: Environment,
) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun cleanupCandidate(invitationId: String): Boolean {
        val teamId = invitationRepository.findTeamIdById(invitationId) ?: return false
        if (!isTestProfile()) transactionGuard.applyLockTimeout()
        // Cleanup never grants team access. It still takes the team lock first,
        // including for an inactive team, so expired encrypted bearer material
        // cannot retain a key dependency indefinitely after a team lifecycle change.
        val team = teamRepository.lockById(teamId) ?: return false
        lifecycleBarrier.afterTeamLockBeforeInvitationLock()
        val invitation = if (isTestProfile()) {
            invitationRepository.lockByIdAndTeamId(invitationId, team.id)
        } else {
            invitationRepository.lockByIdAndTeamIdSkipLocked(invitationId, team.id)
        } ?: return false
        val current = databaseTime.now().truncatedTo(ChronoUnit.MICROS)
        if (invitation.state != "PENDING" || invitation.expiresAt.isAfter(current)) return false
        if (invitation.recoverableTokenEnvelope == null && invitation.recoveryKeyVersion == null) return false
        invitation.recoverableTokenEnvelope = null
        invitation.recoveryKeyVersion = null
        invitation.revision += 1
        invitation.updatedAt = current
        invitationRepository.saveAndFlush(invitation)
        return true
    }

    private fun isTestProfile(): Boolean = environment.activeProfiles.contains("test")
}
