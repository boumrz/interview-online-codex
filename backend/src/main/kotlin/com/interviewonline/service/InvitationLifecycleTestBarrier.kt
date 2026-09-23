package com.interviewonline.service

import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Test-profile-only deterministic seam. It has no transport mapping. */
@Component
@Profile("test")
class InvitationLifecycleTestBarrier : InvitationLifecycleBarrier {
    private val armed = AtomicBoolean(false)
    @Volatile private var arrived = CountDownLatch(0)
    @Volatile private var released = CountDownLatch(0)

    fun arm() {
        arrived = CountDownLatch(1)
        released = CountDownLatch(1)
        armed.set(true)
    }

    fun awaitArrival(timeoutMs: Long): Boolean = arrived.await(timeoutMs, TimeUnit.MILLISECONDS)

    fun releaseOne() = released.countDown()

    fun reset() {
        armed.set(false)
        released.countDown()
        arrived = CountDownLatch(0)
        released = CountDownLatch(0)
    }

    override fun afterTeamLockBeforeInvitationLock() {
        if (!armed.get()) return
        arrived.countDown()
        released.await(15, TimeUnit.SECONDS)
    }
}
