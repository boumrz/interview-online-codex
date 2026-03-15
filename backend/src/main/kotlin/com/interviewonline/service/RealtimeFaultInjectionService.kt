package com.interviewonline.service

import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

@Service
class RealtimeFaultInjectionService {
    data class FaultProfile(
        val latencyMs: Int = 0,
        val dropEveryNthMessage: Int = 0,
    )

    private val profiles = ConcurrentHashMap<String, FaultProfile>()
    private val messageCounters = ConcurrentHashMap<String, AtomicInteger>()

    fun setProfile(inviteCode: String, profile: FaultProfile): FaultProfile {
        val normalized = FaultProfile(
            latencyMs = profile.latencyMs.coerceIn(0, 5_000),
            dropEveryNthMessage = profile.dropEveryNthMessage.coerceIn(0, 100),
        )
        profiles[inviteCode] = normalized
        messageCounters.putIfAbsent(inviteCode, AtomicInteger(0))
        return normalized
    }

    fun clearProfile(inviteCode: String) {
        profiles.remove(inviteCode)
        messageCounters.remove(inviteCode)
    }

    fun profileFor(inviteCode: String): FaultProfile? {
        return profiles[inviteCode]
    }

    fun shouldDropMessage(inviteCode: String): Boolean {
        val profile = profiles[inviteCode] ?: return false
        if (profile.dropEveryNthMessage <= 1) return false
        val counter = messageCounters.computeIfAbsent(inviteCode) { AtomicInteger(0) }
        val messageIndex = counter.incrementAndGet()
        return messageIndex % profile.dropEveryNthMessage == 0
    }
}
