package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
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

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomEditorModeIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val dataSource: javax.sql.DataSource,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_mode")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `confirmed mode is shared durable and independent of task publication`() {
        postgres.verifyPostgres16()
        val room = fixture()
        val owner = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        assertEquals("code", payload(owner.result).path("roomEditorMode").asText())
        assertEquals(204, event(room, owner, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "markdown", "expectedRoomEditorModeRevision" to 0)).response.status)
        assertEquals("markdown", payload(candidate.result).path("roomEditorMode").asText())
        assertEquals(204, event(room, owner, mapOf("type" to "set_step", "stepIndex" to 1)).response.status)
        assertEquals("markdown", payload(owner.result).path("roomEditorMode").asText())
        assertEquals("markdown", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals("markdown", payload(stream(room, owner = false).result).path("roomEditorMode").asText())
        assertEquals("Task 1 briefing", payload(owner.result).path("briefingMarkdown").asText())
    }
    @Test fun `candidate cannot change room mode`() {
        val room = fixture(); val candidate = stream(room, owner = false)
        assertEquals(403, event(room, candidate, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "markdown", "expectedRoomEditorModeRevision" to 0)).response.status)
    }
    @Test fun `stale confirmation cannot overwrite a newer decision`() {
        val room = fixture(); val owner = stream(room, owner = true)
        assertEquals(204, event(room, owner, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "markdown", "expectedRoomEditorModeRevision" to 0)).response.status)
        assertEquals(409, event(room, owner, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "code", "expectedRoomEditorModeRevision" to 0)).response.status)
        assertEquals("markdown", payload(owner.result).path("roomEditorMode").asText())
    }
    @Test fun `invalid mode or missing revision cannot change room`() {
        val room = fixture(); val owner = stream(room, owner = true)
        assertEquals(400, event(room, owner, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "invalid", "expectedRoomEditorModeRevision" to 0)).response.status)
        assertEquals(400, event(room, owner, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to "markdown")).response.status)
    }

    @Test fun `a revoked interviewer cannot use an admitted stream to change the mode`() {
        val room = fixture()
        val interviewer = HrHttpFixtures.register(mvc, mapper, false, "mode-int").first
        jdbc.update("INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'interviewer',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), room.id, interviewer.id)
        val connection = stream(room, owner = false, account = interviewer)
        assertEquals(204, mode(room, connection, "markdown", 0).response.status)
        jdbc.update("UPDATE room_participants SET role='candidate' WHERE room_id=? AND user_id=?", room.id, interviewer.id)
        val revoked = mode(room, connection, "code", 1)
        assertEquals(403, revoked.response.status, revoked.response.contentAsString)
        assertEquals("markdown", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals(1L, jdbc.queryForObject("SELECT room_editor_mode_revision FROM rooms WHERE id=?", Long::class.java, room.id))
    }

    @Test fun `finished rooms allow a manager decision while candidates remain read only`() {
        val room = fixture()
        val owner = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        assertEquals(200, mvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("X-Room-Owner-Token", room.ownerSessionToken); contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE"}"""
        }.andReturn().response.status)
        val resultBefore = jdbc.queryForMap("SELECT status,verdict,finished_at FROM rooms WHERE id=?", room.id)
        val denied = mode(room, candidate, "markdown", 0)
        assertEquals(403, denied.response.status, denied.response.contentAsString)
        assertEquals("ROOM_READ_ONLY", mapper.readTree(denied.response.contentAsString).path("code").asText())
        assertEquals(204, mode(room, owner, "markdown", 0).response.status)
        assertEquals(resultBefore, jdbc.queryForMap("SELECT status,verdict,finished_at FROM rooms WHERE id=?", room.id))
        assertEquals("markdown", payload(candidate.result).path("roomEditorMode").asText())
        assertEquals(1L, payload(candidate.result).path("roomEditorModeRevision").asLong())
    }

    @Test fun `frozen and archived rooms reject mode changes without a revision or broadcast`() {
        listOf("frozen" to 409, "archived" to 410).forEach { (state, status) ->
            val room = fixture()
            val owner = stream(room, owner = true)
            if (state == "frozen") jdbc.update("UPDATE rooms SET status='frozen' WHERE id=?", room.id)
            else jdbc.update("UPDATE rooms SET archived_at=CURRENT_TIMESTAMP WHERE id=?", room.id)
            val before = owner.result.response.contentAsString
            val result = mode(room, owner, "markdown", 0)
            assertEquals(status, result.response.status, result.response.contentAsString)
            assertEquals("code", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
            assertEquals(0L, jdbc.queryForObject("SELECT room_editor_mode_revision FROM rooms WHERE id=?", Long::class.java, room.id))
            assertEquals(before, owner.result.response.contentAsString, "a rejected event cannot publish a mode change")
        }
    }

    @Test fun `two simultaneous manager decisions accept exactly one revision`() {
        val room = fixture()
        val first = stream(room, owner = true)
        val second = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        val ready = java.util.concurrent.CountDownLatch(2)
        val start = java.util.concurrent.CountDownLatch(1)
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val responses = listOf(first, second).map { connection -> executor.submit<MvcResult> {
                ready.countDown(); start.await(5, java.util.concurrent.TimeUnit.SECONDS)
                mode(room, connection, "markdown", 0)
            } }
            assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS))
            start.countDown()
            val statuses = responses.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status }
            assertEquals(1, statuses.count { it == 204 })
            assertEquals(1, statuses.count { it == 409 })
            assertEquals("markdown", payload(candidate.result).path("roomEditorMode").asText())
            assertEquals(1L, payload(candidate.result).path("roomEditorModeRevision").asLong())
            assertEquals(1L, jdbc.queryForObject("SELECT room_editor_mode_revision FROM rooms WHERE id=?", Long::class.java, room.id))
        } finally { executor.shutdownNow() }
    }

    @Test fun `mode changes and task publication preserve manager documents and task metadata`() {
        val room = fixture()
        val document = "AQHSCQAEAQlyb29tLWNvZGUXY29uc3QgYWNrbm93bGVkZ2VkID0gMTsA"
        val code = "const acknowledged = 1;"
        val briefing = "<!--briefing:focus=on-->\nTask 0 briefing"
        jdbc.update("UPDATE rooms SET code=?,briefing_markdown=? WHERE id=?", code, briefing, room.id)
        jdbc.update("UPDATE room_tasks SET solution_code=?,workspace_yjs_document_base64=?,workspace_yjs_sequence=1,workspace_revision=7,workspace_focus_mode=true,briefing_markdown=? WHERE id=?", code, document, briefing, room.tasks.first().id)
        fun tasks() = jdbc.queryForList("SELECT id,title,description,starter_code,solution_code,briefing_markdown,workspace_yjs_document_base64,workspace_yjs_sequence,workspace_revision,workspace_focus_mode,interviewer_notes,score,language FROM room_tasks WHERE room_id=? ORDER BY step_index", room.id)
        val originalTasks = tasks()
        val originalRoom = jdbc.queryForMap("SELECT code,notes,briefing_markdown,current_step FROM rooms WHERE id=?", room.id)
        val owner = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        assertEquals("code", payload(owner.result).path("roomEditorMode").asText(), "a task marker cannot derive a fresh room mode")
        assertEquals(204, mode(room, owner, "markdown", 0).response.status)
        assertEquals(originalTasks, tasks())
        assertEquals(originalRoom, jdbc.queryForMap("SELECT code,notes,briefing_markdown,current_step FROM rooms WHERE id=?", room.id))
        assertEquals(204, event(room, owner, mapOf("type" to "set_step", "stepIndex" to 1)).response.status)
        assertEquals("markdown", payload(candidate.result).path("roomEditorMode").asText())
        assertEquals(1L, payload(candidate.result).path("roomEditorModeRevision").asLong())
        assertEquals("Task 1 briefing", payload(candidate.result).path("briefingMarkdown").asText())
        assertEquals(originalTasks, tasks(), "publication must retain both prepared documents and task metadata")
        assertEquals(204, mode(room, owner, "code", 1).response.status)
        assertEquals(originalTasks, tasks())
        val rejoined = stream(room, owner = false)
        assertEquals("code", payload(rejoined.result).path("roomEditorMode").asText())
        assertEquals(2L, payload(rejoined.result).path("roomEditorModeRevision").asLong())
        val roomDto = mvc.get("/api/rooms/${room.inviteCode}") {}.andReturn()
        assertEquals(200, roomDto.response.status)
        assertEquals("code", mapper.readTree(roomDto.response.contentAsString).path("roomEditorMode").asText())
        assertEquals(2L, mapper.readTree(roomDto.response.contentAsString).path("roomEditorModeRevision").asLong())
    }

    @Test fun `manager authority is resolved after a room lock wait`() {
        val room = fixture()
        val interviewer = HrHttpFixtures.register(mvc, mapper, false, "mode-race").first
        jdbc.update("INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'interviewer',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), room.id, interviewer.id)
        val connection = stream(room, owner = false, account = interviewer)
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { lock ->
                lock.autoCommit = false
                lock.prepareStatement("SELECT id FROM rooms WHERE id=? FOR UPDATE").use { statement -> statement.setString(1, room.id); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> { mode(room, connection, "markdown", 0) }
                waitForRoomLock()
                lock.prepareStatement("UPDATE room_participants SET role='candidate' WHERE room_id=? AND user_id=?").use { statement -> statement.setString(1, room.id); statement.setString(2, interviewer.id); statement.executeUpdate() }
                lock.commit()
                assertEquals(403, request.get(5, java.util.concurrent.TimeUnit.SECONDS).response.status)
            }
            assertEquals("code", jdbc.queryForObject("SELECT room_editor_mode FROM rooms WHERE id=?", String::class.java, room.id))
            assertEquals(0L, jdbc.queryForObject("SELECT room_editor_mode_revision FROM rooms WHERE id=?", Long::class.java, room.id))
        } finally { executor.shutdownNow() }
    }

    @Test fun `rapid concurrent mode commits keep every live revision monotonic and match storage`() {
        val room = fixture()
        val first = stream(room, owner = true)
        val second = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        val start = java.util.concurrent.CountDownLatch(1)
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val responses = listOf(first, second).map { connection -> executor.submit<Int> {
                start.await(5, java.util.concurrent.TimeUnit.SECONDS)
                var committed = 0
                var attempts = 0
                while (committed < 6 && attempts++ < 100) {
                    val current = jdbc.queryForMap("SELECT room_editor_mode,room_editor_mode_revision FROM rooms WHERE id=?", room.id)
                    val next = if (current["room_editor_mode"] == "code") "markdown" else "code"
                    val result = mode(room, connection, next, (current.getValue("room_editor_mode_revision") as Number).toLong())
                    assertTrue(result.response.status in setOf(204, 409), result.response.contentAsString)
                    if (result.response.status == 204) committed += 1
                }
                committed
            } }
            start.countDown()
            assertEquals(listOf(6, 6), responses.map { it.get(15, java.util.concurrent.TimeUnit.SECONDS) })
            val durable = jdbc.queryForMap("SELECT room_editor_mode,room_editor_mode_revision FROM rooms WHERE id=?", room.id)
            assertEquals("code", durable["room_editor_mode"])
            assertEquals(12L, (durable.getValue("room_editor_mode_revision") as Number).toLong())
            listOf(first, second, candidate).forEach { connection ->
                val states = connection.result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
                    .map { mapper.readTree(it.removePrefix("data:")) }.filter { it.path("type").asText() == "state_sync" }.map { it.path("payload") }.toList()
                val revisions = states.map { it.path("roomEditorModeRevision").asLong() }
                assertTrue(revisions.zipWithNext().all { (previous, next) -> previous <= next }, "mode revision must never move backward: $revisions")
                states.forEach { state -> assertEquals(if (state.path("roomEditorModeRevision").asLong() % 2 == 0L) "code" else "markdown", state.path("roomEditorMode").asText()) }
                assertEquals(12L, revisions.last())
                assertEquals("code", states.last().path("roomEditorMode").asText())
            }
        } finally { executor.shutdownNow() }
    }

    private fun mode(room: Room, connection: Stream, value: String, revision: Long): MvcResult =
        event(room, connection, mapOf("type" to "room_editor_mode_update", "roomEditorMode" to value, "expectedRoomEditorModeRevision" to revision))

    private fun waitForRoomLock() {
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5)
        while (System.nanoTime() < deadline) {
            val waiting = jdbc.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE '%from rooms%for%update%'", Long::class.java) ?: 0
            if (waiting > 0) return
            Thread.sleep(10)
        }
        throw AssertionError("Mode event must reach the room lock before revocation")
    }

    private fun fixture(taskCount: Int = 2): Room {
        val room = Room(title = "Markdown reliability", inviteCode = "md-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}", briefingMarkdown = "Task 0 briefing")
        room.tasks = (0 until taskCount).map { index -> RoomTask(room = room, stepIndex = index, title = "Task $index", description = "Task $index briefing", briefingMarkdown = "Task $index briefing") }.toMutableList()
        return rooms.saveAndFlush(room)
    }
    private data class Stream(val sessionId: String, val eventToken: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean, account: HrTestAccount? = null): Stream {
        val sessionId = "md-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
            account?.let { header("Authorization", "Bearer ${it.token}") }
        }.andReturn()
        assertEquals(200, result.response.status)
        val eventToken = payload(result).path("eventToken").asText()
        assertTrue(eventToken.isNotBlank(), "the complete admission state must contain an event token")
        return Stream(sessionId, eventToken, result)
    }
    private fun event(room: Room, stream: Stream, fields: Map<String, Any>): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to stream.sessionId, "eventToken" to stream.eventToken) + fields)
    }.andReturn()
    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}
