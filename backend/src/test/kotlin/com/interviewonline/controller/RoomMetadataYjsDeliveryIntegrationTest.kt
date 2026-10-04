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
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomMetadataYjsDeliveryIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("metadata_yjs_delivery")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()

        // Real Yjs documents/deltas: owner acknowledged text, its queued local
        // replacement, and a different client's competing replacement.
        private const val FIRST = "AQHSCQAEAQlyb29tLWNvZGUXY29uc3QgYWNrbm93bGVkZ2VkID0gMTsA"
        private const val QUEUED_DELTA = "AQHSCReE0gkWEWNvbnN0IHF1ZXVlZCA9IDQ7AdIJAQAX"
        private const val QUEUED_FULL = "AQLSCQABAQlyb29tLWNvZGUXhNIJFhFjb25zdCBxdWV1ZWQgPSA0OwHSCQEAFw=="
        private const val REMOTE_DELTA = "AQGuLACE0gkWEWNvbnN0IHJlbW90ZSA9IDI7AdIJAQAX"
        private const val REMOTE_FULL = "AgGuLACE0gkWEWNvbnN0IHJlbW90ZSA9IDI7AdIJAAEBCXJvb20tY29kZRcB0gkBABc="
        private const val ACKNOWLEDGED = "const acknowledged = 1;"
        private const val QUEUED = "const queued = 4;"
        private const val REMOTE = "const remote = 2;"
    }

    @Test fun `finished metadata refresh retains authority for an already queued owner snapshot`() {
        postgres.verifyPostgres16()
        val room = fixture()
        val owner = stream(room, owner = true)
        assertEquals(204, yjs(room, owner, FIRST, FIRST, ACKNOWLEDGED, base = 0, sequence = 1).response.status)
        finishAndRename(room)
        val finishedAt = jdbc.queryForMap("SELECT finished_at FROM rooms WHERE id=?", room.id)["finished_at"]

        // This intent was captured before the first acknowledgement/SSE. Its
        // base stays zero even though metadata refresh has retained sequence1.
        val result = yjs(room, owner, QUEUED_DELTA, QUEUED_FULL, QUEUED, base = 0, sequence = 2)
        assertEquals(204, result.response.status)
        waitPersisted(room, QUEUED)
        assertEquals(QUEUED, jdbc.queryForObject("SELECT solution_code FROM room_tasks WHERE room_id=?", String::class.java, room.id))
        assertEquals(QUEUED_FULL, jdbc.queryForObject("SELECT workspace_yjs_document_base64 FROM room_tasks WHERE room_id=?", String::class.java, room.id))
        assertEquals("finished", jdbc.queryForObject("SELECT status FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals(finishedAt, jdbc.queryForMap("SELECT finished_at FROM rooms WHERE id=?", room.id)["finished_at"])
    }

    @Test fun `finished metadata refresh never treats another author sequence as an owner only gap`() {
        val room = fixture()
        val owner = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        assertEquals(204, yjs(room, owner, FIRST, FIRST, ACKNOWLEDGED, base = 0, sequence = 1).response.status)
        assertEquals(204, yjs(room, candidate, REMOTE_DELTA, REMOTE_FULL, REMOTE, base = 1, sequence = 1).response.status)
        finishAndRename(room)

        // Even with a current base, a session which is not the last delta author
        // cannot publish an unsolicited snapshot-only document replacement.
        assertEquals(204, yjs(room, owner, "", QUEUED_FULL, QUEUED, base = 2, sequence = 2).response.status)
        assertEquals(REMOTE, jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals(204, yjs(room, owner, QUEUED_DELTA, QUEUED_FULL, QUEUED, base = 0, sequence = 3).response.status)
        // The incremental CRDT event can relay, but its stale whole document
        // excludes the other author and must not replace durable canonical data.
        assertEquals(REMOTE, jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
        assertEquals(REMOTE_FULL, jdbc.queryForObject("SELECT workspace_yjs_document_base64 FROM room_tasks WHERE room_id=?", String::class.java, room.id))
        assertEquals(REMOTE, payload(owner.result).path("code").asText())
    }

    @Test fun `finished metadata refresh retains the last author snapshot heartbeat`() {
        val room = fixture()
        val owner = stream(room, owner = true)
        assertEquals(204, yjs(room, owner, FIRST, FIRST, ACKNOWLEDGED, base = 0, sequence = 1).response.status)
        finishAndRename(room)
        assertEquals(204, yjs(room, owner, "", QUEUED_FULL, QUEUED, base = 1, sequence = 2).response.status)
        waitPersisted(room, QUEUED)
        assertEquals(QUEUED_FULL, jdbc.queryForObject("SELECT workspace_yjs_document_base64 FROM room_tasks WHERE room_id=?", String::class.java, room.id))
    }

    @Test fun `finished candidate cannot replay a queued document after metadata refresh`() {
        val room = fixture()
        val owner = stream(room, owner = true)
        val candidate = stream(room, owner = false)
        assertEquals(204, yjs(room, owner, FIRST, FIRST, ACKNOWLEDGED, base = 0, sequence = 1).response.status)
        finishAndRename(room)
        val result = yjs(room, candidate, QUEUED_DELTA, QUEUED_FULL, QUEUED, base = 0, sequence = 2)
        assertEquals(403, result.response.status)
        assertEquals("ROOM_READ_ONLY", mapper.readTree(result.response.contentAsString).path("code").asText())
        assertEquals(ACKNOWLEDGED, jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id))
    }

    private fun fixture(): Room {
        val room = Room(title = "Queued document metadata", inviteCode = "metadata-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}")
        room.tasks = mutableListOf(RoomTask(room = room, stepIndex = 0, title = "Original task"))
        return rooms.saveAndFlush(room)
    }
    private data class Stream(val sessionId: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean): Stream {
        val sessionId = "metadata-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, result.response.status)
        return Stream(sessionId, result)
    }
    private fun yjs(room: Room, stream: Stream, delta: String, document: String, code: String, base: Long, sequence: Long): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to stream.sessionId, "eventToken" to payload(stream.result).path("eventToken").asText(),
            "type" to "yjs_update", "syncKey" to "${room.inviteCode}:0:nodejs", "operationId" to UUID.randomUUID().toString(),
            "yjsUpdate" to delta, "yjsDocumentBase64" to document, "code" to code,
            "yjsClientSequence" to sequence, "baseServerYjsSequence" to base))
    }.andReturn()
    private fun finishAndRename(room: Room) {
        assertEquals(200, mvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("X-Room-Owner-Token", room.ownerSessionToken); contentType = MediaType.APPLICATION_JSON; content = """{"verdict":"HIRE"}"""
        }.andReturn().response.status)
        assertEquals(200, mvc.patch("/api/rooms/${room.inviteCode}/tasks/0") {
            header("X-Room-Owner-Token", room.ownerSessionToken); contentType = MediaType.APPLICATION_JSON; content = """{"title":"Renamed task"}"""
        }.andReturn().response.status)
    }
    private fun waitPersisted(room: Room, expected: String) {
        val deadline = System.nanoTime() + 3_000_000_000L
        while (jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id) != expected && System.nanoTime() < deadline) Thread.sleep(25)
        assertEquals(expected, jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id), "accepted owner document persists after same-task metadata refresh")
    }
    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}
