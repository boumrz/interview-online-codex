package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.RoomKeystrokeEvent
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.KeystrokePersistenceService
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.mock.mockito.SpyBean
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Cursor, durable reconstruction and security invariants are tested below the browser layer. */
@SpringBootTest(properties = [
    "spring.jpa.open-in-view=false",
    "spring.datasource.url=jdbc:h2:mem:activity_history_test;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
])
@AutoConfigureMockMvc
class CandidateActivityHistoryIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val events: RoomKeystrokeEventRepository,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val collaboration: CollaborationService,
    @Autowired private val transactions: PlatformTransactionManager,
) {
    @SpyBean private lateinit var persistence: KeystrokePersistenceService
    private val fixtures = mutableListOf<ActivityHttpFixture>()

    @AfterEach fun cleanup() {
        Mockito.reset(persistence)
        fixtures.forEach { collaboration.closeRoom(it.room.inviteCode) }
    }

    @Test fun `latest and older pages traverse all 451 identities despite equal and backward timestamps`() {
        val f = fixture()
        seed(f, 1L..451L)
        val foreign = fixture()
        seed(foreign, 1L..2L)
        var page = history(f)
        assertEquals(200, page.path("events").size())
        assertEquals(252L, page.path("nextBeforeSequence").asLong())
        assertEquals(451L, page.path("throughSequence").asLong())
        val loaded = mutableListOf<JsonNode>()
        repeat(3) {
            assertCanonical(page)
            loaded += page.path("events").toList()
            assertTrue(page.path("nextAfterSequence").isNull)
            if (page.path("hasMore").asBoolean()) {
                page = history(f, "beforeSequence=${page.path("nextBeforeSequence").asLong()}&throughSequence=451")
            }
        }
        assertEquals(451, loaded.size)
        assertEquals((1L..451L).toSet(), loaded.map { it.path("acceptedSequence").asLong() }.toSet())
        assertEquals(451, loaded.map { it.path("sourceEventId").asText() }.toSet().size)
        assertFalse(page.path("hasMore").asBoolean())
        assertTrue(page.path("nextBeforeSequence").isNull)
        assertEquals(" ", loaded.single { it.path("acceptedSequence").asLong() == 1L }.path("key").asText())
        assertEquals("Space", loaded.single { it.path("acceptedSequence").asLong() == 1L }.path("keyCode").asText())
    }

    @Test fun `catch up freezes the committed upper boundary while new backwards-clock activity is appended`() {
        val f = fixture()
        seed(f, 1L..451L)
        var page = history(f, "afterSequence=0")
        assertEquals(200L, page.path("nextAfterSequence").asLong())
        seed(f, 452L..453L)
        val loaded = mutableListOf<Long>()
        repeat(3) {
            assertCanonical(page)
            loaded += page.path("events").map { it.path("acceptedSequence").asLong() }
            assertTrue(page.path("nextBeforeSequence").isNull)
            assertEquals(451L, page.path("throughSequence").asLong())
            if (page.path("hasMore").asBoolean()) {
                page = history(f, "afterSequence=${page.path("nextAfterSequence").asLong()}&throughSequence=451")
            }
        }
        assertEquals(451, loaded.size)
        assertEquals((1L..451L).toSet(), loaded.toSet())
        assertFalse(page.path("hasMore").asBoolean())
        assertTrue(page.path("nextAfterSequence").isNull)
        assertEquals(setOf(452L, 453L), history(f, "afterSequence=451").path("events").map { it.path("acceptedSequence").asLong() }.toSet())
    }

    @Test fun `future cursors clamp to committed rows and never certify uncommitted activity`() {
        val f = fixture()
        seed(f, 1L..3L)
        val page = history(f, "throughSequence=${Long.MAX_VALUE}&beforeSequence=${Long.MAX_VALUE}&limit=1")
        assertEquals(3L, page.path("throughSequence").asLong())
        assertEquals(3L, page.path("nextBeforeSequence").asLong())
        assertEquals(setOf(1L, 2L), history(f, "throughSequence=3&beforeSequence=3").path("events").map { it.path("acceptedSequence").asLong() }.toSet())
        val empty = history(f, "afterSequence=${Long.MAX_VALUE}&throughSequence=${Long.MAX_VALUE}")
        assertEquals(3L, empty.path("throughSequence").asLong())
        assertEquals(0, empty.path("events").size())
        assertFalse(empty.path("hasMore").asBoolean())
        seed(f, 4L..4L)
        assertEquals(4L, history(f, "afterSequence=3").path("events").single().path("acceptedSequence").asLong())
    }

    @Test fun `empty and malformed requests have explicit bounded results`() {
        val f = fixture()
        val empty = history(f)
        assertEquals(0, empty.path("events").size())
        assertEquals(0L, empty.path("throughSequence").asLong())
        assertFalse(empty.path("hasMore").asBoolean())
        assertTrue(empty.path("nextBeforeSequence").isNull)
        assertTrue(empty.path("nextAfterSequence").isNull)
        listOf("limit=0", "limit=201", "limit=abc", "limit=", "beforeSequence=", "afterSequence=", "throughSequence=", "beforeSequence=-1", "afterSequence=-1", "throughSequence=-1", "afterSequence=0&beforeSequence=3", "throughSequence=9223372036854775808").forEach { query ->
            assertEquals(400, f.getHistory(query).response.status, query)
        }
        assertEquals(404, mvc.get("/api/rooms/missing-${UUID.randomUUID()}/activity-history") {
            header("Authorization", "Bearer ${f.owner.token}")
        }.andReturn().response.status)
    }

    @Test fun `history JSON always contains explicit null cursors when no continuation remains`() {
        val f = fixture()
        val empty = history(f)
        seed(f, 1L..1L)
        val finalLatest = history(f)
        val finalOlder = history(f, "beforeSequence=2&throughSequence=1")
        val finalCatchUp = history(f, "afterSequence=0&throughSequence=1")
        listOf(empty, finalLatest, finalOlder, finalCatchUp).forEach { page ->
            assertTrue(page.has("nextBeforeSequence"), "history must include nextBeforeSequence")
            assertTrue(page.has("nextAfterSequence"), "history must include nextAfterSequence")
            assertTrue(page.get("nextBeforeSequence").isNull)
            assertTrue(page.get("nextAfterSequence").isNull)
            assertFalse(page.path("hasMore").asBoolean())
        }
    }

    @Test fun `current manager access admits JWT and promoted guests and denies candidates revoked tokens and other rooms`() {
        val f = fixture()
        seed(f, 1L..1L)
        val owner = f.join(f.owner.token)
        val guest = f.join()
        val candidateAccount = HrHttpFixtures.register(mvc, mapper, false, "activity-member").first
        val candidate = f.join(candidateAccount.token)
        assertEquals(403, f.getHistory(token = null, eventToken = guest.token).response.status)
        assertEquals(403, f.getHistory(token = candidateAccount.token).response.status)
        listOf(guest, candidate).forEach { stream ->
            assertEquals(204, f.post(owner, "grant_interviewer_access", mapOf("targetSessionId" to stream.session)).response.status)
        }
        assertEquals(200, f.getHistory(token = null, eventToken = guest.token).response.status)
        assertEquals(200, f.getHistory(token = candidateAccount.token).response.status)
        val other = fixture()
        assertEquals(403, other.getHistory(token = null, eventToken = guest.token).response.status)
        listOf(guest, candidate).forEach { stream ->
            assertEquals(204, f.post(owner, "revoke_interviewer_access", mapOf("targetSessionId" to stream.session)).response.status)
        }
        assertEquals(403, f.getHistory(token = null, eventToken = guest.token).response.status)
        assertEquals(403, f.getHistory(token = candidateAccount.token, eventToken = candidate.token).response.status)
        TransactionTemplate(transactions).executeWithoutResult {
            val room = rooms.findById(f.room.id).orElseThrow()
            room.archivedAt = Instant.now()
            rooms.saveAndFlush(room)
        }
        assertEquals(410, f.getHistory().response.status)
    }

    @Test fun `public manager join reconstructs a bounded durable tail after volatile loss and stale JSON`() {
        val f = fixture()
        seed(f, 1L..75L)
        collaboration.closeRoom(f.room.inviteCode)
        TransactionTemplate(transactions).executeWithoutResult {
            val room = rooms.findById(f.room.id).orElseThrow()
            room.candidateKeyHistory = "[]"
            rooms.saveAndFlush(room)
        }
        val manager = f.join(f.owner.token)
        val restored = f.messages(manager).last { it.path("type").asText() == "state_sync" }.path("payload").path("candidateKeyHistory")
        assertEquals(50, restored.size())
        assertEquals((26L..75L).toSet(), restored.map { it.path("acceptedSequence").asLong() }.toSet())
        val candidate = f.join()
        assertFalse(f.messages(candidate).last().path("payload").hasNonNull("candidateKeyHistory"))
    }

    @Test fun `activity acceptance racing state replacement remains in the next public manager snapshot`() {
        val f = fixture()
        val manager = f.join(f.owner.token)
        val candidate = f.join()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        Mockito.doAnswer { call ->
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            call.callRealMethod()
        }.`when`(persistence).accept(anyString(), anyArgument())
        val source = UUID.randomUUID().toString()
        val post = CompletableFuture.supplyAsync { f.post(candidate, "key_press", mapOf("key" to "a", "keyCode" to "KeyA", "sourceEventId" to source)).response.status }
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            TransactionTemplate(transactions).executeWithoutResult {
                collaboration.syncFromRoom(rooms.findWithTasksByInviteCode(f.room.inviteCode)!!)
            }
        } finally { release.countDown() }
        assertEquals(204, post.get(5, TimeUnit.SECONDS))
        assertEquals(204, f.post(manager, "request_state_sync").response.status)
        val latest = f.messages(manager).last { it.path("type").asText() == "state_sync" }.path("payload").path("candidateKeyHistory")
        assertEquals(listOf(source), latest.map { it.path("sourceEventId").asText() })
    }

    private fun fixture() = ActivityHttpFixture(mvc, mapper).also(fixtures::add)
    private fun seed(f: ActivityHttpFixture, sequences: LongRange) {
        events.saveAllAndFlush(sequences.map { sequence ->
            RoomKeystrokeEvent(roomId = f.room.id, sessionId = "candidate", displayName = "Candidate", keyValue = if (sequence == 1L) " " else "a", keyCode = if (sequence == 1L) "Space" else "KeyA", timestampEpochMs = 10_000L - sequence / 2, sourceEventId = UUID.randomUUID().toString(), acceptedSequence = sequence)
        })
    }
    private fun history(f: ActivityHttpFixture, query: String = ""): JsonNode {
        val result = f.getHistory(query)
        assertEquals(200, result.response.status, result.response.contentAsString)
        assertTrue(result.response.getHeader("Cache-Control").orEmpty().contains("no-store"))
        return mapper.readTree(result.response.contentAsString)
    }
    private fun assertCanonical(page: JsonNode) {
        val pairs = page.path("events").map { it.path("timestampEpochMs").asLong() to it.path("acceptedSequence").asLong() }
        assertEquals(pairs.sortedWith(compareBy<Pair<Long, Long>> { it.first }.thenBy { it.second }), pairs)
        assertTrue(pairs.size <= 200)
    }
    @Suppress("UNCHECKED_CAST") private fun <T> anyArgument(): T { Mockito.any<T>(); return null as T }
}

internal data class ActivityStream(val session: String, val token: String, val response: MvcResult)

/** Uses real MVC SSE output, without private emitter/state reflection. */
internal class ActivityHttpFixture(private val mvc: MockMvc, private val mapper: ObjectMapper) {
    val owner = HrHttpFixtures.register(mvc, mapper, false, "activity-owner").first
    val room = HrHttpFixtures.createRoom(mvc, mapper, owner)

    fun getHistory(query: String = "", token: String? = owner.token, eventToken: String? = null): MvcResult = mvc.get("/api/rooms/${room.inviteCode}/activity-history?$query") {
        token?.let { header("Authorization", "Bearer $it") }
        eventToken?.let { header("X-Room-Event-Token", it) }
    }.andReturn()

    fun join(token: String? = null): ActivityStream {
        val session = UUID.randomUUID().toString()
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session)
            param("displayName", "Activity participant")
            token?.let { header("Authorization", "Bearer $it") }
        }.andReturn()
        assertEquals(200, result.response.status, result.response.contentAsString)
        val eventToken = messages(result).last { it.path("type").asText() == "state_sync" }.path("payload").path("eventToken").asText()
        assertTrue(eventToken.startsWith("evt_"))
        return ActivityStream(session, eventToken, result)
    }

    fun post(stream: ActivityStream, type: String, fields: Map<String, Any> = emptyMap()): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to stream.session, "eventToken" to stream.token, "type" to type) + fields)
    }.andReturn()

    fun messages(stream: ActivityStream) = messages(stream.response)
    private fun messages(result: MvcResult): List<JsonNode> = result.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }.toList()
}
