package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
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
import java.util.UUID

@SpringBootTest(properties = [
    "app.features.team-workspaces-enabled=true",
    "app.team-invitation-link-encryption.active-key-id=integration-v1",
    "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class GuestRoomRoleIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val teams: TeamRepository,
    @Autowired private val memberships: TeamMembershipRepository,
    @Autowired private val users: UserRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("guest_room_roles")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `host can promote a newly joined team guest and preserve its role on reconnect`() {
        postgres.verifyPostgres16()
        val owner = account()
        val room = room(owner, team(owner))
        val host = join(room, owner)
        val guest = join(room)
        assertEquals("candidate", payload(guest.result).path("role").asText())
        assertEquals(403, event(room, guest, mapOf("type" to "grant_interviewer_access", "targetSessionId" to host.sessionId)).response.status)

        val grant = event(room, host, mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId))
        assertEquals(204, grant.response.status, grant.response.contentAsString)
        assertEquals("interviewer", payload(guest.result).path("role").asText())
        assertEquals(204, event(room, guest, mapOf("type" to "private_note_entry", "privateNoteText" to "Guest interviewer note")).response.status)
        assertEquals("Guest interviewer note", payload(guest.result).path("personalNotes").first().path("text").asText())
        assertEquals(200, chat(room, guest, "Guest interviewer chat").response.status)

        val cookie = requireNotNull(guest.cookie)
        val reconnect = join(room, cookie = cookie)
        assertEquals("interviewer", payload(reconnect.result).path("role").asText())
        assertEquals(200, chat(room, reconnect, "Guest after reconnect").response.status)
        assertFalse(reconnect.result.response.containsHeader(HttpHeaders.SET_COOKIE))
        assertFalse(guest.result.response.contentAsString.contains(cookie.substringAfter('=')))
        assertFalse(jdbc.queryForObject("SELECT interviewer_chat FROM rooms WHERE id=?", String::class.java, room.id)!!.contains(cookie.substringAfter('=')))

        assertEquals(204, event(room, host, mapOf("type" to "revoke_interviewer_access", "targetSessionId" to reconnect.sessionId)).response.status)
        assertEquals("candidate", payload(reconnect.result).path("role").asText())
        assertEquals(403, chat(room, reconnect, "Revoked chat must not be accepted").response.status)
        val revokedReconnect = join(room, cookie = cookie)
        assertEquals("candidate", payload(revokedReconnect.result).path("role").asText())
        assertEquals(0, payload(revokedReconnect.result).path("notesMessages").size())
        assertNotEquals(cookie, revokedReconnect.cookie)
    }

    @Test
    fun `host can explicitly promote a live guest again after demotion`() {
        val owner = account()
        val room = room(owner)
        val host = join(room, owner)
        val guest = join(room)
        assertEquals(204, event(room, host, mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId)).response.status)
        assertEquals(204, event(room, host, mapOf("type" to "revoke_interviewer_access", "targetSessionId" to guest.sessionId)).response.status)
        assertEquals(403, chat(room, guest, "Demoted chat must not be accepted").response.status)
        val regrant = event(room, host, mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId))
        assertEquals(204, regrant.response.status, regrant.response.contentAsString)
        assertEquals("interviewer", payload(guest.result).path("role").asText())
        assertEquals(200, chat(room, guest, "Explicitly reauthorized guest").response.status)
    }

    @Test
    fun `a personal guest grant cannot restore interviewer rights after a team scope transition`() {
        val owner = account()
        val team = team(owner)
        val room = room(owner)
        val host = join(room, owner)
        val guest = join(room)
        assertEquals(204, event(room, host, mapOf("type" to "grant_interviewer_access", "targetSessionId" to guest.sessionId)).response.status)
        assertEquals(200, chat(room, guest, "Private personal chat").response.status)
        val oldCookie = requireNotNull(guest.cookie)
        jdbc.update("UPDATE rooms SET team_id=?, origin_team_id=?, team_interview_created=true WHERE id=?", team.id, team.id, room.id)

        assertEquals(403, chat(room, guest, "Old scope chat must not be accepted").response.status)
        val reconnected = join(room, cookie = oldCookie)
        assertEquals("candidate", payload(reconnected.result).path("role").asText())
        assertEquals(0, payload(reconnected.result).path("notesMessages").size())
        assertNotEquals(oldCookie, reconnected.cookie)
        assertTrue(reconnected.cookie != null)
        assertEquals(403, chat(room, reconnected, "Candidate chat must not be accepted").response.status)
    }

    private fun account() = HrHttpFixtures.register(mvc, mapper, false, "guest-role-owner").first

    private fun team(owner: HrTestAccount): Team {
        val id = UUID.randomUUID().toString()
        return teams.saveAndFlush(Team(id = id, name = "Team $id", normalizedName = "team $id", ownerUserId = owner.id)).also {
            memberships.saveAndFlush(TeamMembership(id = UUID.randomUUID().toString(), teamId = id, userId = owner.id, role = "ADMIN"))
        }
    }

    private fun room(owner: HrTestAccount, team: Team? = null) = rooms.saveAndFlush(Room(
        title = "Guest room roles",
        inviteCode = "guest-roles-${UUID.randomUUID()}",
        ownerSessionToken = "owner_${UUID.randomUUID()}",
        interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
        ownerUser = users.findById(owner.id).orElseThrow(),
        createdByUserId = owner.id,
        teamId = team?.id,
        originTeamId = team?.id,
        teamInterviewCreated = team != null,
    ))

    private data class Stream(val sessionId: String, val result: MvcResult, val cookie: String?)

    private fun join(room: Room, account: HrTestAccount? = null, cookie: String? = null): Stream {
        val session = "guest-roles-${UUID.randomUUID()}"
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            account?.let { header("Authorization", "Bearer ${it.token}") }
            cookie?.let { header(HttpHeaders.COOKIE, it) }
            param("sessionId", session)
            param("participantId", "participant-${UUID.randomUUID()}")
            param("displayName", if (account == null) "Guest" else "Host")
        }.andReturn()
        assertEquals(200, result.response.status)
        return Stream(session, result, result.response.getHeaders(HttpHeaders.SET_COOKIE).firstOrNull { it.startsWith("io_guest_reconnect=") }?.substringBefore(';') ?: cookie)
    }

    private fun event(room: Room, stream: Stream, fields: Map<String, Any>) = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        stream.cookie?.let { header(HttpHeaders.COOKIE, it) }
        contentType = MediaType.APPLICATION_JSON
        content = mapper.writeValueAsString(mapOf("sessionId" to stream.sessionId, "eventToken" to payload(stream.result).path("eventToken").asText()) + fields)
    }.andReturn()

    private fun chat(room: Room, stream: Stream, text: String) = event(room, stream, mapOf("type" to "note_message", "clientMessageId" to UUID.randomUUID().toString(), "noteText" to text))

    private fun payload(result: MvcResult): JsonNode = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
        .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
}
