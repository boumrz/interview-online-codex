package com.interviewonline.service

import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component

@Component
@Profile("!test")
class NoopInvitationLifecycleBarrier : InvitationLifecycleBarrier {
    override fun afterTeamLockBeforeInvitationLock() = Unit
}
