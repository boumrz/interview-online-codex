package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.get
import java.util.UUID

@SpringBootTest(properties = [
    "app.team-invitation-link-encryption.active-key-id=integration-v1",
    "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HiringManagerNicknameIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val teams: TeamRepository,
    @Autowired private val memberships: TeamMembershipRepository,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("hiring_nickname")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `exact nickname lookup preserves opaque eligibility minimal response and legacy ID compatibility`() {
        postgres.verifyPostgres16()
        val actor = account("nickname-actor")
        val team = team(actor)
        val target = account("nickname-target", true)
        val targetUser = users.findById(target.id).orElseThrow()
        val before = rooms.count()
        val result = preview(actor, mapOf("nickname" to "  ${targetUser.nickname}  "), team.id)
        assertEquals(200, result.status, result.contentAsString)
        assertEquals("no-store", result.getHeader("Cache-Control"))
        assertEquals("no-referrer", result.getHeader("Referrer-Policy"))
        val body = mapper.readTree(result.contentAsString)
        assertEquals(setOf("normalizedId", "displayName"), body.fieldNames().asSequence().toSet())
        assertEquals(target.id, body.path("normalizedId").asText())
        assertEquals(targetUser.displayName, body.path("displayName").asText())
        assertEquals(200, preview(actor, mapOf("invitationId" to target.id.uppercase()), team.id).status)
        targetUser.nickname = "старый-ник"
        users.saveAndFlush(targetUser)
        assertEquals(200, preview(actor, mapOf("nickname" to targetUser.nickname), team.id).status)
        assertEquals(before, rooms.count())
        assertEquals(404, preview(actor, mapOf("nickname" to targetUser.nickname.take(8)), team.id).status)
    }

    @Test
    fun `unknown ordinary and opted out nicknames give the same prompt opaque not found result`() {
        val actor = account("lookup-actor")
        val team = team(actor)
        val ordinary = account("lookup-ordinary")
        val disabled = account("lookup-disabled", true)
        val disabledUser = users.findById(disabled.id).orElseThrow()
        disabledUser.isHr = false
        users.saveAndFlush(disabledUser)
        val names = listOf("absent-${UUID.randomUUID().toString().take(8)}", users.findById(ordinary.id).orElseThrow().nickname, disabledUser.nickname)
        val responses = names.map { nickname ->
            val start = System.nanoTime()
            val result = preview(actor, mapOf("nickname" to nickname), team.id)
            assertTrue((System.nanoTime() - start) / 1_000_000 < 2000, "Unknown target must not block a request")
            assertEquals(404, result.status, result.contentAsString)
            assertEquals("Нанимающий не найден или недоступен", mapper.readTree(result.contentAsString).path("error").asText())
            result.contentAsString
        }
        assertEquals(1, responses.toSet().size)
    }

    @Test
    fun `nickname lookup rejects ambiguous duplicate non textual and invalid target fields`() {
        val actor = account("invalid-actor")
        val team = team(actor)
        val target = account("invalid-target", true)
        val nickname = users.findById(target.id).orElseThrow().nickname
        val invalid = listOf("{}", "{\"nickname\":7}", "{\"nickname\":\"\"}", "{\"nickname\":\"invalid nickname\"}",
            "{\"nickname\":\"$nickname\",\"invitationId\":\"${target.id}\"}",
            "{\"nickname\":\"$nickname\",\"nickname\":\"$nickname\"}",
            "{\"nickname\":\"$nickname\",\"displayName\":\"forged\"}")
        invalid.forEach { raw ->
            val response = mvc.post("/api/me/hiring-manager-preview") {
                header("Authorization", "Bearer ${actor.token}"); contentType = MediaType.APPLICATION_JSON
                content = raw.replaceFirst("{", "{\"teamId\":\"${team.id}\"," ).replace(",}", "}")
            }.andReturn().response
            assertEquals(400, response.status)
            assertEquals(setOf("error"), mapper.readTree(response.contentAsString).fieldNames().asSequence().toSet())
            assertEquals("no-store", response.getHeader("Cache-Control"))
        }
        assertEquals(401, preview(null, mapOf("nickname" to nickname)).status)
    }

    @Test
    fun `team nickname lookup checks creator membership and excludes active or suspended coworkers`() {
        val actor = account("team-nick-owner")
        val external = account("team-nick-external", true)
        val colleague = account("team-nick-colleague", true)
        val suspended = account("team-nick-suspended", true)
        val team = team(actor)
        join(team, colleague)
        join(team, suspended, "SUSPENDED")
        fun lookup(account: HrTestAccount, target: HrTestAccount) = preview(account, mapOf("nickname" to users.findById(target.id).orElseThrow().nickname, "teamId" to team.id))
        assertEquals(200, lookup(actor, external).status)
        assertEquals(404, lookup(actor, colleague).status)
        assertEquals(404, lookup(actor, suspended).status)
        assertEquals(404, lookup(external, external).status)
        join(team, colleague, "LEFT")
        assertEquals(200, lookup(actor, colleague).status)
    }

    @Test
    fun `personal room nickname lookup accepts current manager credentials and never trusts caller team scope`() {
        val actor = account("room-nick-owner")
        val target = account("room-nick-target", true)
        val nickname = users.findById(target.id).orElseThrow().nickname
        val room = room(actor)
        room.ownerUser = null; rooms.saveAndFlush(room)
        fun lookup(token: String?, extra: Map<String, String> = emptyMap()) = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            token?.let { header("X-Room-Interviewer-Token", it) }; contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname) + extra)
        }.andReturn().response
        assertEquals(200, lookup(room.interviewerSessionToken).status)
        assertEquals(403, lookup(null).status)
        assertEquals(403, lookup("forged").status)
        assertEquals(400, lookup(room.interviewerSessionToken, mapOf("teamId" to UUID.randomUUID().toString())).status)
        room.archivedAt = java.time.Instant.now(); rooms.saveAndFlush(room)
        assertEquals(410, lookup(room.interviewerSessionToken).status)
    }

    @Test
    fun `room scoped preview derives team eligibility from room and rejects personal credentials after conversion`() {
        val actor = account("room-team-owner")
        val external = account("room-team-external", true)
        val colleague = account("room-team-colleague", true)
        val team = team(actor); join(team, colleague)
        val room = room(actor)
        val oldInterviewerToken = room.interviewerSessionToken
        room.teamId = team.id; room.originTeamId = team.id; room.teamInterviewCreated = true; rooms.saveAndFlush(room)
        fun lookup(target: HrTestAccount, auth: Boolean) = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            if (auth) header("Authorization", "Bearer ${actor.token}") else header("X-Room-Interviewer-Token", oldInterviewerToken)
            contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("nickname" to users.findById(target.id).orElseThrow().nickname))
        }.andReturn().response
        assertEquals(403, lookup(external, false).status)
        assertEquals(200, lookup(external, true).status)
        assertEquals(404, lookup(colleague, true).status)
    }

    @Test
    fun `promoting a personal guest enables current hiring lookup until revoke or conversion`() {
        val owner = account("guest-nick-owner")
        val target = account("guest-nick-target", true)
        val nickname = users.findById(target.id).orElseThrow().nickname
        val room = room(owner)
        val hostSession = "nick-host-${UUID.randomUUID()}"
        val guestSession = "nick-guest-${UUID.randomUUID()}"
        fun join(session: String, actor: HrTestAccount? = null) = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            actor?.let { header("Authorization", "Bearer ${it.token}") }
            param("sessionId", session); param("participantId", "participant-${UUID.randomUUID()}"); param("displayName", "Guest")
        }.andReturn()
        fun payload(result: org.springframework.test.web.servlet.MvcResult) = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        val host = join(hostSession, owner); val guest = join(guestSession)
        fun event(type: String) = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to hostSession, "eventToken" to payload(host).path("eventToken").asText(), "type" to type, "targetSessionId" to guestSession))
        }.andReturn().response
        fun previewGuest(token: String) = mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            header("X-Room-Event-Token", token); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname))
        }.andReturn().response
        val guestToken = payload(guest).path("eventToken").asText()
        assertEquals(403, previewGuest(guestToken).status)
        assertEquals(204, event("grant_interviewer_access").status)
        assertEquals(200, previewGuest(guestToken).status)
        assertEquals(204, event("revoke_interviewer_access").status)
        assertEquals(403, previewGuest(guestToken).status)
        assertEquals(204, event("grant_interviewer_access").status)
        assertEquals(200, previewGuest(guestToken).status)
        val team = team(owner)
        val converted = rooms.findById(requireNotNull(room.id)).orElseThrow()
        converted.teamId = team.id; converted.originTeamId = team.id; rooms.saveAndFlush(converted)
        assertEquals(403, previewGuest(guestToken).status)
        assertEquals(403, mvc.post("/api/rooms/${room.inviteCode}/hiring-manager-preview") {
            header("Authorization", "Bearer ${owner.token}"); contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname))
        }.andReturn().response.status, "Converted noncanonical room cannot open TEAM management")
    }

    private fun preview(actor: HrTestAccount?, body: Map<String, String>, teamId: String? = null) = mvc.post("/api/me/hiring-manager-preview") {
        actor?.let { header("Authorization", "Bearer ${it.token}") }; contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(body + (teamId?.let { mapOf("teamId" to it) } ?: emptyMap()))
    }.andReturn().response
    private fun account(prefix: String, hr: Boolean = false) = HrHttpFixtures.register(mvc, mapper, hr, prefix).first
    private fun team(owner: HrTestAccount): Team {
        val id = UUID.randomUUID().toString()
        return teams.saveAndFlush(Team(id = id, name = "Team $id", normalizedName = "team $id", ownerUserId = owner.id)).also { join(it, owner) }
    }
    private fun join(team: Team, account: HrTestAccount, state: String = "ACTIVE") {
        val membership = memberships.findByTeamIdAndUserId(team.id, account.id) ?: TeamMembership(id = UUID.randomUUID().toString(), teamId = team.id, userId = account.id)
        membership.state = state; memberships.saveAndFlush(membership)
    }
    private fun room(owner: HrTestAccount) = rooms.saveAndFlush(Room(title = "Nickname lookup", inviteCode = "nick-${UUID.randomUUID()}", ownerSessionToken = "owner_${UUID.randomUUID()}", interviewerSessionToken = "interviewer_${UUID.randomUUID()}", ownerUser = users.findById(owner.id).orElseThrow(), createdByUserId = owner.id))
}
