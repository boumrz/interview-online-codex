package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.ApiException
import com.interviewonline.service.CollaborationService
import com.interviewonline.ws.RealtimeEventRequest
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.springframework.test.util.AopTestUtils
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc
class HrRoomArchiveIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
) {
    @Test
    fun `tracked room deletion archives idempotently and every live path becomes terminal`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "archive-owner")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isOk() } }

        repeat(2) {
            mockMvc.delete("/api/me/rooms/${room.id}") {
                header("Authorization", "Bearer ${owner.token}")
            }.andExpect {
                status { isOk() }
                jsonPath("$.status") { value("ok") }
                jsonPath("$.archived") { value(true) }
            }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isGone() } }

        mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream-status") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isGone() } }

        mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"passed","verdictComment":"late write"}"""
        }.andExpect { status { isGone() } }

        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.archivedAt") { isNotEmpty() }
        }

        mockMvc.get("/api/me/rooms") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$[?(@.id == '${room.id}')]") { isEmpty() }
        }
    }

    @Test
    fun `untracked owner deletion keeps destructive compatibility`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "delete-owner")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)

        mockMvc.delete("/api/me/rooms/${room.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.status") { value("ok") }
            jsonPath("$.archived") { value(false) }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}")
            .andExpect { status { isNotFound() } }
    }

    @Test
    fun `archive cancels a pending debounced code save and rejects its former event token`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "debounce-owner")
        val creation = mockMvc.post("/api/public/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Debounce archive","language":"nodejs"}"""
        }.andExpect { status { isOk() } }.andReturn().response
        val body = objectMapper.readTree(creation.contentAsString)
        val room = HrTestRoom(body.path("id").asText(), body.path("inviteCode").asText())
        val initialCode = body.path("code").asText()
        mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isOk() } }

        val sessionId = "owner-${UUID.randomUUID()}"
        collaborationService.joinRoomSse(
            room.inviteCode,
            sessionId,
            "owner-participant",
            "Owner",
            null,
            null,
            userRepository.findById(owner.id).orElseThrow(),
        )
        val eventToken = eventTokenFor(room.inviteCode, sessionId)
        collaborationService.handleRealtimeEvent(
            room.inviteCode,
            RealtimeEventRequest(
                sessionId = sessionId,
                eventToken = eventToken,
                operationId = UUID.randomUUID().toString(),
                type = "yjs_update",
                yjsUpdate = "AQ==",
                syncKey = "${room.inviteCode}:0:nodejs",
                code = "late code must never persist",
                yjsDocumentBase64 = "AQ==",
                yjsClientSequence = 1,
                baseServerYjsSequence = 0,
            ),
        )

        mockMvc.delete("/api/me/rooms/${room.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.archived") { value(true) }
        }
        Thread.sleep(900)

        val stored = roomRepository.findWithTasksByInviteCode(room.inviteCode)!!
        assertNotNull(stored.archivedAt)
        assertNotEquals("late code must never persist", stored.code)
        assertNotEquals("late code must never persist", stored.tasks.first().solutionCode)
        val exception = assertThrows(ApiException::class.java) {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(sessionId = sessionId, eventToken = eventToken, type = "code_update", code = initialCode),
            )
        }
        org.junit.jupiter.api.Assertions.assertEquals(410, exception.status.value())
    }

    @Test
    fun `invited interviewer cannot archive the owners tracked room`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "delete-owner2")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "delete-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)

        mockMvc.delete("/api/me/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isNotFound() } }
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isOk() } }
    }

    @Suppress("UNCHECKED_CAST")
    private fun eventTokenFor(inviteCode: String, sessionId: String): String {
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        val field = CollaborationService::class.java.getDeclaredField("participants").apply { isAccessible = true }
        val participants = field.get(target) as Map<String, Any>
        val participant = participants.values.single { candidate ->
            privateField(candidate, "inviteCode") == inviteCode && privateField(candidate, "sessionId") == sessionId
        }
        return privateField(participant, "eventToken") as String
    }

    private fun privateField(instance: Any, name: String): Any? = instance.javaClass.getDeclaredField(name)
        .apply { isAccessible = true }
        .get(instance)
}
