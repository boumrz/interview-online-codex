package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.repository.RoomRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.support.Postgres16TestSupport
import com.interviewonline.ws.RealtimeEventRequest
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
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
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomPersistenceIsolationIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val collaboration: CollaborationService,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_persistence_isolation")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
        private const val FIRST = "AQHSCQAEAQlyb29tLWNvZGUXY29uc3QgYWNrbm93bGVkZ2VkID0gMTsA"
        private const val QUEUED_DELTA = "AQHSCReE0gkWEWNvbnN0IHF1ZXVlZCA9IDQ7AdIJAQAX"
        private const val QUEUED_FULL = "AQLSCQABAQlyb29tLWNvZGUXhNIJFhFjb25zdCBxdWV1ZWQgPSA0OwHSCQEAFw=="
        private const val QUEUED = "const queued = 4;"
        private const val ACKNOWLEDGED = "const acknowledged = 1;"
    }

    @Test fun `a locked room cannot delay accepted editor persistence in another room`() {
        postgres.verifyPostgres16()
        val slow = fixture("Busy room")
        val independent = fixture("Independent room")
        val slowOwner = stream(slow)
        val independentOwner = stream(independent)
        val lockHeld = CountDownLatch(1)
        val releaseLock = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        assertEquals(204, yjs(slow, slowOwner).response.status)
        val holder = executor.submit {
            postgres.connection().use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM rooms WHERE id=? FOR UPDATE").use { statement ->
                    statement.setString(1, slow.id)
                    statement.executeQuery().use { result -> assertTrue(result.next()) }
                }
                lockHeld.countDown()
                assertTrue(releaseLock.await(10, TimeUnit.SECONDS), "test releases its own room lock")
                connection.commit()
            }
        }
        try {
            assertTrue(lockHeld.await(500, TimeUnit.MILLISECONDS), "fixture owns A before its debounce is due")
            // Allow A's accepted save to become due before accepting B. The
            // PostgreSQL wait projection diagnoses the old blocking behaviour;
            // yielding lock attempts correctly have no enduring Lock wait.
            Thread.sleep(1100)
            val blockedSaver = jdbc.queryForObject(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%rooms%invite_code%FOR UPDATE%'",
                Int::class.java,
            ) ?: 0
            println("persistence isolation: blocked room saver observed=${blockedSaver > 0}")
            assertEquals(204, yjs(independent, independentOwner).response.status, "B is accepted while A remains locked")
            waitPersisted(independent, ACKNOWLEDGED, "accepted B is durable while unrelated A still holds its row lock")
            assertEquals(1L, jdbc.queryForObject("SELECT workspace_yjs_sequence FROM room_tasks WHERE room_id=?", Long::class.java, independent.id))
            assertEquals(FIRST, jdbc.queryForObject("SELECT workspace_yjs_document_base64 FROM room_tasks WHERE room_id=?", String::class.java, independent.id))
            assertEquals(1L, releaseLock.count, "B persistence did not depend on releasing A")
            releaseLock.countDown()
            holder.get(3, TimeUnit.SECONDS)
            waitPersisted(slow, ACKNOWLEDGED, "A's pending document survives a busy lock and persists after release")
        } finally {
            releaseLock.countDown()
            holder.get(3, TimeUnit.SECONDS)
            executor.shutdownNow()
            collaboration.closeRoom(slow.inviteCode)
            collaboration.closeRoom(independent.inviteCode)
        }
    }

    @Test fun `busy accepted persistence retains the room activity lease after the last stream leaves`() {
        val room = fixture("Busy disconnected room")
        val owner = stream(room)
        val eventToken = payload(owner.result).path("eventToken").asText()
        assertEquals(204, yjs(room, owner).response.status)
        postgres.connection().use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("SELECT id FROM rooms WHERE id=? FOR UPDATE").use { statement ->
                statement.setString(1, room.id); statement.executeQuery().use { assertTrue(it.next()) }
            }
            collaboration.handleRealtimeEvent(room.inviteCode, RealtimeEventRequest(sessionId = owner.sessionId, eventToken = eventToken, type = "leave_room"))
            Thread.sleep(1100)
            assertTrue(collaboration.hasMergeBlockingRoomActivity(listOf(room.inviteCode)), "accepted busy document remains merge-blocking without a stream")
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM room_realtime_activity WHERE room_code=? AND expires_at > now()", Int::class.java, room.inviteCode), "pending retry retains its shared activity lease without SSE")
            connection.commit()
        }
        try {
            waitPersisted(room, ACKNOWLEDGED, "accepted offline pending document persists after the row unlocks")
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (collaboration.hasMergeBlockingRoomActivity(listOf(room.inviteCode)) && System.nanoTime() < deadline) Thread.sleep(25)
            assertEquals(false, collaboration.hasMergeBlockingRoomActivity(listOf(room.inviteCode)), "settled offline persistence stops blocking merge")
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, room.inviteCode), "settled offline room releases its lease")
        } finally { collaboration.closeRoom(room.inviteCode) }
    }

    @Test fun `a newer accepted snapshot replaces busy retries without an older document restoring later`() {
        val room = fixture("Latest busy snapshot")
        val owner = stream(room)
        val firstAccepted = CountDownLatch(1)
        val replacementAccepted = CountDownLatch(1)
        val releaseLock = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        val holder = executor.submit {
            TransactionTemplate(transactionManager).executeWithoutResult {
                jdbc.queryForObject("SELECT id FROM rooms WHERE id=? FOR UPDATE", String::class.java, room.id)
                collaboration.handleRealtimeEvent(room.inviteCode, event(room, owner))
                firstAccepted.countDown()
                Thread.sleep(1100)
                collaboration.handleRealtimeEvent(room.inviteCode, event(room, owner, QUEUED_DELTA, QUEUED_FULL, QUEUED, 1, 2))
                replacementAccepted.countDown()
                assertTrue(releaseLock.await(10, TimeUnit.SECONDS))
            }
        }
        try {
            assertTrue(firstAccepted.await(3, TimeUnit.SECONDS))
            assertTrue(replacementAccepted.await(3, TimeUnit.SECONDS))
            Thread.sleep(1000)
            assertEquals("", jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id), "A remains locked before release")
            releaseLock.countDown()
            holder.get(3, TimeUnit.SECONDS)
            waitPersisted(room, QUEUED, "busy retry persists the newest accepted document")
            assertEquals(QUEUED_FULL, jdbc.queryForObject("SELECT workspace_yjs_document_base64 FROM room_tasks WHERE room_id=?", String::class.java, room.id))
            assertEquals(2L, jdbc.queryForObject("SELECT workspace_yjs_sequence FROM room_tasks WHERE room_id=?", Long::class.java, room.id))
            Thread.sleep(1000)
            assertEquals(QUEUED, jdbc.queryForObject("SELECT solution_code FROM room_tasks WHERE room_id=?", String::class.java, room.id), "an older cancelled timer cannot restore the earlier snapshot")
        } finally {
            releaseLock.countDown(); holder.get(3, TimeUnit.SECONDS); executor.shutdownNow()
            collaboration.closeRoom(room.inviteCode)
        }
    }

    @ParameterizedTest
    @ValueSource(strings = ["frozen", "archived", "team_changed", "task_replaced"])
    fun `busy retry rechecks lifecycle team and original task fences`(transition: String) {
        val room = fixture("Busy pending fence")
        val owner = stream(room)
        val newTeam = if (transition == "team_changed") {
            val userId = mapper.readTree(mvc.post("/api/auth/register") {
                contentType = MediaType.APPLICATION_JSON
                content = mapper.writeValueAsString(mapOf("nickname" to "busy_${UUID.randomUUID().toString().take(8)}", "displayName" to "Busy owner", "password" to "test-password-123"))
            }.andReturn().also { assertEquals(200, it.response.status) }.response.contentAsString).path("user").path("id").asText()
            val teamId = UUID.randomUUID().toString()
            jdbc.update("INSERT INTO teams(id,name,normalized_name,owner_user_id,state,revision,security_revision,merge_revision,created_at,updated_at) VALUES (?,?,?,?,'ACTIVE',0,0,0,now(),now())", teamId, "Busy team", "busy team", userId)
            teamId
        } else null
        assertEquals(204, yjs(room, owner).response.status)
        postgres.connection().use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("SELECT id FROM rooms WHERE id=? FOR UPDATE").use { statement ->
                statement.setString(1, room.id); statement.executeQuery().use { assertTrue(it.next()) }
            }
            when (transition) {
                "frozen" -> connection.prepareStatement("UPDATE rooms SET status='frozen' WHERE id=?").use { it.setString(1, room.id); it.executeUpdate() }
                "archived" -> connection.prepareStatement("UPDATE rooms SET archived_at=now() WHERE id=?").use { it.setString(1, room.id); it.executeUpdate() }
                "team_changed" -> connection.prepareStatement("UPDATE rooms SET team_id=?,origin_team_id=? WHERE id=?").use { it.setString(1, newTeam); it.setString(2, newTeam); it.setString(3, room.id); it.executeUpdate() }
                "task_replaced" -> {
                    connection.prepareStatement("DELETE FROM room_tasks WHERE room_id=?").use { it.setString(1, room.id); it.executeUpdate() }
                    connection.prepareStatement("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,language,mandatory,workspace_yjs_sequence,workspace_revision) VALUES (?,?,0,'Replacement','','replacement','nodejs',false,0,0)").use { it.setString(1, UUID.randomUUID().toString()); it.setString(2, room.id); it.executeUpdate() }
                    connection.prepareStatement("UPDATE rooms SET code='replacement' WHERE id=?").use { it.setString(1, room.id); it.executeUpdate() }
                }
            }
            Thread.sleep(1100)
            connection.commit()
        }
        try {
            Thread.sleep(1300)
            assertEquals(if (transition == "task_replaced") "replacement" else "", jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id), "pending save cannot cross $transition")
            assertEquals(0L, jdbc.queryForObject("SELECT workspace_yjs_sequence FROM room_tasks WHERE room_id=?", Long::class.java, room.id))
            assertEquals(null, jdbc.queryForObject("SELECT solution_code FROM room_tasks WHERE room_id=?", String::class.java, room.id))
        } finally { collaboration.closeRoom(room.inviteCode) }
    }

    private fun fixture(title: String): Room {
        val room = Room(title = title, inviteCode = "persistence-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "interviewer-${UUID.randomUUID()}")
        room.tasks = mutableListOf(RoomTask(room = room, stepIndex = 0, title = "Original task"))
        return rooms.saveAndFlush(room)
    }
    private data class Stream(val sessionId: String, val result: MvcResult)
    private fun stream(room: Room): Stream {
        val sessionId = "persistence-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", "Owner"); param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, result.response.status)
        return Stream(sessionId, result)
    }
    private fun event(room: Room, stream: Stream, delta: String = FIRST, document: String = FIRST, code: String = ACKNOWLEDGED, base: Long = 0, sequence: Long = 1) = RealtimeEventRequest(
        sessionId = stream.sessionId, eventToken = payload(stream.result).path("eventToken").asText(),
        type = "yjs_update", syncKey = "${room.inviteCode}:0:nodejs", operationId = UUID.randomUUID().toString(),
        yjsUpdate = delta, yjsDocumentBase64 = document, code = code, yjsClientSequence = sequence, baseServerYjsSequence = base,
    )
    private fun yjs(room: Room, stream: Stream): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(event(room, stream))
    }.andReturn()
    private fun waitPersisted(room: Room, expected: String, message: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id) != expected && System.nanoTime() < deadline) Thread.sleep(25)
        assertEquals(expected, jdbc.queryForObject("SELECT code FROM rooms WHERE id=?", String::class.java, room.id), message)
    }
    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}
