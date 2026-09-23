package com.interviewonline.service

import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component

/** H2-compatible test seam only; it is deliberately not an HTTP endpoint. */
@Component
@Profile("test")
class TeamInvitationExpiryCleanup(
    private val coordinator: InvitationExpiryCleanupCoordinator,
) {
    fun cleanupOneCandidateForH2Test(): Boolean = coordinator.cleanupOneCandidate()
}
