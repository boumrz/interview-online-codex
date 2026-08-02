package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.KeystrokePersistenceService
import com.interviewonline.ws.CandidateKeyPayload
import com.interviewonline.ws.RoomRealtimePayload
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.mock.mockito.SpyBean
import org.springframework.http.MediaType
import org.springframework.test.util.AopTestUtils
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Integration coverage for the durable, manager-only raw activity contract.
 *
 * A focused integration test is proportionate here because durable acceptance
 * and server-side role filtering cannot be fully proved by the browser timeline.
 */
@SpringBootTest
@AutoConfigureMockMvc
class DurableCandidateActivityIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val roomKeystrokeEventRepository: RoomKeystrokeEventRepository,
    @Autowired private val roomParticipantRepository: RoomParticipantRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userSessionRepository: UserSessionRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    @SpyBean
    private lateinit var keystrokePersistenceService: KeystrokePersistenceService

    @AfterEach
    fun cleanup() {
        Mockito.reset(keystrokePersistenceService)
        roomKeystrokeEventRepository.deleteAll()
        roomParticipantRepository.deleteAll()
        roomRepository.deleteAll()
        userSessionRepository.deleteAll()
        userRepository.deleteAll()
    }

    @Test
    fun `source ID retry is durable once and manager export uses canonical sequence without a manager connection`() {
        val fixture = createFixture()
        val firstSourceEventId = UUID.randomUUID().toString()
        val secondSourceEventId = UUID.randomUUID().toString()

        postCandidateKey(fixture, firstSourceEventId, "a", "KeyA")
        postCandidateKey(fixture, firstSourceEventId, "a", "KeyA")
        postCandidateKey(fixture, secondSourceEventId, "b", "KeyB")

        mockMvc.get("/api/rooms/${fixture.room.inviteCode}/keystroke-events") {
            header("Authorization", "Bearer ${fixture.ownerAuthToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.length()") { value(2) }
            jsonPath("$[0].sourceEventId") { value(firstSourceEventId) }
            jsonPath("$[0].acceptedSequence") { value(1) }
            jsonPath("$[1].sourceEventId") { value(secondSourceEventId) }
            jsonPath("$[1].acceptedSequence") { value(2) }
        }
    }

    @Test
    fun `candidate activity after an authorized manager set step relay persists once in the durable room`() {
        val fixture = createFixture(withTwoTasks = true)
        val manager = joinManagerRelayCapture(fixture)
        val sourceEventId = UUID.randomUUID().toString()

        assertEquals(204, postManagerSetStep(fixture, manager, stepIndex = 1))
        assertEquals(204, postCandidateKey(fixture, sourceEventId, "p", "KeyP"))

        val persistedRoomId = requireNotNull(fixture.room.id)
        val persisted = roomKeystrokeEventRepository
            .findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(persistedRoomId)
        assertEquals(1, persisted.size)
        assertEquals(persistedRoomId, persisted.single().roomId)
        assertEquals(sourceEventId, persisted.single().sourceEventId)

        val broadcasts = candidateKeyBroadcasts(manager.emitter)
        assertEquals(1, broadcasts.size)
        assertEquals(sourceEventId, broadcasts.single().sourceEventId)
    }

    @Test
    fun `unsaved room IDs are rejected by public realtime-state factories before room state mutation`() {
        val roomStates = realtimeRoomStates()
        val missingRoomIds = listOf<String?>(null, "", " \t ")
        val violations = mutableListOf<String>()

        missingRoomIds.forEachIndexed { index, roomId ->
            val inviteCode = "unsaved-bootstrap-$index-${UUID.randomUUID()}"
            val unsavedRoom = unsavedRoom(inviteCode, roomId)
            val failure = runCatching { collaborationService.bootstrapRoom(unsavedRoom) }.exceptionOrNull()
            val stateWasNotMutated = !roomStates.containsKey(inviteCode)
            unsavedRoomFactoryViolation("BOOTSTRAP", roomId, failure, stateWasNotMutated)?.let(violations::add)
        }

        missingRoomIds.forEachIndexed { index, roomId ->
            val fixture = createFixture()
            val existingState = roomStates[fixture.room.inviteCode]
            if (existingState == null) {
                violations += "UNSAVED_ROOM_SYNC_BASELINE_STATE_MISSING index=$index"
                return@forEachIndexed
            }
            val unsavedRoom = unsavedRoom(fixture.room.inviteCode, roomId)
            val failure = runCatching { collaborationService.syncFromRoom(unsavedRoom) }.exceptionOrNull()
            val stateWasNotMutated = roomStates[fixture.room.inviteCode] === existingState
            unsavedRoomFactoryViolation("SYNC", roomId, failure, stateWasNotMutated)?.let(violations::add)
        }

        if (violations.isNotEmpty()) throw AssertionError(violations.joinToString("\n"))
    }

    @Test
    fun `legacy activity without a source ID receives a minted UUID`() {
        val fixture = createFixture()

        postCandidateKey(fixture, sourceEventId = null, key = "l", keyCode = "KeyL")

        val persisted = rawEvents(fixture).single()
        val mintedSourceEventId = requireNotNull(persisted.sourceEventId)
        assertEquals(mintedSourceEventId, UUID.fromString(mintedSourceEventId).toString())
        assertEquals(1L, persisted.acceptedSequence)
    }

    @Test
    fun `malformed source ID is rejected before persistence or manager broadcast`() {
        val fixture = createFixture()
        val managerEmitter = joinManagerCapture(fixture)

        assertEquals(
            400,
            postCandidateKey(fixture, sourceEventId = "not-a-uuid", key = "m", keyCode = "KeyM"),
        )
        assertTrue(rawEvents(fixture).isEmpty())
        assertTrue(candidateKeyBroadcasts(managerEmitter).isEmpty())
    }

    @Test
    fun `concurrent duplicate source IDs create one canonical row and one manager broadcast`() {
        val fixture = createFixture()
        val managerEmitter = joinManagerCapture(fixture)
        val sourceEventId = UUID.randomUUID().toString()

        assertEquals(
            listOf(204, 204),
            postCandidateKeysConcurrently(fixture, listOf(sourceEventId, sourceEventId)),
        )

        val persisted = rawEvents(fixture)
        assertEquals(1, persisted.size)
        assertEquals(sourceEventId, persisted.single().sourceEventId)
        assertEquals(1L, persisted.single().acceptedSequence)

        val broadcasts = candidateKeyBroadcasts(managerEmitter)
        assertEquals(1, broadcasts.size)
        assertEquals(sourceEventId, broadcasts.single().sourceEventId)
        assertEquals(1L, broadcasts.single().acceptedSequence)
    }

    @Test
    fun `concurrent distinct source IDs create ordered rows and two manager broadcasts`() {
        val fixture = createFixture()
        val managerEmitter = joinManagerCapture(fixture)
        val sourceEventIds = listOf(UUID.randomUUID().toString(), UUID.randomUUID().toString())

        assertEquals(listOf(204, 204), postCandidateKeysConcurrently(fixture, sourceEventIds))

        val persisted = rawEvents(fixture)
        val acceptedSequences = persisted.map { requireNotNull(it.acceptedSequence) }
        assertEquals(2, persisted.size)
        assertEquals(sourceEventIds.toSet(), persisted.map { it.sourceEventId }.toSet())
        assertEquals(listOf(1L, 2L), acceptedSequences)
        assertEquals(2, acceptedSequences.toSet().size)

        val broadcasts = candidateKeyBroadcasts(managerEmitter)
        assertEquals(2, broadcasts.size)
        assertEquals(sourceEventIds.toSet(), broadcasts.map { it.sourceEventId }.toSet())
        assertEquals(setOf(1L, 2L), broadcasts.map { it.acceptedSequence }.toSet())
    }

    @Test
    fun `physical Space retains its raw pair in persistence and manager export`() {
        val fixture = createFixture()
        val sourceEventId = UUID.randomUUID().toString()

        postCandidateKey(fixture, sourceEventId, " ", "Space")

        val persisted = roomKeystrokeEventRepository
            .findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(requireNotNull(fixture.room.id))
            .single { it.sourceEventId == sourceEventId }
        assertEquals(" ", persisted.keyValue)
        assertEquals("Space", persisted.keyCode)

        mockMvc.get("/api/rooms/${fixture.room.inviteCode}/keystroke-events") {
            header("Authorization", "Bearer ${fixture.ownerAuthToken}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.length()") { value(1) }
            jsonPath("$[0].sourceEventId") { value(sourceEventId) }
            jsonPath("$[0].keyValue") { value(" ") }
            jsonPath("$[0].keyCode") { value("Space") }
        }
    }

    @Test
    fun `candidate raw export remains forbidden`() {
        val fixture = createFixture()

        mockMvc.get("/api/rooms/${fixture.room.inviteCode}/keystroke-events") {
            header("Authorization", "Bearer ${fixture.candidateAuthToken}")
        }.andExpect {
            status { isForbidden() }
        }
    }

    @Test
    fun `invalid activity event token is forbidden and creates no raw record`() {
        val fixture = createFixture()

        mockMvc.post("/api/realtime/rooms/${fixture.room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "sessionId": "${fixture.candidateSessionId}",
                  "eventToken": "invalid-event-token",
                  "type": "key_press",
                  "sourceEventId": "${UUID.randomUUID()}",
                  "key": "x",
                  "keyCode": "KeyX"
                }
            """.trimIndent()
        }.andExpect {
            status { isForbidden() }
        }

        assertTrue(roomKeystrokeEventRepository.findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(
            requireNotNull(fixture.room.id),
        ).isEmpty())
    }

    @Test
    fun `candidate reconnect state sync omits raw activity fields`() {
        val fixture = createFixture()
        postCandidateKey(fixture, UUID.randomUUID().toString(), "a", "KeyA")

        // Rejoin with the same session to exercise the reconnect state-sync path.
        collaborationService.joinRoomSse(
            inviteCode = fixture.room.inviteCode,
            sessionId = fixture.candidateSessionId,
            participantId = "candidate-participant",
            displayName = "Candidate",
            ownerToken = null,
            interviewerToken = null,
            user = fixture.candidate,
        )

        val payloadJson = objectMapper.writeValueAsString(stateSyncPayloadFor(fixture.room.inviteCode, fixture.candidateSessionId))
        assertFalse(payloadJson.contains("\"lastCandidateKey\""))
        assertFalse(payloadJson.contains("\"candidateKeyHistory\""))
    }

    @Test
    fun `raw acceptance commits before its caller transaction completes`() {
        val fixture = createFixture()
        val roomId = requireNotNull(fixture.room.id)
        val sourceEventId = UUID.randomUUID().toString()
        val outer = TransactionTemplate(transactionManager)
        val independentRead = TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

        outer.executeWithoutResult {
            keystrokePersistenceService.accept(
                roomId,
                candidateKeyPayload(fixture, sourceEventId, "c", "KeyC"),
            )

            val visibleBeforeOuterCommit = independentRead.execute {
                roomKeystrokeEventRepository
                    .findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(roomId)
                    .count { it.sourceEventId == sourceEventId }
            }
            assertEquals(1, visibleBeforeOuterCommit ?: 0)
        }
    }

    @Test
    fun `slow raw persistence does not hold the room state monitor needed by cursor collaboration`() {
        val fixture = createFixture()
        val persistenceEntered = CountDownLatch(1)
        val releasePersistence = CountDownLatch(1)
        Mockito.doAnswer { invocation ->
            persistenceEntered.countDown()
            assertTrue(releasePersistence.await(5, TimeUnit.SECONDS))
            invocation.callRealMethod()
        }.`when`(keystrokePersistenceService).accept(anyString(), anyArgument())

        val keyFuture = CompletableFuture.runAsync {
            postCandidateKey(fixture, UUID.randomUUID().toString(), "d", "KeyD")
        }
        assertTrue(persistenceEntered.await(5, TimeUnit.SECONDS), "activity persistence should be blocked by the spy")

        val cursorFuture = CompletableFuture.supplyAsync {
            mockMvc.post("/api/realtime/rooms/${fixture.room.inviteCode}/events") {
                contentType = MediaType.APPLICATION_JSON
                content = """
                    {
                      "sessionId": "${fixture.candidateSessionId}",
                      "eventToken": "${fixture.candidateEventToken}",
                      "type": "cursor_update",
                      "lineNumber": 1,
                      "column": 1
                    }
                """.trimIndent()
            }.andReturn().response.status
        }

        try {
            assertEquals(204, cursorFuture.get(350, TimeUnit.MILLISECONDS))
        } finally {
            releasePersistence.countDown()
        }
        keyFuture.get(5, TimeUnit.SECONDS)
    }

    private fun postCandidateKey(
        fixture: Fixture,
        sourceEventId: String?,
        key: String,
        keyCode: String,
    ): Int {
        return mockMvc.post("/api/realtime/rooms/${fixture.room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "sessionId": "${fixture.candidateSessionId}",
                  "eventToken": "${fixture.candidateEventToken}",
                  "type": "key_press",
                  ${sourceEventId?.let { "\"sourceEventId\": \"$it\"," }.orEmpty()}
                  "key": "$key",
                  "keyCode": "$keyCode"
                }
            """.trimIndent()
        }.andReturn().response.status
    }

    private fun postManagerSetStep(
        fixture: Fixture,
        manager: ManagerRelayCapture,
        stepIndex: Int,
    ): Int {
        return mockMvc.post("/api/realtime/rooms/${fixture.room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "sessionId": "${manager.sessionId}",
                  "eventToken": "${manager.eventToken}",
                  "type": "set_step",
                  "stepIndex": $stepIndex
                }
            """.trimIndent()
        }.andReturn().response.status
    }

    private fun postCandidateKeysConcurrently(fixture: Fixture, sourceEventIds: List<String>): List<Int> {
        val ready = CountDownLatch(sourceEventIds.size)
        val start = CountDownLatch(1)
        val requests = sourceEventIds.mapIndexed { index, sourceEventId ->
            CompletableFuture.supplyAsync {
                ready.countDown()
                assertTrue(start.await(5, TimeUnit.SECONDS), "concurrent activity posts were not released")
                postCandidateKey(fixture, sourceEventId, "k$index", "KeyK$index")
            }
        }

        try {
            assertTrue(ready.await(5, TimeUnit.SECONDS), "both activity requests should become ready")
        } finally {
            start.countDown()
        }
        return requests.map { it.get(10, TimeUnit.SECONDS) }
    }

    private fun rawEvents(fixture: Fixture) = roomKeystrokeEventRepository
        .findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(requireNotNull(fixture.room.id))

    private fun unsavedRoom(inviteCode: String, roomId: String?): Room = Room(
        id = roomId,
        title = "Unsaved realtime-state guard",
        inviteCode = inviteCode,
        ownerSessionToken = "unsaved-owner-${UUID.randomUUID()}",
        interviewerSessionToken = "unsaved-interviewer-${UUID.randomUUID()}",
    )

    private fun unsavedRoomFactoryViolation(
        ingress: String,
        roomId: String?,
        failure: Throwable?,
        stateWasNotMutated: Boolean,
    ): String? = when {
        failure == null && !stateWasNotMutated ->
            "UNSAVED_ROOM_${ingress}_ACCEPTED_AND_STATE_MUTATED roomId=${roomIdDiagnostic(roomId)}"
        failure == null ->
            "UNSAVED_ROOM_${ingress}_ACCEPTED roomId=${roomIdDiagnostic(roomId)}"
        !stateWasNotMutated ->
            "UNSAVED_ROOM_${ingress}_STATE_MUTATED_BEFORE_REJECTION roomId=${roomIdDiagnostic(roomId)}"
        !failure.message.orEmpty().contains("persisted Room ID", ignoreCase = true) ->
            "UNSAVED_ROOM_${ingress}_MISSING_PERSISTED_ID_ERROR roomId=${roomIdDiagnostic(roomId)} message=${failure.message}"
        else -> null
    }

    private fun roomIdDiagnostic(roomId: String?): String = when {
        roomId == null -> "<null>"
        roomId.isEmpty() -> "<empty>"
        else -> "<whitespace:length=${roomId.length}>"
    }

    private fun joinManagerCapture(fixture: Fixture): SseEmitter {
        val emitter = collaborationService.joinRoomSse(
            inviteCode = fixture.room.inviteCode,
            sessionId = "manager-session-${UUID.randomUUID()}",
            participantId = "manager-participant",
            displayName = "Manager",
            ownerToken = fixture.room.ownerSessionToken,
            interviewerToken = null,
            user = fixture.owner,
        )
        bufferedSseMessages(emitter).clear()
        return emitter
    }

    private fun joinManagerRelayCapture(fixture: Fixture): ManagerRelayCapture {
        val sessionId = "manager-session-${UUID.randomUUID()}"
        val emitter = collaborationService.joinRoomSse(
            inviteCode = fixture.room.inviteCode,
            sessionId = sessionId,
            participantId = "manager-participant",
            displayName = "Manager",
            ownerToken = fixture.room.ownerSessionToken,
            interviewerToken = null,
            user = fixture.owner,
        )
        bufferedSseMessages(emitter).clear()
        return ManagerRelayCapture(
            sessionId = sessionId,
            eventToken = eventTokenFor(fixture.room.inviteCode, sessionId),
            emitter = emitter,
        )
    }

    private fun candidateKeyBroadcasts(emitter: SseEmitter): List<CandidateKeyPayload> = bufferedSseMessages(emitter)
        .mapNotNull { it.data as? String }
        .mapNotNull { encoded ->
            val message = runCatching { objectMapper.readTree(encoded) }.getOrNull() ?: return@mapNotNull null
            if (message.path("type").asText() != "candidate_key") return@mapNotNull null
            objectMapper.treeToValue(message.path("payload"), CandidateKeyPayload::class.java)
        }

    /**
     * Directly joined emitters have no MVC response handler in this integration
     * fixture, so Spring keeps outbound SSE chunks in its early-send buffer.
     * Filtering its JSON chunks verifies the server's actual manager transport
     * cardinality without adding a test-only production hook.
     */
    @Suppress("UNCHECKED_CAST")
    private fun bufferedSseMessages(emitter: SseEmitter): MutableSet<ResponseBodyEmitter.DataWithMediaType> {
        val field = ResponseBodyEmitter::class.java.getDeclaredField("earlySendAttempts")
            .apply { isAccessible = true }
        return field.get(emitter) as MutableSet<ResponseBodyEmitter.DataWithMediaType>
    }

    private fun candidateKeyPayload(
        fixture: Fixture,
        sourceEventId: String,
        key: String,
        keyCode: String,
    ) = CandidateKeyPayload(
        sessionId = fixture.candidateSessionId,
        displayName = "Candidate",
        key = key,
        keyCode = keyCode,
        ctrlKey = false,
        altKey = false,
        shiftKey = false,
        metaKey = false,
        timestampEpochMs = 0,
        sourceEventId = sourceEventId,
    )

    @Suppress("UNCHECKED_CAST")
    private fun <T> anyArgument(): T {
        Mockito.any<T>()
        return null as T
    }

    private fun createFixture(withTwoTasks: Boolean = false): Fixture {
        val owner = createUser("activity-owner")
        val candidate = createUser("activity-candidate")
        val ownerAuthToken = createSession(owner)
        val candidateAuthToken = createSession(candidate)
        val room = Room(
                title = "Durable activity room",
                inviteCode = "activity-${UUID.randomUUID()}",
                ownerSessionToken = "owner_${UUID.randomUUID()}",
                interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
                ownerUser = owner,
            ).also { persistedRoom ->
                if (withTwoTasks) {
                    persistedRoom.tasks = mutableListOf(
                        RoomTask(
                            room = persistedRoom,
                            stepIndex = 0,
                            title = "First durable task",
                            description = "First task",
                            starterCode = "first",
                            language = "nodejs",
                        ),
                        RoomTask(
                            room = persistedRoom,
                            stepIndex = 1,
                            title = "Second durable task",
                            description = "Second task",
                            starterCode = "second",
                            language = "nodejs",
                        ),
                    )
                }
            }
        roomRepository.saveAndFlush(room)
        roomParticipantRepository.saveAndFlush(
            RoomParticipant(room = room, user = candidate, role = "candidate"),
        )

        val candidateSessionId = "candidate-session-${UUID.randomUUID()}"
        collaborationService.joinRoomSse(
            inviteCode = room.inviteCode,
            sessionId = candidateSessionId,
            participantId = "candidate-participant",
            displayName = "Candidate",
            ownerToken = null,
            interviewerToken = null,
            user = candidate,
        )

        return Fixture(
            room = room,
            owner = owner,
            candidate = candidate,
            ownerAuthToken = ownerAuthToken,
            candidateAuthToken = candidateAuthToken,
            candidateSessionId = candidateSessionId,
            candidateEventToken = eventTokenFor(room.inviteCode, candidateSessionId),
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun eventTokenFor(inviteCode: String, sessionId: String): String {
        val participants = privateField("participants") as Map<String, Any>
        val participant = participants.values.single { participant ->
            readPrivateField(participant, "inviteCode") == inviteCode &&
                readPrivateField(participant, "sessionId") == sessionId
        }
        return readPrivateField(participant, "eventToken") as String
    }

    @Suppress("UNCHECKED_CAST")
    private fun realtimeRoomStates(): Map<String, Any> = privateField("roomState") as Map<String, Any>

    @Suppress("UNCHECKED_CAST")
    private fun stateSyncPayloadFor(inviteCode: String, sessionId: String): RoomRealtimePayload {
        val participants = privateField("participants") as Map<String, Any>
        val participant = participants.values.single { candidate ->
            readPrivateField(candidate, "inviteCode") == inviteCode &&
                readPrivateField(candidate, "sessionId") == sessionId
        }
        val state = (privateField("roomState") as Map<String, Any>).getValue(inviteCode)
        val method = CollaborationService::class.java.declaredMethods.single { it.name == "buildPayload" }
            .apply { isAccessible = true }
        return method.invoke(
            AopTestUtils.getTargetObject<CollaborationService>(collaborationService),
            inviteCode,
            state,
            emptyList<Any>(),
            emptyList<Any>(),
            participant,
        ) as RoomRealtimePayload
    }

    private fun privateField(name: String): Any {
        val target = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
        return CollaborationService::class.java.getDeclaredField(name)
            .apply { isAccessible = true }
            .get(target)
    }

    private fun readPrivateField(target: Any, name: String): Any? {
        return target.javaClass.getDeclaredField(name)
            .apply { isAccessible = true }
            .get(target)
    }

    private fun createUser(prefix: String): User = userRepository.saveAndFlush(
        User(
            nickname = "$prefix-${UUID.randomUUID().toString().take(8)}",
            displayName = prefix,
            passwordHash = "test-only",
            role = "user",
        ),
    )

    private fun createSession(user: User): String {
        val token = "activity_${UUID.randomUUID()}"
        userSessionRepository.saveAndFlush(UserSession(user = user, token = token))
        return token
    }

    private data class Fixture(
        val room: Room,
        val owner: User,
        val candidate: User,
        val ownerAuthToken: String,
        val candidateAuthToken: String,
        val candidateSessionId: String,
        val candidateEventToken: String,
    )

    private data class ManagerRelayCapture(
        val sessionId: String,
        val eventToken: String,
        val emitter: SseEmitter,
    )
}
