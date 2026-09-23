package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.ws.RealtimeEventRequest
import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.http.HttpStatus
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.util.AopTestUtils
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["spring.task.scheduling.enabled=false"],
)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class RealtimeConnectionLifecycleIntegrationTest(
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbc: JdbcTemplate,
    @LocalServerPort private val port: Int,
) {
    @Test
    fun `room stream admission publishes a shared lease and closing removes it`() {
        val (room, owner) = createRoomWithOwner()
        val sessionId = "shared-lease-${UUID.randomUUID()}"
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        joinOwner(room, owner, sessionId)
        assertEquals(1, jdbc.queryForObject(
            "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=? AND expires_at > CURRENT_TIMESTAMP",
            Int::class.java, room.inviteCode,
        ))

        collaborationService.handleRealtimeEvent(
            room.inviteCode,
            RealtimeEventRequest(
                sessionId = sessionId,
                eventToken = eventToken(target, connectionId(target, room.inviteCode, sessionId)),
                type = "leave_room",
            ),
        )
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
        while (System.nanoTime() < deadline && jdbc.queryForObject(
                "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, room.inviteCode,
            ) != 0) {
            Thread.sleep(100)
        }
        assertEquals(0, jdbc.queryForObject(
            "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, room.inviteCode,
        ))
    }

    @Test
    fun `expired shared lease closes its local room stream before another heartbeat`() {
        val (room, owner) = createRoomWithOwner()
        val sessionId = "expired-lease-${UUID.randomUUID()}"
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        joinOwner(room, owner, sessionId)
        assertRegistry(target, room.inviteCode, sessionId, expectedConnections = 1)
        jdbc.update(
            "UPDATE room_realtime_activity SET expires_at=? WHERE room_code=?",
            java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(1)), room.inviteCode,
        )
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
        while (System.nanoTime() < deadline && connectionIdOrNull(target, room.inviteCode, sessionId) != null) {
            Thread.sleep(100)
        }
        assertEquals(null, connectionIdOrNull(target, room.inviteCode, sessionId))
    }

    @Test
    fun `parallel room admissions share one lease and release every connection`() {
        val (room, owner) = createRoomWithOwner()
        val sessionIds = (1..12).map { "parallel-${UUID.randomUUID()}" }
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(sessionIds.size)
        try {
            val admissions = sessionIds.map { sessionId ->
                pool.submit {
                    start.await()
                    joinOwner(room, owner, sessionId)
                }
            }
            start.countDown()
            admissions.forEach { it.get(20, TimeUnit.SECONDS) }
            val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
            assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=? AND expires_at > CURRENT_TIMESTAMP",
                Int::class.java, room.inviteCode,
            ))
            sessionIds.forEach { sessionId ->
                collaborationService.handleRealtimeEvent(
                    room.inviteCode,
                    RealtimeEventRequest(
                        sessionId = sessionId,
                        eventToken = eventToken(target, connectionId(target, room.inviteCode, sessionId)),
                        type = "leave_room",
                    ),
                )
            }
            assertEquals(0, jdbc.queryForObject(
                "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, room.inviteCode,
            ))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `current authority is required for leave and supplied passive events after replacement`() {
        val (room, owner) = createRoomWithOwner()
        val sessionId = "lifecycle-${UUID.randomUUID()}"
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)

        val oldEmitter = joinOwner(room, owner, sessionId)
        val oldConnectionId = connectionId(target, room.inviteCode, sessionId)
        val oldEventToken = eventToken(target, oldConnectionId)

        joinOwner(room, owner, sessionId)
        val activeConnectionId = connectionId(target, room.inviteCode, sessionId)
        val activeEventToken = eventToken(target, activeConnectionId)
        assertNotEquals(oldConnectionId, activeConnectionId)
        assertNotEquals(oldEventToken, activeEventToken)
        assertRegistry(target, room.inviteCode, sessionId, expectedConnections = 1)

        val recordingEmitter = RecordingSseEmitter()
        replaceEmitter(target, activeConnectionId, recordingEmitter)
        val afterReplacement = activeSessionSnapshot(target, room.inviteCode, sessionId, recordingEmitter)

        // This is the physical old emitter returned by the first stream admission,
        // not a call to the private registry-detach implementation. The companion
        // transport test below verifies the same path through real HTTP SSE.
        oldEmitter.complete()
        assertEquals(
            afterReplacement,
            activeSessionSnapshot(target, room.inviteCode, sessionId, recordingEmitter),
            "a late old emitter completion must not detach the replacement",
        )

        listOf<String?>(null, "", "   ", oldEventToken, "random-mismatched-event-token").forEach { rejectedToken ->
            assertRejectedLeavePreservesActive(
                service = target,
                inviteCode = room.inviteCode,
                sessionId = sessionId,
                eventToken = rejectedToken,
                emitter = recordingEmitter,
            )
        }

        val initialPresence = presenceStatus(target, activeConnectionId)
        assertDoesNotThrow {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = null,
                    type = "presence_update",
                    presenceStatus = "away",
                ),
            )
        }
        val blankBootstrapPresence = presenceStatus(target, activeConnectionId)
        assertNotEquals(initialPresence, blankBootstrapPresence)

        val sendsBeforeBlankStateRequest = recordingEmitter.sendCount
        assertDoesNotThrow {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = null,
                    type = "request_state_sync",
                ),
            )
        }
        assertTrue(recordingEmitter.sendCount > sendsBeforeBlankStateRequest)

        listOf(oldEventToken, "random-mismatched-event-token").forEach { rejectedToken ->
            assertRejectedPassiveEventPreservesActive(
                service = target,
                inviteCode = room.inviteCode,
                sessionId = sessionId,
                eventToken = rejectedToken,
                emitter = recordingEmitter,
                type = "presence_update",
                presenceStatus = "active",
            )
            assertRejectedPassiveEventPreservesActive(
                service = target,
                inviteCode = room.inviteCode,
                sessionId = sessionId,
                eventToken = rejectedToken,
                emitter = recordingEmitter,
                type = "request_state_sync",
                presenceStatus = null,
            )
        }
        assertEquals(blankBootstrapPresence, presenceStatus(target, activeConnectionId))

        assertDoesNotThrow {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = activeEventToken,
                    type = "leave_room",
                ),
            )
        }
        assertRegistry(target, room.inviteCode, sessionId, expectedConnections = 0)

        assertForbidden {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = activeEventToken,
                    type = "leave_room",
                ),
            )
        }
        assertRegistry(target, room.inviteCode, sessionId, expectedConnections = 0)

        joinOwner(room, owner, sessionId)
        val replacementAfterRetiredLeave = connectionId(target, room.inviteCode, sessionId)
        val replacementAfterRetiredToken = eventToken(target, replacementAfterRetiredLeave)
        assertNotEquals(activeConnectionId, replacementAfterRetiredLeave)
        val afterRejoin = activeSessionSnapshot(target, room.inviteCode, sessionId, recordingEmitter = null)
        assertForbidden {
            collaborationService.handleRealtimeEvent(
                room.inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = activeEventToken,
                    type = "leave_room",
                ),
            )
        }
        assertEquals(
            afterRejoin,
            activeSessionSnapshot(target, room.inviteCode, sessionId, recordingEmitter = null),
            "a retired token must be a no-op after rejoin",
        )
        assertEquals(replacementAfterRetiredToken, eventToken(target, replacementAfterRetiredLeave))
    }

    @Test
    fun `actual HTTP completion of an old stream cannot detach the newer replacement`() {
        val (room, _) = createRoomWithOwner()
        val sessionId = "transport-replacement-${UUID.randomUUID()}"
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
        var oldStream: HttpResponse<InputStream>? = null
        var replacementStream: HttpResponse<InputStream>? = null

        try {
            oldStream = openTransportStream(client, room, sessionId)
            assertEquals(200, oldStream.statusCode())
            assertTrue(awaitTransportStarted(oldStream.body()), "OLD_SSE_STREAM_DID_NOT_START")
            val oldConnectionId = connectionId(target, room.inviteCode, sessionId)

            replacementStream = openTransportStream(client, room, sessionId)
            assertEquals(200, replacementStream.statusCode())
            assertTrue(awaitTransportStarted(replacementStream.body()), "REPLACEMENT_SSE_STREAM_DID_NOT_START")
            val replacementConnectionId = connectionId(target, room.inviteCode, sessionId)
            assertNotEquals(oldConnectionId, replacementConnectionId)

            assertTrue(awaitTransportClosed(oldStream.body()), "OLD_SSE_STREAM_DID_NOT_COMPLETE")
            assertEquals(replacementConnectionId, connectionId(target, room.inviteCode, sessionId))
            assertRegistry(target, room.inviteCode, sessionId, expectedConnections = 1)
        } finally {
            runCatching { oldStream?.body()?.close() }
            runCatching { replacementStream?.body()?.close() }
            collaborationService.closeRoom(room.inviteCode)
        }
    }

    private fun joinOwner(room: Room, owner: User, sessionId: String): SseEmitter =
        collaborationService.joinRoomSse(
            inviteCode = room.inviteCode,
            sessionId = sessionId,
            participantId = "participant",
            displayName = "Participant",
            ownerToken = null,
            interviewerToken = null,
            user = owner,
        )

    private fun openTransportStream(
        client: HttpClient,
        room: Room,
        sessionId: String,
    ): HttpResponse<InputStream> = client.send(
        HttpRequest.newBuilder(
            URI(
                "http://127.0.0.1:$port/api/realtime/rooms/${room.inviteCode}/stream" +
                    "?sessionId=$sessionId&participantId=transport-participant" +
                    "&displayName=Transport&ownerToken=${room.ownerSessionToken}",
            ),
        )
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build(),
        HttpResponse.BodyHandlers.ofInputStream(),
    )

    private fun awaitTransportStarted(stream: InputStream): Boolean =
        awaitTransportRead { stream.read() >= 0 }

    private fun awaitTransportClosed(stream: InputStream): Boolean =
        awaitTransportRead {
            while (stream.read() >= 0) {
                // Drain already-buffered SSE data before observing the real close.
            }
            true
        }

    private fun awaitTransportRead(read: () -> Boolean): Boolean {
        val executor = Executors.newSingleThreadExecutor()
        return try {
            executor.submit<Boolean>(read).get(5, TimeUnit.SECONDS)
        } finally {
            executor.shutdownNow()
        }
    }

    private fun assertRejectedLeavePreservesActive(
        service: CollaborationService,
        inviteCode: String,
        sessionId: String,
        eventToken: String?,
        emitter: RecordingSseEmitter,
    ) {
        val before = activeSessionSnapshot(service, inviteCode, sessionId, emitter)
        assertForbidden {
            collaborationService.handleRealtimeEvent(
                inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = eventToken,
                    type = "leave_room",
                ),
            )
        }
        assertEquals(
            before,
            activeSessionSnapshot(service, inviteCode, sessionId, emitter),
            "rejected leave token must preserve the full active session without a send",
        )
    }

    private fun assertRejectedPassiveEventPreservesActive(
        service: CollaborationService,
        inviteCode: String,
        sessionId: String,
        eventToken: String,
        emitter: RecordingSseEmitter,
        type: String,
        presenceStatus: String?,
    ) {
        val before = activeSessionSnapshot(service, inviteCode, sessionId, emitter)
        assertForbidden {
            collaborationService.handleRealtimeEvent(
                inviteCode,
                RealtimeEventRequest(
                    sessionId = sessionId,
                    eventToken = eventToken,
                    type = type,
                    presenceStatus = presenceStatus,
                ),
            )
        }
        assertEquals(
            before,
            activeSessionSnapshot(service, inviteCode, sessionId, emitter),
            "rejected $type token must not mutate or send",
        )
    }

    private fun createRoomWithOwner(): Pair<Room, User> {
        val suffix = UUID.randomUUID().toString()
        val owner = userRepository.save(
            User(
                nickname = "lifecycle-owner-$suffix",
                passwordHash = "lifecycle-password",
            ),
        )
        val room = roomRepository.save(
            Room(
                title = "Lifecycle room",
                inviteCode = "lifecycle-$suffix",
                ownerSessionToken = "owner-$suffix",
                interviewerSessionToken = "interviewer-$suffix",
                ownerUser = owner,
            ),
        )
        return room to owner
    }

    @Suppress("UNCHECKED_CAST")
    private fun activeSessionSnapshot(
        service: CollaborationService,
        inviteCode: String,
        sessionId: String,
        recordingEmitter: RecordingSseEmitter?,
    ): ActiveSessionSnapshot {
        val mappings = field(service, "connectionByRoomSession").get(service) as Map<String, String>
        val participants = field(service, "participants").get(service) as Map<String, Any>
        val emitters = field(service, "sseConnections").get(service) as Map<String, SseEmitter>
        val memberships = field(service, "roomSseConnections").get(service) as Map<String, Collection<String>>
        val states = field(service, "roomState").get(service) as Map<String, Any>
        val connectionId = requireNotNull(mappings["$inviteCode::$sessionId"])
        val participant = requireNotNull(participants[connectionId])
        val emitter = requireNotNull(emitters[connectionId])

        return ActiveSessionSnapshot(
            mappingConnectionId = connectionId,
            activeEventToken = eventToken(participant),
            activeEmitter = emitter,
            membershipConnectionIds = memberships[inviteCode].orEmpty().toSet(),
            registryMappings = mappings.toMap(),
            participantConnectionIds = participants.keys.toSet(),
            emitterConnectionIds = emitters.keys.toSet(),
            roomStateFingerprint = roomStateFingerprint(states[inviteCode]),
            presenceStatus = presenceStatus(participant),
            sendCount = recordingEmitter?.sendCount,
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun connectionId(service: CollaborationService, inviteCode: String, sessionId: String): String {
        val connections = field(service, "connectionByRoomSession").get(service) as ConcurrentHashMap<String, String>
        return requireNotNull(connections["$inviteCode::$sessionId"])
    }

    @Suppress("UNCHECKED_CAST")
    private fun connectionIdOrNull(service: CollaborationService, inviteCode: String, sessionId: String): String? {
        val connections = field(service, "connectionByRoomSession").get(service) as ConcurrentHashMap<String, String>
        return connections["$inviteCode::$sessionId"]
    }

    private fun eventToken(service: CollaborationService, connectionId: String): String {
        val participants = field(service, "participants").get(service) as Map<*, *>
        return eventToken(requireNotNull(participants[connectionId]))
    }

    private fun eventToken(participant: Any): String =
        participant.javaClass.getDeclaredField("eventToken").apply { isAccessible = true }.get(participant) as String

    private fun presenceStatus(service: CollaborationService, connectionId: String): Any {
        val participants = field(service, "participants").get(service) as Map<*, *>
        return presenceStatus(requireNotNull(participants[connectionId]))
    }

    private fun presenceStatus(participant: Any): Any = requireNotNull(
        participant.javaClass.getDeclaredField("presenceStatus").apply { isAccessible = true }.get(participant),
    )

    @Suppress("UNCHECKED_CAST")
    private fun replaceEmitter(
        service: CollaborationService,
        connectionId: String,
        replacement: SseEmitter,
    ) {
        val emitters = field(service, "sseConnections").get(service) as MutableMap<String, SseEmitter>
        emitters[connectionId] = replacement
    }

    private fun assertForbidden(block: () -> Unit) {
        val error = assertThrows(ApiException::class.java, block)
        assertEquals(HttpStatus.FORBIDDEN, error.status)
    }

    private fun assertRegistry(
        service: CollaborationService,
        inviteCode: String,
        sessionId: String,
        expectedConnections: Int,
    ) {
        val connections = field(service, "sseConnections").get(service) as Map<*, *>
        val participants = field(service, "participants").get(service) as Map<*, *>
        val memberships = field(service, "roomSseConnections").get(service) as Map<*, *>
        val membershipCount = memberships.values.sumOf { value -> (value as Collection<*>).size }
        val roomSessionConnections = field(service, "connectionByRoomSession").get(service) as Map<*, *>

        assertEquals(expectedConnections, connections.size, "SSE registry count")
        assertEquals(expectedConnections, participants.size, "participant registry count")
        assertEquals(expectedConnections, membershipCount, "room membership registry count")
        if (expectedConnections == 0) {
            assertNull(roomSessionConnections["$inviteCode::$sessionId"], "session mapping must be removed")
        } else {
            assertEquals(1, roomSessionConnections.count { it.key == "$inviteCode::$sessionId" }, "session mapping must remain authoritative")
        }
    }

    private fun field(target: CollaborationService, name: String) =
        target.javaClass.getDeclaredField(name).apply { isAccessible = true }

    private fun roomStateFingerprint(state: Any?): String? = state?.let {
        MessageDigest.getInstance("SHA-256")
            .digest(objectMapper.writeValueAsBytes(it))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private data class ActiveSessionSnapshot(
        val mappingConnectionId: String,
        val activeEventToken: String,
        val activeEmitter: SseEmitter,
        val membershipConnectionIds: Set<String>,
        val registryMappings: Map<String, String>,
        val participantConnectionIds: Set<String>,
        val emitterConnectionIds: Set<String>,
        val roomStateFingerprint: String?,
        val presenceStatus: Any,
        val sendCount: Int?,
    )

    private class RecordingSseEmitter : SseEmitter(0L) {
        var sendCount = 0
            private set

        override fun send(builder: SseEventBuilder) {
            sendCount += 1
        }
    }
}
