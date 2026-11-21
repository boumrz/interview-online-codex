package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
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
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomWhiteboardIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_whiteboard")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `empty board has a stable independent identity and live edit authority`() {
        postgres.verifyPostgres16()
        val room = room()
        val first = get(room)
        assertEquals(200, first.response.status)
        assertEquals(body(first).path("boardId"), body(get(room)).path("boardId"))
        assertEquals(0L, body(first).path("sequence").asLong())
        assertTrue(body(first).path("elements").isEmpty)
        assertFalse(body(first).path("canEdit").asBoolean())
        assertTrue(body(get(room, stream(room))).path("canEdit").asBoolean())
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboards WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `pen points and pressure are durable before changed notification and independent from diagram`() {
        val room = room(); val candidate = stream(room); val observer = stream(room, true)
        val id = boardId(room)
        val result = change(room, candidate, id, listOf(stroke("pen-a")))
        assertEquals(200, result.response.status, result.response.contentAsString)
        assertEquals(1L, body(result).path("sequence").asLong())
        val saved = body(get(room))
        assertEquals(1L, saved.path("sequence").asLong())
        assertEquals(mapper.valueToTree<JsonNode>(stroke("pen-a")), saved.path("elements")[0])
        val event = messages(observer.result).last { it.path("type").asText() == "whiteboard_changed" }
        assertEquals(id, event.path("payload").path("boardId").asText())
        assertEquals(1L, event.path("payload").path("sequence").asLong())
        assertEquals(1L, jdbc.queryForObject("SELECT sequence FROM room_whiteboards WHERE room_id=?", Long::class.java, room.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagrams WHERE room_id=?", Int::class.java, room.id))
        assertEquals("original-code", jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
    }

    @Test fun `whiteboard activity records actual candidate scene edits once and excludes receipts metadata and tombstones`() {
        val room = room()
        val candidate = stream(room)
        val owner = stream(room, true)
        val id = boardId(room)
        val original = stroke("private-id")
        val op = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, id, listOf(original), operationId = op).response.status)
        assertEquals(200, change(room, candidate, id, listOf(original), operationId = op).response.status)
        assertEquals(409, change(room, candidate, id, listOf(stroke("other")), operationId = op).response.status)
        assertEquals(200, change(room, candidate, id, listOf(original + mapOf("version" to 2, "updated" to 222))).response.status)
        assertEquals(200, change(room, candidate, id, listOf(original)).response.status)
        assertEquals(200, change(room, candidate, id, listOf(stroke("never-visible", deleted = true))).response.status)
        assertEquals(200, change(room, candidate, id, listOf(stroke("private-id", version = 3, deleted = true))).response.status)
        assertEquals(200, change(room, owner, id, listOf(stroke("manager"))).response.status)
        val recorded = messages(owner.result).filter { it.path("type").asText() == "candidate_key" }.map { it.path("payload") }
        assertEquals(listOf("whiteboard_edit", "whiteboard_edit"), recorded.map { it.path("eventKind").asText() })
        assertEquals(listOf(1, 2), recorded.map { it.path("acceptedSequence").asInt() })
        assertTrue(recorded.all { it.path("sessionId").asText() == candidate.sessionId && it.path("key").asText() == "" && !it.toString().contains("private-id") })
        assertTrue(messages(candidate.result).none { it.path("type").asText() == "candidate_key" })
    }

    @Test fun `a long freehand gesture logs once across intermediate saves without hiding another candidate or later edits`() {
        val room = room()
        val first = stream(room)
        val second = stream(room)
        val observer = stream(room, true)
        val id = boardId(room)
        fun path(version: Int, points: Int, finished: Boolean = false) = stroke("long", version) + mapOf(
            "points" to (0 until points).map { listOf(it, it) }, "pressures" to List(points) { 0.5 },
            "lastCommittedPoint" to if (finished) listOf(points - 1, points - 1) else null,
            "width" to points - 1, "height" to points - 1,
        )
        fun save(actor: Connection, element: Map<String, Any?>) {
            val result = change(room, actor, id, listOf(element))
            assertEquals(200, result.response.status, result.response.contentAsString)
        }
        fun authors() = messages(observer.result).filter { it.path("type").asText() == "candidate_key" }
            .map { it.path("payload").path("sessionId").asText() }

        save(first, path(1, 2))
        save(first, path(2, 4))
        save(second, stroke("their-stroke")) // Interleaved second candidate must retain their own gesture.
        save(first, path(3, 8))
        save(first, path(4, 9, finished = true))
        assertEquals(listOf(first.sessionId, second.sessionId), authors())
        save(first, path(5, 10)) // Appending after a completed gesture is a new edit.
        save(first, path(6, 10) + ("x" to 42))
        save(first, path(7, 10) + ("isDeleted" to true))
        save(first, path(8, 10))
        save(first, stroke("another"))
        val beforeTakeover = authors().size
        save(second, stroke("another", version = 2) + mapOf(
            "points" to listOf(listOf(0, 0), listOf(2, 3), listOf(5, 1), listOf(6, 5)),
            "pressures" to listOf(0.2, 0.7, 0.4, 0.5)))
        assertEquals(7, beforeTakeover)
        assertEquals(beforeTakeover + 1, authors().size)
        assertEquals(second.sessionId, authors().last())
        save(first, stroke("new-pen"))
        save(first, stroke("new-pen", version = 2) + ("strokeColor" to "#eeeeee"))
        val reconnected = stream(room, sessionId = first.sessionId)
        save(reconnected, stroke("new-pen", version = 3) + mapOf(
            "strokeColor" to "#eeeeee", "points" to listOf(listOf(0, 0), listOf(2, 3), listOf(5, 1), listOf(6, 5)),
            "pressures" to listOf(0.2, 0.7, 0.4, 0.5)))
        assertEquals(11, authors().size)
        assertEquals(14, body(get(room)).path("sequence").asInt())
    }

    @Test fun `a failed journal insert rolls back the scene and receipt and allows the same operation to succeed`() {
        val room = room()
        val candidate = stream(room)
        val owner = stream(room, true)
        val id = boardId(room)
        val operation = UUID.randomUUID().toString()
        val constraint = "canvas_log_failure_" + UUID.randomUUID().toString().replace("-", "")
        jdbc.execute("ALTER TABLE room_keystroke_events ADD CONSTRAINT $constraint CHECK (room_id <> '${room.id}')")
        try {
            val failed = runCatching { change(room, candidate, id, listOf(stroke("stroke")), operationId = operation) }
            assertTrue(failed.isFailure || failed.getOrThrow().response.status >= 400)
            assertEquals(0, body(get(room)).path("sequence").asInt())
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
            assertTrue(messages(owner.result).none { it.path("type").asText() in setOf("candidate_key", "whiteboard_changed") })
        } finally {
            jdbc.execute("ALTER TABLE room_keystroke_events DROP CONSTRAINT $constraint")
        }
        assertEquals(200, change(room, candidate, id, listOf(stroke("stroke")), operationId = operation).response.status)
        assertEquals(1, body(get(room)).path("sequence").asInt())
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM room_keystroke_events WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `concurrent different strokes merge even from the same old base`() {
        val room = room(); val a = stream(room); val b = stream(room); val id = boardId(room)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val statuses = executor.invokeAll(listOf(a to "a", b to "b").map { (connection, label) -> Callable {
                change(room, connection, id, listOf(stroke(label))).response.status
            }}).map { it.get() }
            assertEquals(listOf(200, 200), statuses)
            assertEquals(setOf("a", "b"), body(get(room)).path("elements").map { it.path("id").asText() }.toSet())
            assertEquals(2L, body(get(room)).path("sequence").asLong())
            assertEquals(setOf(a.sessionId, b.sessionId), jdbc.queryForList(
                "SELECT session_id FROM room_keystroke_events WHERE room_id=? AND event_kind='whiteboard_edit'",
                String::class.java, room.id).toSet())
        } finally { executor.shutdownNow() }
    }

    @Test fun `native version and lower nonce win deterministically and old state cannot resurrect tombstones`() {
        val room = room(); val candidate = stream(room); val id = boardId(room)
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 2, nonce = 50))).response.status)
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 2, nonce = 70, x = 70))).response.status)
        assertEquals(1L, body(get(room)).path("sequence").asLong())
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 2, nonce = 20, x = 20))).response.status)
        assertEquals(20, body(get(room)).path("elements")[0].path("x").asInt())
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 3, deleted = true))).response.status)
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 2, nonce = 1))).response.status)
        assertTrue(body(get(room)).path("elements")[0].path("isDeleted").asBoolean())
        assertEquals(3L, body(get(room)).path("sequence").asLong())
        assertEquals(200, change(room, candidate, id, listOf(stroke("a", version = 4))).response.status)
        assertFalse(body(get(room)).path("elements")[0].path("isDeleted").asBoolean(), "newer explicit undo may revive an element")
    }

    @Test fun `same operation retries are idempotent and conflicting reuse is rejected`() {
        val room = room(); val candidate = stream(room); val id = boardId(room); val op = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, id, listOf(stroke("a")), operationId = op).response.status)
        assertEquals(200, change(room, candidate, id, listOf(stroke("b"))).response.status)
        assertEquals(1L, body(change(room, candidate, id, listOf(stroke("a")), operationId = op)).path("sequence").asLong())
        assertEquals(409, change(room, candidate, id, listOf(stroke("different")), operationId = op).response.status)
        assertEquals(409, change(room, candidate, id, listOf(stroke("a")), base = 1, operationId = op).response.status)
        assertEquals(2L, body(get(room)).path("sequence").asLong())
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `future base wrong board and another room capability are rejected`() {
        val room = room(); val other = room(); val candidate = stream(room); val id = boardId(room)
        assertEquals(409, change(room, candidate, id, listOf(stroke("a")), base = 1).response.status)
        assertEquals(409, change(room, candidate, boardId(other), listOf(stroke("a"))).response.status)
        assertEquals(403, change(other, candidate, boardId(other), listOf(stroke("a"))).response.status)
        assertEquals(403, change(room, candidate.copy(eventToken = "forged"), id, listOf(stroke("a"))).response.status)
        assertEquals(403, change(room, candidate.copy(sessionId = "forged"), id, listOf(stroke("a"))).response.status)
        assertEquals(0L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `renewed stream rejects old proof and does not consume a pending operation`() {
        val room = room(); val original = stream(room); val id = boardId(room)
        val replacement = stream(room, sessionId = original.sessionId)
        assertNotEquals(original.eventToken, replacement.eventToken)
        val operation = UUID.randomUUID().toString()
        val staleWrite = change(room, original, id, listOf(stroke("pending")), operationId = operation)
        assertEquals(403, staleWrite.response.status)
        assertEquals("ROOM_EVENT_CAPABILITY_STALE", body(staleWrite).path("code").asText())
        val staleRead = get(room, original)
        assertEquals(403, staleRead.response.status)
        assertEquals("ROOM_EVENT_CAPABILITY_STALE", body(staleRead).path("code").asText())
        assertEquals(200, change(room, replacement, id, listOf(stroke("pending")), operationId = operation).response.status)
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `absent connection and missing blank or mismatched proof are classified as stale without consuming writes`() {
        val room = room(); val connection = stream(room); val id = boardId(room)
        val staleConnections = listOf(connection.copy(sessionId = "not-connected"), connection.copy(eventToken = ""), connection.copy(eventToken = "wrong"))
        staleConnections.forEach { stale ->
            listOf(get(room, stale), change(room, stale, id, listOf(stroke("pending")))).forEach { result ->
                assertEquals(403, result.response.status)
                assertEquals("ROOM_EVENT_CAPABILITY_STALE", body(result).path("code").asText())
            }
        }
        listOf(get(room, connection, sendToken = false), change(room, connection, id, listOf(stroke("pending")), sendToken = false)).forEach { result ->
            assertEquals(403, result.response.status)
            assertEquals("ROOM_EVENT_CAPABILITY_STALE", body(result).path("code").asText())
        }
        assertEquals(0L, body(get(room)).path("sequence").asLong())
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `stale authority is checked before receipts while a different authenticated context remains a genuine denial`() {
        val room = room(); val original = stream(room); val id = boardId(room); val operation = UUID.randomUUID().toString()
        assertEquals(200, change(room, original, id, listOf(stroke("accepted")), operationId = operation).response.status)
        val replacement = stream(room, sessionId = original.sessionId)
        val deniedReplay = change(room, original, id, listOf(stroke("accepted")), operationId = operation)
        assertEquals(403, deniedReplay.response.status)
        assertEquals("ROOM_EVENT_CAPABILITY_STALE", body(deniedReplay).path("code").asText())
        assertEquals(1L, body(change(room, replacement, id, listOf(stroke("accepted")), operationId = operation)).path("sequence").asLong())
        val account = HrHttpFixtures.register(mvc, mapper, false, "board-context-a").first
        val other = HrHttpFixtures.register(mvc, mapper, false, "board-context-b").first
        val authenticated = stream(room, account = account)
        listOf(get(room, authenticated, authToken = other.token), change(room, authenticated, id, listOf(stroke("denied")), authToken = other.token)).forEach { result ->
            assertEquals(403, result.response.status)
            assertEquals("ROOM_ACCESS_DENIED", body(result).path("code").asText())
        }
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `finished candidate cannot replay accepted operation but current manager may edit`() {
        val room = room(); val owner = stream(room, true); val candidate = stream(room); val id = boardId(room)
        val op = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, id, listOf(stroke("a")), operationId = op).response.status)
        jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(403, change(room, candidate, id, listOf(stroke("a")), operationId = op).response.status)
        assertFalse(body(get(room, candidate)).path("canEdit").asBoolean())
        assertTrue(body(get(room, owner)).path("canEdit").asBoolean())
        assertEquals(200, change(room, owner, id, listOf(stroke("manager")), base = 1).response.status)
        assertEquals("finished", jdbc.queryForObject("SELECT status FROM rooms WHERE id=?", String::class.java, room.id))
    }

    @Test fun `fresh revoked interviewer authority cannot write through an older stream`() {
        val room = room(); val account = HrHttpFixtures.register(mvc, mapper, false, "board-interviewer").first
        jdbc.update("INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'interviewer',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), room.id, account.id)
        val connection = stream(room, account = account); val id = boardId(room)
        jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(200, change(room, connection, id, listOf(stroke("accepted"))).response.status)
        jdbc.update("UPDATE room_participants SET role='candidate' WHERE room_id=? AND user_id=?", room.id, account.id)
        val denied = change(room, connection, id, listOf(stroke("denied")))
        assertEquals(403, denied.response.status)
        assertEquals("ROOM_READ_ONLY", body(denied).path("code").asText(), "actual role revocation must not be retried as a stale lease")
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `frozen and archived rooms reject writes regardless of visible controls`() {
        val room = room(); val owner = stream(room, true); val id = boardId(room)
        jdbc.update("UPDATE rooms SET status='frozen' WHERE id=?", room.id)
        assertEquals(409, change(room, owner, id, listOf(stroke("a"))).response.status)
        assertFalse(body(get(room, owner)).path("canEdit").asBoolean())
        jdbc.update("UPDATE rooms SET archived_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
        assertEquals(410, change(room, owner, id, listOf(stroke("a"))).response.status)
        assertEquals(410, get(room).response.status)
    }

    @Test fun `malformed native elements and embedded private or external content never alter a saved board`() {
        val room = room(); val candidate = stream(room); val id = boardId(room)
        assertEquals(200, change(room, candidate, id, listOf(stroke("safe"))).response.status)
        val invalid = listOf(
            stroke("dup") to listOf(stroke("dup")),
            stroke("") to emptyList(), stroke("__proto__") to emptyList(),
            (stroke("a") + ("version" to 0)) to emptyList(),
            (stroke("a") + ("versionNonce" to -1)) to emptyList(),
            (stroke("a") + ("x" to "NaN")) to emptyList(),
            (stroke("a") + ("type" to "image")) to emptyList(),
            (stroke("a") + ("link" to "https://outside.invalid/private")) to emptyList(),
            (stroke("a") + ("customData" to mapOf("token" to "private"))) to emptyList(),
            (stroke("a") + ("appState" to mapOf("selectedElementIds" to mapOf("a" to true)))) to emptyList(),
            (stroke("a") + ("pressures" to listOf(0.1, 2.0, 0.3))) to emptyList(),
            (stroke("a") + ("pressures" to listOf(0.1))) to emptyList(),
            (stroke("a") + ("points" to listOf(listOf(1, 2, 3)))) to emptyList(),
        )
        invalid.forEach { (element, extra) ->
            val response = change(room, candidate, id, listOf(element) + extra, base = 1)
            assertEquals(400, response.response.status, element.toString())
        }
        assertEquals(1L, body(get(room)).path("sequence").asLong())
        assertEquals("safe", body(get(room)).path("elements")[0].path("id").asText())
    }

    @Test fun `oversized operation and scene are rejected without truncating accepted strokes`() {
        val room = room(); val candidate = stream(room); val id = boardId(room)
        assertEquals(200, change(room, candidate, id, listOf(stroke("safe"))).response.status)
        assertEquals(400, change(room, candidate, id, listOf(stroke("large") + ("points" to List(20_001) { listOf(0, 0) }))).response.status)
        assertEquals(400, change(room, candidate, id, listOf(stroke("text") + mapOf("type" to "text", "text" to "x".repeat(512_001)))).response.status)
        assertEquals(400, change(room, candidate, id, (1..5001).map { stroke("element-$it") }).response.status)
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `native text accepts only shipped browser font families`() {
        val room = room(); val connection = stream(room); val id = boardId(room)
        fun text(font: Int) = rectangle("font-$font") + mapOf("type" to "text", "text" to "Пример", "originalText" to "Пример",
            "fontSize" to 24, "fontFamily" to font, "textAlign" to "left", "verticalAlign" to "top", "autoResize" to true, "lineHeight" to 1.25)
        val supported = setOf(1, 2, 3, 5, 6, 7, 8)
        supported.forEach { font -> assertEquals(200, change(room, connection, id, listOf(text(font))).response.status, "supported font $font") }
        listOf(4, 9, 100).forEach { font ->
            val rejected = change(room, connection, id, listOf(text(font)))
            assertEquals(400, rejected.response.status, "unshipped font $font")
            assertEquals("WHITEBOARD_INVALID_DOCUMENT", body(rejected).path("code").asText())
        }
        val saved = body(get(room))
        assertEquals(supported, saved.path("elements").map { it.path("fontFamily").asInt() }.toSet())
        assertEquals(7L, saved.path("sequence").asLong())
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `whiteboard mode shares confirmation revision and preserves documents and taskless rooms`() {
        val room = room(); val owner = stream(room, true); val candidate = stream(room)
        val id = boardId(room)
        assertEquals(200, change(room, candidate, id, listOf(stroke("a"))).response.status)
        assertEquals(204, mode(room, owner, "whiteboard", 0).response.status)
        assertEquals("whiteboard", state(candidate.result).path("roomEditorMode").asText())
        assertTrue(state(candidate.result).path("roomWhiteboardEnabled").asBoolean())
        assertEquals(403, mode(room, candidate, "code", 1).response.status)
        assertEquals(409, mode(room, owner, "code", 0).response.status)
        assertEquals(204, mode(room, owner, "diagram", 1).response.status)
        assertEquals(204, mode(room, owner, "markdown", 2).response.status)
        assertEquals(204, mode(room, owner, "whiteboard", 3).response.status)
        assertEquals("whiteboard", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals("original-code", jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals(id, boardId(room))
        assertEquals(1L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `merged scene enforces element cap across individually valid operations`() {
        val room = room(); val connection = stream(room); val id = boardId(room)
        repeat(10) { batch ->
            val elements = (0 until 500).map { rectangle("r-${batch * 500 + it}") }
            assertEquals(200, change(room, connection, id, elements).response.status)
        }
        assertEquals(400, change(room, connection, id, listOf(rectangle("overflow"))).response.status)
        val saved = body(get(room))
        assertEquals(5_000, saved.path("elements").size())
        assertEquals(10L, saved.path("sequence").asLong())
        assertEquals(10, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `merged scene point budget rejects another valid stroke without changing prior strokes`() {
        val room = room(); val connection = stream(room); val id = boardId(room)
        val points = List(20_000) { listOf(0, 0) }
        repeat(5) { n ->
            assertEquals(200, change(room, connection, id, listOf(stroke("s-$n") + mapOf("points" to points, "pressures" to emptyList<Double>(), "simulatePressure" to true))).response.status)
        }
        assertEquals(400, change(room, connection, id, listOf(stroke("overflow"))).response.status)
        assertEquals(5, body(get(room)).path("elements").size())
        assertEquals(5L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `merged scene byte budget rejects additional text atomically`() {
        val room = room(); val connection = stream(room); val id = boardId(room)
        val content = "x".repeat(50_000)
        fun text(id: String) = rectangle(id) + mapOf("type" to "text", "text" to content, "originalText" to content,
            "fontSize" to 24, "fontFamily" to 5, "textAlign" to "left", "verticalAlign" to "top", "autoResize" to true, "lineHeight" to 1.25)
        repeat(19) { assertEquals(200, change(room, connection, id, listOf(text("t-$it"))).response.status) }
        assertEquals(400, change(room, connection, id, listOf(text("overflow"))).response.status)
        assertEquals(19, body(get(room)).path("elements").size())
        assertEquals(19L, body(get(room)).path("sequence").asLong())
    }

    @Test fun `room deletion cascades board and durable receipts`() {
        val room = room(); val connection = stream(room)
        assertEquals(200, change(room, connection, boardId(room), listOf(stroke("a"))).response.status)
        rooms.deleteById(room.id!!)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboards WHERE room_id=?", Int::class.java, room.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `task boards isolate snapshots receipts and permissions across publication and removal`() {
        val room = room()
        val currentTask = addTask(room, 0)
        val draftTask = addTask(room, 1)
        val candidate = stream(room)
        val manager = stream(room, true)
        val first = body(get(room, manager, taskId = currentTask)).path("boardId").asText()
        val second = body(get(room, manager, taskId = draftTask)).path("boardId").asText()
        assertNotEquals(first, second)
        assertEquals(first, boardId(room), "unscoped clients follow the published task")
        assertEquals(404, get(room, candidate, taskId = draftTask).response.status)
        assertEquals(404, get(room, manager, taskId = "").response.status)
        assertEquals(404, get(room, manager, taskId = addTask(room(), 0)).response.status)

        val operation = UUID.randomUUID().toString()
        assertEquals(200, change(room, candidate, first, listOf(stroke("a")), operationId = operation, taskId = currentTask).response.status)
        assertEquals(404, change(room, candidate, second, listOf(stroke("x")), taskId = draftTask).response.status)
        assertEquals(204, mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to manager.sessionId, "eventToken" to manager.eventToken,
                "type" to "manager_workspace_open", "stepIndex" to 1))
        }.andReturn().response.status)
        assertEquals(200, change(room, manager, second, listOf(stroke("b")), operationId = operation, taskId = draftTask).response.status)
        val event = messages(manager.result).last { it.path("type").asText() == "whiteboard_changed" }
        assertEquals(draftTask, event.path("payload").path("taskId").asText())
        assertEquals(second, event.path("payload").path("boardId").asText())
        assertFalse(messages(candidate.result).any { it.path("type").asText() == "whiteboard_changed" && it.path("payload").path("boardId").asText() == second })
        assertEquals("a", body(get(room)).path("elements").single().path("id").asText())
        jdbc.update("UPDATE rooms SET current_step=1 WHERE id=?", room.id)
        assertEquals("b", body(get(room, candidate)).path("elements").single().path("id").asText())
        assertEquals(409, change(room, candidate, first, listOf(stroke("late"))).response.status)
        assertEquals(404, change(room, candidate, first, listOf(stroke("late")), taskId = currentTask).response.status)
        assertEquals(1, body(get(room, manager, taskId = currentTask)).path("sequence").asInt())
        jdbc.update("DELETE FROM room_tasks WHERE id=?", currentTask)
        jdbc.update("UPDATE room_tasks SET step_index=0 WHERE id=?", draftTask)
        jdbc.update("UPDATE rooms SET current_step=0 WHERE id=?", room.id)
        assertEquals(second, boardId(room))
        assertEquals(404, get(room, manager, taskId = currentTask).response.status)
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM room_whiteboard_operations WHERE room_id=?", Int::class.java, room.id))
    }

    @Test fun `candidate canvas reads wait for publication to commit before checking task visibility`() {
        val room = room()
        addTask(room, 0)
        val nextTask = addTask(room, 1)
        val candidate = stream(room)
        val readers = Executors.newFixedThreadPool(2)
        try {
            postgres.connection().use { publication ->
                publication.autoCommit = false
                val holderPid = publication.createStatement().use { statement ->
                    statement.executeQuery("SELECT pg_backend_pid()").use { it.next(); it.getInt(1) }
                }
                publication.prepareStatement("UPDATE rooms SET current_step=1 WHERE id=?").use { statement ->
                    statement.setString(1, room.id)
                    statement.executeUpdate()
                }
                // A client can receive the new step from SSE while the publishing
                // transaction still holds the room lock.
                val results = listOf("diagram", "whiteboard").map { canvas ->
                    readers.submit<MvcResult> {
                        mvc.get("/api/rooms/${room.inviteCode}/$canvas") {
                            param("taskId", nextTask)
                            param("sessionId", candidate.sessionId)
                            header("X-Room-Event-Token", candidate.eventToken)
                        }.andReturn()
                    }
                }
                await().atMost(5, TimeUnit.SECONDS).until {
                    jdbc.queryForObject("""
                        SELECT count(*) FROM pg_stat_activity
                        WHERE ? = ANY(pg_blocking_pids(pid))
                    """.trimIndent(), Int::class.java, holderPid) == results.size
                }
                publication.commit()
                results.forEach { result ->
                    val response = result.get(5, TimeUnit.SECONDS).response
                    assertEquals(200, response.status, response.contentAsString)
                }
            }
        } finally { readers.shutdownNow() }
    }

    private fun addTask(room: Room, stepIndex: Int): String {
        val id = UUID.randomUUID().toString()
        jdbc.update("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,language) VALUES (?,?,?,'Task','','','nodejs')",
            id, room.id, stepIndex)
        return id
    }

    private fun room(): Room = rooms.saveAndFlush(Room(title = "Whiteboard integration", inviteCode = "board-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}", code = "original-code"))
    private data class Connection(val sessionId: String, val eventToken: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean = false, account: HrTestAccount? = null, sessionId: String = "board-${UUID.randomUUID()}"): Connection {
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
            account?.let { param("authToken", it.token) }
        }.andReturn()
        assertEquals(200, result.response.status)
        return Connection(sessionId, state(result).path("eventToken").asText(), result)
    }
    private fun get(room: Room, connection: Connection? = null, sendToken: Boolean = true, authToken: String? = null, taskId: String? = null) = mvc.get("/api/rooms/${room.inviteCode}/whiteboard") {
        taskId?.let { param("taskId", it) }
        connection?.let { param("sessionId", it.sessionId); if (sendToken) header("X-Room-Event-Token", it.eventToken) }
        authToken?.let { header("Authorization", "Bearer $it") }
    }.andReturn()
    private fun boardId(room: Room) = body(get(room)).path("boardId").asText()
    private fun change(room: Room, connection: Connection, id: String, elements: List<Map<String, Any?>>, base: Long = 0, operationId: String = UUID.randomUUID().toString(), sendToken: Boolean = true, authToken: String? = null, taskId: String? = null) = mvc.post("/api/rooms/${room.inviteCode}/whiteboard/changes") {
        taskId?.let { param("taskId", it) }
        param("sessionId", connection.sessionId); if (sendToken) header("X-Room-Event-Token", connection.eventToken)
        authToken?.let { header("Authorization", "Bearer $it") }
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("boardId" to id, "operationId" to operationId, "baseSequence" to base, "elements" to elements))
    }.andReturn()
    private fun mode(room: Room, connection: Connection, mode: String, revision: Long) = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to connection.sessionId, "eventToken" to connection.eventToken, "type" to "room_editor_mode_update", "roomEditorMode" to mode, "expectedRoomEditorModeRevision" to revision))
    }.andReturn()
    private fun body(result: MvcResult): JsonNode = mapper.readTree(result.response.contentAsByteArray)
    private fun messages(result: MvcResult) = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }.toList()
    private fun state(result: MvcResult) = messages(result).last { it.path("type").asText() == "state_sync" }.path("payload")
    private fun rectangle(id: String): Map<String, Any?> = mapOf("id" to id, "type" to "rectangle", "version" to 1, "versionNonce" to 1,
        "x" to 0, "y" to 0, "width" to 1, "height" to 1, "angle" to 0, "isDeleted" to false)
    private fun stroke(id: String, version: Int = 1, nonce: Int = 50, deleted: Boolean = false, x: Int = 0): Map<String, Any?> = mapOf(
        "id" to id, "type" to "freedraw", "version" to version, "versionNonce" to nonce, "isDeleted" to deleted,
        "x" to x, "y" to 0, "width" to 10, "height" to 10, "angle" to 0, "strokeColor" to "#111111", "backgroundColor" to "transparent",
        "fillStyle" to "solid", "strokeWidth" to 2, "strokeStyle" to "solid", "roughness" to 0, "opacity" to 100,
        "groupIds" to emptyList<String>(), "frameId" to null, "roundness" to null, "seed" to 1, "updated" to 1,
        "link" to null, "locked" to false, "index" to "a0", "points" to listOf(listOf(0, 0), listOf(2, 3), listOf(5, 1)),
        "pressures" to listOf(0.2, 0.7, 0.4), "simulatePressure" to false, "lastCommittedPoint" to null,
    )
}

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomWhiteboardAvailabilityIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mapper: ObjectMapper,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_whiteboard_availability")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }
    @Test fun `whiteboard snapshot and mode are available without feature configuration`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "board-ready-${UUID.randomUUID()}", ownerSessionToken = "owner", interviewerSessionToken = "interviewer"))
        val snapshot = mvc.get("/api/rooms/${room.inviteCode}/whiteboard").andReturn().response
        assertEquals(200, snapshot.status)
        val boardId = mapper.readTree(snapshot.contentAsString).path("boardId").asText()
        val sessionId = UUID.randomUUID().toString()
        val connection = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { param("sessionId", sessionId); param("ownerToken", "owner") }.andReturn()
        val state = connection.response.contentAsString.lineSequence().filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        assertTrue(state.path("roomWhiteboardEnabled").asBoolean())
        assertEquals(204, mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to sessionId, "eventToken" to state.path("eventToken").asText(), "type" to "room_editor_mode_update", "roomEditorMode" to "whiteboard", "expectedRoomEditorModeRevision" to 0))
        }.andReturn().response.status)
        assertEquals(403, mvc.post("/api/rooms/${room.inviteCode}/whiteboard/changes") {
            param("sessionId", sessionId); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("boardId" to boardId, "operationId" to UUID.randomUUID().toString(),
                "baseSequence" to 0, "elements" to listOf(mapOf("id" to "attempted", "type" to "rectangle", "version" to 1,
                    "versionNonce" to 1, "x" to 0, "y" to 0, "width" to 1, "height" to 1, "angle" to 0, "isDeleted" to false))))
        }.andReturn().response.status)
    }
    @Test fun `saved whiteboard mode remains visible without feature configuration`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "board-ready-mode-${UUID.randomUUID()}", ownerSessionToken = "owner", interviewerSessionToken = "interviewer"))
        jdbc.update("UPDATE rooms SET room_editor_mode='whiteboard' WHERE id=?", room.id)
        val result = mvc.get("/api/rooms/${room.inviteCode}") { header("X-Room-Owner-Token", "owner") }.andReturn()
        assertEquals("whiteboard", mapper.readTree(result.response.contentAsString).path("roomEditorMode").asText())
        assertTrue(mapper.readTree(result.response.contentAsString).path("roomWhiteboardEnabled").asBoolean())
    }
}
