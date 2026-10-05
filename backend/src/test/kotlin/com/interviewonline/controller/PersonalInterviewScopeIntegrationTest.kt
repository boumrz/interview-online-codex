package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomHrAssignment
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.repository.*
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PersonalInterviewScopeIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val participants: RoomParticipantRepository,
    @Autowired private val assignments: RoomHrAssignmentRepository,
    @Autowired private val teams: TeamRepository,
    @Autowired private val memberships: TeamMembershipRepository,
    @Autowired private val transactionManager: PlatformTransactionManager,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("personal_interview_scope")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `personal creation atomically assigns distinct eligible managers and reconnect resolves current authority`() {
        postgres.verifyPostgres16()
        val owner = account(); val hiring = account(true); val peer = account(true)
        val result = create(owner, listOf(" ${hiring.id.uppercase()} ", hiring.id, peer.id))
        assertEquals(200, result.status, result.contentAsString)
        val body = mapper.readTree(result.contentAsString); val id = body.path("id").asText(); val invite = body.path("inviteCode").asText()
        assertTrue(body.path("teamId").isNull)
        for (manager in listOf(hiring, peer)) {
            assertEquals("interviewer", participants.findByRoomIdAndUserId(id, manager.id)?.role)
            assertTrue(assignments.existsByRoomIdAndUserId(id, manager.id))
            assertEquals("interviewer", mapper.readTree(mvc.get("/api/rooms/$invite") { header("Authorization", "Bearer ${manager.token}") }.andReturn().response.contentAsString).path("role").asText())
            assertEquals(200, mvc.get("/api/me/rooms/$id/details") { header("Authorization", "Bearer ${manager.token}") }.andReturn().response.status)
        }
        assertEquals(2, assignments.findAllByRoomIdOrderByCreatedAtAscIdAsc(id).size)
        assertEquals(0, memberships.findAll().count { it.userId in setOf(hiring.id, peer.id) })
        val stream = mvc.get("/api/realtime/rooms/$invite/stream") {
            header("Authorization", "Bearer ${hiring.token}"); param("sessionId", "personal-create-${UUID.randomUUID()}")
            param("participantId", "p-${UUID.randomUUID()}"); param("displayName", "Hiring")
        }.andReturn()
        assertEquals("interviewer", streamPayload(stream).path("role").asText())
    }

    @Test fun `personal creation rejects unsafe or opted out targets and malformed lists without partial writes`() {
        val owner = account(); val hiring = account(true); val ordinary = account()
        val disabled = account(true); val stored = users.findById(disabled.id).orElseThrow(); stored.isHr = false; users.saveAndFlush(stored)
        val before = listOf(rooms.count(), participants.count(), assignments.count())
        for (target in listOf(UUID.randomUUID().toString(), "invalid", ordinary.id, disabled.id)) {
            val result = create(owner, listOf(hiring.id, target))
            assertEquals(404, result.status, result.contentAsString)
            assertEquals("Нанимающий не найден или недоступен", mapper.readTree(result.contentAsString).path("error").asText())
            assertEquals(before, listOf(rooms.count(), participants.count(), assignments.count()))
        }
        for (targets in listOf(null, "not-array", listOf(hiring.id, 7))) {
            assertEquals(400, create(owner, targets).status)
            assertEquals(before, listOf(rooms.count(), participants.count(), assignments.count()))
        }
        assertEquals(401, mvc.post("/api/rooms") { contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("title" to "No auth", "hiringManagerIds" to listOf(hiring.id))) }.andReturn().response.status)
        assertEquals(400, mvc.post("/api/public/rooms") { contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("title" to "Quick", "hiringManagerIds" to listOf(hiring.id))) }.andReturn().response.status)
        for (extra in listOf(emptyMap<String, Any>(), mapOf("hiringManagerIds" to emptyList<String>()))) {
            assertEquals(200, mvc.post("/api/rooms") { header("Authorization", "Bearer ${owner.token}"); contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("title" to "Normal personal") + extra) }.andReturn().response.status)
        }
        assertEquals(before[2], assignments.count())
    }

    @Test fun `personal exact nickname preview is minimal no store and unavailable targets are indistinguishable`() {
        val owner = account(); val hiring = account(true); val ordinary = account(); val disabled = account(true)
        val disabledUser = users.findById(disabled.id).orElseThrow(); disabledUser.isHr = false; users.saveAndFlush(disabledUser)
        val nickname = users.findById(hiring.id).orElseThrow().nickname
        val before = listOf(rooms.count(), participants.count(), assignments.count())
        for (request in listOf(mapOf("nickname" to "  $nickname  "), mapOf("invitationId" to hiring.id.uppercase()))) {
            val result = accountPreview(owner, request)
            assertEquals(200, result.status, result.contentAsString)
            assertEquals("no-store", result.getHeader("Cache-Control"))
            val body = mapper.readTree(result.contentAsString)
            assertEquals(setOf("normalizedId", "displayName"), body.fieldNames().asSequence().toSet())
            assertEquals(hiring.id, body.path("normalizedId").asText())
        }
        val failures = listOf("absent-person", users.findById(ordinary.id).orElseThrow().nickname, disabledUser.nickname).map { name ->
            val result = accountPreview(owner, mapOf("nickname" to name)); assertEquals(404, result.status); result.contentAsString
        }
        assertEquals(1, failures.toSet().size)
        val options = mvc.get("/api/me/hiring-manager-options") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response
        assertEquals(200, options.status); assertEquals("[]", options.contentAsString)
        assertEquals(before, listOf(rooms.count(), participants.count(), assignments.count()))
    }

    @Test fun `personal manager can add remove and explicitly restore hiring while candidate and outsider cannot`() {
        val owner = account(); val hiring = account(true); val peer = account(true); val outsider = account(); val room = room(owner)
        assertEquals(200, roomPreview(room, hiring, owner).status)
        assertEquals(403, roomPreview(room, hiring, outsider).status)
        for (actor in listOf(owner, owner)) assertEquals(200, invite(room, hiring, actor).status)
        assertEquals(1, assignments.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id!!).size)
        assertEquals(200, invite(room, peer, hiring).status, "current interviewer can invite another manager")
        assertEquals(403, invite(room, account(true), outsider).status)
        assertTrue(room.id in cabinet(hiring)); assertFalse(room.id in cabinet(account(true)))
        assertEquals(204, mvc.delete("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response.status)
        assertEquals("candidate", participants.findByRoomIdAndUserId(room.id!!, hiring.id)?.role)
        assertFalse(room.id in cabinet(hiring))
        assertEquals(403, roomPreview(room, peer, hiring).status)
        assertEquals(403, mvc.post("/api/rooms/${room.inviteCode}/hr-tracking") { header("Authorization", "Bearer ${hiring.token}"); header("X-Room-Owner-Token", room.ownerSessionToken) }.andReturn().response.status, "tracking cannot bypass a revoked candidate override")
        assertEquals(200, invite(room, hiring, owner).status)
        assertEquals("interviewer", participants.findByRoomIdAndUserId(room.id!!, hiring.id)?.role)
        assertTrue(room.id in cabinet(hiring))
        assertEquals(2, assignments.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id!!).size)
    }

    @Test fun `personal tracking records only current permitted hiring manager and protects owner`() {
        val owner = account(true); val room = room(owner); val candidate = account(true)
        assertEquals(403, mvc.post("/api/rooms/${room.inviteCode}/hr-tracking") { header("Authorization", "Bearer ${candidate.token}") }.andReturn().response.status)
        assertFalse(assignments.existsByRoomIdAndUserId(room.id!!, candidate.id))
        for (attempt in 1..2) assertEquals(200, mvc.post("/api/rooms/${room.inviteCode}/hr-tracking") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response.status)
        assertEquals(1, assignments.findAllByRoomIdOrderByCreatedAtAscIdAsc(room.id!!).size)
        assertNull(participants.findByRoomIdAndUserId(room.id!!, owner.id))
        assertEquals(403, mvc.delete("/api/rooms/${room.inviteCode}/hr-managers/${owner.id}") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response.status)
        assertTrue(room.id in cabinet(owner))
    }

    @Test fun `personal guest proof grants only its current anonymous identity and revoke or conversion denies hiring`() {
        val owner = account(); val hiring = account(true); val outsider = account(); val room = room(owner)
        val hostSession = "hiring-host-${UUID.randomUUID()}"; val guestSession = "hiring-guest-${UUID.randomUUID()}"
        fun join(session: String, actor: HrTestAccount? = null) = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            actor?.let { header("Authorization", "Bearer ${it.token}") }; param("sessionId", session); param("participantId", "p-${UUID.randomUUID()}"); param("displayName", "Guest")
        }.andReturn()
        val host = join(hostSession, owner); val guest = join(guestSession); val guestToken = streamPayload(guest).path("eventToken").asText()
        fun event(type: String) = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("sessionId" to hostSession, "eventToken" to streamPayload(host).path("eventToken").asText(), "type" to type, "targetSessionId" to guestSession))
        }.andReturn().response
        fun preview(actor: HrTestAccount? = null) = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            actor?.let { header("Authorization", "Bearer ${it.token}") }; header("X-Room-Event-Token", guestToken); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to users.findById(hiring.id).orElseThrow().nickname))
        }.andReturn().response
        fun grant(actor: HrTestAccount? = null) = mvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { actor?.let { header("Authorization", "Bearer ${it.token}") }; header("X-Room-Event-Token", guestToken) }.andReturn().response
        val accountToken = streamPayload(host).path("eventToken").asText()
        assertEquals(403, mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            header("X-Room-Event-Token", accountToken); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to users.findById(hiring.id).orElseThrow().nickname))
        }.andReturn().response.status, "anonymous request never borrows an account proof")
        assertEquals(403, mvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { header("X-Room-Event-Token", accountToken) }.andReturn().response.status)
        assertEquals(403, preview().status); assertEquals(204, event("grant_interviewer_access").status)
        assertEquals(200, preview().status); assertEquals(200, grant().status)
        assertEquals(403, preview(outsider).status, "account never borrows anonymous proof")
        assertEquals(403, grant(outsider).status)
        assertEquals(403, mvc.get("/api/rooms/${room.inviteCode}/hr-managers") { header("Authorization", "Bearer ${outsider.token}"); header("X-Room-Event-Token", guestToken) }.andReturn().response.status)
        assertEquals(204, event("revoke_interviewer_access").status); assertEquals(403, preview().status); assertEquals(403, grant().status)
        assertEquals(204, event("grant_interviewer_access").status)
        val team = team(owner); val moved = rooms.findById(room.id!!).orElseThrow(); moved.teamId = team.id; moved.originTeamId = team.id; rooms.saveAndFlush(moved)
        assertEquals(403, preview().status); assertEquals(403, grant().status)
    }

    @Test fun `personal invitation rechecks revoked manager authority after room lock wait`() {
        val owner = account(); val manager = account(true); val target = account(true); val room = room(owner)
        assertEquals(200, invite(room, manager, owner).status)
        val response = blockedMutation("rooms", { rooms.lockById(room.id!!) }, { invite(room, target, manager) }) {
            jdbc.update("UPDATE room_participants SET role='candidate' WHERE room_id=? AND user_id=?", room.id, manager.id)
        }
        assertEquals(403, response.status)
        assertFalse(assignments.existsByRoomIdAndUserId(room.id!!, target.id))
        assertNull(participants.findByRoomIdAndUserId(room.id!!, target.id))
    }

    @Test fun `personal invitation cannot carry old authority through conversion during room lock wait`() {
        val owner = account(); val target = account(true); val room = room(owner); val team = team(owner)
        val response = blockedMutation("rooms", { rooms.lockById(room.id!!) }, { invite(room, target, owner) }) {
            jdbc.update("UPDATE rooms SET team_id=?,origin_team_id=?,team_interview_created=true WHERE id=?", team.id, team.id, room.id)
        }
        assertEquals(404, response.status)
        assertFalse(assignments.existsByRoomIdAndUserId(room.id!!, target.id))
        assertNull(participants.findByRoomIdAndUserId(room.id!!, target.id))
    }

    @Test fun `personal creation rereads hiring eligibility after target user lock wait without partial writes`() {
        val owner = account(); val target = account(true); val before = listOf(rooms.count(), participants.count(), assignments.count())
        val response = blockedMutation("users", { users.lockById(target.id) }, { create(owner, listOf(target.id)) }) {
            jdbc.update("UPDATE users SET is_hr=false WHERE id=?", target.id)
        }
        assertEquals(404, response.status)
        assertEquals(before, listOf(rooms.count(), participants.count(), assignments.count()))
    }

    @Test fun `personal tracking rereads hiring profile after room lock wait and cannot record opted out owner`() {
        val owner = account(true); val room = room(owner)
        val response = blockedMutation("rooms", { rooms.lockById(room.id!!) }, {
            mvc.post("/api/rooms/${room.inviteCode}/hr-tracking") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response
        }) { jdbc.update("UPDATE users SET is_hr=false WHERE id=?", owner.id) }
        assertEquals(403, response.status)
        assertFalse(assignments.existsByRoomIdAndUserId(room.id!!, owner.id))
    }

    @Test fun `team hiring lookup assignment and removal retain real team authority and eligibility`() {
        val owner = account(); val hiring = account(true); val outsider = account()
        val team = team(owner); val room = room(owner, team)
        val request = mapOf("nickname" to users.findById(hiring.id).orElseThrow().nickname, "teamId" to team.id)
        fun preview(actor: HrTestAccount) = mvc.post("/api/me/hiring-manager-preview") {
            header("Authorization", "Bearer ${actor.token}"); contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(request)
        }.andReturn().response
        assertEquals(200, preview(owner).status); assertEquals(404, preview(outsider).status)
        val roomPreview = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            header("Authorization", "Bearer ${owner.token}"); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(request - "teamId")
        }.andReturn().response
        assertEquals(200, roomPreview.status)
        assertEquals(200, mvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response.status)
        assertEquals("interviewer", participants.findByRoomIdAndUserId(room.id!!, hiring.id)!!.role)
        assertTrue(assignments.existsByRoomIdAndUserId(room.id!!, hiring.id))
        assertEquals(200, mvc.get("/api/rooms/${room.inviteCode}/interview-metadata") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
        assertEquals(204, mvc.delete("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { header("Authorization", "Bearer ${owner.token}") }.andReturn().response.status)
        assertEquals("candidate", participants.findByRoomIdAndUserId(room.id!!, hiring.id)!!.role)
        assertEquals(403, mvc.get("/api/rooms/${room.inviteCode}/interview-metadata") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
    }

    @Test fun `legacy personal hiring history preserves current participant rights without exposing unrelated or revoked rooms`() {
        val owner = account(); val hiring = account(true); val outsider = account(true)
        val permitted = room(owner); val revoked = room(owner); val unrelated = room(owner)
        for ((room, role) in listOf(permitted to "interviewer", revoked to "candidate")) {
            assignments.saveAndFlush(RoomHrAssignment(room = room, user = users.findById(hiring.id).orElseThrow()))
            participants.saveAndFlush(RoomParticipant(room = room, user = users.findById(hiring.id).orElseThrow(), role = role))
        }
        fun list(actor: HrTestAccount) = mapper.readTree(mvc.get("/api/me/hr/rooms") { header("Authorization", "Bearer ${actor.token}") }.andReturn().response.contentAsString).path("items").map { it.path("roomId").asText() }
        assertTrue(permitted.id in list(hiring)); assertFalse(revoked.id in list(hiring)); assertFalse(unrelated.id in list(hiring)); assertFalse(permitted.id in list(outsider))
        assertEquals(200, mvc.get("/api/me/hr/rooms/${permitted.id}") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
        assertEquals(404, mvc.get("/api/me/hr/rooms/${revoked.id}") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
        assertEquals(200, mvc.get("/api/me/rooms/${permitted.id}/details") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
        assertEquals(403, mvc.get("/api/me/rooms/${revoked.id}/details") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.status)
        assertEquals(2, listOf(permitted, revoked).sumOf { assignments.findAllByRoomIdOrderByCreatedAtAscIdAsc(it.id!!).size })
    }

    private fun blockedMutation(table: String, lock: () -> Any?, request: () -> MockHttpServletResponse, committedChange: () -> Unit): MockHttpServletResponse {
        val executor = Executors.newSingleThreadExecutor()
        lateinit var result: Future<MockHttpServletResponse>
        try {
            TransactionTemplate(transactionManager).executeWithoutResult {
                lock()
                result = executor.submit<MockHttpServletResponse> { request() }
                val deadline = System.nanoTime() + 5_000_000_000L
                var blocked = false
                while (System.nanoTime() < deadline && !result.isDone) {
                    blocked = (jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid IN (SELECT pid FROM pg_locks WHERE relation='$table'::regclass)", Long::class.java) ?: 0) > 0
                    if (blocked) break
                    Thread.sleep(20)
                }
                assertTrue(blocked, "request must reach current $table row lock")
                committedChange()
            }
            return result.get(10, TimeUnit.SECONDS)
        } finally { executor.shutdownNow() }
    }

    private fun create(owner: HrTestAccount, targets: Any?) = mvc.post("/api/rooms") {
        header("Authorization", "Bearer ${owner.token}"); contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("title" to "Personal hiring", "taskIds" to emptyList<String>(), "hiringManagerIds" to targets))
    }.andReturn().response
    private fun accountPreview(actor: HrTestAccount, request: Map<String, String>) = mvc.post("/api/me/hiring-manager-preview") {
        header("Authorization", "Bearer ${actor.token}"); contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(request)
    }.andReturn().response
    private fun roomPreview(room: Room, target: HrTestAccount, actor: HrTestAccount) = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
        header("Authorization", "Bearer ${actor.token}"); contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("nickname" to users.findById(target.id).orElseThrow().nickname))
    }.andReturn().response
    private fun invite(room: Room, target: HrTestAccount, actor: HrTestAccount) = mvc.put("/api/rooms/${room.inviteCode}/hr-managers/${target.id}") { header("Authorization", "Bearer ${actor.token}") }.andReturn().response
    private fun cabinet(actor: HrTestAccount) = mapper.readTree(mvc.get("/api/me/hr/rooms") { header("Authorization", "Bearer ${actor.token}") }.andReturn().response.contentAsString).path("items").map { it.path("roomId").asText() }
    private fun streamPayload(result: org.springframework.test.web.servlet.MvcResult) = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")

    private fun account(isHr: Boolean = false) = HrHttpFixtures.register(mvc, mapper, isHr, "personal-scope").first
    private fun team(owner: HrTestAccount): Team {
        val id = UUID.randomUUID().toString()
        return teams.saveAndFlush(Team(id = id, name = "Scope team $id", normalizedName = "scope-$id", ownerUserId = owner.id)).also {
            memberships.saveAndFlush(TeamMembership(id = UUID.randomUUID().toString(), teamId = id, userId = owner.id, role = "ADMIN"))
        }
    }
    private fun room(owner: HrTestAccount, team: Team? = null) = rooms.saveAndFlush(Room(
        title = "Personal scope", inviteCode = "scope-${UUID.randomUUID()}", ownerSessionToken = "owner_${UUID.randomUUID()}", interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
        ownerUser = users.findById(owner.id).orElseThrow(), createdByUserId = owner.id, teamId = team?.id, originTeamId = team?.id, teamInterviewCreated = team != null,
    ))
}
