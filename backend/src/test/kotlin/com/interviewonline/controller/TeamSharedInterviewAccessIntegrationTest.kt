package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.TeamTrack
import com.interviewonline.model.TeamVacancy
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTrackRepository
import com.interviewonline.repository.TeamVacancyRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.support.Postgres16TestSupport
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
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
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@SpringBootTest(properties = [
    "app.features.team-workspaces-enabled=true",
    "app.team-invitation-link-encryption.active-key-id=integration-v1",
    "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamSharedInterviewAccessIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val teams: TeamRepository,
    @Autowired private val memberships: TeamMembershipRepository,
    @Autowired private val participants: RoomParticipantRepository,
    @Autowired private val tracks: TeamTrackRepository,
    @Autowired private val vacancies: TeamVacancyRepository,
    @Autowired private val users: UserRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val collaboration: CollaborationService,
    @Autowired private val transactionManager: PlatformTransactionManager,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_shared_interview")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `room link admits guest foreign and revoked accounts as candidate including frozen rooms`() {
        postgres.verifyPostgres16()
        val owner = account("public-owner")
        val outsider = account("public-outsider")
        val revoked = account("public-revoked")
        val team = team(owner)
        join(team, revoked)
        val room = room(owner, team, "Public interview")
        participants.saveAndFlush(RoomParticipant(room = room, user = users.findById(revoked.id).orElseThrow(), role = "interviewer"))
        jdbc.update("UPDATE team_memberships SET state = 'REMOVED' WHERE team_id = ? AND user_id = ?", team.id, revoked.id)
        listOf("active", "finished", "frozen").forEach { status ->
            jdbc.update("UPDATE rooms SET status = ? WHERE id = ?", status, room.id)
            listOf(null, outsider, revoked).forEach { actor ->
                val response = mockMvc.get("/api/rooms/${room.inviteCode}") {
                    actor?.let { header("Authorization", "Bearer ${it.token}") }
                    header("X-Room-Owner-Token", room.ownerSessionToken)
                }.andReturn().response
                assertEquals(200, response.status, "link must remain public for $status")
                val body = mapper.readTree(response.contentAsString)
                assertEquals("candidate", body.path("role").asText())
                assertFalse(body.path("canManageRoom").asBoolean())
                assertEquals(0, body.path("accessMembers").size())
                assertEquals(403, mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") {
                    actor?.let { header("Authorization", "Bearer ${it.token}") }
                }.andReturn().response.status)
                assertEquals(204, mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream-status") {
                    actor?.let { header("Authorization", "Bearer ${it.token}") }
                }.andReturn().response.status)
            }
        }
    }

    @Test
    fun `membership revocation and waiting interview deletion have a consistent authorization order`() {
        val owner = account("lock-delete-owner")
        val member = account("lock-delete-member")
        val team = team(owner)
        join(team, member)
        val room = room(owner, team, "Delete authorization serialization")
        val roomLocked = CountDownLatch(1)
        val releaseRoom = CountDownLatch(1)
        val revokeCommitted = CountDownLatch(1)
        val holderPid = AtomicInteger()
        val executor = Executors.newFixedThreadPool(3)
        try {
            val holder = executor.submit {
                TransactionTemplate(transactionManager).execute {
                    jdbc.queryForObject("SELECT id FROM rooms WHERE id = ? FOR UPDATE", String::class.java, room.id)
                    holderPid.set(requireNotNull(jdbc.queryForObject("SELECT pg_backend_pid()", Int::class.java)))
                    roomLocked.countDown()
                    check(releaseRoom.await(15, TimeUnit.SECONDS))
                }
            }
            check(roomLocked.await(10, TimeUnit.SECONDS))
            val delete = executor.submit<Int> { mockMvc.delete("/api/teams/${team.id}/interviews/${room.id}") { auth(member) }.andReturn().response.status }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (System.nanoTime() < deadline && jdbc.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)) AND query ILIKE '%rooms%'", Int::class.java, holderPid.get()) == 0) Thread.sleep(10)
            check(jdbc.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)) AND query ILIKE '%rooms%'", Int::class.java, holderPid.get())!! > 0)
            val revoke = executor.submit {
                TransactionTemplate(transactionManager).execute {
                    teams.lockById(team.id)
                    jdbc.update("UPDATE team_memberships SET state = 'REMOVED', updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE team_id = ? AND user_id = ?", team.id, member.id)
                }
                revokeCommitted.countDown()
            }
            val revokedBeforeRoomUnlock = revokeCommitted.await(1, TimeUnit.SECONDS)
            releaseRoom.countDown()
            holder.get(10, TimeUnit.SECONDS)
            assertEquals(if (revokedBeforeRoomUnlock) 404 else 204, delete.get(10, TimeUnit.SECONDS), "a committed revocation must be checked after a room lock wait")
            revoke.get(10, TimeUnit.SECONDS)
        } finally {
            releaseRoom.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `delayed chat commit does not restore a revoked external interviewer or disclose later chat`() {
        val owner = account("callback-owner")
        val external = account("callback-external", true)
        val team = team(owner)
        val room = room(owner, team, "Delayed role callback")
        assertEquals(200, mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${external.id}") { auth(owner) }.andReturn().response.status)
        val senderSession = "external-${UUID.randomUUID()}"
        val sender = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { auth(external); param("sessionId", senderSession) }.andReturn()
        val token = lastPayload(sender.response.contentAsString).path("eventToken").asText()
        val ownerSession = "owner-${UUID.randomUUID()}"
        val ownerStream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { auth(owner); param("sessionId", ownerSession) }.andReturn()
        val ownerToken = lastPayload(ownerStream.response.contentAsString).path("eventToken").asText()
        fun send(session: String, eventToken: String, text: String) = mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to session, "eventToken" to eventToken, "type" to "note_message", "clientMessageId" to UUID.randomUUID().toString(), "noteText" to text))
        }.andReturn()
        val committed = CountDownLatch(1)
        val releaseCallback = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val delayedSend = executor.submit<Int> {
                requireNotNull(TransactionTemplate(transactionManager).execute {
                    TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                        override fun afterCommit() {
                            committed.countDown()
                            check(releaseCallback.await(15, TimeUnit.SECONDS))
                        }
                    })
                    send(senderSession, token, "Allowed before revocation").response.status
                })
            }
            check(committed.await(10, TimeUnit.SECONDS))
            assertEquals(204, mockMvc.delete("/api/rooms/${room.inviteCode}/hr-managers/${external.id}") { auth(owner) }.andReturn().response.status)
            releaseCallback.countDown()
            assertEquals(200, delayedSend.get(15, TimeUnit.SECONDS))
            assertEquals(200, send(ownerSession, ownerToken, "Private chat after revocation").response.status)
            val finalPayload = lastPayload(sender.response.contentAsString)
            assertEquals("candidate", finalPayload.path("role").asText())
            assertEquals(0, finalPayload.path("notesMessages").size())
            assertEquals(0, finalPayload.path("personalNotes").size())
        } finally {
            releaseCallback.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `personal guest chat credential cannot cross a transition to team scope`() {
        val owner = account("scope-chat-owner")
        val team = team(owner)
        val personal = HrHttpFixtures.createRoom(mockMvc, mapper, owner, "Guest before team transition")
        val ownerToken = jdbc.queryForObject("SELECT owner_session_token FROM rooms WHERE id = ?", String::class.java, personal.id)
        val session = "old-personal-${UUID.randomUUID()}"
        val oldStream = mockMvc.get("/api/realtime/rooms/${personal.inviteCode}/stream") {
            param("sessionId", session); param("ownerToken", ownerToken)
        }.andReturn()
        assertEquals("owner", lastPayload(oldStream.response.contentAsString).path("role").asText())
        val eventToken = lastPayload(oldStream.response.contentAsString).path("eventToken").asText()
        val persistedChat = jdbc.queryForObject("SELECT interviewer_chat FROM rooms WHERE id = ?", String::class.java, personal.id)
        jdbc.update("UPDATE rooms SET team_id = ?, origin_team_id = ?, team_interview_created = true WHERE id = ?", team.id, team.id, personal.id)

        val send = mockMvc.post("/api/realtime/rooms/${personal.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to session, "eventToken" to eventToken, "type" to "note_message", "clientMessageId" to UUID.randomUUID().toString(), "clientEventSequence" to 1, "noteText" to "Old personal credential must not write team chat"))
        }.andReturn()
        assertEquals(403, send.response.status)
        assertEquals(persistedChat, jdbc.queryForObject("SELECT interviewer_chat FROM rooms WHERE id = ?", String::class.java, personal.id))
        assertEquals(null, collaboration.resolveRoleByEventToken(personal.inviteCode, eventToken))
        val reconnect = mockMvc.get("/api/realtime/rooms/${personal.inviteCode}/stream") {
            param("sessionId", "fresh-${UUID.randomUUID()}"); param("ownerToken", ownerToken)
        }.andReturn()
        assertEquals(200, reconnect.response.status)
        val payload = lastPayload(reconnect.response.contentAsString)
        assertEquals("candidate", payload.path("role").asText())
        assertEquals(0, payload.path("notesMessages").size())
        assertEquals(0, payload.path("personalNotes").size())
    }

    @Test
    fun `old personal guest connection cannot receive team chat before its next event`() {
        val owner = account("scope-receiver")
        val team = team(owner)
        val personal = HrHttpFixtures.createRoom(mockMvc, mapper, owner, "Guest recipient before scope transition")
        val ownerToken = jdbc.queryForObject("SELECT owner_session_token FROM rooms WHERE id = ?", String::class.java, personal.id)
        val guest = mockMvc.get("/api/realtime/rooms/${personal.inviteCode}/stream") {
            param("sessionId", "old-recipient-${UUID.randomUUID()}"); param("ownerToken", ownerToken)
        }.andReturn()
        val oldToken = lastPayload(guest.response.contentAsString).path("eventToken").asText()
        jdbc.update("UPDATE rooms SET team_id = ?, origin_team_id = ?, team_interview_created = true WHERE id = ?", team.id, team.id, personal.id)
        val ownerSession = "team-owner-${UUID.randomUUID()}"
        val manager = mockMvc.get("/api/realtime/rooms/${personal.inviteCode}/stream") {
            auth(owner); param("sessionId", ownerSession)
        }.andReturn()
        val token = lastPayload(manager.response.contentAsString).path("eventToken").asText()
        val send = mockMvc.post("/api/realtime/rooms/${personal.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to ownerSession, "eventToken" to token, "type" to "note_message", "clientMessageId" to UUID.randomUUID().toString(), "noteText" to "Fresh private team chat"))
        }.andReturn()
        assertEquals(200, send.response.status)
        assertEquals(1, lastPayload(manager.response.contentAsString).path("notesMessages").size())
        assertEquals(0, lastPayload(guest.response.contentAsString).path("notesMessages").size())
        assertEquals(null, collaboration.resolveRoleByEventToken(personal.inviteCode, oldToken))
    }

    @Test
    fun `membership revocation invalidates the previous realtime credential but permits candidate reconnect`() {
        val owner = account("detach-owner")
        val member = account("detach-member")
        val team = team(owner)
        join(team, member)
        val room = room(owner, team, "Credential revocation")
        val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { auth(member); param("sessionId", "old-${UUID.randomUUID()}") }.andReturn()
        val token = lastPayload(stream.response.contentAsString).path("eventToken").asText()
        jdbc.update("UPDATE team_memberships SET state = 'REMOVED', updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE team_id = ? AND user_id = ?", team.id, member.id)
        collaboration.syncTeamMemberRoomPermissions(team.id, member.id)
        assertEquals(null, collaboration.resolveRoleByEventToken(room.inviteCode, token))
        val reconnect = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { auth(member); param("sessionId", "new-${UUID.randomUUID()}") }.andReturn()
        assertEquals(200, reconnect.response.status)
        assertEquals("candidate", lastPayload(reconnect.response.contentAsString).path("role").asText())
    }

    @Test
    fun `candidate editor persistence works in an existing converted room without granting management`() {
        val owner = account("legacy-editor-owner")
        val team = team(owner)
        val room = room(owner, team, "Legacy public editor")
        jdbc.update("UPDATE rooms SET team_interview_created = false WHERE id = ?", room.id)
        val session = "converted-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") { param("sessionId", session) }.andReturn()
        val token = lastPayload(stream.response.contentAsString).path("eventToken").asText()
        val code = "const publicCandidate = true;"
        val response = mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to session, "eventToken" to token, "type" to "yjs_update", "syncKey" to "${room.inviteCode}:0:nodejs", "yjsUpdate" to "AQ==", "code" to code, "yjsDocumentBase64" to "AQ==", "yjsClientSequence" to 1, "baseServerYjsSequence" to 0))
        }.andReturn().response
        assertEquals(204, response.status)
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
        while (System.nanoTime() < deadline && jdbc.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, room.id) != code) Thread.sleep(25)
        assertEquals(code, jdbc.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, room.id))
        assertEquals(com.interviewonline.service.RoomAccessService.RoomRole.CANDIDATE, collaboration.resolveRoleByEventToken(room.inviteCode, token))
    }

    @Test
    fun `candidate realtime ignores legacy owner tokens and conceals interviewer chat`() {
        val owner = account("token-privacy-owner")
        val team = team(owner)
        val room = room(owner, team, "Candidate privacy")
        val chat = mapper.writeValueAsString(listOf(mapOf(
            "id" to UUID.randomUUID().toString(), "sessionId" to "host", "displayName" to "Host",
            "role" to "owner", "text" to "Internal interviewer chat", "timestampEpochMs" to 1,
        )))
        jdbc.update("UPDATE rooms SET interviewer_chat = ? WHERE id = ?", chat, room.id)
        val managerRead = mapper.readTree(mockMvc.get("/api/rooms/${room.inviteCode}") { auth(owner) }.andReturn().response.contentAsString)
        assertEquals(1, managerRead.path("notesMessages").size())
        val candidateRead = mapper.readTree(mockMvc.get("/api/rooms/${room.inviteCode}").andReturn().response.contentAsString)
        assertEquals(0, candidateRead.path("notesMessages").size())
        val sessionId = "candidate-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId); param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, stream.response.status)
        val payload = stream.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        assertEquals("candidate", payload.path("role").asText())
        assertEquals(0, payload.path("notesMessages").size())
        assertEquals(0, payload.path("personalNotes").size())
        val token = payload.path("eventToken").asText()
        val event = mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to sessionId, "eventToken" to token, "type" to "notes_update", "notes" to "Unauthorized mutation"))
        }.andReturn().response
        assertEquals(403, event.status)
        assertEquals("", jdbc.queryForObject("SELECT notes FROM rooms WHERE id = ?", String::class.java, room.id))
    }

    @Test
    fun `existing converted room still admits a candidate by link`() {
        val owner = account("converted-owner", true)
        val team = team(owner)
        val room = room(owner, team, "Legacy room")
        jdbc.update("UPDATE rooms SET team_interview_created = false WHERE id = ?", room.id)
        val response = mockMvc.get("/api/rooms/${room.inviteCode}").andReturn().response
        assertEquals(200, response.status)
        assertEquals("candidate", mapper.readTree(response.contentAsString).path("role").asText())
        assertEquals(403, mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") { auth(owner) }.andReturn().response.status)
        assertEquals(404, mockMvc.get("/api/me/hr/rooms/${room.id}") { auth(owner) }.andReturn().response.status)
        assertEquals(0, mapper.readTree(list(owner, team.id).contentAsString).path("totalElements").asInt())
    }

    @Test
    fun `ordinary active team members can manage interviews and see candidates without hiring setup`() {
        val owner = account("shared-owner")
        val member = account("shared-member")
        val team = team(owner)
        join(team, member)
        val room = room(owner, team, "Shared interview")
        val admission = mockMvc.get("/api/rooms/${room.inviteCode}") { auth(member) }.andReturn().response
        assertEquals(200, admission.status)
        assertEquals("interviewer", mapper.readTree(admission.contentAsString).path("role").asText())
        assertEquals(200, mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
            auth(member); contentType = MediaType.APPLICATION_JSON
            content = """{"candidateName":"Shared candidate","position":"Engineer","scheduledAt":null,"revision":0}"""
        }.andReturn().response.status)
        val page = list(member, team.id)
        assertEquals(200, page.status)
        assertEquals(listOf(room.id), mapper.readTree(page.contentAsString).path("items").map { it.path("roomId").asText() })
        assertEquals(200, mockMvc.get("/api/me/hr/rooms/${room.id}") { auth(member) }.andReturn().response.status)
        assertEquals(200, mockMvc.get("/api/me/hr/rooms/export") { auth(member); param("teamId", team.id) }.andReturn().response.status)
        assertEquals(200, mockMvc.get("/api/teams/${team.id}/interviews") { auth(member); param("q", "Shared candidate") }.andReturn().response.status)
        assertEquals(1, mapper.readTree(mockMvc.get("/api/teams/${team.id}/interviews") { auth(member); param("q", "Shared candidate") }.andReturn().response.contentAsString).path("items").size())
        assertEquals(200, mockMvc.patch("/api/teams/${team.id}/interviews/${room.id}") {
            auth(member); contentType = MediaType.APPLICATION_JSON; content = """{"title":"Renamed by member"}"""
        }.andReturn().response.status)
        jdbc.update("UPDATE team_memberships SET state = 'LEFT' WHERE team_id = ? AND user_id = ?", team.id, member.id)
        assertEquals(404, list(member, team.id).status)
        assertEquals(404, mockMvc.get("/api/me/hr/rooms/${room.id}") { auth(member) }.andReturn().response.status)
        assertEquals(403, mockMvc.get("/api/rooms/${room.inviteCode}/interview-metadata") { auth(member) }.andReturn().response.status)
    }

    @Test
    fun `hiring UUID invitations only target external users and expose just the assigned candidate`() {
        val owner = account("external-owner")
        val member = account("external-member", true)
        val external = account("external-hr", true)
        val team = team(owner)
        join(team, member)
        val first = room(owner, team, "External candidate")
        room(owner, team, "Private unassigned candidate")
        assertEquals(404, mockMvc.put("/api/rooms/${first.inviteCode}/hr-managers/${member.id}") { auth(owner) }.andReturn().response.status)
        repeat(2) {
            assertEquals(200, mockMvc.put("/api/rooms/${first.inviteCode}/hr-managers/${external.id}") { auth(owner) }.andReturn().response.status)
        }
        val externalPage = list(external, null)
        assertEquals(200, externalPage.status)
        assertEquals(listOf(first.id), mapper.readTree(externalPage.contentAsString).path("items").map { it.path("roomId").asText() })
        assertEquals(404, list(external, team.id).status)
        assertEquals("interviewer", mapper.readTree(mockMvc.get("/api/rooms/${first.inviteCode}") { auth(external) }.andReturn().response.contentAsString).path("role").asText())
        val managers = mapper.readTree(mockMvc.get("/api/rooms/${first.inviteCode}/hr-managers") { auth(owner) }.andReturn().response.contentAsString)
        assertEquals(listOf(external.id), managers.map { it.path("userId").asText() })
        assertEquals(204, mockMvc.delete("/api/rooms/${first.inviteCode}/hr-managers/${external.id}") { auth(owner) }.andReturn().response.status)
        assertEquals(0, mapper.readTree(list(external, null).contentAsString).path("totalElements").asInt())
        assertEquals("candidate", mapper.readTree(mockMvc.get("/api/rooms/${first.inviteCode}") { auth(external) }.andReturn().response.contentAsString).path("role").asText())
    }

    @Test
    fun `fresh external UUID invitation can authorize a former member without restoring stale grants`() {
        val owner = account("former-owner")
        val former = account("former-hr", true)
        val team = team(owner)
        join(team, former)
        val room = room(owner, team, "Former member invitation")
        participants.saveAndFlush(RoomParticipant(room = room, user = users.findById(former.id).orElseThrow(), role = "interviewer"))
        jdbc.update("INSERT INTO room_hr_assignments (id, room_id, user_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP - INTERVAL '1 day')", UUID.randomUUID().toString(), room.id, former.id)
        listOf("LEFT", "REMOVED").forEach { state ->
            jdbc.update("UPDATE team_memberships SET state = ?, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE team_id = ? AND user_id = ?", state, team.id, former.id)
            assertEquals("candidate", mapper.readTree(mockMvc.get("/api/rooms/${room.inviteCode}") { auth(former) }.andReturn().response.contentAsString).path("role").asText())
            assertEquals(0, mapper.readTree(list(former, null).contentAsString).path("totalElements").asInt())
            assertEquals(200, mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${former.id}") { auth(owner) }.andReturn().response.status)
            assertEquals("interviewer", mapper.readTree(mockMvc.get("/api/rooms/${room.inviteCode}") { auth(former) }.andReturn().response.contentAsString).path("role").asText())
            assertEquals(1, mapper.readTree(list(former, null).contentAsString).path("totalElements").asInt())
        }
        jdbc.update("UPDATE team_memberships SET state = 'SUSPENDED', updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE team_id = ? AND user_id = ?", team.id, former.id)
        assertEquals(404, mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${former.id}") { auth(owner) }.andReturn().response.status)
        assertEquals("candidate", mapper.readTree(mockMvc.get("/api/rooms/${room.inviteCode}") { auth(former) }.andReturn().response.contentAsString).path("role").asText())
    }

    @Test
    fun `team creation accepts external hiring UUID atomically and rejects own team hiring assignments`() {
        val owner = account("create-shared-owner")
        val external = account("create-external", true)
        val member = account("create-shared-hr", true)
        val team = team(owner)
        join(team, member)
        fun create(target: HrTestAccount, key: String) = mockMvc.post("/api/teams/${team.id}/interviews") {
            auth(owner); header("Idempotency-Key", key); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("title" to "External creation", "hiringManagerIds" to listOf(target.id)))
        }.andReturn().response
        val key = UUID.randomUUID().toString()
        val first = create(external, key)
        assertEquals(201, first.status)
        assertEquals(mapper.readTree(first.contentAsString), mapper.readTree(create(external, key).contentAsString))
        assertEquals(404, create(member, UUID.randomUUID().toString()).status)
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id))
        assertEquals(1, mapper.readTree(list(external, null).contentAsString).path("totalElements").asInt())
    }

    @Test
    fun `candidate and interview track vacancy filters combine with each other and pagination`() {
        val owner = account("filter-owner")
        val member = account("filter-member")
        val team = team(owner)
        join(team, member)
        val track = track(team, owner, "Backend")
        val otherTrack = track(team, owner, "Frontend")
        val vacancy = vacancy(team, owner, track, "Kotlin")
        val otherVacancy = vacancy(team, owner, track, "Java")
        val selected = room(owner, team, "Kotlin interview", track.id, vacancy.id)
        val sibling = room(owner, team, "Java interview", track.id, otherVacancy.id)
        room(owner, team, "Frontend interview", otherTrack.id)
        room(owner, team, "No process interview")
        fun interviewIds(trackId: String?, vacancyId: String?) = mapper.readTree(mockMvc.get("/api/teams/${team.id}/interviews") {
            auth(member); trackId?.let { param("trackId", it) }; vacancyId?.let { param("vacancyId", it) }
        }.andReturn().response.contentAsString).path("items").map { it.path("id").asText() }.toSet()
        assertEquals(setOf(selected.id, sibling.id), interviewIds(track.id, null))
        assertEquals(setOf(selected.id), interviewIds(track.id, vacancy.id))
        assertEquals(setOf(selected.id), interviewIds(null, vacancy.id))
        assertEquals(emptySet<String>(), interviewIds(otherTrack.id, vacancy.id))
        val page = mapper.readTree(list(member, team.id, track.id, vacancy.id).contentAsString)
        assertEquals(1, page.path("totalElements").asInt())
        assertEquals(1, page.path("totalPages").asInt())
        assertEquals(selected.id, page.path("items")[0].path("roomId").asText())
        assertEquals(track.id, page.path("items")[0].path("trackId").asText())
        assertEquals("Backend", page.path("items")[0].path("trackName").asText())
        assertEquals(vacancy.id, page.path("items")[0].path("vacancyId").asText())
        assertEquals("Kotlin", page.path("items")[0].path("vacancyTitle").asText())
        assertEquals(0, mapper.readTree(list(member, team.id, otherTrack.id, vacancy.id).contentAsString).path("totalElements").asInt())
        assertEquals("1", mockMvc.get("/api/me/hr/rooms/export") {
            auth(member); param("teamId", team.id); param("trackId", track.id); param("vacancyId", vacancy.id)
        }.andReturn().response.getHeader("Interview-Count"))
    }

    @Test
    fun `scoped hiring preview rejects team members and foreign scope without exposing a catalog`() {
        val owner = account("preview-owner")
        val member = account("preview-member", true)
        val external = account("preview-external", true)
        val team = team(owner)
        join(team, member)
        fun preview(actor: HrTestAccount, target: HrTestAccount) = mockMvc.post("/api/me/hiring-manager-preview") {
            auth(actor); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("invitationId" to target.id, "teamId" to team.id))
        }.andReturn().response
        assertEquals(404, preview(owner, member).status)
        assertEquals(200, preview(owner, external).status)
        assertEquals(404, preview(external, member).status)
        assertEquals(0, mapper.readTree(mockMvc.get("/api/me/hiring-manager-options") { auth(owner); param("teamId", team.id) }.andReturn().response.contentAsString).size())
    }

    private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.auth(account: HrTestAccount) = header("Authorization", "Bearer ${account.token}")
    private fun lastPayload(rawSse: String) = rawSse.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
    private fun account(prefix: String, hr: Boolean = false) = HrHttpFixtures.register(mockMvc, mapper, hr, prefix).first
    private fun team(owner: HrTestAccount): Team {
        val id = UUID.randomUUID().toString()
        return teams.saveAndFlush(Team(id = id, name = "Team $id", normalizedName = "team $id", ownerUserId = owner.id)).also { join(it, owner, "ADMIN") }
    }
    private fun join(team: Team, account: HrTestAccount, role: String = "MEMBER") = memberships.saveAndFlush(TeamMembership(id = UUID.randomUUID().toString(), teamId = team.id, userId = account.id, role = role))
    private fun room(owner: HrTestAccount, team: Team, title: String, trackId: String? = null, vacancyId: String? = null) = rooms.saveAndFlush(Room(title = title, inviteCode = "r-${UUID.randomUUID()}", ownerSessionToken = "owner_${UUID.randomUUID()}", interviewerSessionToken = "interviewer_${UUID.randomUUID()}", ownerUser = users.findById(owner.id).orElseThrow(), createdByUserId = owner.id, teamId = team.id, originTeamId = team.id, teamInterviewCreated = true, teamTrackId = trackId, teamVacancyId = vacancyId))
    private fun track(team: Team, owner: HrTestAccount, name: String) = tracks.saveAndFlush(TeamTrack(id = UUID.randomUUID().toString(), teamId = team.id, name = name, normalizedName = name.lowercase(), createdByUserId = owner.id))
    private fun vacancy(team: Team, owner: HrTestAccount, track: TeamTrack, title: String) = vacancies.saveAndFlush(TeamVacancy(id = UUID.randomUUID().toString(), teamId = team.id, trackId = track.id, title = title, normalizedTitle = title.lowercase(), createdByUserId = owner.id))
    private fun list(actor: HrTestAccount, teamId: String?, trackId: String? = null, vacancyId: String? = null) = mockMvc.get("/api/me/hr/rooms") {
        auth(actor); teamId?.let { param("teamId", it) }; trackId?.let { param("trackId", it) }; vacancyId?.let { param("vacancyId", it) }; param("size", "1")
    }.andReturn().response
}
