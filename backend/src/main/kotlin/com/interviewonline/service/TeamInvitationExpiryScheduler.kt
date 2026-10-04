package com.interviewonline.service

import org.springframework.context.annotation.Profile
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@Profile("!test")
class TeamInvitationExpiryScheduler(
    private val coordinator: InvitationExpiryCleanupCoordinator,
) {
    @Scheduled(fixedDelay = 60_000)
    fun cleanupExpiredRecoverableLinks() {
        coordinator.cleanupCandidates(MAX_CANDIDATES)
    }

    private companion object {
        const val MAX_CANDIDATES = 100
    }
}
