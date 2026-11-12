package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import java.util.Base64
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.zip.Deflater
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@SpringBootTest(properties = ["app.features.room-diagrams-enabled=true"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomDiagramIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_diagram")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
        private const val XML = "<mxfile><diagram id=\"room-diagram\" name=\"Архитектура\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"service-a\" value=\"API\" parent=\"1\" vertex=\"1\"><mxGeometry x=\"10\" y=\"20\" width=\"100\" height=\"40\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>"
    }

    @Test fun `public read has a stable taskless identity without creating durable records`() {
        postgres.verifyPostgres16()
        val room = room()
        val first = get(room)
        val second = get(room)
        assertEquals(200, first.response.status)
        assertEquals(body(first).path("diagramId"), body(second).path("diagramId"))
        assertEquals(0L, body(first).path("sequence").asLong())
        assertEquals("drawio", body(first).path("editor").asText())
        assertTrue(body(first).path("xml").asText().contains("<diagram id=\"room-diagram\""), "all clients start with the same native page identity")
        assertFalse(body(first).path("canEdit").asBoolean())
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagrams WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `accepted candidate changes commit snapshot and ordered operations before broadcast and survive new reads`() {
        val room = room(); val owner = stream(room, true); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val operation = UUID.randomUUID().toString()
        val response = change(room, candidate, id, operation, 0, XML)
        assertEquals(200, response.response.status, response.response.contentAsString)
        assertEquals(1L, body(response).path("sequence").asLong())
        assertEquals(XML, jdbc.queryForObject("SELECT xml FROM room_diagrams WHERE room_id=?", String::class.java, room.id))
        assertEquals(1L, body(get(room)).path("sequence").asLong())
        assertEquals(XML, body(get(room)).path("xml").asText())
        val incremental = body(get(room, after = 0))
        assertEquals(operation, incremental.path("operations")[0].path("operationId").asText())
        assertEquals(XML, incremental.path("operations")[0].path("xml").asText())
        val event = owner.result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "diagram_changed" }
        assertEquals(operation, event.path("payload").path("operationId").asText())
        assertEquals(1L, event.path("payload").path("sequence").asLong())
        assertEquals(id, body(get(room)).path("diagramId").asText())
    }

    @Test fun `concurrent stale snapshot cannot overwrite committed state and retry is idempotent`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val firstId = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, id, firstId, 0, XML).response.status)
        assertEquals(1L, body(change(room, candidate, id, firstId, 0, XML)).path("sequence").asLong())
        val stale = change(room, candidate, id, UUID.randomUUID().toString(), 0, XML.replace("API", "Stale"))
        assertEquals(409, stale.response.status)
        assertEquals("DIAGRAM_VERSION_CONFLICT", body(stale).path("code").asText())
        assertEquals(1L, body(stale).path("currentRevision").asLong())
        assertEquals(XML, body(get(room)).path("xml").asText())
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM room_diagram_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `same base racing writes have one durable winner`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results = pool.invokeAll(listOf("A", "B").map { label -> Callable {
                change(room, candidate, id, UUID.randomUUID().toString(), 0, XML.replace("API", label)).response.status
            }}).map { it.get() }.sorted()
            assertEquals(listOf(200, 409), results)
            assertEquals(1L, body(get(room)).path("sequence").asLong())
        } finally { pool.shutdownNow() }
    }

    @Test fun `older incremental readers fall back to durable snapshot while receipts remain idempotent`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val firstOperationId = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, id, firstOperationId, 0, XML).response.status)
        for (base in 1L..128L) {
            assertEquals(200, change(room, candidate, id, UUID.randomUUID().toString(), base, XML.replace("API", "API $base")).response.status)
        }
        val recovered = body(get(room, after = 0))
        assertTrue(recovered.path("requiresSnapshot").asBoolean())
        assertEquals(129L, recovered.path("sequence").asLong())
        assertTrue(recovered.path("operations").isEmpty)
        assertEquals(XML.replace("API", "API 128"), recovered.path("xml").asText())
        assertEquals(1, body(get(room, after = 128)).path("operations").size())
        assertEquals(1L, body(change(room, candidate, id, firstOperationId, 0, XML)).path("sequence").asLong())
        assertEquals(129L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `fresh role after revocation prevents a finished interviewer from replaying a write`() {
        val room = room()
        val interviewer = HrHttpFixtures.register(mvc, mapper, false, "diagram-int").first
        jdbc.update("INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'interviewer',CURRENT_TIMESTAMP)",
            UUID.randomUUID().toString(), room.id, interviewer.id)
        val connection = stream(room, false, interviewer)
        val id = body(get(room)).path("diagramId").asText()
        val operationId = UUID.randomUUID().toString()
        jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(200, change(room, connection, id, operationId, 0, XML).response.status)
        jdbc.update("UPDATE room_participants SET role='candidate' WHERE room_id=? AND user_id=?", room.id, interviewer.id)
        assertEquals(403, change(room, connection, id, operationId, 0, XML).response.status)
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `document and live session identities cannot cross room boundaries`() {
        val room = room(); val other = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val otherId = body(get(other)).path("diagramId").asText()
        assertEquals(409, change(room, candidate, otherId, UUID.randomUUID().toString(), 0, XML).response.status)
        assertEquals(403, change(other, candidate, id, UUID.randomUUID().toString(), 0, XML).response.status)
        val forged = candidate.copy(sessionId = "forged")
        assertEquals(403, change(room, forged, id, UUID.randomUUID().toString(), 0, XML).response.status)
    }

    @Test fun `finished candidate loses queued writes but manager keeps diagram editing`() {
        val room = room(); val owner = stream(room, true); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        assertEquals(200, change(room, candidate, id, UUID.randomUUID().toString(), 0, XML).response.status)
        jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        val denied = change(room, candidate, id, UUID.randomUUID().toString(), 1, XML.replace("API", "Candidate"))
        assertEquals(403, denied.response.status)
        assertEquals("ROOM_READ_ONLY", body(denied).path("code").asText())
        assertFalse(body(get(room, candidate)).path("canEdit").asBoolean())
        assertTrue(body(get(room, owner)).path("canEdit").asBoolean())
        assertEquals(200, change(room, owner, id, UUID.randomUUID().toString(), 1, XML.replace("API", "Manager")).response.status)
        assertEquals("finished", jdbc.queryForObject("SELECT status FROM rooms WHERE id=?", String::class.java, room.id))
    }

    @Test fun `frozen and archived block writes and archive blocks public reads`() {
        val room = room(); val owner = stream(room, true)
        val id = body(get(room)).path("diagramId").asText()
        jdbc.update("UPDATE rooms SET status='frozen' WHERE id=?", room.id)
        assertEquals(409, change(room, owner, id, UUID.randomUUID().toString(), 0, XML).response.status)
        assertFalse(body(get(room, owner)).path("canEdit").asBoolean())
        jdbc.update("UPDATE rooms SET archived_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(410, change(room, owner, id, UUID.randomUUID().toString(), 0, XML).response.status)
        assertEquals(410, get(room).response.status)
    }

    @Test fun `invalid XML and excessive payloads preserve prior document`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        assertEquals(200, change(room, candidate, id, UUID.randomUUID().toString(), 0, XML).response.status)
        listOf("not xml", "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><mxGraphModel>&e;</mxGraphModel>", "<html><script>alert(1)</script></html>",
            "<mxfile><diagram id=\"room-diagram\">compressed-base64</diagram></mxfile>", "<mxGraphModel/>", "x".repeat(2_000_001)).forEach { xml ->
            assertEquals(400, change(room, candidate, id, UUID.randomUUID().toString(), 1, xml).response.status)
        }
        assertEquals(XML, body(get(room)).path("xml").asText())
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `malformed native patches and inserted page payloads never enter the durable journal`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val invalidPatches = listOf(
            """{"i":[{"id":"evil","data":"compressed-page-data"}]}""",
            """{"r":["room-diagram"]}""",
            """{"u":["not a page map"]}""",
            """{"u":{"room-diagram":{"cells":{"i":"not an insert list"}}}}""",
            """{"u":{"room-diagram":{"cells":{"r":[{"id":"bad"}]}}}}""",
            """{"u":{"room-diagram":{"cells":{"u":{"service-a":{"geometry":{"x":10}}}}}}}""",
            """{"u":{"room-diagram":{"cells":{"u":{"service-a":{"xmlValue":"<!DOCTYPE x><object/>"}}}}}}""",
            """{"u":{"room-diagram":{"cells":{"i":[{"id":"missing-parent","style":"rounded=1;"}]}}}}""",
            """{"unexpected":{"nested":[1,2,3]}}""",
        ).map(mapper::readTree)
        invalidPatches.forEach { patch ->
            assertEquals(400, change(room, candidate, id, UUID.randomUUID().toString(), 0, XML, patch).response.status, mapper.writeValueAsString(patch))
        }
        assertEquals(0L, body(get(room)).path("sequence").asLong())
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagram_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `duplicate empty and reserved logical cell ids never become a baseline`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val duplicate = XML.replace("</root>", "<mxCell id=\"service-a\" value=\"Duplicate\" parent=\"1\" vertex=\"1\"/></root>")
        val wrappedDuplicate = XML.replace("</root>", "<UserObject id=\"service-a\" label=\"Duplicate\"><mxCell parent=\"1\" vertex=\"1\"/></UserObject></root>")
        val invalid = listOf(duplicate, wrappedDuplicate) + listOf("", " ", "__proto__", "prototype", "constructor").map { unsafe ->
            XML.replace("id=\"service-a\"", "id=\"$unsafe\"")
        }
        invalid.forEach { xml ->
            val result = change(room, candidate, id, UUID.randomUUID().toString(), 0, xml)
            assertEquals(400, result.response.status, "invalid cell identities must not be normalized independently by clients")
        }
        assertEquals(0L, body(get(room)).path("sequence").asLong())
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagram_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `native user object wrappers use their wrapper id and retain legitimate labels`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        listOf("UserObject", "object").forEachIndexed { index, wrapper ->
            val xml = XML.replace("<mxCell id=\"service-a\" value=\"API\"", "<$wrapper id=\"service-a\" label=\"API\"><mxCell")
                .replace("</mxCell>", "</mxCell></$wrapper>")
            val result = change(room, candidate, id, UUID.randomUUID().toString(), index.toLong(), xml)
            assertEquals(200, result.response.status, result.response.contentAsString)
            assertEquals(xml, body(get(room)).path("xml").asText())
        }
    }

    @Test fun `ordinary nested insert update delete patches and bounded native freehand stay editable`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val style = "shape=stencil(${stencil("<shape name=\"Freehand\" w=\"100\" h=\"100\"><foreground><path><move x=\"0\" y=\"0\"/><line x=\"50\" y=\"50\"/></path><stroke/></foreground></shape>")});strokeColor=#000000;"
        val xml = XML.replace("value=\"API\"", "value=\"API\" style=\"$style\"")
        val patch = mapOf("u" to mapOf("room-diagram" to mapOf("cells" to mapOf(
            "i" to listOf(mapOf("id" to "freehand-1", "parent" to "1", "vertex" to 1, "style" to style, "geometry" to "<mxGeometry x=\"10\" y=\"20\" width=\"50\" height=\"50\" as=\"geometry\"/>")),
            "u" to mapOf("service-a" to mapOf("parent" to "1", "previous" to "", "value" to "Renamed", "visible" to 1)),
            "r" to listOf("old-cell"),
        ))))
        val result = change(room, candidate, id, UUID.randomUUID().toString(), 0, xml, patch)
        assertEquals(200, result.response.status, result.response.contentAsString)
        assertEquals(xml, body(get(room)).path("xml").asText())
        assertEquals(mapper.valueToTree<JsonNode>(patch), body(get(room, after = 0)).path("operations")[0].path("patch"))
    }

    @Test fun `compressed stencil bombs and malformed stencil XML are rejected in snapshot and patches`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        listOf(stencil("<shape><foreground>" + " ".repeat(300_000) + "</foreground></shape>"),
            stencil("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><shape>&e;</shape>"),
            stencil("<html><script>alert(1)</script></html>"), "not-base64").forEach { encoded ->
            val style = "shape=stencil($encoded);strokeColor=#000000;"
            val xml = XML.replace("value=\"API\"", "value=\"API\" style=\"$style\"")
            assertEquals(400, change(room, candidate, id, UUID.randomUUID().toString(), 0, xml).response.status)
            val patch = mapOf("u" to mapOf("room-diagram" to mapOf("cells" to mapOf("u" to mapOf("service-a" to mapOf("style" to style))))))
            assertEquals(400, change(room, candidate, id, UUID.randomUUID().toString(), 0, XML, patch).response.status)
        }
        assertEquals(0L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `recovery byte budget falls back to one canonical snapshot before loading a large operation batch`() {
        val room = room(); val candidate = stream(room, false)
        val id = body(get(room)).path("diagramId").asText()
        val large = XML.replace("value=\"API\"", "value=\"${"A".repeat(1_400_000)}\"")
        for (base in 0L..2L) assertEquals(200, change(room, candidate, id, UUID.randomUUID().toString(), base, large).response.status)
        val result = get(room, after = 0)
        val recovered = body(result)
        assertTrue(recovered.path("requiresSnapshot").asBoolean())
        assertTrue(recovered.path("operations").isEmpty)
        assertEquals(large, recovered.path("xml").asText())
        assertTrue(result.response.contentAsByteArray.size < 2_000_000, "recovery returns one baseline, not three full documents")
        assertFalse(body(get(room, after = 2)).path("requiresSnapshot").asBoolean())
        assertEquals(1, body(get(room, after = 2)).path("operations").size())
    }

    @Test fun `diagram mode is shared durable and does not alter text`() {
        val room = room(); val owner = stream(room, true); val candidate = stream(room, false)
        val result = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to owner.sessionId, "eventToken" to owner.eventToken,
                "type" to "room_editor_mode_update", "roomEditorMode" to "diagram", "expectedRoomEditorModeRevision" to 0))
        }.andReturn()
        assertEquals(204, result.response.status, result.response.contentAsString)
        assertEquals("diagram", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals("original-code", jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals("diagram", state(candidate.result).path("roomEditorMode").asText())
        assertTrue(state(candidate.result).path("roomDiagramsEnabled").asBoolean())
    }

    @Test fun `deleting room removes its diagram and operations`() {
        val room = room(); val owner = stream(room, true)
        val id = body(get(room)).path("diagramId").asText()
        assertEquals(200, change(room, owner, id, UUID.randomUUID().toString(), 0, XML).response.status)
        rooms.deleteById(room.id!!)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagrams WHERE room_id=?", Int::class.java, room.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagram_operations WHERE room_id=?", Int::class.java, room.id))
    }

    private fun room(): Room = rooms.saveAndFlush(Room(title = "Diagram integration", inviteCode = "diagram-${UUID.randomUUID()}",
        ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}", code = "original-code"))
    private data class Connection(val sessionId: String, val eventToken: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean, account: HrTestAccount? = null): Connection {
        val sessionId = "diagram-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
            account?.let { param("authToken", it.token) }
        }.andReturn()
        assertEquals(200, result.response.status)
        return Connection(sessionId, state(result).path("eventToken").asText(), result)
    }
    private fun get(room: Room, connection: Connection? = null, after: Long? = null): MvcResult = mvc.get("/api/rooms/${room.inviteCode}/diagram") {
        connection?.let { param("sessionId", it.sessionId); header("X-Room-Event-Token", it.eventToken) }
        after?.let { param("afterSequence", it.toString()) }
    }.andReturn()
    private fun change(room: Room, connection: Connection, id: String, operationId: String, base: Long, xml: String,
        patch: Any? = mapOf("u" to mapOf("room-diagram" to mapOf("name" to "Diagram")))): MvcResult = mvc.post("/api/rooms/${room.inviteCode}/diagram/changes") {
        param("sessionId", connection.sessionId); header("X-Room-Event-Token", connection.eventToken)
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("diagramId" to id, "operationId" to operationId, "baseSequence" to base, "xml" to xml,
            "patch" to patch))
    }.andReturn()
    private fun stencil(xml: String): String {
        val input = URLEncoder.encode(xml, StandardCharsets.UTF_8).replace("+", "%20").toByteArray(StandardCharsets.UTF_8)
        val deflater = Deflater(Deflater.DEFAULT_COMPRESSION, true)
        return try {
            deflater.setInput(input); deflater.finish()
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            while (!deflater.finished()) output.write(buffer, 0, deflater.deflate(buffer))
            Base64.getEncoder().encodeToString(output.toByteArray())
        } finally { deflater.end() }
    }
    private fun body(result: MvcResult): JsonNode = mapper.readTree(result.response.contentAsByteArray)
    private fun state(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomDiagramDisabledIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mapper: ObjectMapper,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_diagram_disabled")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }
    @Test fun `diagram API remains unavailable by default`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "diagram-disabled-${UUID.randomUUID()}", ownerSessionToken = "owner", interviewerSessionToken = "interviewer"))
        assertEquals(404, mvc.get("/api/rooms/${room.inviteCode}/diagram").andReturn().response.status)
        assertEquals(404, mvc.post("/api/rooms/${room.inviteCode}/diagram/changes") {
            param("sessionId", "none"); contentType = MediaType.APPLICATION_JSON
            content = """{"diagramId":"${UUID.randomUUID()}","operationId":"${UUID.randomUUID()}","baseSequence":0,"xml":"<mxGraphModel/>"}"""
        }.andReturn().response.status)
    }

    @Test fun `disabling diagrams leaves existing rooms usable and prevents mode bypass`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "diagram-disabled-mode-${UUID.randomUUID()}", ownerSessionToken = "owner", interviewerSessionToken = "interviewer"))
        jdbc.update("UPDATE rooms SET room_editor_mode='diagram' WHERE id=?", room.id)
        val roomResponse = mvc.get("/api/rooms/${room.inviteCode}") { header("X-Room-Owner-Token", "owner") }.andReturn()
        assertEquals("code", mapper.readTree(roomResponse.response.contentAsString).path("roomEditorMode").asText())
        val sessionId = UUID.randomUUID().toString()
        val connection = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("ownerToken", "owner")
        }.andReturn()
        val state = connection.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        assertEquals("code", state.path("roomEditorMode").asText())
        assertFalse(state.path("roomDiagramsEnabled").asBoolean())
        assertEquals(404, mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to sessionId, "eventToken" to state.path("eventToken").asText(),
                "type" to "room_editor_mode_update", "roomEditorMode" to "diagram", "expectedRoomEditorModeRevision" to 0))
        }.andReturn().response.status)
    }
}
