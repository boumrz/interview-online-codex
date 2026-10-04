package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
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
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.net.URI
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

/**
 * D6 contract. This file validates the participant directory only through its
 * public endpoint; it does not reach into the directory service internals.
 */
@SpringBootTest(
    properties = [
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamMemberDirectoryIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("member_directory")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `D6 roster defaults orders active effective roles and exposes only exact safe fields`() {
        postgres.verifyPostgres16()
        val owner = account("directory-owner")
        val admin = account("directory-admin")
        val member = account("directory-member")
        val inactive = account("directory-inactive")
        val team = team(owner, "Directory contract")
        rename(owner, "Zed Owner")
        rename(admin, "Beta Admin")
        rename(member, "Ａlpha Member")
        rename(inactive, "Invisible Former Member")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE", revision = 3)
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 5)
        seedMembership(team.id, inactive.id, role = "MEMBER", state = "LEFT", revision = 7)

        val result = roster(owner, team.id)
        assertStatus(result, 200, "ACTIVE owner must read participant roster")
        assertProtectedNoStore(result)
        val payload = body(result)
        assertEquals(setOf("items", "page", "size", "totalElements", "totalPages"), payload.fieldNames().asSequence().toSet())
        assertEquals(0, payload.path("page").asInt())
        assertEquals(25, payload.path("size").asInt())
        assertEquals(3, payload.path("totalElements").asInt(), "inactive memberships must not contribute totals")
        assertEquals(1, payload.path("totalPages").asInt())
        val items = payload.path("items")
        assertEquals(3, items.size())
        assertEquals(listOf(owner.id, admin.id, member.id), items.map { it.path("userId").asText() })
        assertEquals(listOf("OWNER", "ADMIN", "MEMBER"), items.map { it.path("role").asText() })
        assertEquals(listOf("ACTIVE", "ACTIVE", "ACTIVE"), items.map { it.path("state").asText() })
        assertEquals(listOf("Zed Owner", "Beta Admin", "Ａlpha Member"), items.map { it.path("displayName").asText() })
        assertEquals(5, items[2].path("revision").asInt())
        items.forEach(::assertExactRosterItem)
        assertFalse(payload.toString().contains(inactive.id), "inactive participant must not leak through the directory")
        listOf("nickname", "email", "login", "token", "room", "candidate", "interview", "audit", owner.token, admin.token, member.token).forEach { protected ->
            assertFalse(payload.toString().contains(protected), "roster must not expose private value")
        }

        val asAdmin = roster(admin, team.id)
        val asMember = roster(member, team.id)
        listOf(asAdmin, asMember).forEach {
            assertStatus(it, 200, "every ACTIVE role reads the same safe roster")
            assertProtectedNoStore(it)
            assertEquals(3, body(it).path("totalElements").asInt())
        }
    }

    @Test
    fun `D6 search normalizes safe display names only and pagination totals are filtered`() {
        val owner = account("query-owner")
        val visible = account("query-visible")
        val team = team(owner, "Directory query")
        rename(visible, "Ａlpha Search")
        val privateLogin = "login-${UUID.randomUUID()}"
        renameNickname(visible, privateLogin)
        seedMembership(team.id, visible.id, role = "MEMBER", state = "ACTIVE", revision = 0)

        val normalized = roster(owner, team.id, q = "  Alpha Search  ")
        assertStatus(normalized, 200, "trimmed NFKC display-name query must be accepted")
        assertEquals(1, body(normalized).path("totalElements").asInt())
        assertEquals(visible.id, body(normalized).path("items")[0].path("userId").asText())

        listOf(visible.id, "MEMBER", nicknameFor(visible.id), "visible@example.test").forEach { privateOrNonNameQuery ->
            val noSideChannel = roster(owner, team.id, q = privateOrNonNameQuery)
            assertStatus(noSideChannel, 200, "only safe display names are searchable")
            assertEquals(0, body(noSideChannel).path("totalElements").asInt())
        }

        val paged = roster(owner, team.id, page = 0, size = 1)
        assertStatus(paged, 200, "common pagination accepts its lower size boundary")
        assertEquals(1, body(paged).path("size").asInt())
        assertEquals(2, body(paged).path("totalElements").asInt())
        assertEquals(2, body(paged).path("totalPages").asInt())
        assertEquals(1, body(paged).path("items").size())

        val secondPage = roster(owner, team.id, page = 1, size = 1)
        assertStatus(secondPage, 200, "common pagination accepts page one")
        assertEquals(1, body(secondPage).path("page").asInt())
        assertEquals(1, body(secondPage).path("items").size())

        val maximumSize = roster(owner, team.id, page = 0, size = 100)
        assertStatus(maximumSize, 200, "common pagination accepts size 100")
        assertEquals(100, body(maximumSize).path("size").asInt())
        assertEquals(2, body(maximumSize).path("items").size())

        val exactBoundary = roster(owner, team.id, q = "Я".repeat(200))
        assertStatus(exactBoundary, 200, "a 200-code-point query is valid")
    }

    @Test
    fun `D6 invalid page size and query return private invalid-list errors without a partial roster`() {
        val owner = account("invalid-query-owner")
        val team = team(owner, "Invalid directory query")
        val invalidRequests = listOf(
            roster(owner, team.id, page = -1),
            rosterRaw(owner, team.id, "page", "zero"),
            rosterRaw(owner, team.id, "size", "many"),
            roster(owner, team.id, state = "LEFT"),
            roster(owner, team.id, size = 0),
            roster(owner, team.id, size = 101),
            roster(owner, team.id, q = "😀".repeat(201)),
        )
        invalidRequests.forEach { result ->
            assertStatusAndCode(result, 400, "INVALID_LIST_QUERY")
            assertProtectedNoStore(result)
            assertFalse(body(result).has("items"), "invalid query must not include a partial participant list")
        }
    }

    @Test
    fun `D6 roster distinguishes unauthenticated but normalizes foreign inactive and unknown teams`() {
        val owner = account("visibility-owner")
        val foreign = account("visibility-foreign")
        val formerlyActive = account("visibility-former")
        val team = team(owner, "Visibility directory")
        seedMembership(team.id, formerlyActive.id, role = "MEMBER", state = "REMOVED", revision = 1)

        val unauthenticated = mockMvc.get("/api/teams/${team.id}/members").andReturn()
        assertStatusAndCode(unauthenticated, 401, "UNAUTHORIZED")
        assertProtectedNoStore(unauthenticated)

        val foreignDenied = roster(foreign, team.id)
        val inactiveDenied = roster(formerlyActive, team.id)
        val unknownDenied = roster(owner, UUID.randomUUID().toString())
        listOf(foreignDenied, inactiveDenied, unknownDenied).forEach {
            assertStatusAndCode(it, 404, "TEAM_NOT_FOUND")
            assertProtectedNoStore(it)
            assertFalse(body(it).has("items"), "unavailable team outcome must not leak the roster")
        }
        assertEquals(
            foreignDenied.response.contentAsString,
            unknownDenied.response.contentAsString,
            "foreign and unknown outcomes must be non-disclosing equals",
        )
    }

    @Test
    fun `D6 uses normalized display name then opaque id within the same role`() {
        val owner = account("ordering-owner")
        val alphaFullWidth = account("ordering-fullwidth")
        val alphaAscii = account("ordering-ascii")
        val zeta = account("ordering-zeta")
        val team = team(owner, "Same role ordering")
        rename(alphaFullWidth, "Ａlpha")
        rename(alphaAscii, "Alpha")
        rename(zeta, "Zeta")
        listOf(alphaFullWidth, alphaAscii, zeta).forEach { participant ->
            seedMembership(team.id, participant.id, role = "MEMBER", state = "ACTIVE", revision = 0)
        }

        val result = roster(owner, team.id, size = 100)
        assertStatus(result, 200, "roster endpoint must exist for same-role ordering")
        val memberIds = body(result).path("items")
            .filter { it.path("role").asText() == "MEMBER" }
            .map { it.path("userId").asText() }
        val expected = listOf(
            alphaFullWidth to "Ａlpha",
            alphaAscii to "Alpha",
            zeta to "Zeta",
        ).sortedWith(
            compareBy<Pair<HrTestAccount, String>> { normalizedDisplayName(it.second) }
                .thenBy { it.first.id },
        ).map { it.first.id }
        assertEquals(expected, memberIds, "same-role rows sort by normalized safe name then opaque user id")
    }

    @Test
    fun `P32 managers can list suspended members without polluting active roster`() {
        val owner = account("slist-owner")
        val admin = account("slist-admin")
        val member = account("slist-member")
        val suspended = account("slist-target")
        val team = team(owner, "Suspended member directory")
        rename(suspended, "Suspended Safe Name")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE", revision = 2)
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 3)
        seedMembership(team.id, suspended.id, role = "MEMBER", state = "SUSPENDED", revision = 4)

        val activeRoster = roster(owner, team.id)
        assertStatus(activeRoster, 200, "active roster remains available to the owner")
        assertFalse(
            body(activeRoster).path("items").any { it.path("userId").asText() == suspended.id },
            "suspended member must not pollute the active roster",
        )

        val ownerSuspended = roster(owner, team.id, state = "SUSPENDED")
        assertStatus(ownerSuspended, 200, "owner must read the suspended roster for recovery actions")
        assertProtectedNoStore(ownerSuspended)
        val suspendedItems = body(ownerSuspended).path("items")
        assertEquals(1, suspendedItems.size())
        assertEquals(suspended.id, suspendedItems[0].path("userId").asText())
        assertEquals("Suspended Safe Name", suspendedItems[0].path("displayName").asText())
        assertEquals("MEMBER", suspendedItems[0].path("role").asText())
        assertEquals("SUSPENDED", suspendedItems[0].path("state").asText())
        assertEquals(4, suspendedItems[0].path("revision").asInt())
        assertExactRosterItem(suspendedItems[0], expectedState = "SUSPENDED")

        val adminSuspended = roster(admin, team.id, state = "SUSPENDED")
        assertStatus(adminSuspended, 200, "admin must also read the suspended roster")
        assertEquals(suspended.id, body(adminSuspended).path("items")[0].path("userId").asText())

        val memberDenied = roster(member, team.id, state = "SUSPENDED")
        assertStatusAndCode(memberDenied, 403, "TEAM_MEMBER_LIST_FORBIDDEN")
        assertFalse(body(memberDenied).has("items"), "non-manager denial must not leak suspended members")

        val suspendedDenied = roster(suspended, team.id, state = "SUSPENDED")
        assertStatusAndCode(suspendedDenied, 404, "TEAM_NOT_FOUND")
    }

    @Test
    fun `D6 directory uses neutral name fallback and accepted second account appears on both allowed reads`() {
        val owner = account("accept-owner")
        val secondAccount = account("accept-second")
        val anonymousMember = account("accept-anonymous")
        val team = team(owner, "Accept directory")
        rename(anonymousMember, null)
        seedMembership(team.id, anonymousMember.id, role = "MEMBER", state = "ACTIVE", revision = 9)

        val invitation = createAndReveal(owner, team.id)
        val accepted = accept(secondAccount, invitation.token)
        assertStatus(accepted, 200, "second account accepts the invitation")

        val ownerRoster = roster(owner, team.id)
        assertStatus(ownerRoster, 200, "owner reads accepted account after refresh")
        val ownerItems = body(ownerRoster).path("items")
        assertTrue(ownerItems.any { it.path("userId").asText() == secondAccount.id && it.path("role").asText() == "MEMBER" })
        assertTrue(ownerItems.any { it.path("userId").asText() == anonymousMember.id && it.path("displayName").asText() == "Участник" })

        val memberRoster = roster(secondAccount, team.id)
        assertStatus(memberRoster, 200, "accepted MEMBER receives a roster instead of a placeholder")
        assertTrue(body(memberRoster).path("items").any { it.path("userId").asText() == secondAccount.id })
    }

    @Test
    fun `P31 leave and remove make memberships inactive idempotently and keep the last owner guarded`() {
        val owner = account("lifecycle-owner")
        val admin = account("lifecycle-admin")
        val removed = account("lifecycle-removed")
        val leaver = account("lifecycle-leaver")
        val team = team(owner, "Lifecycle directory")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE", revision = 0)
        seedMembership(team.id, removed.id, role = "MEMBER", state = "ACTIVE", revision = 0)
        seedMembership(team.id, leaver.id, role = "MEMBER", state = "ACTIVE", revision = 0)

        val removeKey = UUID.randomUUID().toString()
        val removedResult = removeMember(admin, team.id, removed.id, removeKey)
        assertStatus(removedResult, 200, "ADMIN must remove a non-owner member")
        assertEquals("MEMBER_REMOVED", body(removedResult).path("outcome").asText())
        assertEquals("REMOVED", body(removedResult).path("member").path("state").asText())
        assertEquals("REMOVED", membershipState(team.id, removed.id))
        assertEquals(1L, membershipEpoch(team.id, removed.id))
        assertEquals(1L, membershipRevision(team.id, removed.id))

        val replayedRemove = removeMember(admin, team.id, removed.id, removeKey)
        assertStatus(replayedRemove, 200, "same remove key must replay the terminal outcome")
        assertEquals(true, body(replayedRemove).path("recovered").asBoolean())
        assertEquals(1L, membershipEpoch(team.id, removed.id), "remove replay must not advance epoch")

        val leaveKey = UUID.randomUUID().toString()
        val leaveResult = leaveTeam(leaver, team.id, leaveKey)
        assertStatus(leaveResult, 200, "non-owner active member must leave the team")
        assertEquals("MEMBER_LEFT", body(leaveResult).path("outcome").asText())
        assertEquals("LEFT", body(leaveResult).path("member").path("state").asText())
        assertEquals("LEFT", membershipState(team.id, leaver.id))
        assertEquals(1L, membershipEpoch(team.id, leaver.id))

        val roster = body(roster(owner, team.id)).path("items")
        assertFalse(roster.any { it.path("userId").asText() == removed.id }, "removed member leaves the active roster")
        assertFalse(roster.any { it.path("userId").asText() == leaver.id }, "left member leaves the active roster")
        assertStatusAndCode(roster(removed, team.id), 404, "TEAM_NOT_FOUND")
        assertStatusAndCode(roster(leaver, team.id), 404, "TEAM_NOT_FOUND")
        assertFalse(workspaceIds(removed).contains(team.id), "removed member loses the team workspace")
        assertFalse(workspaceIds(leaver).contains(team.id), "left member loses the team workspace")

        val ownerLeave = leaveTeam(owner, team.id, UUID.randomUUID().toString())
        assertStatusAndCode(ownerLeave, 409, "LAST_OWNER_TRANSFER_REQUIRED")
        assertEquals("ACTIVE", membershipState(team.id, owner.id), "owner leave denial must not alter owner membership")

        val removeOwner = removeMember(admin, team.id, owner.id, UUID.randomUUID().toString())
        assertStatusAndCode(removeOwner, 409, "LAST_OWNER_TRANSFER_REQUIRED")
        assertEquals("ACTIVE", membershipState(team.id, owner.id), "owner remove denial must not alter owner membership")
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorizeDirectory(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "team fixture must exist")
        return TeamFixture(body(result).path("team").path("id").asText())
    }

    private fun rename(account: HrTestAccount, displayName: String?) {
        jdbcTemplate.update("UPDATE users SET display_name=? WHERE id=?", displayName, account.id)
    }

    private fun renameNickname(account: HrTestAccount, nickname: String) {
        jdbcTemplate.update("UPDATE users SET nickname=? WHERE id=?", nickname, account.id)
    }

    private fun nicknameFor(userId: String): String = jdbcTemplate.queryForObject(
        "SELECT nickname FROM users WHERE id=?",
        String::class.java,
        userId,
    ).orEmpty()

    private fun seedMembership(teamId: String, userId: String, role: String, state: String, revision: Long) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role, state, revision,
        )
    }

    private fun roster(
        actor: HrTestAccount,
        teamId: String,
        page: Int? = null,
        size: Int? = null,
        q: String? = null,
        state: String? = null,
    ): MvcResult = mockMvc.get("/api/teams/$teamId/members") {
        authorizeDirectory(actor)
        page?.let { param("page", it.toString()) }
        size?.let { param("size", it.toString()) }
        q?.let { param("q", it) }
        state?.let { param("state", it) }
    }.andReturn()

    private fun rosterRaw(actor: HrTestAccount, teamId: String, name: String, value: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/members") {
            authorizeDirectory(actor)
            param(name, value)
        }.andReturn()

    private fun createAndReveal(actor: HrTestAccount, teamId: String): InvitationRef {
        val created = mockMvc.post("/api/teams/$teamId/invitations") {
            authorizeDirectory(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andReturn()
        assertStatus(created, 201, "invitation fixture must be created")
        val invitationId = body(created).path("invitation").path("id").asText()
        val revealed = mockMvc.get("/api/teams/$teamId/invitations/$invitationId/link") {
            authorizeDirectory(actor)
        }.andReturn()
        assertStatus(revealed, 200, "fixture requires issuer-only explicit reveal")
        val url = body(revealed).path("url").asText()
        return InvitationRef(invitationId, URI("https://local.test$url").fragment.removePrefix("token="))
    }

    private fun accept(actor: HrTestAccount, token: String): MvcResult = mockMvc.post("/api/team-invitations/accept") {
        authorizeDirectory(actor)
        header("Idempotency-Key", UUID.randomUUID().toString())
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("token" to token))
    }.andReturn()

    private fun leaveTeam(actor: HrTestAccount, teamId: String, key: String): MvcResult = mockMvc.post("/api/teams/$teamId/leave") {
        authorizeDirectory(actor)
        header("Idempotency-Key", key)
    }.andReturn()

    private fun removeMember(actor: HrTestAccount, teamId: String, userId: String, key: String): MvcResult =
        mockMvc.delete("/api/teams/$teamId/members/$userId") {
            authorizeDirectory(actor)
            header("Idempotency-Key", key)
        }.andReturn()

    private fun workspaceIds(actor: HrTestAccount): Set<String> =
        body(mockMvc.get("/api/me/workspaces") { authorizeDirectory(actor) }.andReturn())
            .path("workspaces")
            .map { it.path("id").asText() }
            .toSet()

    private fun membershipState(teamId: String, userId: String): String = jdbcTemplate.queryForObject(
        "SELECT state FROM team_memberships WHERE team_id=? AND user_id=?",
        String::class.java,
        teamId,
        userId,
    ).orEmpty()

    private fun membershipEpoch(teamId: String, userId: String): Long = jdbcTemplate.queryForObject(
        "SELECT epoch FROM team_memberships WHERE team_id=? AND user_id=?",
        Long::class.java,
        teamId,
        userId,
    ) ?: error("membership epoch fixture missing")

    private fun membershipRevision(teamId: String, userId: String): Long = jdbcTemplate.queryForObject(
        "SELECT revision FROM team_memberships WHERE team_id=? AND user_id=?",
        Long::class.java,
        teamId,
        userId,
    ) ?: error("membership revision fixture missing")

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun normalizedDisplayName(value: String): String =
        Normalizer.normalize(value, Normalizer.Form.NFKC).trim().lowercase(Locale.ROOT)

    private fun assertExactRosterItem(item: JsonNode, expectedState: String = "ACTIVE") {
        assertEquals(rosterItemFields, item.fieldNames().asSequence().toSet(), "roster item must use the D6 allowlist")
        assertTrue(item.path("userId").asText().isNotBlank())
        assertTrue(item.path("displayName").asText().isNotBlank())
        assertTrue(item.path("role").asText() in setOf("OWNER", "ADMIN", "MEMBER"))
        assertEquals(expectedState, item.path("state").asText())
        assertTrue(item.path("revision").isIntegralNumber)
        assertTrue(item.path("processes").isArray)
    }

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertStatus(result, expected, "unexpected member-directory status")
        assertEquals(code, body(result).path("code").asText(), "unexpected member-directory error code")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "directory response must be private and non-cacheable")
    }

    private data class TeamFixture(val id: String)
    private data class InvitationRef(val id: String, val token: String)

    private val rosterItemFields = setOf("userId", "displayName", "role", "state", "revision", "processes")
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorizeDirectory(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
