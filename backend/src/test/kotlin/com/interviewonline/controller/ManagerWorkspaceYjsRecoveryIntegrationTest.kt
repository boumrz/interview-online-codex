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
class ManagerWorkspaceYjsRecoveryIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("manager_yjs_recovery")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()

        // Real Yjs states before and after a local replacement, using room-code.
        private const val FIRST = "AQHSCQAEAQlyb29tLWNvZGUXY29uc3QgYWNrbm93bGVkZ2VkID0gMTsA"
        private const val NEXT = "AQLSCQABAQlyb29tLWNvZGUXhNIJFhFjb25zdCBxdWV1ZWQgPSA0OwHSCQEAFw=="
        private const val ACKNOWLEDGED = "const acknowledged = 1;"
        private const val QUEUED = "const queued = 4;"
    }

    @Test fun `stale future and missing manager Yjs bases return canonical recovery without overwriting the draft`() {
        postgres.verifyPostgres16()
        val fixture = fixture()
        val workspace = mvc.get("/api/rooms/${fixture.room.inviteCode}/tasks/1/workspace") {
            header("X-Room-Owner-Token", fixture.room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, workspace.response.status)
        assertEquals(fixture.taskId, mapper.readTree(workspace.response.contentAsString).path("taskId").asText())
        val peerSession = "manager-peer-${UUID.randomUUID()}"
        val peerStream = mvc.get("/api/realtime/rooms/${fixture.room.inviteCode}/stream") {
            param("sessionId", peerSession); param("displayName", "Peer"); param("ownerToken", fixture.room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, peerStream.response.status)
        val peer = Fixture(fixture.room, fixture.taskId, peerSession, payload(peerStream, "state_sync").path("eventToken").asText(), peerStream)
        assertEquals(204, event(peer, "manager_workspace_open", emptyMap()).response.status)
        assertEquals(204, event(fixture, "manager_workspace_yjs_update", snapshot(0, FIRST, ACKNOWLEDGED)).response.status)
        assertEquals(fixture.taskId, payload(peerStream, "manager_workspace_yjs_update").path("taskId").asText())
        val before = persisted(fixture)

        listOf(0L, 2L, null).forEach { base ->
            val rejected = event(fixture, "manager_workspace_yjs_update", snapshot(base, NEXT, QUEUED))
            assertEquals(409, rejected.response.status)
            assertEquals("WORKSPACE_YJS_RESYNC_REQUIRED", mapper.readTree(rejected.response.contentAsString).path("code").asText())
            val canonical = payload(fixture.stream, "manager_workspace_sync")
            assertTrue(canonical.path("recovery").asBoolean())
            assertEquals(1L, canonical.path("yjsSequence").asLong())
            assertEquals(FIRST, canonical.path("yjsDocumentBase64").asText())
            assertEquals(ACKNOWLEDGED, canonical.path("code").asText())
            assertEquals(fixture.taskId, canonical.path("taskId").asText())
            assertEquals(before, persisted(fixture), "rejected snapshots never change durable manager data")
        }

        assertEquals(204, event(fixture, "manager_workspace_yjs_update", snapshot(1, NEXT, QUEUED)).response.status)
        val after = persisted(fixture)
        assertEquals(2L, after["workspace_yjs_sequence"])
        assertEquals(NEXT, after["workspace_yjs_document_base64"])
        assertEquals(QUEUED, after["solution_code"])
        assertEquals(204, event(fixture, "set_step", emptyMap()).response.status)
        assertEquals(QUEUED, jdbc.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, fixture.room.id))
    }

    @Test fun `manager Yjs retained for a replaced task cannot write the new task at the same index`() {
        val fixture = fixture()
        val replacementId = UUID.randomUUID().toString()
        jdbc.update("UPDATE room_tasks SET id = ? WHERE id = ?", replacementId, fixture.taskId)
        assertEquals(204, event(fixture, "manager_workspace_open", emptyMap()).response.status)
        assertEquals(replacementId, payload(fixture.stream, "manager_workspace_sync").path("taskId").asText())

        val rejected = event(fixture, "manager_workspace_yjs_update", snapshot(0, NEXT, QUEUED) + ("taskId" to fixture.taskId))
        assertEquals(409, rejected.response.status)
        assertEquals("WORKSPACE_TASK_CHANGED", mapper.readTree(rejected.response.contentAsString).path("code").asText())
        val unchanged = persisted(fixture)
        assertEquals(0L, unchanged["workspace_yjs_sequence"])
        assertEquals(null, unchanged["workspace_yjs_document_base64"])
        assertEquals(null, unchanged["solution_code"])

        assertEquals(204, event(fixture, "manager_workspace_yjs_update", snapshot(0, NEXT, QUEUED) + ("taskId" to replacementId)).response.status)
        assertEquals(QUEUED, persisted(fixture)["solution_code"])
    }

    @Test fun `manager Yjs rejects a different task UUID even when the draft base is current`() {
        val fixture = fixture()
        val rejected = event(fixture, "manager_workspace_yjs_update", snapshot(0, FIRST, ACKNOWLEDGED) + ("taskId" to fixture.room.tasks[0].id))
        assertEquals(409, rejected.response.status)
        assertEquals("WORKSPACE_TASK_CHANGED", mapper.readTree(rejected.response.contentAsString).path("code").asText())
        assertEquals(0L, persisted(fixture)["workspace_yjs_sequence"])
    }

    private data class Fixture(val room: Room, val taskId: String, val session: String, val token: String, val stream: MvcResult)

    private fun fixture(): Fixture {
        val room = Room(title = "Manager recovery", inviteCode = "manager-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}")
        room.tasks = mutableListOf(RoomTask(room = room, stepIndex = 0, title = "Published"), RoomTask(room = room, stepIndex = 1, title = "Prepared"))
        rooms.saveAndFlush(room)
        val session = "manager-${UUID.randomUUID()}"
        val stream = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session); param("displayName", "Manager"); param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, stream.response.status)
        val fixture = Fixture(room, room.tasks[1].id!!, session, payload(stream, "state_sync").path("eventToken").asText(), stream)
        assertEquals(204, event(fixture, "manager_workspace_open", emptyMap()).response.status)
        return fixture
    }

    private fun snapshot(base: Long?, document: String, code: String): Map<String, Any?> = mapOf(
        "baseServerYjsSequence" to base, "yjsDocumentBase64" to document, "code" to code,
        "yjsUpdate" to "", "operationId" to UUID.randomUUID().toString(),
    )

    private fun event(fixture: Fixture, type: String, fields: Map<String, Any?>): MvcResult = mvc.post("/api/realtime/rooms/${fixture.room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to fixture.session, "eventToken" to fixture.token, "type" to type, "stepIndex" to 1) + fields)
    }.andReturn()

    private fun persisted(fixture: Fixture): Map<String, Any?> = jdbc.queryForMap(
        "SELECT solution_code, workspace_yjs_document_base64, workspace_yjs_sequence FROM room_tasks WHERE room_id = ? AND step_index = 1", fixture.room.id,
    )

    private fun payload(result: MvcResult, type: String): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == type }.path("payload")
}
