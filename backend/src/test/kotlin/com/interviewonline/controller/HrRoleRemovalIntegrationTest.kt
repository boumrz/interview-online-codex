package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.RoomHrAssignment
import com.interviewonline.model.RoomParticipant
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Server-only acceptance complements the participant-menu and offline-list browser flows. */
// Match production; MockMvc does not complete long-lived SSE dispatches automatically.
@SpringBootTest(properties = ["spring.jpa.open-in-view=false"])
@AutoConfigureMockMvc
class HrRoleRemovalIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val participantRepository: RoomParticipantRepository,
    @Autowired private val assignmentRepository: RoomHrAssignmentRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    @Test
    fun `offline removal is durable and idempotent retains history and permits explicit regrant`() {
        val (owner, hr, room) = assignedRoom()
        val originalMembership = participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.id
        val originalAssignment = assignmentRepository.findByRoomIdAndUserId(room.id, hr.id)!!.id
        assertCabinetCount(hr, 1)

        repeat(2) { assertRemoved(remove(room, hr.id, owner)) }

        assertCandidate(room, hr)
        assertEquals(originalMembership, participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.id)
        assertEquals(originalAssignment, assignmentRepository.findByRoomIdAndUserId(room.id, hr.id)!!.id)
        assertTrue(userRepository.findById(hr.id).orElseThrow().isHr)
        assertEquals(owner.id, roomRepository.findById(room.id).orElseThrow().ownerUser!!.id)
        assertCabinetCount(hr, 0)
        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isNotFound() } }
        mockMvc.get("/api/me/hr/rooms/export") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isOk() }; header { string("Interview-Count", "0") } }
        mockMvc.get("/api/rooms/${room.inviteCode}/hr-managers") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isOk() }; jsonPath("$.length()") { value(0) } }
        assertEquals(403, track(room, hr).response.status)
        assertCandidate(room, hr)

        repeat(2) { assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status) }
        assertCabinetCount(hr, 1)
        assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.role)
        assertEquals(originalAssignment, assignmentRepository.findByRoomIdAndUserId(room.id, hr.id)!!.id)
        assertEquals(1, assignmentRepository.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id).size)
    }

    @ParameterizedTest
    @ValueSource(strings = ["membership", "retained-assignment"])
    fun `either room relationship is sufficient and removal preserves the relationship`(relationship: String) {
        val owner = account(false)
        val hr = account(true)
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val storedRoom = roomRepository.findById(room.id).orElseThrow()
        val storedHr = userRepository.findById(hr.id).orElseThrow()
        if (relationship == "membership") {
            participantRepository.saveAndFlush(RoomParticipant(room = storedRoom, user = storedHr, role = "interviewer"))
            assertFalse(assignmentRepository.existsByRoomIdAndUserId(room.id, hr.id))
        } else {
            assignmentRepository.saveAndFlush(RoomHrAssignment(room = storedRoom, user = storedHr))
            assertNull(participantRepository.findByRoomIdAndUserId(room.id, hr.id))
        }

        repeat(2) { assertRemoved(remove(room, hr.id, owner)) }

        assertCandidate(room, hr)
        assertEquals(1, participantRepository.findAllByRoomIdOrderByCreatedAtAsc(room.id).count { it.user!!.id == hr.id })
        assertEquals(relationship == "retained-assignment", assignmentRepository.existsByRoomIdAndUserId(room.id, hr.id))
        assertTrue(userRepository.findById(hr.id).orElseThrow().isHr)
    }

    @ParameterizedTest
    @ValueSource(strings = ["interviewer", "promoted-guest"])
    fun `current non-owner managers can remove HR without broadening ordinary role controls`(actor: String) {
        val (owner, hr, room) = assignedRoom()
        try {
            val ownerTab = join(room, owner)
            val manager = if (actor == "interviewer") account(false) else null
            val managerTab = join(room, manager)
            assertEquals(204, event(room, ownerTab, "grant_interviewer_access", mapOf(
                "targetSessionId" to managerTab.sessionId,
            )).response.status)
            assertEquals("interviewer", payload(managerTab).path("role").asText())

            val result = if (manager != null) remove(room, hr.id, manager) else {
                remove(room, hr.id, eventToken = managerTab.eventToken)
            }
            assertRemoved(result)
            assertCandidate(room, hr)

            val ordinary = account(false)
            val ordinaryTab = join(room, ordinary)
            assertEquals(204, event(room, ownerTab, "grant_interviewer_access", mapOf(
                "targetSessionId" to ordinaryTab.sessionId,
            )).response.status)
            assertEquals(404, remove(room, ordinary.id, eventToken = managerTab.eventToken).response.status)
            assertEquals(403, event(room, managerTab, "revoke_interviewer_access", mapOf(
                "targetUserId" to ordinary.id,
            )).response.status)
            assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(room.id, ordinary.id)!!.role)
        } finally { collaborationService.closeRoom(room.inviteCode) }
    }

    @Test
    fun `self removal succeeds once then current candidate authority prevents retries`() {
        val (owner, hr, room) = assignedRoom()
        assertRemoved(remove(room, hr.id, hr))
        assertEquals(403, remove(room, hr.id, hr).response.status)
        assertEquals(403, remove(room, "malformed-user-id", hr).response.status)
        assertCandidate(room, hr)
        assertRemoved(remove(room, hr.id, owner))
        assertTrue(assignmentRepository.existsByRoomIdAndUserId(room.id, hr.id))
    }

    @ParameterizedTest
    @CsvSource("owner-hr,403", "owner-non-hr,403", "malformed,404", "unknown,404", "ordinary,404", "unrelated-hr,404")
    fun `target boundaries are checked only after caller authority and never create membership`(targetKind: String, expected: Int) {
        val owner = account(targetKind == "owner-hr")
        val callerCandidate = account(true)
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val targetId = when (targetKind) {
            "owner-hr", "owner-non-hr" -> owner.id
            "malformed" -> "malformed-user-id"
            "unknown" -> UUID.randomUUID().toString()
            "ordinary" -> account(false).id
            else -> account(true).id
        }

        assertEquals(403, remove(room, targetId, callerCandidate).response.status)
        assertEquals(403, remove(room, targetId).response.status)
        assertEquals(expected, remove(room, targetId, owner).response.status)
        assertNull(participantRepository.findByRoomIdAndUserId(room.id, targetId))
        assertFalse(assignmentRepository.existsByRoomIdAndUserId(room.id, targetId))
    }

    @Test
    fun `archived removal is terminal and does not rewrite the retained membership`() {
        val (owner, hr, room) = assignedRoom()
        mockMvc.delete("/api/me/rooms/${room.id}") {
            header("Authorization", "Bearer ${owner.token}")
        }.andExpect { status { isOk() }; jsonPath("$.archived") { value(true) } }

        assertEquals(410, remove(room, hr.id, owner).response.status)
        assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.role)
        assertTrue(assignmentRepository.existsByRoomIdAndUserId(room.id, hr.id))
        assertNotNull(roomRepository.findById(room.id).orElseThrow().archivedAt)
    }

    @Test
    fun `all active tabs lose private payload and old credentials cannot restore access after reconnect`() {
        val (owner, hr, room) = assignedRoom()
        try {
            val firstTab = join(room, hr)
            val secondTab = join(room, hr)
            assertEquals(204, event(room, firstTab, "private_note_entry", mapOf(
                "privateNoteId" to UUID.randomUUID().toString(),
                "privateNoteText" to "Private HR observation",
                "privateNoteTimestampEpochMs" to System.currentTimeMillis(),
            )).response.status)
            assertTrue(payload(firstTab).path("personalNotes").any { it.path("text").asText() == "Private HR observation" })

            assertRemoved(remove(room, hr.id, owner))

            for (tab in listOf(firstTab, secondTab)) {
                assertCandidatePayload(payload(tab))
                mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") {
                    header("X-Room-Event-Token", tab.eventToken)
                }.andExpect { status { isForbidden() } }
                assertEquals(403, event(room, tab, "private_note_entry", mapOf(
                    "privateNoteId" to UUID.randomUUID().toString(), "privateNoteText" to "Forbidden new note",
                )).response.status)
                assertEquals(403, event(room, tab, "grant_interviewer_access", mapOf("targetUserId" to hr.id)).response.status)
                assertEquals(403, remove(room, hr.id, eventToken = tab.eventToken).response.status)
                assertEquals(204, event(room, tab, "request_state_sync").response.status)
                assertCandidatePayload(payload(tab))
            }
            mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") {
                header("Authorization", "Bearer ${hr.token}")
            }.andExpect { status { isForbidden() } }
            assertEquals(403, track(room, hr).response.status)
            collaborationService.closeRoom(room.inviteCode)
            assertCandidatePayload(payload(join(room, hr)))
            assertCandidate(room, hr)
            assertTrue(roomRepository.findById(room.id).orElseThrow().privateNotesJson.orEmpty().contains("Private HR observation"),
                "removal revokes access without deleting private interview history")
        } finally { collaborationService.closeRoom(room.inviteCode) }
    }

    @ParameterizedTest
    @CsvSource("invite,remove", "remove,invite", "track,remove", "remove,track", "entry,remove", "remove,entry")
    fun `removal and concurrent permission operations respect the committed room order`(first: String, second: String) {
        val (owner, hr, room) = assignedRoom()
        val executor = Executors.newSingleThreadExecutor()
        val started = CountDownLatch(1)
        fun operation(name: String): Int = when (name) {
            "invite" -> HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status
            "remove" -> remove(room, hr.id, owner).response.status
            "track" -> track(room, hr).response.status
            "entry" -> join(room, hr).result.response.status
            else -> error("Unknown operation $name")
        }
        try {
            val queued = TransactionTemplate(transactionManager).execute {
                assertEquals(if (first == "remove") 204 else 200, operation(first))
                val future = executor.submit<Int> { started.countDown(); operation(second) }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                assertThrows(TimeoutException::class.java, { future.get(200, TimeUnit.MILLISECONDS) },
                    "a competing permission operation must wait until the current room transaction commits")
                future
            }!!
            val expectedStatus = when {
                second == "remove" -> 204
                first == "remove" && second == "track" -> 403
                else -> 200
            }
            assertEquals(expectedStatus, queued.get(10, TimeUnit.SECONDS))
            val expectedRole = if (second == "invite") "interviewer" else "candidate"
            assertEquals(expectedRole, participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.role)
            assertEquals(1, assignmentRepository.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id).size)
            assertEquals(1, participantRepository.findAllByRoomIdOrderByCreatedAtAsc(room.id).count { it.user!!.id == hr.id })
            assertEquals(expectedRole, payload(join(room, hr)).path("role").asText(),
                "entry must use the final durable role even after an older permission callback")
        } finally {
            executor.shutdownNow()
            collaborationService.closeRoom(room.inviteCode)
        }
    }

    private fun account(isHr: Boolean) = HrHttpFixtures.register(mockMvc, objectMapper, isHr, "remove-hr").first

    private fun assignedRoom(): Triple<HrTestAccount, HrTestAccount, HrTestRoom> {
        val owner = account(false)
        val hr = account(true)
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status)
        return Triple(owner, hr, room)
    }

    private fun remove(room: HrTestRoom, targetId: String, caller: HrTestAccount? = null, eventToken: String? = null) =
        mockMvc.delete("/api/rooms/${room.inviteCode}/hr-managers/$targetId") {
            caller?.let { header("Authorization", "Bearer ${it.token}") }
            eventToken?.let { header("X-Room-Event-Token", it) }
        }.andReturn()

    private fun assertRemoved(result: MvcResult) {
        assertEquals(204, result.response.status, "authorized HR removal must return 204: ${result.response.contentAsString}")
        assertEquals("", result.response.contentAsString)
    }

    private fun assertCandidate(room: HrTestRoom, hr: HrTestAccount) {
        assertEquals("candidate", participantRepository.findByRoomIdAndUserId(room.id, hr.id)!!.role)
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("candidate") }
            jsonPath("$.canManageRoom") { value(false) }
            jsonPath("$.isOwner") { value(false) }
        }
    }

    private fun assertCabinetCount(hr: HrTestAccount, count: Int) {
        mockMvc.get("/api/me/hr/rooms") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect { status { isOk() }; jsonPath("$.totalElements") { value(count) } }
    }

    private fun track(room: HrTestRoom, hr: HrTestAccount) = mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
        header("Authorization", "Bearer ${hr.token}")
    }.andReturn()

    private data class Tab(val sessionId: String, val eventToken: String, val result: MvcResult)

    private fun join(room: HrTestRoom, account: HrTestAccount?): Tab {
        val sessionId = UUID.randomUUID().toString()
        val result = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId)
            param("displayName", "Removal acceptance participant")
            account?.let { header("Authorization", "Bearer ${it.token}") }
        }.andExpect { status { isOk() }; request { asyncStarted() } }.andReturn()
        return Tab(sessionId, payload(result).path("eventToken").asText().also { assertTrue(it.isNotBlank()) }, result)
    }

    private fun event(room: HrTestRoom, tab: Tab, type: String, fields: Map<String, Any> = emptyMap()) =
        mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(fields + mapOf("sessionId" to tab.sessionId, "eventToken" to tab.eventToken, "type" to type))
        }.andReturn()

    private fun payload(tab: Tab) = payload(tab.result)

    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }
        .map { objectMapper.readTree(it.removePrefix("data:")) }
        .filter { it.path("type").asText() == "state_sync" }
        .last().path("payload")

    private fun assertCandidatePayload(payload: JsonNode) {
        assertEquals("candidate", payload.path("role").asText())
        assertFalse(payload.path("canManageRoom").asBoolean())
        assertFalse(payload.path("canGrantAccess").asBoolean())
        assertTrue(payload.path("personalNotes").isEmpty)
        assertFalse(payload.has("candidateKeyHistory"))
        assertFalse(payload.has("lastCandidateKey"))
    }
}
