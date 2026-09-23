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
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * RED P1 ownership contract. These tests deliberately cover only public HTTP
 * commands plus direct PostgreSQL inspection of their transaction effects.
 * The endpoint does not exist yet, so every assertion is expected to be RED
 * until TASK-5-10 implements the server-authoritative transfer transaction.
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
class TeamOwnershipTransferIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("ownership_transfer")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `owner transfer returns the exact safe response and changes no room interview or candidate rows`() {
        postgres.verifyPostgres16()
        val fixture = fixture("success")
        val before = snapshot(fixture)
        val key = UUID.randomUUID().toString()

        val result = transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, key)

        assertStatus(result, 200, "only the current owner can complete an ownership transfer")
        assertProtectedNoStore(result)
        val response = body(result)
        assertEquals(setOf("outcome", "recovered", "team", "affectedMembers"), response.fieldNames().asSequence().toSet())
        assertEquals("OWNERSHIP_TRANSFERRED", response.path("outcome").asText())
        assertFalse(response.path("recovered").asBoolean(), "first terminal command is not a replay")
        assertExactSafeTeam(response.path("team"), fixture.teamId, expectedRole = "ADMIN")
        val affected = response.path("affectedMembers")
        assertEquals(2, affected.size(), "transfer response contains exactly old and new owner")
        assertEquals(listOf(fixture.owner.id, fixture.member.id), affected.map { it.path("userId").asText() })
        affected.forEach(::assertExactSafeMember)
        assertEquals(listOf("ADMIN", "OWNER"), affected.map { it.path("role").asText() })

        val after = snapshot(fixture)
        assertEquals(fixture.member.id, after.team.ownerUserId)
        assertEquals(before.team.revision + 1, after.team.revision)
        assertEquals(before.team.mergeRevision + 1, after.team.mergeRevision)
        assertEquals(before.team.securityRevision, after.team.securityRevision, "transfer must not rotate security revision")
        assertExactlyOneActiveEffectiveOwner(fixture.teamId, fixture.member.id)
        assertMembership(after, fixture.owner.id, expectedRole = "ADMIN", expectedState = "ACTIVE", expectedEpoch = before.membership(fixture.owner.id).epoch, expectedRevision = before.membership(fixture.owner.id).revision)
        assertMembership(after, fixture.member.id, expectedRole = "ADMIN", expectedState = "ACTIVE", expectedEpoch = before.membership(fixture.member.id).epoch, expectedRevision = before.membership(fixture.member.id).revision + 1)
        assertMembership(after, fixture.admin.id, expectedRole = before.membership(fixture.admin.id).role, expectedState = "ACTIVE", expectedEpoch = before.membership(fixture.admin.id).epoch, expectedRevision = before.membership(fixture.admin.id).revision)
        assertEquals(before.auditCount + 1, after.auditCount, "one completed transfer writes one audit event")
        assertEquals(before.receiptCount + 1, after.receiptCount, "one completed transfer writes one terminal receipt")
        assertEquals(1L, count("team_audit_events", "team_id=? AND actor_user_id=? AND action='TEAM_OWNERSHIP_TRANSFERRED' AND outcome='SUCCESS'", fixture.teamId, fixture.owner.id))
        assertEquals(1L, count("command_receipts", "actor_user_id=? AND scope_kind='TEAM' AND scope_id=? AND operation='TEAM_OWNERSHIP_TRANSFER' AND idempotency_key=?", fixture.owner.id, fixture.teamId, key))
        assertNonExpansion(before, after)
    }

    @Test
    fun `only an active current owner can transfer and every normal denial is private no-store`() {
        val fixture = fixture("authority")
        val revision = snapshot(fixture).team.revision
        val inactiveTarget = account("inactive-target")
        seedMembership(fixture.teamId, inactiveTarget.id, role = "MEMBER", state = "SUSPENDED", revision = 7)
        val foreign = account("foreign")
        val beforeDenials = snapshot(fixture)

        val unauthenticated = transfer(null, fixture.teamId, fixture.member.id, revision, UUID.randomUUID().toString())
        assertExactSafeTransferError(unauthenticated, fixture, 401, "UNAUTHORIZED")
        assertProtectedNoStore(unauthenticated)
        assertSnapshotsEqual(beforeDenials, snapshot(fixture), "unauthenticated denial must not create a transfer receipt, audit, domain or invitation write")

        val denied = listOf(
            transfer(fixture.admin, fixture.teamId, fixture.member.id, revision, UUID.randomUUID().toString()) to Pair(403, "TEAM_OWNER_REQUIRED"),
            transfer(fixture.member, fixture.teamId, fixture.admin.id, revision, UUID.randomUUID().toString()) to Pair(403, "TEAM_OWNER_REQUIRED"),
            transfer(foreign, fixture.teamId, fixture.member.id, revision, UUID.randomUUID().toString()) to Pair(404, "TEAM_NOT_FOUND"),
            transfer(fixture.owner, fixture.teamId, fixture.owner.id, revision, UUID.randomUUID().toString()) to Pair(409, "OWNERSHIP_TRANSFER_TARGET_INVALID"),
            transfer(fixture.owner, fixture.teamId, inactiveTarget.id, revision, UUID.randomUUID().toString()) to Pair(409, "OWNERSHIP_TRANSFER_TARGET_INVALID"),
            transfer(fixture.owner, fixture.teamId, UUID.randomUUID().toString(), revision, UUID.randomUUID().toString()) to Pair(409, "OWNERSHIP_TRANSFER_TARGET_INVALID"),
        )
        denied.forEach { (result, expected) ->
            assertExactSafeTransferError(result, fixture, expected.first, expected.second)
            assertProtectedNoStore(result)
            assertSnapshotsEqual(beforeDenials, snapshot(fixture), "denied transfer must not create a receipt, audit, domain or invitation write")
        }
    }

    @Test
    fun `transfer requires missing and malformed idempotency keys before every protected row remains unchanged`() {
        val fixture = fixture("invalid-key")
        val before = snapshot(fixture)
        val denials = listOf(
            transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, null) to "IDEMPOTENCY_KEY_REQUIRED",
            transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, "not-a-uuid") to "INVALID_IDEMPOTENCY_KEY",
        )

        denials.forEach { (result, code) ->
            assertExactSafeTransferError(result, fixture, 400, code)
            assertProtectedNoStore(result)
            assertSnapshotsEqual(before, snapshot(fixture), "invalid idempotency key must not create receipt, audit, domain or invitation state")
        }
    }

    @Test
    fun `same key with a different canonical transfer request conflicts without mutating receipt audit domain or invitation`() {
        val fixture = fixture("key-reuse")
        val key = UUID.randomUUID().toString()
        seedTerminalOwnershipReceipt(fixture.owner, fixture.teamId, key)
        val before = snapshot(fixture)

        val changedCanonicalBody = transfer(fixture.owner, fixture.teamId, fixture.admin.id, before.team.revision, key)

        assertExactSafeTransferError(changedCanonicalBody, fixture, 409, "IDEMPOTENCY_KEY_REUSED")
        assertProtectedNoStore(changedCanonicalBody)
        assertSnapshotsEqual(before, snapshot(fixture), "changed same-key transfer must not alter the existing receipt, audit, domain or invitation")
    }

    @Test
    fun `stale team revision returns the exact permitted current revision and no mutation`() {
        val fixture = fixture("stale-team")
        val staleRevision = snapshot(fixture).team.revision
        jdbcTemplate.update("UPDATE teams SET revision=revision+1, merge_revision=merge_revision+1 WHERE id=?", fixture.teamId)
        val before = snapshot(fixture)

        val result = transfer(fixture.owner, fixture.teamId, fixture.member.id, staleRevision, UUID.randomUUID().toString())

        assertExactSafeTransferError(result, fixture, 409, "TEAM_REVISION_CONFLICT", before.team.revision)
        assertProtectedNoStore(result)
        assertSnapshotsEqual(before, snapshot(fixture), "stale transfer must not create a receipt, audit, domain or invitation mutation")
    }

    @Test
    fun `held team lock returns bounded private busy without pending receipt or any snapshot mutation`() {
        val fixture = fixture("held-lock")
        val before = snapshot(fixture)
        val key = UUID.randomUUID().toString()
        val executor = Executors.newSingleThreadExecutor()
        val result = try {
            postgres.connection().use { heldConnection ->
                heldConnection.autoCommit = false
                lockTeam(heldConnection, fixture.teamId)
                val contender = executor.submit(Callable {
                    transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, key)
                })
                try {
                    contender.get(15, TimeUnit.SECONDS)
                } finally {
                    heldConnection.rollback()
                }
            }
        } finally {
            executor.shutdownNow()
        }

        assertExactSafeTransferError(result, fixture, 503, "TEAM_MANAGEMENT_BUSY")
        assertProtectedNoStore(result)
        assertEquals("5", result.response.getHeader("Retry-After"), "bounded transfer lock exhaustion must communicate the retry delay")
        assertFalse(result.response.contentAsString.contains("COMMAND_PENDING"), "no public pending receipt state is permitted")
        val after = snapshot(fixture)
        assertSnapshotsEqual(before, after, "busy transfer must leave every protected row unchanged")
        assertEquals(0L, count("command_receipts", "scope_kind='TEAM' AND scope_id=? AND operation='TEAM_OWNERSHIP_TRANSFER' AND idempotency_key=?", fixture.teamId, key))
        assertFalse(after.receiptRows.any { it["outcome"] == "COMMAND_PENDING" }, "busy transfer must not persist a pending receipt")
    }

    @Test
    fun `same revision competing transfers elect one owner and persist no loser receipt audit or partial state`() {
        val fixture = fixture("concurrent")
        val before = snapshot(fixture)
        val results = concurrently(
            { transfer(fixture.owner, fixture.teamId, fixture.admin.id, before.team.revision, UUID.randomUUID().toString()) },
            { transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, UUID.randomUUID().toString()) },
        )

        val winners = results.filter { it.response.status == 200 }
        val losers = results.filter { it.response.status != 200 }
        assertEquals(1, winners.size, "same-revision ownership transfers elect exactly one winner")
        assertEquals(1, losers.size)
        assertProtectedNoStore(winners.single())
        assertProtectedNoStore(losers.single())
        assertTrue(losers.single().response.status in setOf(409, 503), "loser has a documented conflict or busy result")
        val after = snapshot(fixture)
        when (losers.single().response.status) {
            409 -> assertExactSafeTransferError(losers.single(), fixture, 409, "TEAM_REVISION_CONFLICT", after.team.revision)
            503 -> assertRetryAfterFive(losers.single(), fixture)
        }
        val winnerTarget = body(winners.single()).path("affectedMembers")[1].path("userId").asText()
        assertEquals(winnerTarget, after.team.ownerUserId)
        assertExactlyOneActiveEffectiveOwner(fixture.teamId, winnerTarget)
        assertEquals(before.auditCount + 1, after.auditCount, "loser cannot append an audit event")
        assertEquals(before.receiptCount + 1, after.receiptCount, "loser cannot retain a receipt")
        assertEquals(1L, count("team_audit_events", "team_id=? AND action='TEAM_OWNERSHIP_TRANSFERRED'", fixture.teamId))
        assertEquals(1L, count("command_receipts", "scope_kind='TEAM' AND scope_id=? AND operation='TEAM_OWNERSHIP_TRANSFER'", fixture.teamId))
        assertMembership(after, fixture.owner.id, "ADMIN", "ACTIVE", before.membership(fixture.owner.id).epoch, before.membership(fixture.owner.id).revision)
        listOf(fixture.admin, fixture.member).forEach { target ->
            val beforeTarget = before.membership(target.id)
            val won = target.id == winnerTarget
            assertMembership(
                after,
                target.id,
                expectedRole = if (won) "ADMIN" else beforeTarget.role,
                expectedState = beforeTarget.state,
                expectedEpoch = beforeTarget.epoch,
                expectedRevision = beforeTarget.revision + if (won && beforeTarget.role != "ADMIN") 1 else 0,
            )
        }
        assertNonExpansion(before, after)
    }

    @Test
    fun `role update committed first makes a transfer with prior team revision conflict without a transfer receipt`() {
        val fixture = fixture("role-first")
        val before = snapshot(fixture)
        val roleKey = UUID.randomUUID().toString()
        val role = updateStoredRole(fixture.owner, fixture.teamId, fixture.member.id, "ADMIN", before.membership(fixture.member.id).revision, roleKey)
        assertStatus(role, 200, "owner role update is the controlled first committer")
        assertProtectedNoStore(role)
        val afterRole = snapshot(fixture)

        val transfer = transfer(fixture.owner, fixture.teamId, fixture.admin.id, before.team.revision, UUID.randomUUID().toString())
        assertExactSafeTransferError(transfer, fixture, 409, "TEAM_REVISION_CONFLICT", afterRole.team.revision)
        assertProtectedNoStore(transfer)

        val after = snapshot(fixture)
        assertSnapshotsEqual(afterRole, after, "stale transfer after role commit must not add any write")
        assertEquals(fixture.owner.id, after.team.ownerUserId, "stale transfer cannot move ownership")
        assertExactlyOneActiveEffectiveOwner(fixture.teamId, fixture.owner.id)
        assertMembership(after, fixture.member.id, "ADMIN", "ACTIVE", before.membership(fixture.member.id).epoch, before.membership(fixture.member.id).revision + 1)
        assertEquals(before.auditCount + 1, after.auditCount)
        assertEquals(before.receiptCount + 1, after.receiptCount)
        assertEquals(0L, count("team_audit_events", "team_id=? AND action='TEAM_OWNERSHIP_TRANSFERRED'", fixture.teamId))
        assertEquals(0L, count("command_receipts", "scope_kind='TEAM' AND scope_id=? AND operation='TEAM_OWNERSHIP_TRANSFER'", fixture.teamId))
        assertNonExpansion(before, after)
    }

    @Test
    fun `transfer committed first removes former owner authority before a role update can disclose or mutate`() {
        val fixture = fixture("transfer-first")
        val before = snapshot(fixture)
        val transfer = transfer(fixture.owner, fixture.teamId, fixture.admin.id, before.team.revision, UUID.randomUUID().toString())
        assertStatus(transfer, 200, "owner transfer is the controlled first committer")
        assertProtectedNoStore(transfer)

        val oldOwnerRoleAttempt = updateStoredRole(
            fixture.owner,
            fixture.teamId,
            fixture.member.id,
            "ADMIN",
            before.membership(fixture.member.id).revision,
            UUID.randomUUID().toString(),
        )
        assertStatusAndCode(oldOwnerRoleAttempt, 403, "TEAM_OWNER_REQUIRED")
        assertProtectedNoStore(oldOwnerRoleAttempt)
        assertNoTransferDisclosure(oldOwnerRoleAttempt, fixture)

        val after = snapshot(fixture)
        assertEquals(fixture.admin.id, after.team.ownerUserId)
        assertExactlyOneActiveEffectiveOwner(fixture.teamId, fixture.admin.id)
        assertMembership(after, fixture.member.id, before.membership(fixture.member.id).role, "ACTIVE", before.membership(fixture.member.id).epoch, before.membership(fixture.member.id).revision)
        assertEquals(before.auditCount + 1, after.auditCount)
        assertEquals(before.receiptCount + 1, after.receiptCount)
        assertEquals(1L, count("team_audit_events", "team_id=? AND action='TEAM_OWNERSHIP_TRANSFERRED'", fixture.teamId))
        assertEquals(0L, count("team_audit_events", "team_id=? AND action='MEMBER_ROLE_UPDATED'", fixture.teamId))
        assertEquals(1L, count("command_receipts", "scope_kind='TEAM' AND scope_id=? AND operation='TEAM_OWNERSHIP_TRANSFER'", fixture.teamId))
        assertNonExpansion(before, after)
    }

    @Test
    fun `legacy inactive current owner fails closed with no receipt audit domain or non expansion write`() {
        val fixture = fixture("invalid-owner")
        jdbcTemplate.update("UPDATE team_memberships SET state='SUSPENDED' WHERE team_id=? AND user_id=?", fixture.teamId, fixture.owner.id)
        val before = snapshot(fixture)

        val result = transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, UUID.randomUUID().toString())

        assertExactSafeTransferError(result, fixture, 404, "TEAM_NOT_FOUND")
        assertProtectedNoStore(result)
        assertNoTransferDisclosure(result, fixture)
        val after = snapshot(fixture)
        assertSnapshotsEqual(before, after, "invalid legacy current-owner data must fail closed without a write")
    }

    @Test
    fun `former owner exact replay is forbidden before receipt outcome or target is disclosed`() {
        val fixture = fixture("former-owner-replay")
        val before = snapshot(fixture)
        val key = UUID.randomUUID().toString()
        val first = transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, key)
        assertStatus(first, 200, "fixture needs a committed transfer")
        assertProtectedNoStore(first)
        val afterFirst = snapshot(fixture)

        val replay = transfer(fixture.owner, fixture.teamId, fixture.member.id, before.team.revision, key)
        assertExactSafeTransferError(replay, fixture, 403, "TEAM_OWNER_REQUIRED")
        assertProtectedNoStore(replay)
        assertNoTransferDisclosure(replay, fixture)
        val afterReplay = snapshot(fixture)
        assertSnapshotsEqual(afterFirst, afterReplay, "former-owner replay must not read or write the receipt outcome")
    }

    private fun fixture(prefix: String): OwnershipFixture {
        val owner = account("$prefix-owner")
        val admin = account("$prefix-admin")
        val member = account("$prefix-member")
        val candidate = account("$prefix-candidate")
        val interviewer = account("$prefix-interviewer", isHr = true)
        val teamId = createTeam(owner, "Ownership $prefix")
        seedMembership(teamId, admin.id, role = "ADMIN", state = "ACTIVE", revision = 11)
        seedMembership(teamId, member.id, role = "MEMBER", state = "ACTIVE", revision = 13)
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Ownership $prefix room")
        jdbcTemplate.update("UPDATE rooms SET team_id=?, origin_team_id=? WHERE id=?", teamId, teamId, room.id)
        jdbcTemplate.update(
            "INSERT INTO room_participants(id,room_id,user_id,role,created_at) VALUES (?,?,?,'candidate',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            UUID.randomUUID().toString(), room.id, candidate.id,
        )
        jdbcTemplate.update(
            "INSERT INTO room_hr_assignments(id,room_id,user_id,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            UUID.randomUUID().toString(), room.id, interviewer.id,
        )
        val invitationId = createLifecycleInvitation(owner, teamId)
        return OwnershipFixture(teamId, owner, admin, member, candidate, interviewer, room.id, invitationId)
    }

    private fun account(prefix: String, isHr: Boolean = false): HrTestAccount =
        HrHttpFixtures.register(mockMvc, objectMapper, isHr, prefix.take(18)).first

    private fun createTeam(owner: HrTestAccount, name: String): String {
        val result = mockMvc.post("/api/teams") {
            authorizeOwnership(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "ownership fixture needs an active team")
        return body(result).path("team").path("id").asText()
    }

    private fun createLifecycleInvitation(owner: HrTestAccount, teamId: String): String {
        val result = mockMvc.post("/api/teams/$teamId/invitations") {
            authorizeOwnership(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andReturn()
        assertStatus(result, 201, "ownership fixture requires one protected invitation lifecycle row")
        return body(result).path("invitation").path("id").asText()
    }

    private fun seedMembership(teamId: String, userId: String, role: String, state: String, revision: Long) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id,team_id,user_id,role,state,epoch,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,0,?,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role, state, revision,
        )
    }

    private fun transfer(actor: HrTestAccount?, teamId: String, targetUserId: String, revision: Long, key: String?): MvcResult =
        mockMvc.post("/api/teams/$teamId/ownership-transfer") {
            actor?.let(::authorizeOwnership)
            key?.let { header("Idempotency-Key", it) }
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("targetUserId" to targetUserId, "revision" to revision))
        }.andReturn()

    private fun updateStoredRole(
        actor: HrTestAccount,
        teamId: String,
        targetUserId: String,
        role: String,
        revision: Long,
        key: String,
    ): MvcResult = mockMvc.patch("/api/teams/$teamId/members/$targetUserId") {
        authorizeOwnership(actor)
        header("Idempotency-Key", key)
        contentType = MediaType.APPLICATION_JSON
        content = objectMapper.writeValueAsString(mapOf("role" to role, "revision" to revision))
    }.andReturn()

    private fun seedTerminalOwnershipReceipt(actor: HrTestAccount, teamId: String, key: String) {
        jdbcTemplate.update(
            """
            WITH stamp AS (SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS created_at)
            INSERT INTO command_receipts(
                actor_user_id,scope_kind,scope_id,operation,idempotency_key,request_hash,
                outcome,status,resource_id,created_at,expires_at
            )
            SELECT ?, 'TEAM', ?, 'TEAM_OWNERSHIP_TRANSFER', ?, ?,
                   'OWNERSHIP_TRANSFERRED', 200, ?, created_at, created_at + INTERVAL '24 hours'
            FROM stamp
            """.trimIndent(),
            actor.id,
            teamId,
            key,
            "v1:${"a".repeat(64)}",
            teamId,
        )
    }

    private fun concurrently(vararg commands: () -> MvcResult): List<MvcResult> {
        val executor = Executors.newFixedThreadPool(commands.size)
        val ready = CountDownLatch(commands.size)
        val start = CountDownLatch(1)
        return try {
            val futures = commands.map { command ->
                executor.submit(Callable {
                    ready.countDown()
                    check(start.await(10, TimeUnit.SECONDS)) { "concurrent test start latch timed out" }
                    command()
                })
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS), "both transfer contenders must reach the commit path")
            start.countDown()
            futures.map { it.get(15, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun lockTeam(connection: Connection, teamId: String) {
        connection.prepareStatement("SELECT id FROM teams WHERE id=? FOR UPDATE").use { statement ->
            statement.setString(1, teamId)
            statement.executeQuery().use { result -> assertTrue(result.next(), "held-lock fixture must lock the existing team row") }
        }
    }

    private fun snapshot(fixture: OwnershipFixture): OwnershipSnapshot = OwnershipSnapshot(
        team = jdbcTemplate.queryForObject(
            "SELECT owner_user_id,revision,security_revision,merge_revision FROM teams WHERE id=?",
            { resultSet, _ -> TeamState(resultSet.getString("owner_user_id"), resultSet.getLong("revision"), resultSet.getLong("security_revision"), resultSet.getLong("merge_revision")) },
            fixture.teamId,
        ) ?: error("team fixture disappeared"),
        memberships = jdbcTemplate.query(
            "SELECT user_id,role,state,epoch,revision FROM team_memberships WHERE team_id=? ORDER BY user_id",
            { resultSet, _ -> MembershipState(resultSet.getString("user_id"), resultSet.getString("role"), resultSet.getString("state"), resultSet.getLong("epoch"), resultSet.getLong("revision")) },
            fixture.teamId,
        ).associateBy { it.userId },
        auditCount = count("team_audit_events", "team_id=?", fixture.teamId),
        receiptCount = count("command_receipts", "scope_kind='TEAM' AND scope_id=?", fixture.teamId),
        auditRows = stableRows(
            "SELECT id,team_id,origin_team_id,actor_user_id,target_user_id,action,created_at,outcome,opaque_entity_id FROM team_audit_events WHERE team_id=? ORDER BY id",
            fixture.teamId,
        ),
        receiptRows = stableRows(
            "SELECT actor_user_id,scope_kind,scope_id,operation,idempotency_key,request_hash,outcome,status,resource_id,created_at,expires_at FROM command_receipts WHERE scope_kind='TEAM' AND scope_id=? ORDER BY operation,idempotency_key",
            fixture.teamId,
        ),
        roomRows = stableRows("SELECT id,owner_user_id,team_id,origin_team_id,archived_at,interview_metadata_revision FROM rooms WHERE id=? ORDER BY id", fixture.roomId),
        candidateAccessRows = stableRows("SELECT id,room_id,user_id,role FROM room_participants WHERE room_id=? ORDER BY id", fixture.roomId),
        interviewGrantRows = stableRows("SELECT id,room_id,user_id FROM room_hr_assignments WHERE room_id=? ORDER BY id", fixture.roomId),
        invitationRows = stableRows(
            "SELECT id,state,revision,accepted_by,accepted_at,expires_at,token_hash,recoverable_token_envelope,recovery_key_version FROM team_invitations WHERE team_id=? ORDER BY id",
            fixture.teamId,
        ),
    )

    private fun stableRows(sql: String, vararg values: String): List<Map<String, Any?>> = jdbcTemplate.queryForList(sql, *values)

    private fun OwnershipSnapshot.membership(userId: String): MembershipState =
        requireNotNull(memberships[userId]) { "fixture membership missing" }

    private fun assertMembership(
        snapshot: OwnershipSnapshot,
        userId: String,
        expectedRole: String,
        expectedState: String,
        expectedEpoch: Long,
        expectedRevision: Long,
    ) {
        val membership = snapshot.membership(userId)
        assertEquals(expectedRole, membership.role, "stored role mismatch")
        assertEquals(expectedState, membership.state, "transfer must not move membership state")
        assertEquals(expectedEpoch, membership.epoch, "transfer must not change membership epoch")
        assertEquals(expectedRevision, membership.revision, "only a stored role change increments membership revision")
    }

    private fun assertExactlyOneActiveEffectiveOwner(teamId: String, expectedOwnerId: String) {
        assertEquals(
            1L,
            count("teams team JOIN team_memberships membership ON membership.team_id=team.id AND membership.user_id=team.owner_user_id", "team.id=? AND membership.state='ACTIVE'", teamId),
            "there must be exactly one ACTIVE effective owner",
        )
        assertEquals(expectedOwnerId, jdbcTemplate.queryForObject("SELECT owner_user_id FROM teams WHERE id=?", String::class.java, teamId))
    }

    private fun assertNonExpansion(before: OwnershipSnapshot, after: OwnershipSnapshot) {
        assertTrue(before.roomRows == after.roomRows, "ownership transfer must not alter room ownership or metadata rows")
        assertTrue(before.candidateAccessRows == after.candidateAccessRows, "ownership transfer must not alter candidate-access rows")
        assertTrue(before.interviewGrantRows == after.interviewGrantRows, "ownership transfer must not alter interview grant rows")
        assertTrue(before.invitationRows == after.invitationRows, "ownership transfer must preserve invitation state, revision and link-protection fields byte-for-byte")
    }

    private fun assertSnapshotsEqual(before: OwnershipSnapshot, after: OwnershipSnapshot, message: String) {
        assertTrue(before == after, message)
    }

    private fun assertExactSafeTeam(value: JsonNode, teamId: String, expectedRole: String) {
        assertEquals(setOf("id", "name", "role", "revision"), value.fieldNames().asSequence().toSet())
        assertEquals(teamId, value.path("id").asText())
        assertEquals(expectedRole, value.path("role").asText())
        assertTrue(value.path("revision").isIntegralNumber)
        assertFalse(value.has("ownerUserId"))
        assertFalse(value.has("securityRevision"))
    }

    private fun assertExactSafeMember(value: JsonNode) {
        assertEquals(setOf("userId", "displayName", "role", "state", "revision"), value.fieldNames().asSequence().toSet())
        assertTrue(value.path("userId").asText().isNotBlank())
        assertTrue(value.path("displayName").asText().isNotBlank())
        assertTrue(value.path("role").asText() in setOf("OWNER", "ADMIN", "MEMBER"))
        assertEquals("ACTIVE", value.path("state").asText())
        assertTrue(value.path("revision").isIntegralNumber)
        listOf("epoch", "nickname", "login", "email", "ownerUserId").forEach { forbidden -> assertFalse(value.has(forbidden)) }
    }

    private fun assertNoTransferDisclosure(result: MvcResult, fixture: OwnershipFixture) {
        val raw = result.response.contentAsString
        listOf(fixture.teamId, fixture.owner.id, fixture.admin.id, fixture.member.id, fixture.candidate.id, fixture.interviewer.id, fixture.roomId, fixture.invitationId).forEach { forbidden ->
            assertFalse(raw.contains(forbidden), "denial must not disclose a protected team, target, room or candidate identity")
        }
        assertFalse(raw.contains("affectedMembers"))
        assertFalse(raw.contains("outcome"))
    }

    private fun assertStatusAndCode(result: MvcResult, expectedStatus: Int, code: String) {
        assertStatus(result, expectedStatus, "unexpected ownership-transfer response")
        assertEquals(code, body(result).path("code").asText())
    }

    private fun assertExactSafeTransferError(
        result: MvcResult,
        fixture: OwnershipFixture,
        expectedStatus: Int,
        code: String,
        currentRevision: Long? = null,
    ) {
        assertStatusAndCode(result, expectedStatus, code)
        val payload = body(result)
        val expectedFields = if (currentRevision == null) setOf("error", "code") else setOf("error", "code", "currentRevision")
        assertEquals(expectedFields, payload.fieldNames().asSequence().toSet(), "transfer errors use only their documented safe fields")
        currentRevision?.let { assertEquals(it, payload.path("currentRevision").asLong()) }
        assertNoForbiddenTransferErrorFields(payload)
        assertNoTransferDisclosure(result, fixture)
    }

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "protected ownership response must be private and non-cacheable")
    }

    private fun assertRetryAfterFive(result: MvcResult, fixture: OwnershipFixture) {
        assertExactSafeTransferError(result, fixture, 503, "TEAM_MANAGEMENT_BUSY")
        assertEquals("5", result.response.getHeader("Retry-After"))
    }

    private fun assertNoForbiddenTransferErrorFields(payload: JsonNode) {
        val forbiddenFragments = setOf(
            "team", "target", "member", "affected", "owner", "user", "receipt", "idempotency",
            "invitation", "token", "hash", "envelope", "room", "candidate", "interview", "grant",
            "audit", "role", "state", "epoch", "security", "merge", "stack", "trace", "exception",
        )
        payload.fieldNames().asSequence().forEach { field ->
            val normalized = field.lowercase()
            assertFalse(forbiddenFragments.any(normalized::contains), "transfer error must not expose protected field '$field'")
        }
    }

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun count(table: String, where: String, vararg args: Any): Long = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM $table WHERE $where",
        Long::class.java,
        *args,
    ) ?: 0L

    private data class OwnershipFixture(
        val teamId: String,
        val owner: HrTestAccount,
        val admin: HrTestAccount,
        val member: HrTestAccount,
        val candidate: HrTestAccount,
        val interviewer: HrTestAccount,
        val roomId: String,
        val invitationId: String,
    )

    private data class TeamState(
        val ownerUserId: String,
        val revision: Long,
        val securityRevision: Long,
        val mergeRevision: Long,
    )

    private data class MembershipState(
        val userId: String,
        val role: String,
        val state: String,
        val epoch: Long,
        val revision: Long,
    )

    private data class OwnershipSnapshot(
        val team: TeamState,
        val memberships: Map<String, MembershipState>,
        val auditCount: Long,
        val receiptCount: Long,
        val auditRows: List<Map<String, Any?>>,
        val receiptRows: List<Map<String, Any?>>,
        val roomRows: List<Map<String, Any?>>,
        val candidateAccessRows: List<Map<String, Any?>>,
        val interviewGrantRows: List<Map<String, Any?>>,
        val invitationRows: List<Map<String, Any?>>,
    )
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorizeOwnership(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
