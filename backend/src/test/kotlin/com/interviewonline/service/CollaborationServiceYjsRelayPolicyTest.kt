package com.interviewonline.service

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CollaborationServiceYjsRelayPolicyTest {
    @Test
    fun `heartbeat-only yjs packet is ignored`() {
        assertTrue(isHeartbeatOnlyYjsUpdate(null))
        assertTrue(isHeartbeatOnlyYjsUpdate(""))
        assertTrue(isHeartbeatOnlyYjsUpdate("   "))
        assertFalse(isHeartbeatOnlyYjsUpdate("AQID"))
    }
}
