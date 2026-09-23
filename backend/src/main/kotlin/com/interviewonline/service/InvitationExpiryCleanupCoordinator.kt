package com.interviewonline.service

import com.interviewonline.repository.TeamInvitationRepository
import org.springframework.stereotype.Service

@Service
class InvitationExpiryCleanupCoordinator(
    private val invitationRepository: TeamInvitationRepository,
    private val command: InvitationExpiryCleanupCommand,
) {
    fun cleanupCandidates(limit: Int): Int = invitationRepository.findExpiredCandidateIds(limit)
        .count { command.cleanupCandidate(it) }

    fun cleanupOneCandidate(): Boolean = invitationRepository.findExpiredCandidateIds(1)
        .firstOrNull()
        ?.let(command::cleanupCandidate)
        ?: false
}
