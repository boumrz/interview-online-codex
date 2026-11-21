package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
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
import org.springframework.http.MediaType
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.util.AopTestUtils
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import javax.sql.DataSource

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
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val dataSource: DataSource,
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

    @Test
    fun `embedded rooms advertise only supported modes and preserve Markdown after a rejected canvas request`() {
        assertEquals("H2", dataSource.connection.use { it.metaData.databaseProductName })
        val room = roomRepository.saveAndFlush(Room(inviteCode = "embedded-modes-${UUID.randomUUID()}",
            ownerSessionToken = UUID.randomUUID().toString(), roomEditorMode = "diagram"))
        val path = "/api/rooms/${room.inviteCode}"
        mockMvc.get(path).andExpect {
            status { isOk() }
            jsonPath("$.roomEditorMode") { value("code") }
            jsonPath("$.roomDiagramsEnabled") { value(false) }
            jsonPath("$.roomWhiteboardEnabled") { value(false) }
        }
        val realtime = "/api/realtime/rooms/${room.inviteCode}"
        val sessionId = UUID.randomUUID().toString()
        val stream = mockMvc.get("$realtime/stream") {
            param("sessionId", sessionId); param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        val state = stream.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        assertEquals("code", state.path("roomEditorMode").asText())
        assertEquals(false, state.path("roomDiagramsEnabled").asBoolean(true))
        assertEquals(false, state.path("roomWhiteboardEnabled").asBoolean(true))
        assertEquals(true, state.path("drawingColor").isNull)
        fun event(type: String, details: Map<String, Any?>) = mockMvc.post("$realtime/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("type" to type, "sessionId" to sessionId,
                "eventToken" to state.path("eventToken").asText()) + details)
        }
        for (mode in listOf("diagram", "whiteboard")) {
            event("room_editor_mode_update", mapOf("roomEditorMode" to mode, "expectedRoomEditorModeRevision" to 0)).andExpect {
                status { isNotImplemented() }
                jsonPath("$.code") { value("ROOM_CANVAS_STORAGE_UNSUPPORTED") }
            }
            event("canvas_cursor_update", mapOf("canvasType" to mode)).andExpect {
                status { isNotImplemented() }
                jsonPath("$.code") { value("ROOM_CANVAS_STORAGE_UNSUPPORTED") }
            }
        }
        event("room_editor_mode_update", mapOf("roomEditorMode" to "markdown", "expectedRoomEditorModeRevision" to 0)).andExpect {
            status { isNoContent() }
        }
        mockMvc.get(path).andExpect { jsonPath("$.roomEditorMode") { value("markdown") } }
    }

    @Test
    fun `embedded storage rejects canvas APIs without querying missing tables`() {
        val room = roomRepository.saveAndFlush(Room(inviteCode = "embedded-canvases-${UUID.randomUUID()}",
            ownerSessionToken = UUID.randomUUID().toString()))
        for (canvas in listOf("diagram", "whiteboard")) {
            val path = "/api/rooms/${room.inviteCode}/$canvas"
            mockMvc.get(path).andExpect {
                status { isNotImplemented() }
                jsonPath("$.code") { value("ROOM_CANVAS_STORAGE_UNSUPPORTED") }
            }
        }
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
