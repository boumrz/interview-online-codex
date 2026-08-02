package com.interviewonline.controller

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.util.AopTestUtils
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.util.UUID

/**
 * The status endpoint is intentionally not a second SSE handshake: it is used
 * only to classify an EventSource error without minting a participant/token.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RealtimeStreamStatusIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomParticipantRepository: RoomParticipantRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userSessionRepository: UserSessionRepository,
    @Autowired private val userRepository: UserRepository,
) {
    @AfterEach
    fun cleanup() {
        roomParticipantRepository.deleteAll()
        roomRepository.deleteAll()
        userSessionRepository.deleteAll()
        userRepository.deleteAll()
    }

    @Test
    fun `stream status distinguishes an existing room from a missing one without realtime side effects`() {
        val user = userRepository.saveAndFlush(
            User(
                nickname = "stream-status-${UUID.randomUUID().toString().take(8)}",
                displayName = "Stream status owner",
                passwordHash = "test-only",
                role = "user",
            ),
        )
        val authToken = "stream_status_${UUID.randomUUID()}"
        userSessionRepository.saveAndFlush(UserSession(user = user, token = authToken))
        val room = roomRepository.saveAndFlush(
            Room(
                title = "Stream status room",
                inviteCode = "stream-status-${UUID.randomUUID()}",
                ownerSessionToken = "owner_${UUID.randomUUID()}",
                interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
                ownerUser = user,
            ),
        )

        val before = realtimeTransportCounts()
        mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream-status") {
            param("authToken", authToken)
            param("ownerToken", room.ownerSessionToken)
        }.andExpect {
            status { isNoContent() }
            header { string(HttpHeaders.CACHE_CONTROL, "private, no-store") }
        }
        assertEquals(before, realtimeTransportCounts(), "status probe must not open a realtime session")

        mockMvc.get("/api/realtime/rooms/missing-${UUID.randomUUID()}/stream-status") {
            param("authToken", authToken)
        }.andExpect {
            status { isNotFound() }
            content { string("") }
            header { string(HttpHeaders.CACHE_CONTROL, "private, no-store") }
        }
        assertEquals(before, realtimeTransportCounts(), "missing probe must not create realtime state")
    }

    private fun realtimeTransportCounts(): Map<String, Int> {
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        return listOf("participants", "sseConnections", "roomSseConnections", "connectionByRoomSession", "roomState")
            .associateWith { fieldName ->
                val field = CollaborationService::class.java.getDeclaredField(fieldName)
                    .apply { isAccessible = true }
                (field.get(target) as Map<*, *>).size
            }
    }
}
