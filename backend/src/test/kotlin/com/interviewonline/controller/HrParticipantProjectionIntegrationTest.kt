package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc
class HrParticipantProjectionIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val collaborationService: CollaborationService,
) {
    @Test
    fun `participant HR eligibility comes from authenticated account not claimed name or query fields`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false).first
        val hr = HrHttpFixtures.register(mockMvc, objectMapper, true).first
        val ordinary = HrHttpFixtures.register(mockMvc, objectMapper, false).first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        try {
            join(room, hr)
            join(room, ordinary)
            val guestSession = UUID.randomUUID().toString()
            join(room, null, guestSession)
            val snapshot = participantList(join(room, owner))
            assertEquals(true, snapshot.single { it.path("userId").asText() == hr.id }.path("isHr").booleanValue(),
                "server participant projection must expose authenticated HR eligibility")
            assertEquals(false, snapshot.single { it.path("userId").asText() == ordinary.id }.path("isHr").booleanValue())
            val guest = snapshot.single { it.path("sessionId").asText() == guestSession }
            assertFalse(guest.path("isHr").booleanValue())
            assertFalse(guest.path("isAuthenticated").booleanValue())
            assertTrue(guest.path("userId").isNull)
            assertTrue(snapshot.all { !it.has("email") && !it.has("authToken") && !it.has("eventToken") })
            mockMvc.get("/api/me/hr/rooms") { header("Authorization", "Bearer ${hr.token}") }
                .andExpect { status { isOk() }; jsonPath("$.totalElements") { value(0) } }
        } finally { collaborationService.closeRoom(room.inviteCode) }
    }

    @Test
    fun `HR opt in is retained across mixed old and refreshed sessions of the same account`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false).first
        val account = HrHttpFixtures.register(mockMvc, objectMapper, false).first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        try {
            join(room, account, "a-old-${UUID.randomUUID()}")
            mockMvc.patch("/api/me/profile") {
                header("Authorization", "Bearer ${account.token}")
                contentType = MediaType.APPLICATION_JSON
                content = """{"displayName":"New HR profile","isHr":true}"""
            }.andExpect { status { isOk() } }
            join(room, account, "z-refreshed-${UUID.randomUUID()}")
            val matching = participantList(join(room, owner)).filter { it.path("userId").asText() == account.id }
            assertEquals(1, matching.size, "sessions of one account remain a single participant")
            assertTrue(matching.single().path("isHr").booleanValue(), "an older session must not hide refreshed HR eligibility")
            assertEquals("candidate", matching.single().path("role").asText())
        } finally { collaborationService.closeRoom(room.inviteCode) }
    }

    private fun join(room: HrTestRoom, account: HrTestAccount?, session: String = UUID.randomUUID().toString()): MvcResult =
        mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session)
            param("displayName", "Claimed HR")
            param("isHr", "true")
            param("userId", "forged-identity")
            account?.let { header("Authorization", "Bearer ${it.token}") }
        }.andExpect { status { isOk() }; request { asyncStarted() } }.andReturn()

    private fun participantList(result: MvcResult): List<JsonNode> = result.response.contentAsString
        .lineSequence().filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .filter { it.path("type").asText() == "state_sync" }
        .last().path("payload").path("participants").toList()
}
