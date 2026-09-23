package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
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
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * RED contract for TASK-5-02. These tests exercise only future public HTTP
 * commands. They deliberately do not call a future management service or use
 * a production-only test seam, so a controller stub cannot satisfy them.
 */
@SpringBootTest(
    properties = [
        "app.features.team-workspaces-enabled=true",
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamManagementCommandIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_management_commands")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `M5 rename enforces the full authority and idempotency header matrix with no-store`() {
        postgres.verifyPostgres16()
        val owner = account("rename-owner")
        val admin = account("rename-admin")
        val member = account("rename-member")
        val foreign = account("rename-foreign")
        val replacementOwner = account("rename-next-owner")
        val formerOwner = account("rename-former-owner")
        val team = team(owner, "Rename baseline")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE")
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE")
        val beforeOwnerRename = teamSnapshot(team.id)

        val expectedBody = mapOf("name" to "  Ｒenamed team  ", "revision" to team.revision)
        val ownerResult = rename(owner, team.id, expectedBody, UUID.randomUUID().toString())
        assertStatus(ownerResult, 200, "M5_RENAME_OWNER_ADMIN_COMMAND_MISSING")
        assertNoStore(ownerResult)
        assertExactRenameSuccess(body(ownerResult), "Renamed team", recovered = false)
        val afterOwnerRename = teamSnapshot(team.id)
        assertEquals(beforeOwnerRename.revision + 1, afterOwnerRename.revision)
        assertEquals(beforeOwnerRename.mergeRevision + 1, afterOwnerRename.mergeRevision)
        assertEquals(beforeOwnerRename.securityRevision, afterOwnerRename.securityRevision)
        assertEquals(1L, auditCount(team.id, "TEAM_RENAMED"))

        val adminResult = rename(admin, team.id, mapOf("name" to "Admin renamed", "revision" to afterOwnerRename.revision), UUID.randomUUID().toString())
        assertStatus(adminResult, 200, "M5_RENAME_ADMIN_COMMAND_MISSING")
        assertNoStore(adminResult)

        val unauthenticated = mockMvc.patch("/api/teams/${team.id}") {
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to "No auth", "revision" to team.revision))
        }.andReturn()
        assertError(unauthenticated, 401, "UNAUTHORIZED")

        val foreignDenied = rename(foreign, team.id, mapOf("name" to "Foreign", "revision" to currentTeamRevision(team.id)), UUID.randomUUID().toString())
        assertError(foreignDenied, 404, "TEAM_NOT_FOUND")

        val memberDenied = rename(member, team.id, mapOf("name" to "Member", "revision" to currentTeamRevision(team.id)), UUID.randomUUID().toString())
        assertError(memberDenied, 403, "TEAM_MANAGER_REQUIRED")

        seedMembership(team.id, replacementOwner.id, role = "ADMIN", state = "ACTIVE")
        seedMembership(team.id, formerOwner.id, role = "ADMIN", state = "ACTIVE")
        jdbcTemplate.update("UPDATE teams SET owner_user_id=? WHERE id=?", replacementOwner.id, team.id)
        val formerOwnerDenied = rename(formerOwner, team.id, mapOf("name" to "Former owner", "revision" to currentTeamRevision(team.id)), UUID.randomUUID().toString())
        assertStatus(formerOwnerDenied, 200, "M5_FORMER_OWNER_AS_ADMIN_MUST_RETAIN_MANAGER_RENAME")
        assertNoStore(formerOwnerDenied)

        val missingKey = rename(owner, team.id, mapOf("name" to "Missing key", "revision" to currentTeamRevision(team.id)), null)
        val invalidKey = rename(owner, team.id, mapOf("name" to "Bad key", "revision" to currentTeamRevision(team.id)), "not-a-uuid")
        assertError(missingKey, 400, "IDEMPOTENCY_KEY_REQUIRED")
        assertError(invalidKey, 400, "INVALID_IDEMPOTENCY_KEY")
    }

    @Test
    fun `M5 rename canonical CAS unchanged replay and no-expansion state are exact`() {
        val owner = account("rename-cas-owner")
        val admin = account("rename-cas-admin")
        val candidate = account("rename-candidate")
        val team = team(owner, "Canonical baseline")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE", revision = 4, epoch = 8)
        val room = teamRoom(owner, candidate, team.id)
        val before = commandBaseline(team.id, room.id)

        val key = UUID.randomUUID().toString()
        val first = rename(owner, team.id, mapOf("name" to "  Ａlpha  ", "revision" to before.team.revision), key)
        assertStatus(first, 200, "M5_RENAME_COMMAND_MISSING")
        assertExactRenameSuccess(body(first), "Alpha", recovered = false)
        val firstNode = body(first)
        val firstRevision = firstNode.path("team").path("revision").asLong()
        assertTrue(firstRevision > before.team.revision)
        assertNoExpansion(before, commandBaseline(team.id, room.id), expectedAuditDelta = 1, expectedReceiptDelta = 1, expectedName = "Alpha")

        val replay = rename(owner, team.id, mapOf("name" to "Ａlpha", "revision" to before.team.revision), key)
        assertStatus(replay, 200, "M5_RENAME_REPLAY_MISSING")
        assertExactRenameSuccess(body(replay), "Alpha", recovered = true)
        assertEquals(firstRevision, body(replay).path("team").path("revision").asLong(), "exact replay must not advance revision")
        assertNoExpansion(before, commandBaseline(team.id, room.id), expectedAuditDelta = 1, expectedReceiptDelta = 1, expectedName = "Alpha")

        val reused = rename(owner, team.id, mapOf("name" to "Different body", "revision" to before.team.revision), key)
        assertError(reused, 409, "IDEMPOTENCY_KEY_REUSED")
        assertNoExpansion(before, commandBaseline(team.id, room.id), expectedAuditDelta = 1, expectedReceiptDelta = 1, expectedName = "Alpha")

        val stale = rename(admin, team.id, mapOf("name" to "Stale", "revision" to before.team.revision), UUID.randomUUID().toString())
        assertRevisionConflict(stale, "TEAM_REVISION_CONFLICT", firstRevision)

        val unchangedKey = UUID.randomUUID().toString()
        val unchanged = rename(owner, team.id, mapOf("name" to "  Alpha  ", "revision" to firstRevision), unchangedKey)
        assertStatus(unchanged, 200, "M5_RENAME_UNCHANGED_MISSING")
        assertExactRenameSuccess(body(unchanged), "Alpha", recovered = false, outcome = "UNCHANGED")
        assertEquals(firstRevision, currentTeamRevision(team.id), "UNCHANGED must not advance team revision")
        assertEquals(1L, auditCount(team.id, "TEAM_RENAMED"), "UNCHANGED must not write audit")
        assertEquals(2L, receiptCount(team.id, "TEAM_RENAME"), "UNCHANGED has one terminal receipt but no extra domain mutation")

        val unchangedReplay = rename(owner, team.id, mapOf("name" to "Alpha", "revision" to firstRevision), unchangedKey)
        assertStatus(unchangedReplay, 200, "M5_RENAME_UNCHANGED_REPLAY_MISSING")
        assertExactRenameSuccess(body(unchangedReplay), "Alpha", recovered = true, outcome = "UNCHANGED")
        assertEquals(firstRevision, currentTeamRevision(team.id), "UNCHANGED replay must not advance team revision")
        assertEquals(1L, auditCount(team.id, "TEAM_RENAMED"), "UNCHANGED replay must not write audit")
        assertEquals(2L, receiptCount(team.id, "TEAM_RENAME"), "UNCHANGED replay must not add another receipt")

        val invalidNames = listOf("   ", "Я".repeat(101), "😀".repeat(101))
        invalidNames.forEach { invalidName ->
            val denied = rename(owner, team.id, mapOf("name" to invalidName, "revision" to firstRevision), UUID.randomUUID().toString())
            assertError(denied, 400, "INVALID_TEAM_NAME")
        }
    }

    @Test
    fun `M5 only owner changes stored ADMIN MEMBER role with target CAS exact DTO and no expansion`() {
        val owner = account("role-owner")
        val admin = account("role-admin")
        val member = account("role-member")
        val inactive = account("role-inactive")
        val foreign = account("role-foreign")
        val candidate = account("role-candidate")
        val team = team(owner, "Role baseline")
        seedMembership(team.id, admin.id, role = "ADMIN", state = "ACTIVE", revision = 3, epoch = 10)
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 7, epoch = 11)
        seedMembership(team.id, inactive.id, role = "MEMBER", state = "LEFT", revision = 9, epoch = 12)
        val room = teamRoom(owner, candidate, team.id)
        val before = commandBaseline(team.id, room.id)

        val activeMemberDenied = updateRole(member, team.id, admin.id, mapOf("role" to "MEMBER", "revision" to 3), UUID.randomUUID().toString())
        assertError(activeMemberDenied, 403, "TEAM_OWNER_REQUIRED")
        assertEquals(before, commandBaseline(team.id, room.id), "ACTIVE MEMBER denial must not mutate any protected management baseline row")

        val ownerDemotion = updateRole(owner, team.id, admin.id, mapOf("role" to "MEMBER", "revision" to 3), UUID.randomUUID().toString())
        assertStatus(ownerDemotion, 200, "M5_OWNER_ADMIN_TO_MEMBER_COMMAND_MISSING")
        assertNoStore(ownerDemotion)
        assertExactRoleSuccess(body(ownerDemotion), admin.id, "MEMBER", recovered = false)
        assertEquals("MEMBER", membershipSnapshot(team.id, admin.id).role)
        assertEquals(4L, membershipSnapshot(team.id, admin.id).revision)
        val afterOwnerDemotion = commandBaseline(team.id, room.id)
        assertNoExpansion(before, afterOwnerDemotion, expectedAuditDelta = 1, expectedReceiptDelta = 1)

        val ownerUpdate = updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to 7), UUID.randomUUID().toString())
        assertStatus(ownerUpdate, 200, "M5_OWNER_ROLE_COMMAND_MISSING")
        assertNoStore(ownerUpdate)
        assertExactRoleSuccess(body(ownerUpdate), member.id, "ADMIN", recovered = false)
        assertEquals("ADMIN", membershipSnapshot(team.id, member.id).role)
        assertEquals(8L, membershipSnapshot(team.id, member.id).revision)
        assertNoExpansion(afterOwnerDemotion, commandBaseline(team.id, room.id), expectedAuditDelta = 1, expectedReceiptDelta = 1)

        val adminDenied = updateRole(admin, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 8), UUID.randomUUID().toString())
        assertError(adminDenied, 403, "TEAM_OWNER_REQUIRED")
        val ownTargetDenied = updateRole(owner, team.id, owner.id, mapOf("role" to "MEMBER", "revision" to membershipSnapshot(team.id, owner.id).revision), UUID.randomUUID().toString())
        assertError(ownTargetDenied, 409, "OWNER_ROLE_IMMUTABLE")
        val inactiveDenied = updateRole(owner, team.id, inactive.id, mapOf("role" to "ADMIN", "revision" to 9), UUID.randomUUID().toString())
        assertError(inactiveDenied, 404, "MEMBER_NOT_FOUND")
        val unknownDenied = updateRole(owner, team.id, UUID.randomUUID().toString(), mapOf("role" to "ADMIN", "revision" to 0), UUID.randomUUID().toString())
        assertError(unknownDenied, 404, "MEMBER_NOT_FOUND")
        val foreignDenied = updateRole(foreign, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 8), UUID.randomUUID().toString())
        assertError(foreignDenied, 404, "TEAM_NOT_FOUND")

        val stale = updateRole(owner, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 7), UUID.randomUUID().toString())
        assertRevisionConflict(stale, "MEMBER_REVISION_CONFLICT", 8)
        val invalidRole = updateRole(owner, team.id, member.id, mapOf("role" to "OWNER", "revision" to 8), UUID.randomUUID().toString())
        assertError(invalidRole, 400, "INVALID_MEMBER_ROLE")
    }

    @Test
    fun `M5 role unchanged changed-key replay and current-resource replay are exact`() {
        val owner = account("role-replay-owner")
        val member = account("role-replay-member")
        val team = team(owner, "Role replay")
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 2)

        val unchangedKey = UUID.randomUUID().toString()
        val unchanged = updateRole(owner, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 2), unchangedKey)
        assertStatus(unchanged, 200, "M5_ROLE_UNCHANGED_MISSING")
        assertExactRoleSuccess(body(unchanged), member.id, "MEMBER", recovered = false, outcome = "UNCHANGED")
        assertEquals(2L, membershipSnapshot(team.id, member.id).revision)
        assertEquals(0L, auditCount(team.id, "MEMBER_ROLE_UPDATED"))
        assertEquals(1L, receiptCount(team.id, "TEAM_MEMBER_ROLE_UPDATE"), "UNCHANGED stores one terminal receipt")

        val unchangedReplay = updateRole(owner, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 2), unchangedKey)
        assertStatus(unchangedReplay, 200, "M5_ROLE_UNCHANGED_REPLAY_MISSING")
        assertExactRoleSuccess(body(unchangedReplay), member.id, "MEMBER", recovered = true, outcome = "UNCHANGED")
        assertEquals(2L, membershipSnapshot(team.id, member.id).revision, "UNCHANGED replay must not advance member revision")
        assertEquals(0L, auditCount(team.id, "MEMBER_ROLE_UPDATED"), "UNCHANGED replay must not write audit")
        assertEquals(1L, receiptCount(team.id, "TEAM_MEMBER_ROLE_UPDATE"), "UNCHANGED replay must not add another receipt")

        val key = UUID.randomUUID().toString()
        val first = updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to 2), key)
        assertStatus(first, 200, "M5_ROLE_UPDATE_COMMAND_MISSING")
        assertExactRoleSuccess(body(first), member.id, "ADMIN", recovered = false)
        val afterFirst = membershipSnapshot(team.id, member.id)

        val later = updateRole(owner, team.id, member.id, mapOf("role" to "MEMBER", "revision" to afterFirst.revision), UUID.randomUUID().toString())
        assertStatus(later, 200, "M5_LATER_PERMITTED_ROLE_UPDATE_MISSING")
        val afterLater = membershipSnapshot(team.id, member.id)
        assertNotEquals(afterFirst.revision, afterLater.revision)

        val replay = updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to 2), key)
        assertStatus(replay, 200, "M5_ROLE_CURRENT_RESOURCE_REPLAY_MISSING")
        assertExactRoleSuccess(body(replay), member.id, "MEMBER", recovered = true, outcome = "ROLE_UPDATED")
        assertEquals(afterLater.revision, body(replay).path("member").path("revision").asLong(), "replay returns current safe resource rather than historic JSON")
        assertEquals(2L, auditCount(team.id, "MEMBER_ROLE_UPDATED"), "replay must not create a third audit event")

        val changedBody = updateRole(owner, team.id, member.id, mapOf("role" to "MEMBER", "revision" to 2), key)
        assertError(changedBody, 409, "IDEMPOTENCY_KEY_REUSED")
    }

    @Test
    fun `M5 lock contender has no pending state and rolls back every protected baseline row`() {
        val owner = account("lock-owner")
        val member = account("lock-member")
        val candidate = account("lock-candidate")
        val team = team(owner, "Lock baseline")
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 4, epoch = 13)
        val room = teamRoom(owner, candidate, team.id)
        val baseline = commandBaseline(team.id, room.id)
        val key = UUID.randomUUID().toString()
        val executor = Executors.newSingleThreadExecutor()
        postgres.connection().use { heldConnection ->
            heldConnection.autoCommit = false
            lockTeam(heldConnection, team.id)
            val contender = executor.submit(Callable {
                rename(owner, team.id, mapOf("name" to "Blocked command", "revision" to baseline.team.revision), key)
            })
            val response = try {
                contender.get(15, TimeUnit.SECONDS)
            } finally {
                heldConnection.rollback()
            }
            assertError(response, 503, "TEAM_MANAGEMENT_BUSY")
            assertEquals("5", response.response.getHeader("Retry-After"))
            assertFalse(body(response).toString().contains("COMMAND_PENDING"), "no durable pending outcome is ever public")
        }
        executor.shutdownNow()
        assertEquals(baseline, commandBaseline(team.id, room.id), "busy/rollback leaves team, membership, room, grant, interview, candidate, audit and receipt rows unchanged")
        assertEquals(0L, receiptCount(team.id, "TEAM_RENAME"), "busy command must not leave a pending receipt")
    }

    @Test
    fun `M5 role lock contender has the same bounded busy rollback contract`() {
        val owner = account("role-lock-owner")
        val member = account("role-lock-member")
        val candidate = account("role-lock-candidate")
        val team = team(owner, "Role lock baseline")
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 4, epoch = 17)
        val room = teamRoom(owner, candidate, team.id)
        val baseline = commandBaseline(team.id, room.id)
        val executor = Executors.newSingleThreadExecutor()
        postgres.connection().use { heldConnection ->
            heldConnection.autoCommit = false
            lockTeam(heldConnection, team.id)
            val contender = executor.submit(Callable {
                updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to 4), UUID.randomUUID().toString())
            })
            val response = try {
                contender.get(15, TimeUnit.SECONDS)
            } finally {
                heldConnection.rollback()
            }
            assertError(response, 503, "TEAM_MANAGEMENT_BUSY")
            assertEquals("5", response.response.getHeader("Retry-After"), "bounded busy response must tell the client when retry is permitted")
            assertFalse(body(response).toString().contains("COMMAND_PENDING"), "role lock contention must never expose a pending command state")
        }
        executor.shutdownNow()
        assertEquals(baseline, commandBaseline(team.id, room.id), "role busy/rollback leaves all protected rows unchanged")
        assertEquals(0L, receiptCount(team.id, "TEAM_MEMBER_ROLE_UPDATE"), "busy role command must not leave a pending receipt")
    }

    @Test
    fun `M5 original owner remains public ADMIN manager but loses owner-only commands after transfer`() {
        val originalOwner = account("former-owner")
        val newOwner = account("new-owner")
        val member = account("former-member")
        val team = team(originalOwner, "Former owner commands")
        seedMembership(team.id, newOwner.id, role = "ADMIN", state = "ACTIVE", revision = 2)
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 3)

        val transferred = transfer(
            originalOwner,
            team.id,
            mapOf("targetUserId" to newOwner.id, "revision" to currentTeamRevision(team.id)),
            UUID.randomUUID().toString(),
        )
        assertStatus(transferred, 200, "M5_PUBLIC_TRANSFER_FIXTURE_MISSING")
        assertNoStore(transferred)
        assertEquals("OWNERSHIP_TRANSFERRED", body(transferred).path("outcome").asText())
        val revisionAfterTransfer = body(transferred).path("team").path("revision").asLong()

        val formerOwnerRename = rename(
            originalOwner,
            team.id,
            mapOf("name" to "Former owner may rename", "revision" to revisionAfterTransfer),
            UUID.randomUUID().toString(),
        )
        assertStatus(formerOwnerRename, 200, "M5_FORMER_OWNER_AS_ADMIN_RENAME_MISSING")
        assertNoStore(formerOwnerRename)
        assertExactRenameSuccess(body(formerOwnerRename), "Former owner may rename", recovered = false)

        val formerOwnerRoleDenied = updateRole(
            originalOwner,
            team.id,
            member.id,
            mapOf("role" to "ADMIN", "revision" to membershipSnapshot(team.id, member.id).revision),
            UUID.randomUUID().toString(),
        )
        assertError(formerOwnerRoleDenied, 403, "TEAM_OWNER_REQUIRED")
        val formerOwnerTransferDenied = transfer(
            originalOwner,
            team.id,
            mapOf("targetUserId" to member.id, "revision" to currentTeamRevision(team.id)),
            UUID.randomUUID().toString(),
        )
        assertError(formerOwnerTransferDenied, 403, "TEAM_OWNER_REQUIRED")
    }

    @Test
    fun `M5 invalid idempotency and authority errors never mutate protected role baseline`() {
        val owner = account("role-headers-owner")
        val member = account("role-headers-member")
        val team = team(owner, "Role header baseline")
        seedMembership(team.id, member.id, role = "MEMBER", state = "ACTIVE", revision = 6, epoch = 14)
        val before = membershipSnapshot(team.id, member.id)

        val unauthenticated = mockMvc.patch("/api/teams/${team.id}/members/${member.id}") {
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("role" to "ADMIN", "revision" to before.revision))
        }.andReturn()
        assertError(unauthenticated, 401, "UNAUTHORIZED")
        val missing = updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to before.revision), null)
        val invalid = updateRole(owner, team.id, member.id, mapOf("role" to "ADMIN", "revision" to before.revision), "not-a-uuid")
        assertError(missing, 400, "IDEMPOTENCY_KEY_REQUIRED")
        assertError(invalid, 400, "INVALID_IDEMPOTENCY_KEY")
        assertEquals(before, membershipSnapshot(team.id, member.id))
        assertEquals(0L, auditCount(team.id, "MEMBER_ROLE_UPDATED"))
        assertEquals(0L, receiptCount(team.id, "TEAM_MEMBER_ROLE_UPDATE"))
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorizeManagement(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "M5_TEAM_FIXTURE_MISSING")
        val team = body(result).path("team")
        val id = team.path("id").asText()
        return TeamFixture(id, currentTeamRevision(id), name)
    }

    private fun seedMembership(teamId: String, userId: String, role: String, state: String, revision: Long = 0, epoch: Long = 0) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id,team_id,user_id,role,state,epoch,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role, state, epoch, revision,
        )
    }

    private fun teamRoom(owner: HrTestAccount, candidate: HrTestAccount, teamId: String): HrTestRoom {
        val grantedHr = HrHttpFixtures.register(mockMvc, objectMapper, true, "m5-granted-hr").first
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Management no expansion")
        jdbcTemplate.update("UPDATE rooms SET team_id=?, origin_team_id=?, candidate_name=?, position=? WHERE id=?", teamId, teamId, "Candidate", "Engineer", room.id)
        jdbcTemplate.update(
            "INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'candidate',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            UUID.randomUUID().toString(), room.id, candidate.id,
        )
        jdbcTemplate.update(
            "INSERT INTO room_hr_assignments(id,room_id,user_id,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            UUID.randomUUID().toString(), room.id, grantedHr.id,
        )
        return room
    }

    private fun rename(actor: HrTestAccount, teamId: String, command: Map<String, Any>, key: String?): MvcResult =
        mockMvc.patch("/api/teams/$teamId") {
            authorizeManagement(actor)
            key?.let { header("Idempotency-Key", it) }
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(command)
        }.andReturn()

    private fun updateRole(actor: HrTestAccount, teamId: String, userId: String, command: Map<String, Any>, key: String?): MvcResult =
        mockMvc.patch("/api/teams/$teamId/members/$userId") {
            authorizeManagement(actor)
            key?.let { header("Idempotency-Key", it) }
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(command)
        }.andReturn()

    private fun transfer(actor: HrTestAccount, teamId: String, command: Map<String, Any>, key: String?): MvcResult =
        mockMvc.post("/api/teams/$teamId/ownership-transfer") {
            authorizeManagement(actor)
            key?.let { header("Idempotency-Key", it) }
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(command)
        }.andReturn()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "every management result, including failures, is private and non-cacheable")
    }

    private fun assertError(result: MvcResult, status: Int, code: String) {
        assertStatus(result, status, "M5 expected $code")
        assertNoStore(result)
        val payload = body(result)
        assertEquals(setOf("error", "code"), payload.fieldNames().asSequence().toSet(), "error envelope must be safe and exact")
        assertEquals(code, payload.path("code").asText())
        assertSafeDenialPayload(result)
    }

    private fun assertRevisionConflict(result: MvcResult, code: String, currentRevision: Long) {
        assertStatus(result, 409, "M5 stale permitted command must conflict")
        assertNoStore(result)
        val payload = body(result)
        assertEquals(setOf("error", "code", "currentRevision"), payload.fieldNames().asSequence().toSet())
        assertEquals(code, payload.path("code").asText())
        assertEquals(currentRevision, payload.path("currentRevision").asLong())
        assertSafeDenialPayload(result)
    }

    private fun assertSafeDenialPayload(result: MvcResult) {
        val serialized = result.response.contentAsString
        listOf(
            "receipt", "requestHash", "actorUserId", "targetUserId", "ownerUserId",
            "securityRevision", "epoch", "room", "interview", "candidate", "grant",
        ).forEach { forbidden ->
            assertFalse(serialized.contains(forbidden, ignoreCase = true), "safe management denial must not disclose $forbidden")
        }
    }

    private fun assertExactRenameSuccess(payload: JsonNode, expectedName: String, recovered: Boolean, outcome: String = "RENAMED") {
        assertEquals(setOf("outcome", "recovered", "team"), payload.fieldNames().asSequence().toSet())
        assertEquals(outcome, payload.path("outcome").asText())
        assertEquals(recovered, payload.path("recovered").asBoolean())
        val team = payload.path("team")
        assertEquals(setOf("id", "name", "role", "revision"), team.fieldNames().asSequence().toSet())
        assertEquals(expectedName, team.path("name").asText())
        assertTrue(team.path("role").asText() in setOf("OWNER", "ADMIN"))
        assertTrue(team.path("revision").isIntegralNumber)
    }

    private fun assertExactRoleSuccess(payload: JsonNode, expectedId: String, expectedRole: String, recovered: Boolean, outcome: String = "ROLE_UPDATED") {
        assertEquals(setOf("outcome", "recovered", "member"), payload.fieldNames().asSequence().toSet())
        assertEquals(outcome, payload.path("outcome").asText())
        assertEquals(recovered, payload.path("recovered").asBoolean())
        val member = payload.path("member")
        assertEquals(setOf("userId", "displayName", "role", "state", "revision"), member.fieldNames().asSequence().toSet())
        assertEquals(expectedId, member.path("userId").asText())
        assertEquals(expectedRole, member.path("role").asText())
        assertEquals("ACTIVE", member.path("state").asText())
        assertTrue(member.path("displayName").asText().isNotBlank())
        assertTrue(member.path("revision").isIntegralNumber)
    }

    private fun currentTeamRevision(teamId: String): Long = teamSnapshot(teamId).revision

    private fun teamSnapshot(teamId: String): TeamState = jdbcTemplate.queryForObject(
        "SELECT name,revision,security_revision,merge_revision,owner_user_id FROM teams WHERE id=?",
        { row, _ -> TeamState(row.getString("name"), row.getLong("revision"), row.getLong("security_revision"), row.getLong("merge_revision"), row.getString("owner_user_id")) },
        teamId,
    ) ?: error("M5 team fixture missing")

    private fun membershipSnapshot(teamId: String, userId: String): MembershipState = jdbcTemplate.queryForObject(
        "SELECT role,state,epoch,revision FROM team_memberships WHERE team_id=? AND user_id=?",
        { row, _ -> MembershipState(row.getString("role"), row.getString("state"), row.getLong("epoch"), row.getLong("revision")) },
        teamId, userId,
    ) ?: error("M5 membership fixture missing")

    private fun auditCount(teamId: String, action: String): Long = count("team_audit_events", "team_id=? AND action=?", teamId, action)

    private fun receiptCount(teamId: String, operation: String): Long = count("command_receipts", "scope_kind='TEAM' AND scope_id=? AND operation=?", teamId, operation)

    private fun count(table: String, where: String, vararg values: Any): Long =
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM $table WHERE $where", Long::class.java, *values) ?: 0L

    private fun commandBaseline(teamId: String, roomId: String): CommandBaseline = CommandBaseline(
        team = teamSnapshot(teamId),
        memberships = jdbcTemplate.queryForList("SELECT user_id,role,state,epoch,revision FROM team_memberships WHERE team_id=? ORDER BY user_id", teamId),
        rooms = jdbcTemplate.queryForList("SELECT id,owner_user_id,team_id,origin_team_id,interview_metadata_revision,candidate_name,position FROM rooms WHERE id=?", roomId),
        participants = jdbcTemplate.queryForList("SELECT room_id,user_id,role FROM room_participants WHERE room_id=? ORDER BY user_id", roomId),
        assignments = jdbcTemplate.queryForList("SELECT room_id,user_id FROM room_hr_assignments WHERE room_id=? ORDER BY user_id", roomId),
        audit = jdbcTemplate.queryForList("SELECT id,actor_user_id,target_user_id,action,outcome,opaque_entity_id FROM team_audit_events WHERE team_id=? ORDER BY id", teamId),
        receipts = jdbcTemplate.queryForList("SELECT actor_user_id,scope_kind,scope_id,operation,idempotency_key,outcome,status,resource_id FROM command_receipts WHERE scope_kind='TEAM' AND scope_id=? ORDER BY operation,idempotency_key", teamId),
    )

    private fun assertNoExpansion(before: CommandBaseline, after: CommandBaseline, expectedAuditDelta: Int, expectedReceiptDelta: Int, expectedName: String? = null) {
        assertEquals(expectedName ?: before.team.name, after.team.name)
        assertEquals(before.team.securityRevision, after.team.securityRevision, "management cannot change security revision")
        assertEquals(before.memberships.map { it["state"] to it["epoch"] }, after.memberships.map { it["state"] to it["epoch"] }, "management cannot change member lifecycle state/epoch")
        assertEquals(before.rooms, after.rooms, "management cannot change room owner or interview metadata")
        assertEquals(before.participants, after.participants, "management cannot change room/interview/candidate access")
        assertEquals(before.assignments, after.assignments, "management cannot change grant rows")
        assertEquals(before.audit.size + expectedAuditDelta, after.audit.size)
        assertEquals(before.receipts.size + expectedReceiptDelta, after.receipts.size)
    }

    private fun lockTeam(connection: Connection, teamId: String) {
        connection.prepareStatement("SELECT id FROM teams WHERE id=? FOR UPDATE").use { statement ->
            statement.setString(1, teamId)
            statement.executeQuery().use { result -> assertTrue(result.next(), "M5 lock fixture must hold an existing team row") }
        }
    }

    private data class TeamFixture(val id: String, val revision: Long, val name: String)
    private data class TeamState(val name: String, val revision: Long, val securityRevision: Long, val mergeRevision: Long, val ownerUserId: String)
    private data class MembershipState(val role: String, val state: String, val epoch: Long, val revision: Long)
    private data class CommandBaseline(
        val team: TeamState,
        val memberships: List<Map<String, Any?>>,
        val rooms: List<Map<String, Any?>>,
        val participants: List<Map<String, Any?>>,
        val assignments: List<Map<String, Any?>>,
        val audit: List<Map<String, Any?>>,
        val receipts: List<Map<String, Any?>>,
    )
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorizeManagement(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
