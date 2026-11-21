package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.support.Postgres16TestSupport
import org.awaitility.Awaitility.await
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import org.mockito.Mockito
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.mock.mockito.SpyBean
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.util.ReflectionTestUtils
import org.springframework.test.util.AopTestUtils
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.util.UUID
import java.time.Clock

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomCanvasPresenceIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val collaboration: CollaborationService,
) {
    @SpyBean private lateinit var roomParticipants: RoomParticipantRepository
    @SpyBean private lateinit var clock: Clock
    companion object {
        private val postgres = Postgres16TestSupport.create("canvas_presence")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `readonly candidates and guests share named cursors without content or activity writes`() {
        val room = room(); val candidate = stream(room); val guest = stream(room, true)
        jdbc.update("UPDATE rooms SET status='finished' WHERE id=?", room.id)
        assertEquals(204, pointer(room, guest, 1, visible = false).response.status)
        assertEquals(204, pointer(room, candidate, 1).response.status)
        val cursor = snapshot(guest).path("cursors").single()
        assertEquals("Candidate", cursor.path("displayName").asText())
        assertEquals(42.5, cursor.path("x").asDouble())
        assertTrue(cursor.path("color").asText().matches(Regex("#[0-9a-fA-F]{6}")))
        assertTrue(snapshot(candidate).path("cursors").isEmpty)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_whiteboards WHERE room_id=?", Int::class.java, room.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM room_diagrams WHERE room_id=?", Int::class.java, room.id))
        assertTrue(messages(guest.result).none { it.path("type").asText() == "candidate_key" })
        assertEquals(204, pointer(room, candidate, 2, visible = false).response.status)
        assertTrue(snapshot(guest).path("cursors").isEmpty)
    }

    @Test fun `private tasks canvas kind and latest scope isolate recipients and reject stale movement`() {
        val room = room(); val published = task(room, 0); val private = task(room, 1)
        val candidate = stream(room); val owner = stream(room, true); val otherOwner = stream(room, true)
        assertEquals(204, pointer(room, candidate, 1, taskId = published, visible = false).response.status)
        assertEquals(204, pointer(room, otherOwner, 1, taskId = private, visible = false).response.status)
        assertEquals(204, pointer(room, owner, 1, taskId = private).response.status)
        assertTrue(snapshot(candidate).path("cursors").isEmpty)
        assertEquals(1, snapshot(otherOwner).path("cursors").size())
        assertEquals(404, pointer(room, candidate, 2, taskId = private).response.status)
        assertEquals(204, pointer(room, owner, 3, taskId = published, canvas = "diagram").response.status)
        assertTrue(snapshot(otherOwner).path("cursors").isEmpty)
        assertTrue(snapshot(candidate).path("cursors").isEmpty)
        assertEquals(409, pointer(room, owner, 2, taskId = private).response.status)
        assertTrue(snapshot(otherOwner).path("cursors").isEmpty)
    }

    @Test fun `unfocused authorized canvas still receives peers without publishing its own pointer`() {
        val room = room(); val candidate = stream(room); val observer = stream(room, true)
        assertEquals(204, pointer(room, observer, 1, active = false, visible = false).response.status)
        assertEquals(204, pointer(room, candidate, 1).response.status)
        assertEquals(1, snapshot(observer).path("cursors").size(), "window focus must not gate receiving a permitted canvas")
        assertTrue(snapshot(candidate).path("cursors").isEmpty, "unfocused observer has no own visible pointer")
        assertEquals(204, pointer(room, candidate, 2, active = false, visible = false).response.status)
        assertTrue(snapshot(observer).path("cursors").isEmpty, "sender blur still removes the old pointer")
        assertEquals(204, pointer(room, observer, 2, canvas = "diagram", active = false, visible = false).response.status)
        assertEquals(204, pointer(room, candidate, 3).response.status)
        assertTrue(snapshot(observer).path("cursors").isEmpty, "receiving remains isolated by canvas type")
        pointer(room, observer, 3, active = true, visible = false, subscribed = null)
        assertEquals(1, snapshot(observer).path("cursors").size(), "legacy foreground client still receives")
        pointer(room, observer, 4, active = false, visible = false, subscribed = null)
        assertTrue(snapshot(observer).path("cursors").isEmpty, "legacy inactive client keeps the old unsubscribe fallback")
    }

    @Test fun `unfocused subscription changes scope but a late leave cannot restore the old scope`() {
        val room = room(); val published = task(room, 0); val private = task(room, 1)
        val candidate = stream(room); val observer = stream(room, true)
        pointer(room, candidate, 1, taskId = published, canvas = "diagram")
        pointer(room, observer, 1, taskId = private, active = false, visible = false)
        assertTrue(snapshot(observer).path("cursors").isEmpty)
        pointer(room, observer, 2, taskId = published, canvas = "diagram", active = false, visible = false)
        assertEquals(1, snapshot(observer).path("cursors").size())
        pointer(room, observer, 3, taskId = private, active = false, visible = false, subscribed = false)
        pointer(room, candidate, 2, taskId = published, canvas = "diagram")
        assertEquals(1, snapshot(observer).path("cursors").size(), "late cleanup must not overwrite the new receive scope")
        pointer(room, observer, 4, taskId = published, canvas = "diagram", active = false, visible = false, subscribed = false)
        assertTrue(snapshot(observer).path("cursors").isEmpty, "hidden or unmounted canvas unsubscribes")
        assertEquals(404, pointer(room, candidate, 3, taskId = private, active = false, visible = false).response.status)
    }

    @Test fun `visible unfocused heartbeat keeps receiving beyond the original lease and expiry still clears it`() {
        val room = room(); val candidate = stream(room); val observer = stream(room, true)
        val start = clock.millis()
        try {
            Mockito.doReturn(start).`when`(clock).millis()
            pointer(room, observer, 1, active = false, visible = false)
            pointer(room, candidate, 1)
            Mockito.doReturn(start + 55_000).`when`(clock).millis()
            pointer(room, observer, 2, active = false, visible = false)
            Mockito.doReturn(start + 65_000).`when`(clock).millis()
            pointer(room, candidate, 2)
            assertEquals(1, snapshot(observer).path("cursors").size(), "receiver heartbeat renews the lease without window focus")
            Mockito.doReturn(start + 120_000).`when`(clock).millis()
            pointer(room, candidate, 3)
            assertTrue(snapshot(observer).path("cursors").isEmpty, "unrenewed receiver expires")
            pointer(room, observer, 3, active = false, visible = false)
            assertEquals(1, snapshot(observer).path("cursors").size(), "visible return refreshes authorized receiving")
        } finally { Mockito.reset(clock) }
    }

    @Test fun `changing room mode after canvas subscription succeeds after commit and invalidates old cursors`() {
        val room = room()
        jdbc.update("UPDATE rooms SET room_editor_mode='whiteboard' WHERE id=?", room.id)
        val owner = stream(room, true); val candidate = stream(room)
        pointer(room, owner, 1)
        pointer(room, candidate, 1, active = false, visible = false)
        assertEquals(1, snapshot(candidate).path("cursors").size())
        val changed = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("type" to "room_editor_mode_update", "sessionId" to owner.sessionId,
                "eventToken" to owner.token, "roomEditorMode" to "diagram", "expectedRoomEditorModeRevision" to 0))
        }.andReturn()
        assertEquals(204, changed.response.status, "post-commit cursor dispatch must not turn a committed mode change into a storage error")
        assertEquals("diagram", rooms.findById(requireNotNull(room.id)).orElseThrow().roomEditorMode)
        await().atMost(5, TimeUnit.SECONDS).until { snapshot(candidate).path("cursors").isEmpty }
        pointer(room, owner, 2, canvas = "diagram", modeRevision = 1)
        pointer(room, candidate, 2, canvas = "diagram", active = false, visible = false, modeRevision = 1)
        assertEquals(1, snapshot(candidate).path("cursors").size())
        val returned = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("type" to "room_editor_mode_update", "sessionId" to owner.sessionId,
                "eventToken" to owner.token, "roomEditorMode" to "whiteboard", "expectedRoomEditorModeRevision" to 1))
        }.andReturn()
        assertEquals(204, returned.response.status)
        assertEquals("whiteboard", rooms.findById(requireNotNull(room.id)).orElseThrow().roomEditorMode)
        await().atMost(5, TimeUnit.SECONDS).until { snapshot(candidate).path("cursors").isEmpty }
    }

    @Test fun `room mode save commits while a canvas cursor send is stalled`() {
        val room = room()
        val owner = stream(room, true)
        val candidate = stream(room)
        assertEquals(204, pointer(room, owner, 1, visible = false).response.status)

        val target = AopTestUtils.getUltimateTargetObject<CollaborationService>(collaboration)
        @Suppress("UNCHECKED_CAST")
        val sessions = ReflectionTestUtils.getField(target, "connectionByRoomSession") as Map<String, String>
        @Suppress("UNCHECKED_CAST")
        val emitters = ReflectionTestUtils.getField(target, "sseConnections") as MutableMap<String, SseEmitter>
        val connectionId = sessions.getValue("${room.inviteCode}::${owner.sessionId}")
        val liveEmitter = emitters.getValue(connectionId)
        val workspaceLock = requireNotNull(ReflectionTestUtils.invokeMethod<Any>(target, "managerWorkspaceRoomLock", room.inviteCode))
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val stalledOnce = AtomicBoolean(false)
        val transactionHeld = AtomicBoolean(false)
        val monitorHeld = AtomicBoolean(false)
        val emitter = Mockito.spy(liveEmitter)
        Mockito.doAnswer { call ->
            val event = call.getArgument<SseEmitter.SseEventBuilder>(0)
            if (event.build().any { it.data.toString().contains("\"type\":\"canvas_cursor_snapshot\"") } &&
                stalledOnce.compareAndSet(false, true)) {
                transactionHeld.set(TransactionSynchronizationManager.isActualTransactionActive())
                monitorHeld.set(Thread.holdsLock(workspaceLock))
                entered.countDown()
                check(release.await(8, TimeUnit.SECONDS))
            }
            call.callRealMethod()
        }.`when`(emitter).send(Mockito.any(SseEmitter.SseEventBuilder::class.java))
        emitters[connectionId] = emitter
        val workers = Executors.newFixedThreadPool(2)
        try {
            val movement = workers.submit<MvcResult> { pointer(room, candidate, 1, awaitDispatch = false) }
            assertTrue(entered.await(5, TimeUnit.SECONDS), "the canvas message must reach its transport boundary")
            assertEquals(204, movement.get(3, TimeUnit.SECONDS).response.status, "the accepted position must not wait on a stream")
            val save = workers.submit<MvcResult> {
                mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                    contentType = MediaType.APPLICATION_JSON
                    content = mapper.writeValueAsString(mapOf("type" to "room_editor_mode_update", "sessionId" to owner.sessionId,
                        "eventToken" to owner.token, "roomEditorMode" to "diagram", "expectedRoomEditorModeRevision" to 0))
                }.andReturn()
            }
            assertEquals(204, save.get(3, TimeUnit.SECONDS).response.status)
            assertEquals("diagram", rooms.findById(requireNotNull(room.id)).orElseThrow().roomEditorMode)
            assertFalse(transactionHeld.get(), "the transport must not hold a room transaction")
            assertFalse(monitorHeld.get(), "the transport must not hold the workspace monitor")
            release.countDown()
            awaitCanvasDispatch(room.inviteCode)
        } finally {
            release.countDown()
            emitters.replace(connectionId, emitter, liveEmitter)
            workers.shutdownNow()
        }
    }

    @Test fun `connection renewal rejects old proof and leaving removes cursor`() {
        val room = room(); val candidate = stream(room); val observer = stream(room, true)
        pointer(room, observer, 1, visible = false)
        pointer(room, candidate, 1)
        val renewed = stream(room, sessionId = candidate.sessionId)
        assertEquals(403, pointer(room, candidate, 10).response.status)
        await().atMost(5, TimeUnit.SECONDS).until { snapshot(observer).path("cursors").isEmpty }
        assertEquals(204, pointer(room, renewed, 1).response.status)
        assertEquals(1, snapshot(observer).path("cursors").size())
        assertEquals(204, pointer(room, renewed, 2, active = false).response.status)
        assertTrue(snapshot(observer).path("cursors").isEmpty)
        assertEquals(400, pointer(room, observer, 2, canvas = "code").response.status)
    }

    @Test fun `cursor update overlapping a disconnect cannot leave an orphan position`() {
        val room = room()
        val candidate = stream(room)
        val target = AopTestUtils.getUltimateTargetObject<CollaborationService>(collaboration)
        @Suppress("UNCHECKED_CAST")
        val sessions = ReflectionTestUtils.getField(target, "connectionByRoomSession") as Map<String, String>
        val connectionId = sessions.getValue("${room.inviteCode}::${candidate.sessionId}")
        val cursors = ReflectionTestUtils.getField(target, "canvasPresence") as Map<*, *>
        val workspaceLock = requireNotNull(ReflectionTestUtils.invokeMethod<Any>(target, "managerWorkspaceRoomLock", room.inviteCode))
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pausedOnce = AtomicBoolean(false)
        Mockito.doAnswer { call ->
            if (Thread.holdsLock(workspaceLock) && pausedOnce.compareAndSet(false, true)) {
                entered.countDown()
                check(release.await(8, TimeUnit.SECONDS))
            }
            call.callRealMethod()
        }.`when`(clock).millis()
        val workers = Executors.newFixedThreadPool(2)
        try {
            val movement = workers.submit<MvcResult> { pointer(room, candidate, 1, awaitDispatch = false) }
            assertTrue(entered.await(5, TimeUnit.SECONDS), "the accepted update should pause before storing its cursor")
            val leaving = workers.submit<MvcResult> {
                mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                    contentType = MediaType.APPLICATION_JSON
                    content = mapper.writeValueAsString(mapOf("type" to "leave_room", "sessionId" to candidate.sessionId,
                        "eventToken" to candidate.token))
                }.andReturn()
            }
            assertEquals(204, leaving.get(3, TimeUnit.SECONDS).response.status)
            release.countDown()
            assertEquals(204, movement.get(5, TimeUnit.SECONDS).response.status)
            awaitCanvasDispatch(room.inviteCode)
            assertFalse(cursors.containsKey(connectionId), "closing the connection must remove its temporary cursor")
            val reconnected = stream(room, sessionId = candidate.sessionId)
            assertEquals(204, pointer(room, reconnected, 1).response.status)
            assertTrue(cursors.containsKey(sessions.getValue("${room.inviteCode}::${candidate.sessionId}")))
        } finally {
            release.countDown()
            workers.shutdownNow()
            Mockito.reset(clock)
        }
    }

    @Test fun `cursor dispatch waits for publication and rechecks candidate task access`() {
        val room = room(); val oldTask = task(room, 0); task(room, 1)
        val candidate = stream(room)
        val worker = Executors.newSingleThreadExecutor()
        try {
            postgres.connection().use { publication ->
                publication.autoCommit = false
                val holder = publication.createStatement().use { statement ->
                    statement.executeQuery("SELECT pg_backend_pid()").use { it.next(); it.getInt(1) }
                }
                publication.prepareStatement("UPDATE rooms SET current_step=1 WHERE id=?").use { statement ->
                    statement.setString(1, room.id); statement.executeUpdate()
                }
                val pending = worker.submit<MvcResult> { pointer(room, candidate, 1, taskId = oldTask) }
                await().atMost(5, TimeUnit.SECONDS).until {
                    jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))", Int::class.java, holder)!! > 0
                }
                publication.commit()
                assertEquals(404, pending.get(5, TimeUnit.SECONDS).response.status)
            }
        } finally { worker.shutdownNow() }
    }

    @Test fun `late blur from another tab cannot hide the active account cursor`() {
        val room = room()
        val account = HrHttpFixtures.register(mvc, mapper, false, "cursor").first
        val oldTab = stream(room, account = account)
        val activeTab = stream(room, account = account)
        val observer = stream(room, true)
        pointer(room, observer, 1, visible = false)
        pointer(room, oldTab, 1)
        val id = snapshot(observer).path("cursors").single().path("id").asText()
        pointer(room, activeTab, 1)
        pointer(room, oldTab, 2, active = false, visible = false)
        assertEquals(1, snapshot(observer).path("cursors").size())
        assertEquals(id, snapshot(observer).path("cursors").single().path("id").asText())
        pointer(room, activeTab, 2)
        assertEquals(1, snapshot(observer).path("cursors").size())
        assertTrue(snapshot(activeTab).path("cursors").isEmpty)
        pointer(room, activeTab, 3, visible = false)
        assertTrue(snapshot(observer).path("cursors").isEmpty)
        pointer(room, oldTab, 3)
        pointer(room, activeTab, 4)
        // The older tab vanished before sending its blur. Leaving the new tab
        // must not restore the old visible position from its unexpired lease.
        pointer(room, activeTab, 5, active = false, visible = false)
        assertTrue(snapshot(observer).path("cursors").isEmpty)
    }

    @Test fun `detaching streams never waits for a room lock while closing the lifecycle registry`() {
        val room = room(); val candidate = stream(room); val observer = stream(room, true)
        pointer(room, observer, 1, visible = false)
        pointer(room, candidate, 1)
        val worker = Executors.newSingleThreadExecutor()
        try {
            postgres.connection().use { holder ->
                holder.autoCommit = false
                holder.prepareStatement("SELECT id FROM rooms WHERE id=? FOR UPDATE").use { statement ->
                    statement.setString(1, room.id); statement.executeQuery().close()
                }
                try {
                    // Heartbeat lease loss invokes closeRoom while holding the
                    // lifecycle registry. Detach must not introduce registry -> row.
                    worker.submit { collaboration.closeRoom(room.inviteCode) }.get(2, TimeUnit.SECONDS)
                } finally { holder.rollback() }
            }
        } finally { worker.shutdownNow() }
    }

    @Test fun `background snapshot cannot overwrite a newer cursor with a higher revision`() {
        val room = room()
        val account = HrHttpFixtures.register(mvc, mapper, false, "cursororder").first
        val candidate = stream(room, account = account); val observer = stream(room, true)
        pointer(room, observer, 1, visible = false)
        pointer(room, candidate, 1)
        val baseline = messages(observer.result).count { it.path("type").asText() == "canvas_cursor_snapshot" }
        val captured = CountDownLatch(1); val release = CountDownLatch(1)
        val once = AtomicBoolean(false)
        val storedParticipant = roomParticipants.findByRoomIdAndUserId(requireNotNull(room.id), account.id)
        Mockito.doAnswer {
            if (Thread.currentThread().name == "canvas-background-snapshot" && once.compareAndSet(false, true)) {
                captured.countDown()
                check(release.await(5, TimeUnit.SECONDS))
            }
            storedParticipant
        }.`when`(roomParticipants).findByRoomIdAndUserId(requireNotNull(room.id), account.id)
        val background = Executors.newSingleThreadExecutor { Thread(it, "canvas-background-snapshot") }
        val movement = Executors.newSingleThreadExecutor()
        try {
            val target = AopTestUtils.getUltimateTargetObject<CollaborationService>(collaboration)
            val stale = background.submit { ReflectionTestUtils.invokeMethod<Unit>(target, "broadcastCanvasPresence", room.inviteCode) }
            assertTrue(captured.await(5, TimeUnit.SECONDS), "background snapshot must have captured the old position")
            val newer = movement.submit<MvcResult> { pointer(room, candidate, 2, x = 99.0) }
            // With serialization the movement waits for capture->dispatch. The
            // unfixed path finishes here, then sends its older higher revision.
            try { newer.get(1, TimeUnit.SECONDS) } catch (_: TimeoutException) { }
            release.countDown()
            stale.get(5, TimeUnit.SECONDS)
            assertEquals(204, newer.get(5, TimeUnit.SECONDS).response.status)
            val received = messages(observer.result).filter { it.path("type").asText() == "canvas_cursor_snapshot" }
                .drop(baseline).map { it.path("payload") }.sortedBy { it.path("sequence").asLong() }
            val coordinates = received.mapNotNull { it.path("cursors").singleOrNull()?.path("x")?.asDouble() }
            val firstNew = coordinates.indexOf(99.0)
            assertTrue(firstNew >= 0, "new position must arrive")
            assertTrue(coordinates.drop(firstNew).all { it == 99.0 }, "newer snapshot revisions must never restore the old position: $coordinates")
        } finally {
            release.countDown(); background.shutdownNow(); movement.shutdownNow()
            Mockito.reset(roomParticipants)
        }
    }

    private fun room() = rooms.saveAndFlush(Room(title = "Canvas presence", inviteCode = "cursor-${UUID.randomUUID()}", ownerSessionToken = "owner-${UUID.randomUUID()}", interviewerSessionToken = "manager-${UUID.randomUUID()}"))
    private fun task(room: Room, index: Int): String {
        val id = UUID.randomUUID().toString()
        jdbc.update("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,language) VALUES (?,?,?,'Task','','','nodejs')", id, room.id, index)
        return id
    }
    private data class Connection(val sessionId: String, val token: String, val result: MvcResult)
    private fun stream(room: Room, owner: Boolean = false, sessionId: String = UUID.randomUUID().toString(), account: HrTestAccount? = null): Connection {
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("displayName", if (owner) "Owner" else "Candidate")
            if (owner) param("ownerToken", room.ownerSessionToken)
            account?.let { param("authToken", it.token) }
        }.andReturn()
        assertEquals(200, result.response.status)
        val state = messages(result).last { it.path("type").asText() == "state_sync" }.path("payload")
        return Connection(sessionId, state.path("eventToken").asText(), result)
    }
    private fun pointer(room: Room, connection: Connection, sequence: Int, taskId: String = "", canvas: String = "whiteboard", visible: Boolean = true, active: Boolean = true, x: Double = 42.5, subscribed: Boolean? = true, modeRevision: Int = 0, awaitDispatch: Boolean = true) = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("type" to "canvas_cursor_update", "sessionId" to connection.sessionId, "eventToken" to connection.token,
            "taskId" to taskId, "canvasType" to canvas, "canvasSequence" to sequence, "canvasVisible" to visible, "canvasActive" to active, "canvasSubscribed" to subscribed,
            "canvasX" to x, "canvasY" to -8.0, "expectedRoomEditorModeRevision" to modeRevision))
    }.andReturn().also { result ->
        if (result.response.status == 204 && awaitDispatch) awaitCanvasDispatch(room.inviteCode)
    }

    private fun awaitCanvasDispatch(inviteCode: String) {
        val target = AopTestUtils.getUltimateTargetObject<CollaborationService>(collaboration)
        val pending = ReflectionTestUtils.getField(target, "pendingCanvasPresenceBroadcasts") as Set<*>
        val running = ReflectionTestUtils.getField(target, "runningCanvasPresenceBroadcasts") as Set<*>
        await().atMost(5, TimeUnit.SECONDS).until { inviteCode !in pending && inviteCode !in running }
    }
    private fun messages(result: MvcResult) = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }.toList()
    private fun snapshot(connection: Connection): JsonNode = messages(connection.result).last { it.path("type").asText() == "canvas_cursor_snapshot" }.path("payload")
}
