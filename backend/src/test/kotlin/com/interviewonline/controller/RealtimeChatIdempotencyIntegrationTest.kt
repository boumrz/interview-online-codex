package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.interviewonline.InterviewOnlineApplication
import com.interviewonline.repository.RoomRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.context.WebApplicationContext
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val CHAT_RECEIPT_TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
private const val GUEST_RECONNECT_COOKIE = "io_guest_reconnect"
private const val ACTIVE_RECEIPT_CAPACITY = 4096
private val MOCK_SYNTHESIZED_EXPIRES = Regex(
    "^Expires=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), " +
        "\\d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) " +
        "\\d{4} \\d{2}:\\d{2}:\\d{2} GMT$",
)

/**
 * INT-04 RED contract for durable interviewer-chat delivery.
 *
 * This suite deliberately exercises the public realtime HTTP/SSE boundary and
 * a real PostgreSQL 16 schema. It must turn green only after the relay returns
 * a post-commit ACK and persists v2 dedupe receipts; no test-only production
 * endpoint or in-memory receipt substitute is used here.
 */
@SpringBootTest(properties = [
    "app.realtime.chat-receipt-hmac-secret=$CHAT_RECEIPT_TEST_SECRET",
    "spring.jpa.open-in-view=false",
])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(RealtimeChatIdempotencyClockTestConfiguration::class)
class RealtimeChatIdempotencyIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val transactionManager: PlatformTransactionManager,
    @Autowired private val testClock: AdjustableRealtimeChatClock,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("realtime_chat_idempotency")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `UUID intent returns a durable byte-equivalent ACK before stale sequence while legacy remains 204`() {
        postgres.verifyPostgres16()
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-ack-owner").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Chat ACK contract")
        val stream = join(mockMvc, room, authToken = owner.token)
        val clientMessageId = UUID.randomUUID().toString()

        val first = postChat(
            mockMvc,
            room,
            stream,
            clientMessageId = clientMessageId,
            text = "  Сообщение сохранено один раз  ",
            clientEventSequence = 77,
        )
        val firstAck = assertAck(first, clientMessageId)

        // The original sequence is intentionally reused. Dedupe has to run
        // before the generic stale clientEventSequence guard.
        val exactRetry = postChat(
            mockMvc,
            room,
            stream,
            clientMessageId = clientMessageId,
            text = "Сообщение сохранено один раз",
            clientEventSequence = 77,
        )
        assertAck(exactRetry, clientMessageId)
        assertEquals(first.response.contentAsString, exactRetry.response.contentAsString)

        val storedAfterRetry = storedThread(room)
        assertV2Thread(storedAfterRetry)
        assertEquals(1, storedAfterRetry.path("messages").size())
        assertEquals("Сообщение сохранено один раз", storedAfterRetry.path("messages")[0].path("text").asText())
        assertEquals(firstAck.path("messageId").asText(), storedAfterRetry.path("messages")[0].path("id").asText())
        assertEquals(1, storedAfterRetry.path("receipts").size())

        val beforeInvalid = storedChatJson(room)
        val invalid = postChat(mockMvc, room, stream, "not-a-uuid", "Не записывать", 78)
        assertError(invalid, 400, "INVALID_CLIENT_MESSAGE_ID")
        assertEquals(beforeInvalid, storedChatJson(room), "invalid UUID must not mutate the durable thread")

        val changedBody = postChat(mockMvc, room, stream, clientMessageId, "Другой текст", 77)
        assertError(changedBody, 409, "CLIENT_MESSAGE_ID_REUSED")
        assertEquals(beforeInvalid, storedChatJson(room), "reused UUID with changed text must not mutate the durable thread")

        val legacy = postChat(
            mockMvc,
            room,
            stream,
            clientMessageId = null,
            text = "Legacy сообщение",
            clientEventSequence = 78,
        )
        assertEquals(204, legacy.response.status)
        assertEquals("", legacy.response.contentAsString)
        val storedAfterLegacy = storedThread(room)
        assertEquals(2, storedAfterLegacy.path("messages").size(), "204 is returned only after the legacy message is durable")
        assertEquals(1, storedAfterLegacy.path("receipts").size(), "legacy writes must not manufacture a client receipt")
    }

    @Test
    fun `twenty concurrent exact retries produce one message one receipt one broadcast and identical ACKs`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-exact-race").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Exact retry race")
        val sender = join(mockMvc, room, authToken = owner.token, participantId = "race-sender")
        val observer = join(mockMvc, room, authToken = owner.token, participantId = "race-observer")
        val observerBaseline = sseMessages(observer.response).size
        val clientMessageId = UUID.randomUUID().toString()

        val ready = CountDownLatch(20)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(20)
        val results = try {
            val futures = (1..20).map {
                executor.submit<MvcResult> {
                    ready.countDown()
                    assertTrue(start.await(10, TimeUnit.SECONDS), "concurrent exact retries were not released")
                    postChat(mockMvc, room, sender, clientMessageId, "Один конкурентный intent", 101)
                }
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS), "all twenty requests must reach the start barrier")
            start.countDown()
            futures.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            start.countDown()
            executor.shutdownNow()
        }

        assertEquals(setOf(200), results.map { it.response.status }.toSet())
        assertEquals(1, results.map { it.response.contentAsByteArray.toList() }.distinct().size,
            "all exact retries must receive the byte-equivalent persisted ACK")
        results.forEach { assertAck(it, clientMessageId) }

        val ack = objectMapper.readTree(results.first().response.contentAsString)
        val thread = storedThread(room)
        assertV2Thread(thread)
        assertEquals(1, thread.path("messages").size())
        assertEquals(1, thread.path("receipts").size())
        assertEquals(clientMessageId, thread.path("receipts")[0].path("clientMessageId").asText())

        val framesAfterStart = sseMessages(observer.response).drop(observerBaseline)
        val framesWithMessage = framesAfterStart.count { frame ->
            frame.path("type").asText() == "state_sync" &&
                frame.path("payload").path("notesMessages").any { it.path("id").asText() == ack.path("messageId").asText() }
        }
        assertEquals(1, framesWithMessage, "one committed logical message must create one observer broadcast")
    }

    @Test
    fun `concurrent changed body has one winner and one reuse conflict`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-conflict-race").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Changed-body race")
        val sender = join(mockMvc, room, authToken = owner.token)
        val clientMessageId = UUID.randomUUID().toString()
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        val results = try {
            listOf("Первый конкурент", "Второй конкурент").map { text ->
                executor.submit<MvcResult> {
                    ready.countDown()
                    assertTrue(start.await(10, TimeUnit.SECONDS))
                    postChat(mockMvc, room, sender, clientMessageId, text, 202)
                }
            }.also {
                assertTrue(ready.await(10, TimeUnit.SECONDS))
                start.countDown()
            }.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            start.countDown()
            executor.shutdownNow()
        }

        assertEquals(listOf(200, 409), results.map { it.response.status }.sorted())
        assertAck(results.single { it.response.status == 200 }, clientMessageId)
        assertError(results.single { it.response.status == 409 }, 409, "CLIENT_MESSAGE_ID_REUSED")
        val thread = storedThread(room)
        assertEquals(1, thread.path("messages").size())
        assertEquals(1, thread.path("receipts").size())
        assertTrue(thread.path("messages")[0].path("text").asText() in setOf("Первый конкурент", "Второй конкурент"))
    }

    @Test
    fun `server sender namespace uses stable HMAC identity and never projects receipts`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-hmac-owner").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Sender HMAC namespace")
        val persistedRoom = roomRepository.findById(room.id).orElseThrow()
        val ownerToken = persistedRoom.ownerSessionToken
        val clientMessageId = UUID.randomUUID().toString()

        // Authentication wins even though a valid owner link and forged
        // payload identity hints are present in the same request/session.
        val authenticated = join(
            mockMvc,
            room,
            authToken = owner.token,
            ownerToken = ownerToken,
            participantId = "authenticated-principal",
        )
        val authenticatedResult = postChat(
            mockMvc,
            room,
            authenticated,
            clientMessageId,
            "Одинаковый UUID — пользователь",
            301,
            mapOf(
                "userId" to "forged-user",
                "senderIdentity" to "forged-sender",
                "displayName" to "Forged display name",
                "role" to "owner",
                "noteId" to "forged-note-identity",
            ),
        )
        val authenticatedAck = assertAck(authenticatedResult, clientMessageId)

        val ownerLink = join(
            mockMvc,
            room,
            ownerToken = ownerToken,
            participantId = "owner-link-principal",
        )
        val ownerLinkResult = postChat(
            mockMvc,
            room,
            ownerLink,
            clientMessageId,
            "Одинаковый UUID — owner link",
            301,
            mapOf("senderIdentity" to owner.id, "role" to "candidate"),
        )
        val ownerLinkAck = assertAck(ownerLinkResult, clientMessageId)
        assertNotEquals(authenticatedAck.path("messageId").asText(), ownerLinkAck.path("messageId").asText(),
            "the same client UUID belongs to independent valid sender namespaces")

        val thread = storedThread(room)
        assertV2Thread(thread)
        assertEquals(2, thread.path("messages").size())
        assertEquals(2, thread.path("receipts").size())
        val senderKeys = thread.path("receipts").map { it.path("senderKey").asText() }.toSet()
        assertEquals(
            setOf(
                expectedSenderKey(room.id, "user", owner.id),
                expectedSenderKey(room.id, "owner-link", ownerToken),
            ),
            senderKeys,
            "payload identity, display name, role, session and note id must not select the sender namespace",
        )
        thread.path("receipts").forEach { receipt ->
            assertEquals(
                setOf("senderKey", "clientMessageId", "requestHash", "messageId", "persistedAtEpochMs", "expiresAtEpochMs"),
                receipt.fieldNames().asSequence().toSet(),
            )
            assertTrue(Regex("^h1:[0-9a-f]{64}$").matches(receipt.path("senderKey").asText()))
            assertTrue(Regex("^[0-9a-f]{64}$").matches(receipt.path("requestHash").asText()))
        }

        val storedRaw = storedChatJson(room)
        assertFalse(storedRaw.contains(ownerToken), "validated owner token must never be stored raw")
        assertFalse(storedRaw.contains(owner.id), "persisted user subject must never be stored raw in a receipt")
        listOf(authenticated.response, ownerLink.response).forEach { streamResponse ->
            assertFalse(streamResponse.response.contentAsString.contains("receipts"))
            assertFalse(streamResponse.response.contentAsString.contains("senderKey"))
            assertFalse(streamResponse.response.contentAsString.contains("requestHash"))
        }
        val restProjection = mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn()
        assertEquals(200, restProjection.response.status)
        assertFalse(restProjection.response.contentAsString.contains("receipts"))
        assertFalse(restProjection.response.contentAsString.contains("senderKey"))
        assertFalse(restProjection.response.contentAsString.contains("requestHash"))
    }

    @Test
    fun `PERSONAL revoke is authorized before receipt lookup and cannot ACK or mutate an exact retry`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-revoke-owner").first
        val manager = HrHttpFixtures.register(mockMvc, objectMapper, true, "chat-revoke-manager").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Revoke before receipt")
        assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, room, manager).response.status)
        val managerStream = join(mockMvc, room, authToken = manager.token, participantId = "revoked-manager")
        val clientMessageId = UUID.randomUUID().toString()
        val first = postChat(mockMvc, room, managerStream, clientMessageId, "До отзыва", 401)
        assertAck(first, clientMessageId)

        mockMvc.post("/api/rooms/${room.inviteCode}/participants/${manager.id}/role") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"role":"candidate"}"""
        }.andExpect { status { isOk() } }
        val afterCommittedRevoke = storedChatJson(room)
        val framesAfterCommittedRevoke = sseMessages(managerStream.response).size

        val retry = postChat(mockMvc, room, managerStream, clientMessageId, "До отзыва", 401)
        assertError(retry, 403, "ROOM_ACCESS_DENIED")
        assertEquals(afterCommittedRevoke, storedChatJson(room), "revoked retry must not mutate messages or receipts")
        assertEquals(framesAfterCommittedRevoke, sseMessages(managerStream.response).size,
            "revoked retry must not broadcast protected state or an ACK")
    }

    @Test
    fun `active receipt survives the five hundred visible message cap for at least twenty four hours`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-cap-owner").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Receipt independent of cap")
        val firstStream = join(mockMvc, room, authToken = owner.token)
        val clientMessageId = UUID.randomUUID().toString()
        val first = postChat(mockMvc, room, firstStream, clientMessageId, "Уже вытесненное сообщение", 501)
        val firstAck = assertAck(first, clientMessageId)
        val firstThread = storedThread(room)
        val receipt = firstThread.path("receipts").single()
        assertTrue(
            receipt.path("expiresAtEpochMs").asLong() - receipt.path("persistedAtEpochMs").asLong() >= TimeUnit.HOURS.toMillis(24),
            "receipt expiry is guaranteed for at least twenty four hours",
        )

        // Simulate the durable boundary after later traffic has evicted the
        // original visible message. The active receipt is intentionally kept,
        // then the runtime is rebuilt from the stored v2 envelope.
        collaborationService.closeRoom(room.inviteCode)
        val seededThread = firstThread.deepCopy<JsonNode>()
        val visibleTail = objectMapper.createArrayNode()
        repeat(500) { index ->
            visibleTail.add(messageNode("tail-$index", "tail-session", "Хвост $index", 10_000L + index))
        }
        (seededThread as com.fasterxml.jackson.databind.node.ObjectNode).set<ArrayNode>("messages", visibleTail)
        jdbcTemplate.update("UPDATE rooms SET interviewer_chat=? WHERE id=?", objectMapper.writeValueAsString(seededThread), room.id)

        val retryStream = join(mockMvc, room, authToken = owner.token, participantId = "after-cap-reconnect")
        val retry = postChat(mockMvc, room, retryStream, clientMessageId, "Уже вытесненное сообщение", 501)
        assertAck(retry, clientMessageId)
        assertEquals(first.response.contentAsString, retry.response.contentAsString,
            "an active receipt ACKs the original result even after its visible message left the tail")

        val afterRetry = storedThread(room)
        assertEquals(500, afterRetry.path("messages").size())
        assertFalse(afterRetry.path("messages").any { it.path("id").asText() == firstAck.path("messageId").asText() },
            "dedupe must not reinsert an already-evicted visible message")
        assertEquals(1, afterRetry.path("receipts").size())
        assertEquals(clientMessageId, afterRetry.path("receipts")[0].path("clientMessageId").asText())
    }

    @Test
    fun `legacy array and version one threads are read without eager migration`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-legacy-owner").first
        val arrayRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Legacy array")
        val arrayJson = objectMapper.writeValueAsString(listOf(
            messageMap("legacy-array-id", "legacy-array-session", "Сообщение из массива", 11),
        ))
        collaborationService.closeRoom(arrayRoom.inviteCode)
        jdbcTemplate.update("UPDATE rooms SET interviewer_chat=? WHERE id=?", arrayJson, arrayRoom.id)
        assertEquals(arrayJson, storedChatJson(arrayRoom))
        val arrayStream = join(mockMvc, arrayRoom, authToken = owner.token)
        assertProjectedMessage(arrayStream, "legacy-array-id", "Сообщение из массива")
        assertEquals(arrayJson, storedChatJson(arrayRoom), "read-only legacy array load must not eagerly rewrite storage")

        val v1Room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Legacy version one")
        val v1Json = objectMapper.writeValueAsString(mapOf(
            "version" to 1,
            "messages" to listOf(messageMap("legacy-v1-id", "legacy-v1-session", "Сообщение из v1", 12)),
        ))
        collaborationService.closeRoom(v1Room.inviteCode)
        jdbcTemplate.update("UPDATE rooms SET interviewer_chat=? WHERE id=?", v1Json, v1Room.id)
        assertEquals(v1Json, storedChatJson(v1Room))
        val v1Stream = join(mockMvc, v1Room, authToken = owner.token)
        assertProjectedMessage(v1Stream, "legacy-v1-id", "Сообщение из v1")
        assertEquals(v1Json, storedChatJson(v1Room), "read-only v1 load must not eagerly rewrite storage")
    }

    @Test
    fun `same database and secret preserve user and owner-link receipts while runtime guest expires on restart`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-restart-owner").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Restart receipt contract")
        val ownerToken = roomRepository.findById(room.id).orElseThrow().ownerSessionToken

        val authenticated = join(mockMvc, room, authToken = owner.token, participantId = "restart-user")
        val authenticatedId = UUID.randomUUID().toString()
        val authenticatedFirst = postChat(mockMvc, room, authenticated, authenticatedId, "Authenticated survives", 601)
        assertAck(authenticatedFirst, authenticatedId)

        val ownerLink = join(mockMvc, room, ownerToken = ownerToken, participantId = "restart-owner-link")
        val ownerLinkId = UUID.randomUUID().toString()
        val ownerLinkFirst = postChat(mockMvc, room, ownerLink, ownerLinkId, "Owner link survives", 602)
        assertAck(ownerLinkFirst, ownerLinkId)

        val guestSessionId = "runtime-guest-${UUID.randomUUID()}"
        val guestParticipantId = "runtime-guest-principal-${UUID.randomUUID()}"
        val guest = join(
            mockMvc,
            room,
            sessionId = guestSessionId,
            participantId = guestParticipantId,
        )
        val grant = postEvent(
            mockMvc,
            room,
            authenticated,
            mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
        )
        assertEquals(204, grant.response.status)
        val guestId = UUID.randomUUID().toString()
        val guestFirst = postChat(mockMvc, room, guest, guestId, "Runtime guest intent", 603)
        assertAck(guestFirst, guestId)

        // A server-minted reconnect capability keeps the guest principal and
        // therefore the exact receipt namespace inside the same runtime.
        val reconnectedGuest = join(
            mockMvc,
            room,
            sessionId = guestSessionId,
            participantId = guestParticipantId,
            reconnectCapability = guest.reconnectCapability,
        )
        val guestRetry = postChat(mockMvc, room, reconnectedGuest, guestId, "Runtime guest intent", 603)
        assertAck(guestRetry, guestId)
        assertEquals(guestFirst.response.contentAsString, guestRetry.response.contentAsString)

        var replica: ConfigurableApplicationContext? = null
        try {
            replica = SpringApplicationBuilder(InterviewOnlineApplication::class.java)
                .web(WebApplicationType.SERVLET)
                .run(*replicaProperties().map { (name, value) -> "--$name=$value" }.toTypedArray())
            val replicaMvc = MockMvcBuilders.webAppContextSetup(replica as WebApplicationContext).build()

            val restartedAuthenticated = join(replicaMvc, room, authToken = owner.token, participantId = "restarted-user")
            val authenticatedRetry = postChat(
                replicaMvc,
                room,
                restartedAuthenticated,
                authenticatedId,
                "Authenticated survives",
                601,
            )
            assertAck(authenticatedRetry, authenticatedId)
            assertEquals(authenticatedFirst.response.contentAsString, authenticatedRetry.response.contentAsString)
            assertError(
                postChat(replicaMvc, room, restartedAuthenticated, authenticatedId, "Authenticated changed", 601),
                409,
                "CLIENT_MESSAGE_ID_REUSED",
            )

            val restartedOwnerLink = join(
                replicaMvc,
                room,
                ownerToken = ownerToken,
                participantId = "restarted-owner-link",
            )
            val ownerLinkRetry = postChat(replicaMvc, room, restartedOwnerLink, ownerLinkId, "Owner link survives", 602)
            assertAck(ownerLinkRetry, ownerLinkId)
            assertEquals(ownerLinkFirst.response.contentAsString, ownerLinkRetry.response.contentAsString)
            assertError(
                postChat(replicaMvc, room, restartedOwnerLink, ownerLinkId, "Owner link changed", 602),
                409,
                "CLIENT_MESSAGE_ID_REUSED",
            )

            val oldGuestRetry = postChat(replicaMvc, room, reconnectedGuest, guestId, "Runtime guest intent", 603)
            assertError(oldGuestRetry, 403, "ROOM_ACCESS_DENIED")
        } finally {
            replica?.close()
        }
    }

    @Test
    fun `spoofing a granted guest participant id does not inherit chat authority`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-pid-spoof").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Participant spoof")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val granted = join(
            mockMvc,
            room,
            sessionId = "granted-${UUID.randomUUID()}",
            participantId = "shared-${UUID.randomUUID()}",
        )
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to granted.sessionId),
            ).response.status,
        )

        val spoof = join(
            mockMvc,
            room,
            sessionId = "spoof-${UUID.randomUUID()}",
            participantId = granted.participantId,
        )
        val denied = postChat(mockMvc, room, spoof, UUID.randomUUID().toString(), "Не наследовать grant", 701)

        assertError(denied, 403, "ROOM_ACCESS_DENIED")
        assertEquals(0, storedThread(room).path("messages").size())
    }

    @Test
    fun `spoofing a granted guest session id does not inherit chat authority`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-sid-spoof").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Session spoof")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val granted = join(mockMvc, room, sessionId = "shared-${UUID.randomUUID()}")
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to granted.sessionId),
            ).response.status,
        )

        val spoof = join(
            mockMvc,
            room,
            sessionId = granted.sessionId,
            participantId = "different-${UUID.randomUUID()}",
        )
        val denied = postChat(mockMvc, room, spoof, UUID.randomUUID().toString(), "Не наследовать session grant", 702)

        assertError(denied, 403, "ROOM_ACCESS_DENIED")
        assertEquals(0, storedThread(room).path("messages").size())
    }

    @Test
    fun `server capability preserves a granted guest across a new session without exposing the secret`() {
        testClock.set(Instant.parse("2032-01-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-capability").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Capability reconnect")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val guest = join(mockMvc, room)
        val capability = requireReconnectCapability(guest, room)
        assertReconnectCookieWire(guest, room)
        assertFalse(guest.response.response.contentAsString.contains(capability.substringAfter('=')))
        assertFalse(storedChatJson(room).contains(capability.substringAfter('=')))
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )
        val clientMessageId = UUID.randomUUID().toString()
        val first = postChat(mockMvc, room, guest, clientMessageId, "Capability intent", 703)
        assertAck(first, clientMessageId)

        val reconnect = join(
            mockMvc,
            room,
            sessionId = "capability-new-session-${UUID.randomUUID()}",
            participantId = "capability-new-participant-${UUID.randomUUID()}",
            reconnectCapability = capability,
        )
        assertFalse(
            reconnect.setCookieHeaders.any { it.startsWith("$GUEST_RECONNECT_COOKIE=") },
            "a valid current-room capability must not be exposed again",
        )
        val retry = postChat(mockMvc, room, reconnect, clientMessageId, "Capability intent", 703)
        assertAck(retry, clientMessageId)
        assertEquals(first.response.contentAsString, retry.response.contentAsString)
        assertEquals(1, storedThread(room).path("messages").size())
    }

    @Test
    fun `HTTPS guest admission returns one exact secure room cookie without leaking its capability`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-https-cookie").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "HTTPS capability cookie")

        val guest = join(mockMvc, room, secure = true)
        val capabilityCookie = requireReconnectCapability(guest, room)
        val rawCapability = capabilityCookie.substringAfter('=')
        val header = guest.setCookieHeaders.single { it.startsWith("$GUEST_RECONNECT_COOKIE=") }
        val attributes = header.split(';').map(String::trim)
        val mockSynthesizedExpires = attributes.drop(1).filter(MOCK_SYNTHESIZED_EXPIRES::matches)
        assertEquals(
            1,
            mockSynthesizedExpires.size,
            "Spring MockHttpServletResponse must add exactly its one known RFC1123 Expires artifact",
        )
        val canonicalAttributes = attributes.drop(1).filterNot(MOCK_SYNTHESIZED_EXPIRES::matches)

        assertTrue(Regex("^$GUEST_RECONNECT_COOKIE=grc1_[A-Za-z0-9_-]{43}$").matches(attributes.first()))
        assertEquals(
            setOf(
                "Path=/api/realtime/rooms/${room.inviteCode}/",
                "Max-Age=43200",
                "HttpOnly",
                "Secure",
                "SameSite=Strict",
            ),
            canonicalAttributes.toSet(),
            "HTTPS admission must emit only the exact capability-cookie attributes",
        )
        assertEquals(5, canonicalAttributes.size, "no duplicate capability-cookie attributes are allowed")
        assertEquals(
            listOf(
                "$GUEST_RECONNECT_COOKIE=$rawCapability",
                "Path=/api/realtime/rooms/${room.inviteCode}/",
                "Max-Age=43200",
                "HttpOnly",
                "Secure",
                "SameSite=Strict",
            ),
            buildGuestReconnectCookieHeader(room.inviteCode, rawCapability, secure = true)
                .split(';')
                .map(String::trim),
            "the production header builder must not emit the MockMvc-only Expires artifact",
        )
        assertFalse(header.contains("Domain=", ignoreCase = true), "capability cookie must remain host-only")
        assertFalse(guest.response.response.contentAsString.contains(rawCapability), "SSE payload must not project the capability")
        assertFalse(storedChatJson(room).contains(rawCapability), "durable room state must store no raw capability")

        val roomProjection = mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn()
        assertEquals(200, roomProjection.response.status)
        assertFalse(roomProjection.response.contentAsString.contains(rawCapability), "REST projection must not expose the capability")
        assertFalse(roomProjection.response.contentAsString.contains(GUEST_RECONNECT_COOKIE))
    }

    @Test
    fun `forged capability is replaced generically and never restores a manager grant`() {
        testClock.set(Instant.parse("2032-02-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-forged-cap").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Forged capability")
        val forged = "$GUEST_RECONNECT_COOKIE=grc1_${"A".repeat(43)}"

        val admission = join(mockMvc, room, reconnectCapability = forged)
        val replacement = requireReconnectCapability(admission, room)
        assertTrue(replacement != forged, "forged capability must be replaced without echoing it")
        assertError(
            postChat(mockMvc, room, admission, UUID.randomUUID().toString(), "Forged write", 704),
            403,
            "ROOM_ACCESS_DENIED",
        )
        assertFalse(admission.response.response.contentAsString.contains(forged.substringAfter('=')))
        assertFalse(storedChatJson(room).contains(forged.substringAfter('=')))
    }

    @Test
    fun `capability is room scoped and cross-room reuse becomes a fresh candidate`() {
        testClock.set(Instant.parse("2032-03-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-cross-cap").first
        val sourceRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Capability source")
        val targetRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Capability target")
        val ownerStream = join(mockMvc, sourceRoom, authToken = owner.token)
        val guest = join(mockMvc, sourceRoom)
        val capability = requireReconnectCapability(guest, sourceRoom)
        assertEquals(
            204,
            postEvent(
                mockMvc,
                sourceRoom,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )

        val crossRoom = join(mockMvc, targetRoom, reconnectCapability = capability)
        val replacement = requireReconnectCapability(crossRoom, targetRoom)
        assertTrue(replacement != capability, "cross-room capability must be replaced generically")
        assertError(
            postChat(mockMvc, targetRoom, crossRoom, UUID.randomUUID().toString(), "Cross-room write", 705),
            403,
            "ROOM_ACCESS_DENIED",
        )
    }

    @Test
    fun `capability expires exactly after twelve hours and reconnects only as candidate`() {
        val issuedAt = Instant.parse("2032-04-01T00:00:00Z")
        testClock.set(issuedAt)
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-expired-cap").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Expired capability")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val guest = join(mockMvc, room)
        val capability = requireReconnectCapability(guest, room)
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )

        testClock.set(issuedAt.plus(Duration.ofHours(12)))
        val expired = join(mockMvc, room, reconnectCapability = capability)
        val replacement = requireReconnectCapability(expired, room)
        assertTrue(replacement != capability, "an exactly expired capability must be replaced")
        assertError(
            postChat(mockMvc, room, expired, UUID.randomUUID().toString(), "Expired capability write", 706),
            403,
            "ROOM_ACCESS_DENIED",
        )
    }

    @Test
    fun `revoked capability cannot restore its previous guest grant`() {
        testClock.set(Instant.parse("2032-05-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-revoked-cap").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Revoked capability")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val guest = join(mockMvc, room)
        val capability = requireReconnectCapability(guest, room)
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "revoke_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )

        assertError(
            postChat(mockMvc, room, guest, UUID.randomUUID().toString(), "Revoked live write", 707),
            403,
            "ROOM_ACCESS_DENIED",
        )
        val reconnect = join(mockMvc, room, reconnectCapability = capability)
        val replacement = requireReconnectCapability(reconnect, room)
        assertTrue(replacement != capability, "revoked capability must be replaced")
        assertError(
            postChat(mockMvc, room, reconnect, UUID.randomUUID().toString(), "Revoked reconnect write", 708),
            403,
            "ROOM_ACCESS_DENIED",
        )
    }

    @Test
    fun `runtime capability unknown to a restarted replica cannot restore guest authority`() {
        testClock.set(Instant.parse("2032-06-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-unknown-cap").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Unknown restart capability")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val guest = join(mockMvc, room)
        val capability = requireReconnectCapability(guest, room)
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )

        var replica: ConfigurableApplicationContext? = null
        try {
            replica = SpringApplicationBuilder(InterviewOnlineApplication::class.java)
                .web(WebApplicationType.SERVLET)
                .run(*replicaProperties().map { (name, value) -> "--$name=$value" }.toTypedArray())
            val replicaMvc = MockMvcBuilders.webAppContextSetup(replica as WebApplicationContext).build()
            val restarted = join(replicaMvc, room, reconnectCapability = capability)
            val replacement = requireReconnectCapability(restarted, room)
            assertTrue(replacement != capability, "unknown-after-restart capability must be replaced")
            assertError(
                postChat(replicaMvc, room, restarted, UUID.randomUUID().toString(), "Unknown runtime write", 709),
                403,
                "ROOM_ACCESS_DENIED",
            )
        } finally {
            replica?.close()
        }
    }

    @Test
    fun `revoke committed before a queued room lock denies the already waiting guest send`() {
        testClock.set(Instant.parse("2032-07-01T00:00:00Z"))
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-post-lock").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Post-lock revoke")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val guest = join(mockMvc, room)
        requireReconnectCapability(guest, room)
        assertEquals(
            204,
            postEvent(
                mockMvc,
                room,
                ownerStream,
                mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId),
            ).response.status,
        )
        val before = storedChatJson(room)
        val holderReady = CountDownLatch(1)
        val releaseHolder = CountDownLatch(1)
        val holderPid = AtomicReference<Int>()
        val executor = Executors.newFixedThreadPool(3)

        try {
            val holder = executor.submit<Unit> {
                TransactionTemplate(transactionManager).executeWithoutResult {
                    jdbcTemplate.queryForObject("SELECT id FROM rooms WHERE id=? FOR UPDATE", String::class.java, room.id)
                    holderPid.set(
                        jdbcTemplate.queryForObject("SELECT pg_backend_pid()", Int::class.java)
                            ?: error("PostgreSQL holder pid is required"),
                    )
                    holderReady.countDown()
                    assertTrue(releaseHolder.await(20, TimeUnit.SECONDS), "room-row holder was not released")
                }
            }
            assertTrue(holderReady.await(10, TimeUnit.SECONDS), "room row holder did not start")

            val revoke = executor.submit<MvcResult> {
                postEvent(
                    mockMvc,
                    room,
                    ownerStream,
                    mapOf("type" to "revoke_interviewer_access", "targetSessionId" to guest.sessionId),
                )
            }
            awaitBlockedBy(holderPid.get(), expectedWaiters = 1)

            val queuedSend = executor.submit<MvcResult> {
                postChat(mockMvc, room, guest, UUID.randomUUID().toString(), "Queued after revoke", 710)
            }
            awaitBlockedBy(holderPid.get(), expectedWaiters = 2)
            releaseHolder.countDown()

            assertEquals(204, revoke.get(30, TimeUnit.SECONDS).response.status)
            holder.get(30, TimeUnit.SECONDS)
            val denied = queuedSend.get(30, TimeUnit.SECONDS)
            assertError(denied, 403, "ROOM_ACCESS_DENIED")
            assertEquals(before, storedChatJson(room))
        } finally {
            releaseHolder.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `reversed post-commit callbacks cannot roll runtime or broadcast back to an older chat revision`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-callback").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Callback order")
        val sender = join(mockMvc, room, authToken = owner.token)
        val observer = join(mockMvc, room, authToken = owner.token)
        val observerBaseline = sseMessages(observer.response).size
        val firstCallbackEntered = CountDownLatch(1)
        val releaseFirstCallback = CountDownLatch(1)
        val secondCallbackEntered = CountDownLatch(1)
        val firstId = UUID.randomUUID().toString()
        val secondId = UUID.randomUUID().toString()
        val executor = Executors.newFixedThreadPool(2)

        try {
            val firstFuture = executor.submit<MvcResult> {
                postChatInOuterTransaction(
                    object : TransactionSynchronization {
                        override fun afterCommit() {
                            firstCallbackEntered.countDown()
                            assertTrue(
                                releaseFirstCallback.await(20, TimeUnit.SECONDS),
                                "revision one callback was not released",
                            )
                        }
                    },
                ) { postChat(mockMvc, room, sender, firstId, "Revision one", 711) }
            }
            assertTrue(
                firstCallbackEntered.await(20, TimeUnit.SECONDS),
                "revision one transaction did not enter its pre-service callback",
            )

            val secondFuture = executor.submit<MvcResult> {
                postChatInOuterTransaction(
                    object : TransactionSynchronization {
                        override fun afterCommit() {
                            secondCallbackEntered.countDown()
                        }
                    },
                ) { postChat(mockMvc, room, sender, secondId, "Revision two", 712) }
            }
            val second = secondFuture.get(30, TimeUnit.SECONDS)
            assertTrue(secondCallbackEntered.await(1, TimeUnit.SECONDS))
            val secondAck = assertAck(second, secondId)
            val beforeRelease = sseMessages(observer.response).drop(observerBaseline)
            assertTrue(
                beforeRelease.any { stateContainsMessage(it, secondAck.path("messageId").asText()) },
                "revision two callback must broadcast while revision one callback is held",
            )

            releaseFirstCallback.countDown()
            val first = firstFuture.get(30, TimeUnit.SECONDS)
            val firstAck = assertAck(first, firstId)
            val stored = storedThread(room)
            assertEquals(
                setOf(firstAck.path("messageId").asText(), secondAck.path("messageId").asText()),
                stored.path("messages").map { it.path("id").asText() }.toSet(),
            )

            val finalFrame = sseMessages(observer.response)
                .drop(observerBaseline)
                .last { it.path("type").asText() == "state_sync" }
            assertTrue(stateContainsMessage(finalFrame, firstAck.path("messageId").asText()))
            assertTrue(
                stateContainsMessage(finalFrame, secondAck.path("messageId").asText()),
                "late revision one callback must not roll runtime or SSE back from revision two",
            )
            assertEquals(2, stored.path("chatRevision").asLong())
        } finally {
            releaseFirstCallback.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `revoked archived sender receives non-disclosing 403 while an authorized sender receives 410`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-archive-owner").first
        val manager = HrHttpFixtures.register(mockMvc, objectMapper, true, "chat-arch-mgr").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Archive authorization order")
        assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, room, manager).response.status)
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val managerStream = join(mockMvc, room, authToken = manager.token)
        val managerIntent = UUID.randomUUID().toString()
        assertAck(postChat(mockMvc, room, managerStream, managerIntent, "Before archive", 713), managerIntent)

        mockMvc.post("/api/rooms/${room.inviteCode}/participants/${manager.id}/role") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"role":"candidate"}"""
        }.andExpect { status { isOk() } }
        jdbcTemplate.update("UPDATE rooms SET archived_at=? WHERE id=?", Timestamp.from(testClock.instant()), room.id)
        val beforeDeniedRequests = storedChatJson(room)

        assertError(
            postChat(mockMvc, room, managerStream, managerIntent, "Before archive", 713),
            403,
            "ROOM_ACCESS_DENIED",
        )
        val ownerArchived = postChat(
            mockMvc,
            room,
            ownerStream,
            UUID.randomUUID().toString(),
            "Authorized archive probe",
            714,
        )
        assertEquals(410, ownerArchived.response.status, ownerArchived.response.contentAsString)
        assertEquals(beforeDeniedRequests, storedChatJson(room))
    }

    @Test
    fun `authorized active legacy note message remains 204 and persists after the room row lock`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "legacy-active").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Active legacy chat")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val before = storedChatJson(room)

        val accepted = postChat(
            mockMvc,
            room,
            ownerStream,
            clientMessageId = null,
            text = "Authorized active legacy message",
            clientEventSequence = 722,
        )

        assertEquals(204, accepted.response.status, accepted.response.contentAsString)
        assertEquals("", accepted.response.contentAsString)
        assertNotEquals(before, storedChatJson(room), "accepted legacy message must be durable before 204")
    }

    @Test
    fun `authorized finished sender receives 409 without mutating idempotent or legacy chat`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-finished-owner").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Finished chat is read-only")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        val beforeFinishIntent = UUID.randomUUID().toString()
        assertAck(postChat(mockMvc, room, ownerStream, beforeFinishIntent, "Before finish", 725), beforeFinishIntent)
        val beforeLateWrites = storedChatJson(room)

        val verdict = mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE","verdictComment":"done"}"""
        }.andReturn()
        assertEquals(200, verdict.response.status, verdict.response.contentAsString)

        val idempotent = postChat(
            mockMvc,
            room,
            ownerStream,
            UUID.randomUUID().toString(),
            "Late finished idempotent chat",
            726,
        )
        assertEquals(409, idempotent.response.status, idempotent.response.contentAsString)

        val legacy = postChat(
            mockMvc,
            room,
            ownerStream,
            clientMessageId = null,
            text = "Late finished legacy chat",
            clientEventSequence = 727,
        )
        assertEquals(409, legacy.response.status, legacy.response.contentAsString)
        assertEquals(beforeLateWrites, storedChatJson(room), "finished chat requests must not mutate messages or receipts")
    }

    @Test
    fun `revoked archived legacy sender receives non-disclosing 403 without mutating chat`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "legacy-rev-own").first
        val manager = HrHttpFixtures.register(mockMvc, objectMapper, true, "legacy-rev-mgr").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Revoked archived legacy chat")
        assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, room, manager).response.status)
        val managerStream = join(mockMvc, room, authToken = manager.token)

        mockMvc.post("/api/rooms/${room.inviteCode}/participants/${manager.id}/role") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"role":"candidate"}"""
        }.andExpect { status { isOk() } }
        jdbcTemplate.update("UPDATE rooms SET archived_at=? WHERE id=?", Timestamp.from(testClock.instant()), room.id)
        val beforeDeniedRequest = storedChatJson(room)

        val denied = postChat(
            mockMvc,
            room,
            managerStream,
            clientMessageId = null,
            text = "Revoked legacy archive probe",
            clientEventSequence = 723,
        )

        assertError(denied, 403, "ROOM_ACCESS_DENIED")
        assertEquals(beforeDeniedRequest, storedChatJson(room), "revoked archived legacy request must not mutate chat")
    }

    @Test
    fun `authorized archived legacy sender receives 410 without mutating chat`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "legacy-arch-own").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Authorized archived legacy chat")
        val ownerStream = join(mockMvc, room, authToken = owner.token)
        jdbcTemplate.update("UPDATE rooms SET archived_at=? WHERE id=?", Timestamp.from(testClock.instant()), room.id)
        val beforeDeniedRequest = storedChatJson(room)

        val archived = postChat(
            mockMvc,
            room,
            ownerStream,
            clientMessageId = null,
            text = "Authorized legacy archive probe",
            clientEventSequence = 724,
        )

        assertEquals(410, archived.response.status, archived.response.contentAsString)
        assertEquals(beforeDeniedRequest, storedChatJson(room), "authorized archived legacy request must not mutate chat")
    }

    @Test
    fun `exact retry still ACKs at receipt capacity while the 4097th active intent is rate limited`() {
        val now = Instant.parse("2033-01-01T00:00:00Z")
        testClock.set(now)
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-receipt-cap").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Receipt capacity")
        val senderKey = expectedSenderKey(room.id, "user", owner.id)
        val exactClientMessageId = UUID.randomUUID().toString()
        val exactMessageId = UUID.randomUUID().toString()
        val receipts = (0 until ACTIVE_RECEIPT_CAPACITY).map { index ->
            val clientMessageId = if (index == 0) exactClientMessageId else UUID.randomUUID().toString()
            val messageId = if (index == 0) exactMessageId else UUID.randomUUID().toString()
            receiptMap(
                senderKey = senderKey,
                clientMessageId = clientMessageId,
                text = "capacity-$index",
                messageId = messageId,
                persistedAt = now,
                expiresAt = now.plus(Duration.ofHours(24)),
            )
        }
        seedV2Thread(
            room,
            chatRevision = ACTIVE_RECEIPT_CAPACITY.toLong(),
            messages = listOf(messageMap(exactMessageId, "capacity-session", "capacity-0", now.toEpochMilli())),
            receipts = receipts,
        )
        val stream = join(mockMvc, room, authToken = owner.token)
        val exact = postChat(mockMvc, room, stream, exactClientMessageId, "capacity-0", 715)
        val exactAck = assertAck(exact, exactClientMessageId)
        assertEquals(exactMessageId, exactAck.path("messageId").asText())
        val beforeOverflow = storedChatJson(room)

        val overflow = postChat(
            mockMvc,
            room,
            stream,
            UUID.randomUUID().toString(),
            "capacity-overflow",
            716,
        )
        assertError(overflow, 429, "CHAT_RECEIPT_CAPACITY")
        assertEquals("private, no-store", overflow.response.getHeader(HttpHeaders.CACHE_CONTROL))
        val retryAfter = overflow.response.getHeader(HttpHeaders.RETRY_AFTER)?.toLongOrNull()
        assertTrue(retryAfter != null && retryAfter in 1..86_400, "Retry-After must be between 1 and 86400 seconds")
        assertEquals(beforeOverflow, storedChatJson(room), "capacity rejection must not prune or overwrite receipts")
    }

    @Test
    fun `receipt remains active immediately before its twenty four hour boundary`() {
        val persistedAt = Instant.parse("2033-02-01T00:00:00Z")
        val fixture = seedSingleReceipt("chat-before-24h", persistedAt)
        testClock.set(persistedAt.plus(Duration.ofHours(24)).minusMillis(1))
        val stream = join(mockMvc, fixture.room, authToken = fixture.owner.token)

        val retry = postChat(mockMvc, fixture.room, stream, fixture.clientMessageId, fixture.text, 717)
        val ack = assertAck(retry, fixture.clientMessageId)
        assertEquals(fixture.messageId, ack.path("messageId").asText())
        assertEquals(fixture.storedJson, storedChatJson(fixture.room))
    }

    @Test
    fun `receipt becomes a non-replayable tombstone exactly at twenty four hours`() {
        val persistedAt = Instant.parse("2033-03-01T00:00:00Z")
        val fixture = seedSingleReceipt("chat-exact-24h", persistedAt)
        testClock.set(persistedAt.plus(Duration.ofHours(24)))
        val stream = join(mockMvc, fixture.room, authToken = fixture.owner.token)

        val expired = postChat(mockMvc, fixture.room, stream, fixture.clientMessageId, fixture.text, 718)
        assertError(expired, 410, "CHAT_RECEIPT_EXPIRED")
        assertEquals(fixture.storedJson, storedChatJson(fixture.room))
    }

    @Test
    fun `receipt tombstone is retained through the exact forty eight hour boundary`() {
        val persistedAt = Instant.parse("2033-04-01T00:00:00Z")
        val fixture = seedSingleReceipt("chat-exact-48h", persistedAt)
        testClock.set(persistedAt.plus(Duration.ofHours(48)))
        val stream = join(mockMvc, fixture.room, authToken = fixture.owner.token)

        val expired = postChat(mockMvc, fixture.room, stream, fixture.clientMessageId, fixture.text, 719)
        assertError(expired, 410, "CHAT_RECEIPT_EXPIRED")
        assertEquals(fixture.storedJson, storedChatJson(fixture.room))
    }

    @Test
    fun `receipt older than forty eight hours is removed and the logical id may create a new message`() {
        val persistedAt = Instant.parse("2033-05-01T00:00:00Z")
        val fixture = seedSingleReceipt("chat-after-48h", persistedAt)
        testClock.set(persistedAt.plus(Duration.ofHours(48)).plusMillis(1))
        val stream = join(mockMvc, fixture.room, authToken = fixture.owner.token)

        val recreated = postChat(mockMvc, fixture.room, stream, fixture.clientMessageId, fixture.text, 720)
        val ack = assertAck(recreated, fixture.clientMessageId)
        assertTrue(ack.path("messageId").asText() != fixture.messageId, "an old tombstone must not ACK the original message")
        val stored = storedThread(fixture.room)
        assertEquals(2, stored.path("messages").size())
        assertEquals(1, stored.path("receipts").size())
        assertEquals(ack.path("messageId").asText(), stored.path("receipts")[0].path("messageId").asText())
    }

    @Test
    fun `malformed v2 chat storage returns 503 and is never overwritten`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-malformed").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Malformed v2")
        val malformed = """{"version":2,"chatRevision":9,"messages":[],"receipts":[{"senderKey":"raw-subject","clientMessageId":"not-a-uuid"}]}"""
        collaborationService.closeRoom(room.inviteCode)
        jdbcTemplate.update("UPDATE rooms SET interviewer_chat=? WHERE id=?", malformed, room.id)
        val stream = join(mockMvc, room, authToken = owner.token)

        val rejected = postChat(mockMvc, room, stream, UUID.randomUUID().toString(), "Do not overwrite malformed", 721)
        assertError(rejected, 503, "CHAT_STORAGE_UNAVAILABLE")
        assertEquals(malformed, storedChatJson(room))
    }

    private fun join(
        mvc: MockMvc,
        room: HrTestRoom,
        authToken: String? = null,
        ownerToken: String? = null,
        sessionId: String = "chat-session-${UUID.randomUUID()}",
        participantId: String = "chat-participant-${UUID.randomUUID()}",
        reconnectCapability: String? = null,
        secure: Boolean = false,
    ): ChatStream {
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            this.secure = secure
            param("sessionId", sessionId)
            param("participantId", participantId)
            param("displayName", "Chat manager")
            authToken?.let { header("Authorization", "Bearer $it") }
            ownerToken?.let { param("ownerToken", it) }
            reconnectCapability?.let { header(HttpHeaders.COOKIE, it) }
        }.andReturn()
        assertEquals(200, result.response.status, result.response.contentAsString)
        val sync = sseMessages(result).lastOrNull { it.path("type").asText() == "state_sync" }
            ?: error("join did not emit state_sync")
        val eventToken = sync.path("payload").path("eventToken").asText()
        assertTrue(eventToken.startsWith("evt_"), "join must mint a server event token")
        val setCookieHeaders = result.response.getHeaders(HttpHeaders.SET_COOKIE)
        val returnedCapability = setCookieHeaders
            .firstOrNull { it.startsWith("$GUEST_RECONNECT_COOKIE=") }
            ?.substringBefore(';')
        return ChatStream(
            sessionId = sessionId,
            participantId = participantId,
            eventToken = eventToken,
            response = result,
            reconnectCapability = returnedCapability ?: reconnectCapability,
            setCookieHeaders = setCookieHeaders,
        )
    }

    private fun postChat(
        mvc: MockMvc,
        room: HrTestRoom,
        stream: ChatStream,
        clientMessageId: String?,
        text: String,
        clientEventSequence: Long,
        extra: Map<String, Any?> = emptyMap(),
    ): MvcResult {
        val body = linkedMapOf<String, Any?>(
            "sessionId" to stream.sessionId,
            "eventToken" to stream.eventToken,
            "clientEventSequence" to clientEventSequence,
            "type" to "note_message",
            "noteText" to text,
            "noteTimestampEpochMs" to 1_725_000_000_000L,
        )
        clientMessageId?.let { body["clientMessageId"] = it }
        body.putAll(extra)
        return mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(body)
            stream.reconnectCapability?.let { header(HttpHeaders.COOKIE, it) }
        }.andReturn()
    }

    private fun postEvent(
        mvc: MockMvc,
        room: HrTestRoom,
        stream: ChatStream,
        fields: Map<String, Any?>,
    ): MvcResult = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        stream.reconnectCapability?.let { header(HttpHeaders.COOKIE, it) }
        content = objectMapper.writeValueAsString(
            linkedMapOf<String, Any?>(
                "sessionId" to stream.sessionId,
                "eventToken" to stream.eventToken,
            ) + fields,
        )
    }.andReturn()

    private fun assertAck(result: MvcResult, expectedClientMessageId: String): JsonNode {
        assertEquals(200, result.response.status, result.response.contentAsString)
        assertEquals("private, no-store", result.response.getHeader(HttpHeaders.CACHE_CONTROL))
        assertTrue(result.response.contentType.orEmpty().startsWith(MediaType.APPLICATION_JSON_VALUE))
        val ack = objectMapper.readTree(result.response.contentAsString)
        assertEquals(
            setOf("type", "status", "clientMessageId", "messageId", "persistedAtEpochMs"),
            ack.fieldNames().asSequence().toSet(),
        )
        assertEquals("note_message_ack", ack.path("type").asText())
        assertEquals("persisted", ack.path("status").asText())
        assertEquals(expectedClientMessageId, ack.path("clientMessageId").asText())
        assertTrue(ack.path("messageId").asText().isNotBlank())
        assertTrue(ack.path("persistedAtEpochMs").asLong() > 0)
        return ack
    }

    private fun assertError(result: MvcResult, expectedStatus: Int, expectedCode: String) {
        assertEquals(expectedStatus, result.response.status, result.response.contentAsString)
        val error = objectMapper.readTree(result.response.contentAsString)
        assertEquals(setOf("error", "code"), error.fieldNames().asSequence().toSet())
        assertEquals(expectedCode, error.path("code").asText())
        assertTrue(error.path("error").asText().isNotBlank())
    }

    private fun assertV2Thread(thread: JsonNode) {
        assertTrue(thread.isObject, "new writes must use an object envelope")
        assertEquals(2, thread.path("version").asInt())
        assertTrue(thread.path("messages").isArray)
        assertTrue(thread.path("receipts").isArray)
    }

    private fun storedThread(room: HrTestRoom): JsonNode = objectMapper.readTree(storedChatJson(room))

    private fun storedChatJson(room: HrTestRoom): String = jdbcTemplate.queryForObject(
        "SELECT interviewer_chat FROM rooms WHERE id=?",
        String::class.java,
        room.id,
    ).orEmpty()

    private fun assertProjectedMessage(stream: ChatStream, id: String, text: String) {
        val sync = sseMessages(stream.response).last { it.path("type").asText() == "state_sync" }
        val notesMessages = sync.path("payload").path("notesMessages")
        val message = notesMessages.firstOrNull { it.path("id").asText() == id }
            ?: error("projected notesMessages did not contain $id: $notesMessages")
        assertEquals(text, message.path("text").asText())
        assertFalse(sync.toString().contains("receipts"))
    }

    private fun sseMessages(result: MvcResult): List<JsonNode> =
        result.response.getContentAsString(StandardCharsets.UTF_8).lineSequence()
        .filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .toList()

    private fun stateContainsMessage(frame: JsonNode, messageId: String): Boolean =
        frame.path("type").asText() == "state_sync" &&
            frame.path("payload").path("notesMessages").any { it.path("id").asText() == messageId }

    private fun postChatInOuterTransaction(
        synchronization: TransactionSynchronization,
        request: () -> MvcResult,
    ): MvcResult = requireNotNull(TransactionTemplate(transactionManager).execute {
        TransactionSynchronizationManager.registerSynchronization(synchronization)
        request()
    })

    private fun awaitBlockedBy(holderPid: Int, expectedWaiters: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        postgres.connection().use { connection ->
            connection.prepareStatement(
                """
                WITH RECURSIVE blocked_room_queries(pid) AS (
                    SELECT activity.pid
                      FROM pg_stat_activity activity
                     WHERE ? = ANY(pg_blocking_pids(activity.pid))
                       AND activity.query ILIKE '%rooms%'
                    UNION
                    SELECT activity.pid
                      FROM pg_stat_activity activity
                      JOIN blocked_room_queries blocker
                        ON blocker.pid = ANY(pg_blocking_pids(activity.pid))
                     WHERE activity.query ILIKE '%rooms%'
                )
                SELECT COUNT(*) FROM blocked_room_queries
                """.trimIndent(),
            ).use { statement ->
                while (System.nanoTime() < deadline) {
                    statement.setInt(1, holderPid)
                    statement.executeQuery().use { result ->
                        result.next()
                        if (result.getInt(1) >= expectedWaiters) return
                    }
                    Thread.onSpinWait()
                }
            }
        }
        throw AssertionError("queued chat request did not block on the held room row")
    }

    private fun requireReconnectCapability(stream: ChatStream, room: HrTestRoom): String {
        val capability = stream.setCookieHeaders
            .firstOrNull { it.startsWith("$GUEST_RECONNECT_COOKIE=") }
            ?.substringBefore(';')
            ?: throw AssertionError("anonymous admission must mint a room-scoped reconnect capability")
        assertTrue(
            Regex("^$GUEST_RECONNECT_COOKIE=grc1_[A-Za-z0-9_-]{43}$").matches(capability),
            "capability must contain exactly 32 random base64url bytes",
        )
        assertTrue(
            stream.setCookieHeaders.any { it.contains("Path=/api/realtime/rooms/${room.inviteCode}/") },
            "capability cookie path must be scoped to the exact room transport",
        )
        return capability
    }

    private fun assertReconnectCookieWire(stream: ChatStream, room: HrTestRoom) {
        val header = stream.setCookieHeaders
            .firstOrNull { it.startsWith("$GUEST_RECONNECT_COOKIE=") }
            ?: throw AssertionError("reconnect capability Set-Cookie header is missing")
        assertTrue(header.contains("Path=/api/realtime/rooms/${room.inviteCode}/"))
        assertTrue(header.contains("Max-Age=43200"))
        assertTrue(header.contains("HttpOnly", ignoreCase = true))
        assertTrue(header.contains("SameSite=Strict", ignoreCase = true))
        assertFalse(header.contains("Secure", ignoreCase = true), "plain HTTP admission must not set Secure")
    }

    private fun receiptMap(
        senderKey: String,
        clientMessageId: String,
        text: String,
        messageId: String,
        persistedAt: Instant,
        expiresAt: Instant,
    ): Map<String, Any> = linkedMapOf(
        "senderKey" to senderKey,
        "clientMessageId" to clientMessageId,
        "requestHash" to sha256(text.trim()),
        "messageId" to messageId,
        "persistedAtEpochMs" to persistedAt.toEpochMilli(),
        "expiresAtEpochMs" to expiresAt.toEpochMilli(),
    )

    private fun seedV2Thread(
        room: HrTestRoom,
        chatRevision: Long,
        messages: List<Map<String, Any>>,
        receipts: List<Map<String, Any>>,
    ): String {
        collaborationService.closeRoom(room.inviteCode)
        val stored = objectMapper.writeValueAsString(
            linkedMapOf(
                "version" to 2,
                "chatRevision" to chatRevision,
                "messages" to messages,
                "receipts" to receipts,
            ),
        )
        jdbcTemplate.update("UPDATE rooms SET interviewer_chat=? WHERE id=?", stored, room.id)
        return stored
    }

    private fun seedSingleReceipt(prefix: String, persistedAt: Instant): SeededReceipt {
        testClock.set(persistedAt)
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "chat-boundary").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Seeded receipt $prefix")
        val clientMessageId = UUID.randomUUID().toString()
        val messageId = UUID.randomUUID().toString()
        val text = "Stored intent $prefix"
        val storedJson = seedV2Thread(
            room = room,
            chatRevision = 1,
            messages = listOf(messageMap(messageId, "seeded-session", text, persistedAt.toEpochMilli())),
            receipts = listOf(
                receiptMap(
                    senderKey = expectedSenderKey(room.id, "user", owner.id),
                    clientMessageId = clientMessageId,
                    text = text,
                    messageId = messageId,
                    persistedAt = persistedAt,
                    expiresAt = persistedAt.plus(Duration.ofHours(24)),
                ),
            ),
        )
        return SeededReceipt(owner, room, clientMessageId, messageId, text, storedJson)
    }

    private fun messageNode(id: String, sessionId: String, text: String, timestamp: Long): JsonNode =
        objectMapper.valueToTree(messageMap(id, sessionId, text, timestamp))

    private fun messageMap(id: String, sessionId: String, text: String, timestamp: Long): Map<String, Any> = mapOf(
        "id" to id,
        "sessionId" to sessionId,
        "displayName" to "Legacy interviewer",
        "role" to "interviewer",
        "text" to text,
        "timestampEpochMs" to timestamp,
    )

    private fun expectedSenderKey(roomId: String, principalKind: String, principalSubject: String): String {
        val payload = listOf("chat-sender:v1", roomId, principalKind, principalSubject).joinToString("\u0000")
        val secret = Base64.getUrlDecoder().decode(CHAT_RECEIPT_TEST_SECRET)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret, "HmacSHA256"))
        val digest = mac.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
        return "h1:" + digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun replicaProperties(): Map<String, Any> = postgres.applicationProperties() + mapOf(
        "server.port" to 0,
        "spring.main.banner-mode" to "off",
        "spring.jpa.open-in-view" to false,
        "app.realtime.chat-receipt-hmac-secret" to CHAT_RECEIPT_TEST_SECRET,
    )

    private data class ChatStream(
        val sessionId: String,
        val participantId: String,
        val eventToken: String,
        val response: MvcResult,
        val reconnectCapability: String?,
        val setCookieHeaders: List<String>,
    )

    private data class SeededReceipt(
        val owner: HrTestAccount,
        val room: HrTestRoom,
        val clientMessageId: String,
        val messageId: String,
        val text: String,
        val storedJson: String,
    )
}

@TestConfiguration(proxyBeanMethods = false)
class RealtimeChatIdempotencyClockTestConfiguration {
    @Bean
    @Primary
    fun realtimeChatTestClock(): AdjustableRealtimeChatClock = AdjustableRealtimeChatClock(
        Instant.parse("2031-01-01T00:00:00Z"),
    )
}

class AdjustableRealtimeChatClock(initial: Instant) : Clock() {
    private val current = AtomicReference(initial)

    fun set(next: Instant) {
        current.set(next)
    }

    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = Clock.fixed(current.get(), zone)

    override fun instant(): Instant = current.get()
}
