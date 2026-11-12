package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@SpringBootTest(properties = ["app.features.room-whiteboard-enabled=true", "app.features.room-diagrams-enabled=true"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomDrawingColorIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_drawing_color")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `each admitted identity gets a distinct color shared by own state and roster`() {
        postgres.verifyPostgres16()
        val room = room()
        val first = stream(room, participantId = "first")
        val second = stream(room, participantId = "second")
        val firstColor = drawingColor(first)
        val secondColor = drawingColor(second)
        assertNotEquals(firstColor, secondColor)
        val roster = state(second).path("participants")
        assertEquals(firstColor, roster.first { it.path("participantId").asText() == "first" }.path("drawingColor").asText())
        assertEquals(secondColor, roster.first { it.path("participantId").asText() == "second" }.path("drawingColor").asText())
        assertEquals(setOf(firstColor, secondColor), roster.map { it.path("drawingColor").asText() }.toSet())
    }

    @Test fun `guest multiple tabs reconnect rename and role changes preserve reserved color`() {
        val room = room()
        val first = stream(room, participantId = "  stable-guest  ", sessionId = "original")
        val color = drawingColor(first)
        assertEquals(color, drawingColor(stream(room, participantId = "stable-guest", sessionId = "another-tab")))
        assertEquals(color, drawingColor(stream(room, participantId = "stable-guest", sessionId = "original", displayName = "Renamed", owner = true)))
        assertEquals(color, drawingColor(stream(room, participantId = "stable-guest", sessionId = "after-reconnect")))
        assertNotEquals(color, drawingColor(stream(room, participantId = "new-person")))
        assertEquals(2, assignmentCount(room))
        assertEquals(color, jdbc.queryForObject("SELECT color FROM room_drawing_colors WHERE room_id=? AND identity_key=?", String::class.java, room.id, "guest:stable-guest"))
    }

    @Test fun `authenticated identity keeps its color across participant and session ids without colliding with guests`() {
        val room = room()
        val account = HrHttpFixtures.register(mvc, mapper, isHr = false, prefix = "drawing-color").first
        val color = drawingColor(stream(room, participantId = "browser-a", account = account))
        assertEquals(color, drawingColor(stream(room, participantId = "browser-b", account = account)))
        assertNotEquals(color, drawingColor(stream(room, participantId = "browser-a")))
        val anotherAccount = HrHttpFixtures.register(mvc, mapper, isHr = false, prefix = "drawing-color").first
        assertNotEquals(color, drawingColor(stream(room, participantId = "browser-a", account = anotherAccount)))
        assertEquals(3, assignmentCount(room))
        assertEquals(color, jdbc.queryForObject("SELECT color FROM room_drawing_colors WHERE room_id=? AND identity_key=?", String::class.java, room.id, "user:${account.id}"))
    }

    @Test fun `colors do not wrap after the initial palette and concurrent admissions remain unique`() {
        val room = room()
        val executor = Executors.newFixedThreadPool(8)
        try {
            val connections = executor.invokeAll((0 until 40).map { index -> Callable {
                stream(room, participantId = "person-$index")
            }}).map { it.get() }
            // Every join broadcasts to every response. Read after concurrent
            // writers finish so a mock response snapshot cannot end mid-frame.
            val colors = connections.map(::drawingColor)
            assertEquals(40, colors.toSet().size)
            assertEquals(40, assignmentCount(room))
            val samePersonConnections = executor.invokeAll((0 until 8).map { index -> Callable {
                stream(room, participantId = "same-person", sessionId = "same-person-tab-$index")
            }}).map { it.get() }
            val samePersonColors = samePersonConnections.map(::drawingColor)
            assertEquals(1, samePersonColors.toSet().size)
            assertEquals(41, assignmentCount(room))
        } finally { executor.shutdownNow() }
    }

    @Test fun `preexisting persisted colors survive reconnect and removal of room removes reservations`() {
        val room = room()
        val persisted = "#123abc"
        jdbc.update("INSERT INTO room_drawing_colors(room_id,identity_key,color) VALUES (?,?,?)", room.id, "guest:known", persisted)
        assertEquals(persisted, drawingColor(stream(room, participantId = "known")))
        assertNotEquals(persisted, drawingColor(stream(room, participantId = "new")))
        rooms.deleteById(requireNotNull(room.id))
        assertEquals(0, assignmentCount(room))
    }

    @Test fun `legacy sessions without participant id keep distinct reserved colors`() {
        val room = room()
        val first = drawingColor(stream(room, participantId = null, sessionId = "legacy-first"))
        val second = drawingColor(stream(room, participantId = null, sessionId = "legacy-second"))
        assertNotEquals(first, second)
        assertEquals(first, drawingColor(stream(room, participantId = null, sessionId = "legacy-first")))
        assertEquals(2, assignmentCount(room))
    }

    @Test fun `database prevents duplicate or malformed colors and permits room local reuse`() {
        val room = room()
        val color = drawingColor(stream(room, participantId = "first"))
        assertThrows(DataIntegrityViolationException::class.java) {
            jdbc.update("INSERT INTO room_drawing_colors(room_id,identity_key,color) VALUES (?,?,?)", room.id, "guest:duplicate", color)
        }
        assertThrows(DataIntegrityViolationException::class.java) {
            jdbc.update("INSERT INTO room_drawing_colors(room_id,identity_key,color) VALUES (?,?,?)", room.id, "guest:malformed", "red")
        }
        assertEquals(color, drawingColor(stream(room(), participantId = "different-room")))
    }

    @Test fun `rejected admission does not reserve or disclose a drawing color`() {
        val room = room()
        jdbc.update("UPDATE rooms SET archived_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        val rejected = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", "rejected"); param("participantId", "rejected"); param("displayName", "Rejected")
        }.andReturn()
        assertEquals(410, rejected.response.status)
        assertFalse(rejected.response.contentAsString.contains("drawingColor"))
        assertEquals(0, assignmentCount(room))
    }

    private fun room(): Room = rooms.saveAndFlush(Room(title = "Drawing colors", inviteCode = "color-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}"))
    private fun assignmentCount(room: Room) = jdbc.queryForObject("SELECT count(*) FROM room_drawing_colors WHERE room_id=?", Int::class.java, room.id)
    private fun stream(room: Room, participantId: String?, sessionId: String = "color-${UUID.randomUUID()}", displayName: String = "Participant", owner: Boolean = false, account: HrTestAccount? = null): MvcResult = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
        param("sessionId", sessionId); param("displayName", displayName)
        participantId?.let { param("participantId", it) }
        if (owner) param("ownerToken", room.ownerSessionToken)
        account?.let { param("authToken", it.token) }
    }.andReturn().also { assertEquals(200, it.response.status, it.response.contentAsString) }
    private fun state(result: MvcResult): JsonNode = result.response.contentAsString.split("\n\n").dropLast(1)
        .map { frame -> frame.lineSequence().filter { it.startsWith("data:") }.joinToString("\n") { it.removePrefix("data:") } }
        .filter { it.isNotBlank() }.map(mapper::readTree).last { it.path("type").asText() == "state_sync" }.path("payload")
    private fun drawingColor(result: MvcResult): String = state(result).path("drawingColor").asText().also {
        assertTrue(it.matches(Regex("#[0-9a-f]{6}")), "Expected a server-assigned HEX drawingColor, got '$it'")
    }
}

@SpringBootTest(properties = ["app.features.room-whiteboard-enabled=false", "app.features.room-diagrams-enabled=false"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomDrawingColorDisabledIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_drawing_color_off")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `disabled canvases leave own and roster colors unset without reserving a color`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "color-off-${UUID.randomUUID()}", ownerSessionToken = "owner", interviewerSessionToken = "interviewer"))
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", "off"); param("participantId", "off"); param("displayName", "Off")
        }.andReturn()
        assertEquals(200, result.response.status)
        val state = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        assertTrue(state.path("drawingColor").isNull)
        assertTrue(state.path("participants").single().path("drawingColor").isNull)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_drawing_colors WHERE room_id=?", Int::class.java, room.id))
    }
}
