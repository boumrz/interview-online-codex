package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
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
class MarkdownTaskDeliveryIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("markdown_delivery")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `late Markdown belongs to its original task after another task is published`() {
        postgres.verifyPostgres16()
        val room = fixture()
        val owner = stream(room, owner = true)
        val originalId = room.tasks[0].id!!
        assertEquals(204, event(room, owner, mapOf("type" to "set_step", "stepIndex" to 1)).response.status)
        val saved = event(room, owner, mapOf("type" to "briefing_markdown_update", "briefingMarkdown" to "LAST_OLD_TASK_DRAFT", "taskId" to originalId, "syncKey" to "${room.inviteCode}:0:nodejs"))
        assertEquals(204, saved.response.status, saved.response.contentAsString)
        assertEquals("LAST_OLD_TASK_DRAFT", jdbc.queryForObject("SELECT briefing_markdown FROM room_tasks WHERE id=?", String::class.java, originalId))
        assertEquals("Task 1 briefing", jdbc.queryForObject("SELECT briefing_markdown FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals("Task 1 briefing", payload(owner.result).path("briefingMarkdown").asText())
    }

    @Test fun `deleted task ID cannot redirect pending Markdown into a reindexed task`() {
        val room = fixture()
        val owner = stream(room, owner = true)
        val deletedId = room.tasks[0].id!!
        jdbc.update("DELETE FROM room_tasks WHERE id=?", deletedId)
        jdbc.update("UPDATE room_tasks SET step_index=0 WHERE room_id=?", room.id)
        val result = event(room, owner, mapOf("type" to "briefing_markdown_update", "briefingMarkdown" to "WRONG_TASK_DRAFT", "taskId" to deletedId))
        assertEquals(409, result.response.status, result.response.contentAsString)
        assertEquals("Task 1 briefing", jdbc.queryForObject("SELECT briefing_markdown FROM room_tasks WHERE room_id=?", String::class.java, room.id))
    }

    @Test fun `candidate cannot use a task ID to edit private or public Markdown`() {
        val room = fixture()
        val candidate = stream(room, owner = false)
        for (task in room.tasks) {
            val result = event(room, candidate, mapOf("type" to "briefing_markdown_update", "briefingMarkdown" to "FORBIDDEN", "taskId" to task.id!!))
            assertEquals(403, result.response.status)
        }
    }

    @Test fun `restored manager subscription cannot redirect old metadata into a reindexed task`() {
        val room = fixture(3)
        val owner = stream(room, owner = true)
        val originalId = room.tasks[1].id!!
        assertEquals(204, event(room, owner, mapOf("type" to "manager_workspace_open", "stepIndex" to 1)).response.status)
        jdbc.update("DELETE FROM room_tasks WHERE id=?", originalId)
        jdbc.update("UPDATE room_tasks SET step_index=1 WHERE id=?", room.tasks[2].id)
        assertEquals(204, event(room, owner, mapOf("type" to "manager_workspace_open", "stepIndex" to 1)).response.status)
        for (fields in listOf(
            mapOf("type" to "manager_workspace_briefing_update", "briefingMarkdown" to "WRONG_TASK_DRAFT"),
            mapOf("type" to "manager_workspace_language_update", "language" to "python"),
            mapOf("type" to "manager_workspace_focus_mode_update", "focusMode" to true),
        )) {
            val result = event(room, owner, fields + mapOf("stepIndex" to 1, "taskId" to originalId, "revision" to 0))
            assertEquals(409, result.response.status, result.response.contentAsString)
        }
        assertEquals("Task 2 briefing", jdbc.queryForObject("SELECT briefing_markdown FROM room_tasks WHERE id=?", String::class.java, room.tasks[2].id))
        assertEquals("nodejs", jdbc.queryForObject("SELECT language FROM room_tasks WHERE id=?", String::class.java, room.tasks[2].id))
    }

    private fun fixture(taskCount: Int = 2): Room {
        val room = Room(title = "Markdown reliability", inviteCode = "md-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}", briefingMarkdown = "Task 0 briefing")
        room.tasks = (0 until taskCount).map { index -> RoomTask(room = room, stepIndex = index, title = "Task $index", description = "Task $index briefing", briefingMarkdown = "Task $index briefing") }.toMutableList()
        return rooms.saveAndFlush(room)
    }
    private data class Stream(val sessionId: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean): Stream {
        val sessionId = "md-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, result.response.status)
        return Stream(sessionId, result)
    }
    private fun event(room: Room, stream: Stream, fields: Map<String, Any>): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to stream.sessionId, "eventToken" to payload(stream.result).path("eventToken").asText()) + fields)
    }.andReturn()
    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}
