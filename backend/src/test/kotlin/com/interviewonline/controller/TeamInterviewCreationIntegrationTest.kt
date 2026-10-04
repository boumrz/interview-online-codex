package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.service.CollaborationService
import com.interviewonline.service.AuthService
import com.interviewonline.service.TeamManagementService
import com.interviewonline.service.KeystrokePersistenceService
import com.interviewonline.service.ApiException
import com.interviewonline.ws.CandidateKeyPayload
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.UUID

@SpringBootTest(
    properties = [
        "app.features.team-workspaces-enabled=true",
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        "test.fixture.suspension=true",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Import(TeamSuspensionFixtureController::class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamInterviewCreationIntegrationTest(
    @Autowired private val dataSource: javax.sql.DataSource,
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val keystrokePersistenceService: KeystrokePersistenceService,
) {
    @Test
    fun teamCreationMetadataIsAtomicNormalizedPrivateAndIdempotent() {
        val owner = account("cm-owner")
        val team = team(owner, "Creation metadata")
        val key = UUID.randomUUID().toString()
        fun create(metadata: Map<String, Any?>, commandKey: String = key) = mockMvc.post("/api/teams/${team.id}/interviews") {
            authorize(owner); header("Idempotency-Key", commandKey); contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Metadata interview") + metadata)
        }.andReturn()
        val first = create(mapOf("candidateName" to "  Анна  ", "position" to " Kotlin developer ", "scheduledAt" to "2026-09-05T09:30:00+03:00"))
        assertStatus(first, 201, "metadata and interview created in one command")
        val room = body(first).path("interview")
        val roomId = room.path("id").asText()
        val invite = room.path("inviteCode").asText()
        assertBodyDoesNotContain(first, "candidateName", "scheduledAt", "Kotlin developer", "Анна")
        val metadata = mockMvc.get("/api/rooms/$invite/interview-metadata") { authorize(owner) }.andReturn()
        assertEquals("Анна", body(metadata).path("candidateName").asText())
        assertEquals("Kotlin developer", body(metadata).path("position").asText())
        assertEquals("2026-09-05T06:30:00Z", body(metadata).path("scheduledAt").asText())
        assertEquals(0L, body(metadata).path("revision").asLong())
        val replay = create(mapOf("candidateName" to "Анна", "position" to "Kotlin developer", "scheduledAt" to "2026-09-05T06:30:00Z"))
        assertStatus(replay, 201, "normalized equivalent command replays")
        assertEquals(roomId, body(replay).path("interview").path("id").asText())
        assertStatus(create(mapOf("candidateName" to "Мария", "position" to "Kotlin developer", "scheduledAt" to "2026-09-05T06:30:00Z")), 409, "changed private metadata cannot reuse key")
        assertStatus(create(mapOf("candidateName" to "Анна", "position" to "Java developer", "scheduledAt" to "2026-09-05T06:30:00Z")), 409, "position participates in command identity")
        assertStatus(create(mapOf("candidateName" to "Анна", "position" to "Kotlin developer", "scheduledAt" to "2026-09-06T06:30:00Z")), 409, "schedule participates in command identity")
        assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id))
        assertBodyDoesNotContain(mockMvc.get("/api/rooms/$invite") { authorize(owner) }.andReturn(), "candidateName", "scheduledAt", "Анна", "Kotlin developer")

        val legacyKey = UUID.randomUUID().toString()
        val legacy = create(emptyMap(), legacyKey)
        assertStatus(legacy, 201, "legacy metadata-free command")
        jdbcTemplate.update(
            "UPDATE command_receipts SET request_hash = ? WHERE scope_id = ? AND idempotency_key = ?",
            "v1:f2ce0bb05072b5aab94ca8a973275a8510d264f20a1916ce6d3a4e2d4d71d576", team.id, legacyKey,
        )
        val emptyReplay = create(mapOf("candidateName" to "  ", "position" to null, "scheduledAt" to ""), legacyKey)
        assertStatus(emptyReplay, 201, "normalized empty metadata preserves legacy receipt")
        assertEquals(body(legacy).path("interview").path("id"), body(emptyReplay).path("interview").path("id"))
        val before = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id)
        listOf(
            mapOf("candidateName" to "😀".repeat(201)),
            mapOf("position" to "😀".repeat(201)),
            mapOf("scheduledAt" to "2026-09-05T09:30:00"),
            mapOf("candidateName" to 42),
            mapOf("position" to false),
            mapOf("scheduledAt" to 123),
        ).forEach { invalid -> assertStatus(create(invalid, UUID.randomUUID().toString()), 400, "invalid creation metadata rejected") }
        assertEquals(before, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id), "invalid metadata leaves no partial room")
        val boundary = create(mapOf("candidateName" to "😀".repeat(200), "position" to "😀".repeat(200)), UUID.randomUUID().toString())
        assertStatus(boundary, 201, "200 Unicode code points accepted")
    }

    @Test
    fun teamInterviewDetailsSaveTitleAndMetadataAtomicallyWithOneRevision() {
        val owner = account("det-owner")
        val colleague = account("det-colleague")
        val team = team(owner, "Details editing")
        seedMembership(team.id, colleague.id, "MEMBER")
        val room = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview")
        val roomId = room.path("id").asText()
        val path = "/api/teams/${team.id}/interviews/$roomId/details"
        val initial = mockMvc.get(path) { authorize(colleague) }.andReturn()
        assertStatus(initial, 200, "every active colleague reads one current editor snapshot")
        assertEquals("private, no-store", initial.response.getHeader("Cache-Control"))
        assertEquals("Original title", body(initial).path("title").asText())
        assertTrue(body(initial).path("candidateName").isNull)
        assertEquals(0L, body(initial).path("revision").asLong())
        val saved = mockMvc.patch(path) {
            authorize(colleague); contentType = MediaType.APPLICATION_JSON
            content = """{"title":"  Revised title  ","candidateName":"  Анна  ","position":" Kotlin developer ","scheduledAt":"2026-09-05T09:30:00+03:00","revision":0}"""
        }.andReturn()
        assertStatus(saved, 200, "one command saves title and private metadata")
        assertEquals("private, no-store", saved.response.getHeader("Cache-Control"))
        assertEquals("Revised title", body(saved).path("title").asText())
        assertEquals("Анна", body(saved).path("candidateName").asText())
        assertEquals("Kotlin developer", body(saved).path("position").asText())
        assertEquals("2026-09-05T06:30:00Z", body(saved).path("scheduledAt").asText())
        assertEquals(1L, body(saved).path("revision").asLong())
        val stale = mockMvc.patch(path) {
            authorize(owner); contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Stale title","candidateName":"Lost candidate","position":null,"scheduledAt":null,"revision":0}"""
        }.andReturn()
        assertStatus(stale, 409, "stale complete editor cannot partially overwrite either field")
        assertEquals(body(saved), body(mockMvc.get(path) { authorize(owner) }.andReturn()), "saved complete snapshot remains durable")
        val cleared = mockMvc.patch(path) {
            authorize(owner); contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Revised title","candidateName":"  ","position":null,"scheduledAt":"","revision":1}"""
        }.andReturn()
        assertStatus(cleared, 200, "explicit blank values clear metadata")
        assertTrue(body(cleared).path("candidateName").isNull)
        assertTrue(body(cleared).path("position").isNull)
        assertTrue(body(cleared).path("scheduledAt").isNull)
        assertEquals(2L, body(cleared).path("revision").asLong())
    }

    @Test
    fun teamInterviewDetailsValidateCompleteTypedBodiesWithoutPartialSave() {
        val owner = account("dv-owner")
        val team = team(owner, "Details validation")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Retained title", null, null, null)).path("interview").path("id").asText()
        val path = "/api/teams/${team.id}/interviews/$roomId/details"
        val valid = mapOf("title" to "Changed title", "candidateName" to "Анна", "position" to null, "scheduledAt" to null, "revision" to 0)
        val original = body(mockMvc.get(path) { authorize(owner) }.andReturn())
        listOf(
            valid - "position", valid + ("unknown" to "value"), valid + ("title" to 42), valid + ("title" to null),
            valid + ("title" to "  "), valid + ("candidateName" to 42), valid + ("position" to false),
            valid + ("candidateName" to "😀".repeat(201)), valid + ("position" to "😀".repeat(201)),
            valid + ("scheduledAt" to "2026-09-05T09:30:00"), valid + ("scheduledAt" to true),
            valid + ("revision" to -1), valid + ("revision" to 0.5), valid + ("revision" to "0"), valid + ("revision" to null),
        ).forEach { invalid ->
            assertStatus(mockMvc.patch(path) { authorize(owner); contentType = MediaType.APPLICATION_JSON; content = objectMapper.writeValueAsString(invalid) }.andReturn(), 400, "invalid complete editor command")
            assertEquals(original, body(mockMvc.get(path) { authorize(owner) }.andReturn()), "invalid editor command is atomic")
        }
        assertStatus(mockMvc.patch(path) {
            authorize(owner); contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(valid + ("candidateName" to "😀".repeat(200)) + ("position" to "😀".repeat(200)))
        }.andReturn(), 200, "details accept Unicode boundary")
    }

    @Test
    fun teamInterviewDetailsRejectUnauthorizedArchivedAndNoncanonicalRooms() {
        val owner = account("da-owner")
        val member = account("da-member")
        val external = account("da-external")
        val team = team(owner, "Details access")
        seedMembership(team.id, member.id, "MEMBER")
        jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", external.id)
        val room = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Private details", null, null, null)).path("interview")
        val roomId = room.path("id").asText()
        val path = "/api/teams/${team.id}/interviews/$roomId/details"
        assertStatus(mockMvc.put("/api/rooms/${room.path("inviteCode").asText()}/hr-managers/${external.id}") { authorize(owner) }.andReturn(), 200, "external hiring access fixture")
        val command = """{"title":"Unauthorized","candidateName":"Secret","position":null,"scheduledAt":null,"revision":0}"""
        fun denied(actor: HrTestAccount, expected: Int) {
            assertStatus(mockMvc.get(path) { authorize(actor) }.andReturn(), expected, "details GET enforces TEAM authority")
            assertStatus(mockMvc.patch(path) { authorize(actor); contentType = MediaType.APPLICATION_JSON; content = command }.andReturn(), expected, "details PATCH enforces TEAM authority")
        }
        denied(external, 404)
        jdbcTemplate.update("UPDATE team_memberships SET state = 'SUSPENDED' WHERE team_id = ? AND user_id = ?", team.id, member.id)
        denied(member, 404)
        jdbcTemplate.update("UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", roomId)
        denied(owner, 410)
        jdbcTemplate.update("UPDATE rooms SET archived_at = NULL, team_interview_created = false WHERE id = ?", roomId)
        denied(owner, 404)
        assertEquals("Private details", jdbcTemplate.queryForObject("SELECT title FROM rooms WHERE id = ?", String::class.java, roomId))
    }

    @Test
    fun teamInterviewDetailsRefreshRoomAfterWaitingForLock() {
        val owner = account("dr-owner")
        val team = team(owner, "Details revision race")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview").path("id").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM rooms WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, roomId); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> {
                    mockMvc.patch("/api/teams/${team.id}/interviews/$roomId/details") {
                        authorize(owner); contentType = MediaType.APPLICATION_JSON
                        content = """{"title":"Stale title","candidateName":"Stale candidate","position":null,"scheduledAt":null,"revision":0}"""
                    }.andReturn()
                }
                waitForHiringLock("rooms")
                connection.prepareStatement("UPDATE rooms SET title = 'Committed title', candidate_name = 'Committed candidate', interview_metadata_revision = 1 WHERE id = ?").use { statement -> statement.setString(1, roomId); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 409, "editor observes the committed revision after lock wait")
            }
            val saved = mockMvc.get("/api/teams/${team.id}/interviews/$roomId/details") { authorize(owner) }.andReturn()
            assertEquals("Committed title", body(saved).path("title").asText())
            assertEquals("Committed candidate", body(saved).path("candidateName").asText())
            assertEquals(1L, body(saved).path("revision").asLong())
        } finally { executor.shutdownNow() }
    }

    @Test
    fun teamInterviewDetailsRecheckMembershipAfterTeamLockWait() {
        val owner = account("dma-owner")
        val member = account("dma-member")
        val team = team(owner, "Details authority race")
        seedMembership(team.id, member.id, "MEMBER")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview").path("id").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM teams WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, team.id); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> {
                    mockMvc.patch("/api/teams/${team.id}/interviews/$roomId/details") {
                        authorize(member); contentType = MediaType.APPLICATION_JSON
                        content = """{"title":"Lost authority","candidateName":"Secret","position":null,"scheduledAt":null,"revision":0}"""
                    }.andReturn()
                }
                waitForHiringLock("teams")
                connection.prepareStatement("UPDATE team_memberships SET state = 'SUSPENDED' WHERE team_id = ? AND user_id = ?").use { statement -> statement.setString(1, team.id); statement.setString(2, member.id); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 404, "editor checks membership after team wait")
            }
            assertEquals("Original title", jdbcTemplate.queryForObject("SELECT title FROM rooms WHERE id = ?", String::class.java, roomId))
            assertEquals(0L, jdbcTemplate.queryForObject("SELECT interview_metadata_revision FROM rooms WHERE id = ?", Long::class.java, roomId))
        } finally { executor.shutdownNow() }
    }

    @Test
    fun teamInterviewDetailsRecheckMembershipAfterRoomLockWait() {
        val owner = account("dmar-owner")
        val member = account("dmar-member")
        val team = team(owner, "Details room authority race")
        seedMembership(team.id, member.id, "MEMBER")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview").path("id").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM rooms WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, roomId); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> {
                    mockMvc.patch("/api/teams/${team.id}/interviews/$roomId/details") {
                        authorize(member); contentType = MediaType.APPLICATION_JSON
                        content = """{"title":"Lost authority","candidateName":"Secret","position":null,"scheduledAt":null,"revision":0}"""
                    }.andReturn()
                }
                waitForHiringLock("rooms")
                connection.prepareStatement("UPDATE team_memberships SET state = 'SUSPENDED' WHERE team_id = ? AND user_id = ?").use { statement -> statement.setString(1, team.id); statement.setString(2, member.id); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 404, "editor checks fresh membership after room wait")
            }
            assertEquals("Original title", jdbcTemplate.queryForObject("SELECT title FROM rooms WHERE id = ?", String::class.java, roomId))
            assertEquals(0L, jdbcTemplate.queryForObject("SELECT interview_metadata_revision FROM rooms WHERE id = ?", Long::class.java, roomId))
        } finally { executor.shutdownNow() }
    }

    @Test
    fun concurrentTeamInterviewDetailsSavesAcceptExactlyOneCompleteSnapshot() {
        val owner = account("dc-owner")
        val team = team(owner, "Concurrent details")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview").path("id").asText()
        val path = "/api/teams/${team.id}/interviews/$roomId/details"
        val ready = java.util.concurrent.CountDownLatch(2)
        val start = java.util.concurrent.CountDownLatch(1)
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val responses = (1..2).map { index ->
                executor.submit<MvcResult> {
                    ready.countDown(); start.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    mockMvc.patch(path) {
                        authorize(owner); contentType = MediaType.APPLICATION_JSON
                        content = """{"title":"Title $index","candidateName":"Candidate $index","position":"Position $index","scheduledAt":null,"revision":0}"""
                    }.andReturn()
                }
            }
            assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS))
            start.countDown()
            val results = responses.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS) }
            assertEquals(1, results.count { it.response.status == 200 })
            assertEquals(1, results.count { it.response.status == 409 })
            val saved = body(mockMvc.get(path) { authorize(owner) }.andReturn())
            assertEquals(body(results.single { it.response.status == 200 }), saved)
            assertEquals(1L, saved.path("revision").asLong())
        } finally { executor.shutdownNow() }
    }

    @Test
    fun legacyRenamePreservesCommittedMetadataAndRevisionAfterRoomLockWait() {
        val owner = account("drr-owner")
        val team = team(owner, "Legacy rename race")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview").path("id").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM rooms WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, roomId); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> {
                    mockMvc.patch("/api/teams/${team.id}/interviews/$roomId") { authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"title":"Legacy renamed"}""" }.andReturn()
                }
                waitForHiringLock("rooms")
                connection.prepareStatement("UPDATE rooms SET candidate_name = 'Committed candidate', interview_metadata_revision = 1 WHERE id = ?").use { statement -> statement.setString(1, roomId); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 200, "legacy rename waits safely")
            }
            assertEquals("Committed candidate", jdbcTemplate.queryForObject("SELECT candidate_name FROM rooms WHERE id = ?", String::class.java, roomId))
            assertEquals(2L, jdbcTemplate.queryForObject("SELECT interview_metadata_revision FROM rooms WHERE id = ?", Long::class.java, roomId))
        } finally { executor.shutdownNow() }
    }

    @Test
    fun hiringManagerTeamAssignmentsCatalogAndCandidateSearchRespectScope() {
        val owner = account("hr-team-owner")
        val hr = account("hr-team-target")
        val ordinary = account("hr-ordinary")
        val outsider = account("hr-outsider")
        val admin = account("hr-team-admin")
        val team = team(owner, "Hiring managers")
        listOf(hr, ordinary).forEach { seedMembership(team.id, it.id, "MEMBER") }
        seedMembership(team.id, admin.id, "ADMIN")
        listOf(hr, outsider).forEach { jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", it.id) }
        val created = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Scope room", null, null, null)).path("interview")
        val invite = created.path("inviteCode").asText()
        fun inviteBy(actor: HrTestAccount, target: HrTestAccount) = mockMvc.put("/api/rooms/$invite/hr-managers/${target.id}") { authorize(actor) }.andReturn()
        assertStatus(inviteBy(owner, hr), 404, "team member needs no separate hiring assignment")
        assertStatus(inviteBy(owner, ordinary), 404, "ordinary active member needs no hiring assignment")
        assertStatus(inviteBy(owner, outsider), 200, "external HR can be explicitly invited")
        assertStatus(inviteBy(admin, outsider), 200, "all active team members manage external assignments")
        assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_participants WHERE room_id = ? AND user_id = ?", Long::class.java, created.path("id").asText(), outsider.id))
        assertStatus(mockMvc.put("/api/rooms/$invite/hr-managers/${hr.id}") { header("X-Room-Owner-Token", "owner_legacy") }.andReturn(), 403, "legacy credentials confer no team authority")
        val options = mockMvc.get("/api/me/hiring-manager-options") { authorize(owner); param("teamId", team.id) }.andReturn()
        assertStatus(options, 200, "team-scoped HR selector")
        assertEquals("no-store", options.response.getHeader("Cache-Control"))
        assertEquals(0, body(options).size(), "external managers are invited by UUID without a team member picker")
        assertBodyDoesNotContain(options, outsider.id, ordinary.id)
        assertStatus(mockMvc.get("/api/me/hiring-manager-options") { authorize(outsider); param("teamId", team.id) }.andReturn(), 404, "foreign catalog private")
        assertEquals(0, body(mockMvc.get("/api/me/hiring-manager-options") { authorize(owner) }.andReturn()).size())
        assertStatus(mockMvc.put("/api/rooms/$invite/interview-metadata") {
            authorize(hr); contentType = MediaType.APPLICATION_JSON
            content = """{"candidateName":"Кандидат 234","position":null,"scheduledAt":null,"revision":0}"""
        }.andReturn(), 200, "assigned HR edits TEAM metadata")
        val found = mockMvc.get("/api/teams/${team.id}/interviews") { authorize(owner); param("q", "  КАНДИДАТ 234  ") }.andReturn()
        assertStatus(found, 200, "candidate search")
        assertEquals(1, body(found).path("items").size())
        jdbcTemplate.update("DELETE FROM room_participants WHERE room_id = ? AND user_id = ?", created.path("id").asText(), owner.id)
        assertStatus(mockMvc.get("/api/rooms/$invite/interview-metadata") { authorize(owner) }.andReturn(), 200, "active membership retains metadata without an explicit room row")
        assertEquals(1, body(mockMvc.get("/api/teams/${team.id}/interviews") { authorize(owner); param("q", "234") }.andReturn()).path("items").size(), "team candidate search follows active membership")
        jdbcTemplate.update("INSERT INTO room_participants (id, room_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), created.path("id").asText(), owner.id)

        assertEquals(1, body(mockMvc.get("/api/teams/${team.id}/interviews") { authorize(ordinary); param("q", "234") }.andReturn()).path("items").size(), "all active members can search candidates")
        assertStatus(mockMvc.delete("/api/rooms/$invite/hr-managers/${outsider.id}") { authorize(owner) }.andReturn(), 204, "remove external HR")
        assertStatus(mockMvc.get("/api/rooms/$invite/interview-metadata") { authorize(outsider) }.andReturn(), 403, "removed external HR loses private access")
        jdbcTemplate.update("UPDATE team_memberships SET state = 'SUSPENDED' WHERE team_id = ? AND user_id = ?", team.id, hr.id)
        assertStatus(mockMvc.get("/api/rooms/$invite/interview-metadata") { authorize(hr) }.andReturn(), 403, "inactive membership loses team management")
        val personal = body(mockMvc.post("/api/rooms") { authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"title":"Personal scope","taskIds":[]}""" }.andReturn())
        assertStatus(mockMvc.put("/api/rooms/${personal.path("inviteCode").asText()}/hr-managers/${outsider.id}") { authorize(owner) }.andReturn(), 200, "personal external UUID remains supported")
    }

    @Test
    fun hiringManagerSelectionOnTeamCreationIsAtomicAndIdempotent() {
        val owner = account("create-hr-owner")
        val hr = account("create-hr-target")
        val nonHr = account("create-non-hr")
        val external = account("create-ext-hr")
        val team = team(owner, "Creation HR")
        listOf(hr, nonHr).forEach { seedMembership(team.id, it.id, "MEMBER") }
        listOf(hr, external).forEach { jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", it.id) }
        val key = UUID.randomUUID().toString()
        fun create(ids: List<String>, commandKey: String = key) = mockMvc.post("/api/teams/${team.id}/interviews") {
            authorize(owner); header("Idempotency-Key", commandKey); contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Create HR", "hiringManagerIds" to ids))
        }.andReturn()
        val first = create(listOf(external.id))
        assertStatus(first, 201, "hiring managers created atomically")
        val invite = body(first).path("interview").path("inviteCode").asText()
        val replay = create(listOf(external.id))
        assertStatus(replay, 201, "same command returns original room")
        assertEquals(body(first).path("interview").path("id"), body(replay).path("interview").path("id"))
        assertEquals(external.id, body(mockMvc.get("/api/rooms/$invite/hr-managers") { authorize(owner) }.andReturn()).first().path("userId").asText())
        assertStatus(create(emptyList()), 409, "same key cannot silently remove hiring managers")
        val before = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id)
        assertStatus(create(listOf(nonHr.id), UUID.randomUUID().toString()), 404, "non HR rejected")
        assertStatus(create(listOf(hr.id), UUID.randomUUID().toString()), 404, "same-team HR cannot receive redundant assignment")
        assertEquals(before, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id), "no partial interview")
    }

    @Test
    fun hiringManagerMutationRechecksFreshRoomAfterWaitingForLock() {
        val owner = account("hr-stale-owner")
        val team = team(owner, "Fresh room")
        val room = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Stale metadata", null, null, null)).path("interview")
        val invite = room.path("inviteCode").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM rooms WHERE id = ? FOR UPDATE").use { statement ->
                    statement.setString(1, room.path("id").asText()); statement.executeQuery().close()
                }
                val request = executor.submit<MvcResult> {
                    mockMvc.put("/api/rooms/$invite/interview-metadata") {
                        authorize(owner); contentType = MediaType.APPLICATION_JSON
                        content = """{"candidateName":"stale overwrite","position":null,"scheduledAt":null,"revision":0}"""
                    }.andReturn()
                }
                waitForHiringLock("rooms")
                connection.prepareStatement("UPDATE rooms SET candidate_name = 'committed value', interview_metadata_revision = 1 WHERE id = ?").use { statement ->
                    statement.setString(1, room.path("id").asText()); statement.executeUpdate()
                }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 409, "fresh revision wins after room lock")
                assertEquals("committed value", jdbcTemplate.queryForObject("SELECT candidate_name FROM rooms WHERE id = ?", String::class.java, room.path("id").asText()))
            }
        } finally { executor.shutdownNow() }
    }

    @Test
    fun hiringManagerAssignmentRejectsTargetJoiningTheTeamWhileWaiting() {
        val owner = account("hr-remove-owner")
        val hr = account("hr-remove-target")
        val team = team(owner, "Membership race")
        jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", hr.id)
        val room = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Assignment race", null, null, null)).path("interview")
        val invite = room.path("inviteCode").asText()
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM teams WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, team.id); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> { mockMvc.put("/api/rooms/$invite/hr-managers/${hr.id}") { authorize(owner) }.andReturn() }
                waitForHiringLock("teams")
                connection.prepareStatement("INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").use { statement -> statement.setString(1, UUID.randomUUID().toString()); statement.setString(2, team.id); statement.setString(3, hr.id); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 404, "fresh active membership prevents a redundant external hiring grant")
            }
            assertEquals(0L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_participants WHERE room_id = ? AND user_id = ?", Long::class.java, room.path("id").asText(), hr.id), "rejected hiring assignment leaves no partial room grant")
            assertStatus(mockMvc.delete("/api/teams/${team.id}/members/${hr.id}") { authorize(owner); header("Idempotency-Key", UUID.randomUUID().toString()) }.andReturn(), 200, "fixture removes the member")
            assertStatus(mockMvc.put("/api/rooms/$invite/hr-managers/${hr.id}") { authorize(owner) }.andReturn(), 200, "former member can be explicitly invited as an external hiring manager")
        } finally { executor.shutdownNow() }
    }

    @Test
    fun hiringManagerCreationRechecksProfileAndRejectsMalformedIds() {
        val owner = account("hr-profile-owner")
        val hr = account("hr-profile-target")
        val team = team(owner, "Profile race")
        jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", hr.id)
        fun create(ids: Any?) = mockMvc.post("/api/teams/${team.id}/interviews") {
            authorize(owner); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Profile race", "hiringManagerIds" to ids))
        }.andReturn()
        listOf(listOf("bad"), listOf("1-1-1-1-1"), listOf(123), null, hr.id).forEach { malformed ->
            assertTrue(create(malformed).response.status in 400..499, "malformed hiring IDs give client errors")
        }
        val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            dataSource.connection.use { connection ->
                connection.autoCommit = false
                connection.prepareStatement("SELECT id FROM users WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, hr.id); statement.executeQuery().close() }
                val request = executor.submit<MvcResult> { create(listOf(hr.id)) }
                waitForHiringLock("users")
                connection.prepareStatement("UPDATE users SET is_hr = false WHERE id = ?").use { statement -> statement.setString(1, hr.id); statement.executeUpdate() }
                connection.commit()
                assertStatus(request.get(5, java.util.concurrent.TimeUnit.SECONDS), 404, "disabled HR profile cannot pass a stale creation check")
            }
            assertEquals(0L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, team.id), "invalid or raced assignment creates no room")
        } finally { executor.shutdownNow() }
    }

    @Test
    fun hiringManagerReciprocalOwnersAcrossTeamsCannotDeadlock() {
        val first = account("hr-cross-one")
        val second = account("hr-cross-two")
        val teamOne = team(first, "Cross team one")
        val teamTwo = team(second, "Cross team two")
        listOf(first, second).forEach { jdbcTemplate.update("UPDATE users SET is_hr = true WHERE id = ?", it.id) }
        val lower = listOf(first.id, second.id).minOrNull()!!
        val higher = listOf(first.id, second.id).maxOrNull()!!
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        fun request(owner: HrTestAccount, teamId: String, hr: HrTestAccount) = executor.submit<MvcResult> {
            mockMvc.post("/api/teams/$teamId/interviews") {
                authorize(owner); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("title" to "Reciprocal owners", "hiringManagerIds" to listOf(hr.id)))
            }.andReturn()
        }
        try {
            dataSource.connection.use { lowerLock -> dataSource.connection.use { higherLock ->
                listOf(lowerLock to lower, higherLock to higher).forEach { (connection, id) ->
                    connection.autoCommit = false
                    connection.prepareStatement("SELECT id FROM users WHERE id = ? FOR UPDATE").use { statement -> statement.setString(1, id); statement.executeQuery().close() }
                }
                val one = request(first, teamOne.id, second)
                val two = request(second, teamTwo.id, first)
                val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5)
                while ((jdbcTemplate.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND lower(query) LIKE '%from users%for update%'", Long::class.java) ?: 0) < 2) {
                    assertTrue(System.nanoTime() < deadline, "both requests reach external user locks")
                    Thread.sleep(10)
                }
                lowerLock.commit()
                // Both requests are now serialized on the same sorted user chain.
                // The previous target-only order instead reaches an owner FK insert.
                val advancedDeadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5)
                while ((jdbcTemplate.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND lower(query) LIKE '%insert into rooms%'", Long::class.java) ?: 0) == 0L &&
                    (jdbcTemplate.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND lower(query) LIKE '%from users%for update%'", Long::class.java) ?: 0) < 2) {
                    assertTrue(System.nanoTime() < advancedDeadline, "request advances after lower lock release")
                    Thread.sleep(10)
                }
                higherLock.commit()
                assertStatus(one.get(10, java.util.concurrent.TimeUnit.SECONDS), 201, "first reciprocal creation succeeds")
                assertStatus(two.get(10, java.util.concurrent.TimeUnit.SECONDS), 201, "second reciprocal creation succeeds without deadlock")
            } }
        } finally { executor.shutdownNow() }
    }

    private fun waitForHiringLock(table: String) {
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5)
        while (System.nanoTime() < deadline) {
            val waiting = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND lower(query) LIKE ?", Long::class.java, "%from $table%for update%") ?: 0
            if (waiting > 0) return
            Thread.sleep(10)
        }
        throw AssertionError("Hiring request must reach the $table lock before fixture transaction changes authority")
    }

    @Test
    fun candidateActivityPersistenceRechecksLifecycleInsideItsOwnTransaction() {
        val owner = account("key-lock")
        val team = team(owner, "Activity lifecycle")
        val roomId = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Activity room", null, null, null)).path("interview").path("id").asText()
        val payload = CandidateKeyPayload("candidate-session", "Candidate", "a", "KeyA", false, false, false, false, 1,
            sourceEventId = UUID.randomUUID().toString())
        assertTrue(keystrokePersistenceService.accept(roomId, payload).created, "active candidate activity remains durable")
        jdbcTemplate.update("UPDATE rooms SET status = 'finished' WHERE id = ?", roomId)
        val finished = assertThrows(ApiException::class.java) {
            keystrokePersistenceService.accept(roomId, payload.copy(sourceEventId = UUID.randomUUID().toString()))
        }
        assertEquals(403, finished.status.value())
        assertEquals("ROOM_READ_ONLY", finished.code)
        assertEquals(403, assertThrows(ApiException::class.java) { keystrokePersistenceService.accept(roomId, payload) }.status.value(), "old source IDs cannot bypass the locked lifecycle guard")
        jdbcTemplate.update("UPDATE rooms SET status = 'frozen' WHERE id = ?", roomId)
        assertEquals(409, assertThrows(ApiException::class.java) {
            keystrokePersistenceService.accept(roomId, payload.copy(sourceEventId = UUID.randomUUID().toString()))
        }.status.value())
        assertEquals(1L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_keystroke_events WHERE room_id = ?", Long::class.java, roomId))
    }

    @Test
    fun tasklessPendingSnapshotCannotBecomeTheFirstAddedTaskDocument() {
        val owner = account("empty-bound")
        val team = team(owner, "Taskless context boundary")
        val created = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Empty boundary", null, null, null)).path("interview")
        val inviteCode = created.path("inviteCode").asText()
        val roomId = created.path("id").asText()
        val session = UUID.randomUUID().toString()
        val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            authorize(owner); param("sessionId", session); param("displayName", "Owner")
        }.andReturn()
        val token = realtimePayload(stream).path("eventToken").asText()
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("sessionId" to session, "eventToken" to token, "type" to "yjs_update",
                "operationId" to UUID.randomUUID().toString(), "yjsUpdate" to "AQID", "yjsDocumentBase64" to "AQID",
                "baseServerYjsSequence" to 0, "code" to "// old taskless code"))
        }.andReturn(), 204, "taskless snapshot is acknowledged before delayed persistence")
        assertStatus(mockMvc.post("/api/rooms/$inviteCode/tasks") {
            authorize(owner); contentType = MediaType.APPLICATION_JSON
            content = """{"customTasks":[{"title":"First added task","description":"Brief","starterCode":"// new task","language":"nodejs"}]}"""
        }.andReturn(), 200, "adding the first task creates a new published context")
        val published = realtimePayload(stream)
        assertEquals("// new task", published.path("code").asText())
        assertEquals(0L, published.path("lastYjsSequence").asLong(), "new task cannot inherit the taskless transport sequence")
        assertTrue(published.path("yjsDocumentBase64").isNull, "new task cannot inherit a taskless CRDT document")
        Thread.sleep(1000)
        assertEquals("// new task", jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "delayed taskless save cannot overwrite a newly added task")
    }

    @Test
    fun tasklessFinishedPublicEditorPersistsCodeYjsAndLanguage() = verifyTasklessFinishedEditor(false)

    @Test
    fun tasklessFinishedTeamEditorPersistsCodeYjsAndLanguage() = verifyTasklessFinishedEditor(true)

    private fun verifyTasklessFinishedEditor(teamScope: Boolean) {
        val owner = account("fin-empty")
        val rooms = if (teamScope) {
            val team = team(owner, "Taskless editor")
            val teamRoom = createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Taskless TEAM", null, null, null)
            assertStatus(teamRoom, 201, "taskless TEAM room fixture")
            listOf(body(teamRoom).path("interview"))
        } else {
            val personal = mockMvc.post("/api/rooms") {
                authorize(owner); contentType = MediaType.APPLICATION_JSON
                content = """{"title":"Taskless personal public channel","taskIds":[]}"""
            }.andReturn()
            assertStatus(personal, 200, "taskless PUBLIC room fixture")
            listOf(body(personal))
        }
        for (room in rooms) {
            val inviteCode = room.path("inviteCode").asText()
            val roomId = room.path("id").asText()
            assertEquals(0L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_tasks WHERE room_id = ?", Long::class.java, roomId))
            fun connect(session: String): MvcResult = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
                authorize(owner); param("sessionId", session); param("displayName", "Taskless owner")
            }.andReturn().also { assertStatus(it, 200, "taskless editor connects") }
            var session = UUID.randomUUID().toString()
            var stream = connect(session)
            var token = realtimePayload(stream).path("eventToken").asText()
            fun event(type: String, fields: Map<String, Any?>): MvcResult = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("sessionId" to session, "eventToken" to token, "type" to type) + fields)
            }.andReturn()
            fun waitPersisted(code: String) {
                val deadline = System.nanoTime() + 3_000_000_000L
                while (jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId) != code && System.nanoTime() < deadline) Thread.sleep(25)
                assertEquals(code, jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "taskless accepted code survives debounce")
            }
            assertStatus(event("yjs_update", mapOf("operationId" to UUID.randomUUID().toString(), "yjsUpdate" to "AQID", "yjsDocumentBase64" to "AQID",
                "baseServerYjsSequence" to 0, "code" to "// accepted before finish")), 204, "taskless pre-finish snapshot accepted")
            assertStatus(mockMvc.post("/api/rooms/$inviteCode/verdict") {
                authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"verdict":"HIRE"}"""
            }.andReturn(), 200, "taskless interview finishes before debounce")
            assertEquals("// accepted before finish", jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "first finish snapshots already acknowledged taskless code")
            val finishedAt = jdbcTemplate.queryForMap("SELECT finished_at FROM rooms WHERE id = ?", roomId)["finished_at"]
            assertStatus(event("code_update", mapOf("code" to "// finished direct code")), 204, "finished taskless code_update accepted")
            assertEquals("// finished direct code", body(mockMvc.get("/api/rooms/$inviteCode") { authorize(owner) }.andReturn()).path("code").asText(), "taskless code_update persists immediately")
            for (language in listOf("python", "nodejs")) {
                assertStatus(event("language_update", mapOf("language" to language)), 204, "finished taskless language changes")
                assertEquals(language, body(mockMvc.get("/api/rooms/$inviteCode") { authorize(owner) }.andReturn()).path("language").asText())
            }
            assertStatus(event("yjs_update", mapOf("operationId" to UUID.randomUUID().toString(), "yjsUpdate" to "AQIDBA==", "yjsDocumentBase64" to "AQIDBA==",
                "baseServerYjsSequence" to realtimePayload(stream).path("lastYjsSequence").asLong(), "code" to "// finished Yjs code")), 204, "finished taskless Yjs accepted")
            waitPersisted("// finished Yjs code")
            collaborationService.closeRoom(inviteCode)
            session = UUID.randomUUID().toString()
            stream = connect(session)
            token = realtimePayload(stream).path("eventToken").asText()
            assertEquals("// finished Yjs code", realtimePayload(stream).path("code").asText(), "fresh taskless realtime hydration uses durable code")
            assertStatus(event("yjs_update", mapOf("operationId" to UUID.randomUUID().toString(), "yjsUpdate" to "", "yjsDocumentBase64" to "AQIDBAU=",
                "baseServerYjsSequence" to 0, "code" to "// finished snapshot-only code")), 204, "taskless bootstrap full snapshot accepted")
            waitPersisted("// finished snapshot-only code")
            val stored = jdbcTemplate.queryForMap("SELECT status, finished_at FROM rooms WHERE id = ?", roomId)
            assertEquals("finished", stored["status"])
            assertEquals(finishedAt, stored["finished_at"], "editing does not restart or re-finish the interview")
        }
    }

    @Test
    fun finishedRoomManagersKeepEditingWhileCandidateAndUnassignedHrCannotWrite() {
        val owner = account("fin-own")
        val interviewer = account("fin-int")
        val hr = HrHttpFixtures.register(mockMvc, objectMapper, true, "fin-hr").first
        val unassignedHr = HrHttpFixtures.register(mockMvc, objectMapper, true, "fin-otherhr").first
        val candidate = account("fin-cand")
        val team = team(owner, "Finished editing matrix")
        seedMembership(team.id, interviewer.id, "MEMBER")
        val first = body(createTeamTask(owner, team.id, "First", "Brief", "// starter", "nodejs")).path("task").path("id").asText()
        val second = body(createTeamTask(owner, team.id, "Second", "Brief", "// draft", "nodejs")).path("task").path("id").asText()
        val created = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Finished editing", null, null, null,
            taskIds = listOf(first, second), interviewerIds = listOf(interviewer.id))).path("interview")
        val roomId = created.path("id").asText()
        val inviteCode = created.path("inviteCode").asText()
        assertStatus(mockMvc.put("/api/rooms/$inviteCode/hr-managers/${hr.id}") { authorize(owner) }.andReturn(), 200, "external hiring manager is assigned to this interview")
        data class Tab(val session: String, val token: String, val stream: MvcResult)
        fun connect(actor: HrTestAccount): Tab {
            val session = UUID.randomUUID().toString()
            val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
                authorize(actor)
                param("sessionId", session)
                param("displayName", "Matrix participant")
            }.andReturn()
            assertStatus(stream, 200, "assigned participant connects")
            return Tab(session, realtimePayload(stream).path("eventToken").asText(), stream)
        }
        fun event(tab: Tab, type: String, fields: Map<String, Any?> = emptyMap()): MvcResult =
            mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("sessionId" to tab.session, "eventToken" to tab.token, "type" to type) + fields)
            }.andReturn()
        val managers = listOf(owner, interviewer, hr).map { it to connect(it) }
        val candidateTab = connect(candidate)
        val verdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(owner)
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE"}"""
        }.andReturn()
        assertStatus(verdict, 200, "owner finishes interview")
        val finishedAt = jdbcTemplate.queryForMap("SELECT finished_at FROM rooms WHERE id = ?", roomId)["finished_at"]
        for ((actor, tab) in managers) {
            val marker = actor.id.take(8)
            assertStatus(event(tab, "language_update", mapOf("language" to "python")), 204, "finished manager changes language")
            assertStatus(event(tab, "briefing_markdown_update", mapOf("briefingMarkdown" to "Brief $marker")), 204, "finished manager changes briefing")
            assertStatus(event(tab, "notes_update", mapOf("notes" to "Notes $marker")), 204, "finished manager changes notes")
            assertStatus(event(tab, "task_rating_update", mapOf("stepIndex" to 0, "rating" to 3)), 204, "finished manager rates task")
            assertStatus(event(tab, "private_note_entry", mapOf("privateNoteId" to UUID.randomUUID().toString(), "privateNoteText" to "Private $marker")), 204, "finished manager adds private note")
            assertStatus(event(tab, "note_message", mapOf("clientMessageId" to UUID.randomUUID().toString(), "noteText" to "Chat $marker")), 200, "finished manager sends acknowledged chat")
            assertStatus(event(tab, "set_step", mapOf("stepIndex" to 1)), 204, "finished manager publishes step")
            assertStatus(event(tab, "manager_workspace_open", mapOf("stepIndex" to 0)), 204, "finished manager opens inactive workspace")
            val workspaceSave = mockMvc.put("/api/rooms/$inviteCode/tasks/0/workspace") {
                authorize(actor)
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("code" to "// prepared $marker", "briefingMarkdown" to "Prepared $marker"))
            }.andReturn()
            assertStatus(workspaceSave, 200, "finished manager saves REST workspace")
            assertStatus(event(tab, "set_step", mapOf("stepIndex" to 0)), 204, "finished manager republishes step")
            assertStatus(event(tab, "code_update", mapOf("code" to "// direct $marker")), 204, "finished manager updates code")
            val currentSequence = realtimePayload(tab.stream).path("lastYjsSequence").asLong()
            assertStatus(event(tab, "yjs_update", mapOf("operationId" to UUID.randomUUID().toString(), "syncKey" to "$inviteCode:0:python",
                "yjsUpdate" to "AQID", "yjsDocumentBase64" to "AQID", "baseServerYjsSequence" to currentSequence,
                "code" to "// acknowledged $marker")), 204, "finished manager submits Yjs snapshot")
            val deadline = System.nanoTime() + 3_000_000_000L
            while (jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId) != "// acknowledged $marker" && System.nanoTime() < deadline) Thread.sleep(25)
            assertEquals("// acknowledged $marker", jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "finished acknowledged Yjs debounce persists")
            val reload = body(mockMvc.get("/api/rooms/$inviteCode") { authorize(actor) }.andReturn())
            assertEquals("finished", reload.path("status").asText())
            assertEquals("// acknowledged $marker", reload.path("code").asText())
            assertEquals(finishedAt, jdbcTemplate.queryForMap("SELECT finished_at FROM rooms WHERE id = ?", roomId)["finished_at"])
            assertStatus(mockMvc.patch("/api/rooms/$inviteCode/tasks/0") {
                authorize(actor); contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("title" to "Corrected $marker"))
            }.andReturn(), 200, "finished manager renames task")
            assertStatus(mockMvc.post("/api/rooms/$inviteCode/tasks") {
                authorize(actor); contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf("customTasks" to listOf(mapOf("title" to "Added $marker", "description" to "Brief", "starterCode" to "// added", "language" to "python"))))
            }.andReturn(), 200, "finished manager adds task")
            assertStatus(mockMvc.delete("/api/rooms/$inviteCode/tasks/2") { authorize(actor) }.andReturn(), 200, "finished manager removes optional task")
        }
        // Current team membership determines management even with a stored room row.
        jdbcTemplate.update("UPDATE team_memberships SET state = 'REMOVED' WHERE team_id = ? AND user_id = ?", team.id, interviewer.id)
        val deniedRevoked = event(managers[1].second, "code_update", mapOf("code" to "revoked manager must not write"))
        assertStatus(deniedRevoked, 403, "revoked manager's already connected token cannot edit finished code")
        assertEquals("ROOM_READ_ONLY", body(deniedRevoked).path("code").asText())
        val beforeDenied = jdbcTemplate.queryForMap("SELECT code, language, briefing_markdown, private_notes_json, interviewer_chat FROM rooms WHERE id = ?", roomId)
        val activityCountBeforeDenied = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_keystroke_events WHERE room_id = ?", Long::class.java, roomId)
        val deniedEvents = listOf(
            "code_update" to mapOf("code" to "forged candidate code"),
            "yjs_update" to mapOf("operationId" to UUID.randomUUID().toString(), "yjsUpdate" to "AQID", "yjsDocumentBase64" to "AQID", "code" to "forged candidate Yjs", "baseServerYjsSequence" to 999),
            "language_update" to mapOf("language" to "java"),
            "briefing_markdown_update" to mapOf("briefingMarkdown" to "forged brief"),
            "private_note_entry" to mapOf("privateNoteId" to UUID.randomUUID().toString(), "privateNoteText" to "forged private"),
            "note_message" to mapOf("clientMessageId" to UUID.randomUUID().toString(), "noteText" to "forged chat"),
            "set_step" to mapOf("stepIndex" to 1),
            "task_rating_update" to mapOf("stepIndex" to 0, "rating" to 1),
            "manager_workspace_open" to mapOf("stepIndex" to 1),
            "key_press" to mapOf("key" to "a", "keyCode" to "KeyA", "sourceEventId" to UUID.randomUUID().toString()),
        )
        deniedEvents.forEach { (type, fields) -> assertStatus(event(candidateTab, type, fields), 403, "finished candidate cannot send $type") }
        assertEquals(activityCountBeforeDenied, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM room_keystroke_events WHERE room_id = ?", Long::class.java, roomId), "readonly candidate cannot append durable typing activity")
        assertStatus(mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(candidate); contentType = MediaType.APPLICATION_JSON; content = """{"code":"forged REST"}"""
        }.andReturn(), 403, "candidate cannot use REST workspace")
        assertStatus(mockMvc.patch("/api/rooms/$inviteCode/tasks/0") {
            authorize(candidate); contentType = MediaType.APPLICATION_JSON; content = """{"title":"forged title"}"""
        }.andReturn(), 403, "candidate cannot rename task through REST")
        assertStatus(mockMvc.post("/api/rooms/$inviteCode/tasks") {
            authorize(candidate); contentType = MediaType.APPLICATION_JSON; content = """{"customTasks":[{"title":"forged task","description":"Brief","starterCode":""}]}"""
        }.andReturn(), 403, "candidate cannot add task through REST")
        assertStatus(mockMvc.delete("/api/rooms/$inviteCode/tasks/1") { authorize(candidate) }.andReturn(), 403, "candidate cannot remove task through REST")
        assertStatus(mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            authorize(unassignedHr); param("sessionId", UUID.randomUUID().toString()); param("displayName", "Unassigned HR")
        }.andReturn(), 200, "unassigned external HR can connect only as a candidate")
        assertStatus(mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(unassignedHr); contentType = MediaType.APPLICATION_JSON; content = """{"code":"forged HR"}"""
        }.andReturn(), 403, "global HR profile alone cannot mutate REST workspace")
        assertEquals(beforeDenied, jdbcTemplate.queryForMap("SELECT code, language, briefing_markdown, private_notes_json, interviewer_chat FROM rooms WHERE id = ?", roomId))
        jdbcTemplate.update("UPDATE rooms SET status = 'frozen' WHERE id = ?", roomId)
        assertStatus(mockMvc.post("/api/rooms/$inviteCode/next-step") { authorize(owner) }.andReturn(), 409, "frozen REST published step remains blocked")
        assertStatus(mockMvc.patch("/api/rooms/$inviteCode/tasks/0") {
            authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"title":"frozen title"}"""
        }.andReturn(), 409, "frozen REST rename remains blocked")
        assertStatus(mockMvc.post("/api/rooms/$inviteCode/tasks") {
            authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"customTasks":[{"title":"frozen task","description":"Brief","starterCode":""}]}"""
        }.andReturn(), 409, "frozen REST add remains blocked")
        assertStatus(mockMvc.delete("/api/rooms/$inviteCode/tasks/1") { authorize(owner) }.andReturn(), 409, "frozen REST delete remains blocked")
        assertStatus(event(managers.first().second, "language_update", mapOf("language" to "java")), 409, "frozen manager remains blocked")
        assertStatus(mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(owner); contentType = MediaType.APPLICATION_JSON; content = """{"code":"frozen REST"}"""
        }.andReturn(), 409, "frozen REST manager remains blocked")
        jdbcTemplate.update("UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", roomId)
        assertStatus(event(managers.first().second, "code_update", mapOf("code" to "archived write")), 410, "archived editor writes remain gone")
    }

    @Test
    fun `team members stay out of the external hiring manager panel regardless of profile flag`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, true, "team-hr-owner").first
        val interviewer = HrHttpFixtures.register(mockMvc, objectMapper, true, "team-hr-interviewer").first
        val ordinary = account("team-ordinary")
        val team = team(owner, "Team hiring panel")
        seedMembership(team.id, interviewer.id, "MEMBER")
        seedMembership(team.id, ordinary.id, "MEMBER")
        val interview = body(createTeamInterview(
            owner, team.id, UUID.randomUUID().toString(), "Team hiring room", null, null, null,
            interviewerIds = listOf(interviewer.id, ordinary.id),
        )).path("interview")
        val inviteCode = interview.path("inviteCode").asText()

        val response = mockMvc.get("/api/rooms/$inviteCode/hr-managers") { authorize(owner) }.andReturn()
        assertStatus(response, 200, "team owner reads the hiring managers in the room")
        val managers = body(response)
        assertEquals(0, managers.size(), "team members are not listed as separately assigned external hiring managers")

        val roleEnabled = mockMvc.patch("/api/me/profile") {
            authorize(ordinary)
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"New hiring interviewer","isHr":true}"""
        }.andReturn()
        assertStatus(roleEnabled, 200, "interviewer enables the hiring role after room creation")
        val afterRoleChange = body(mockMvc.get("/api/rooms/$inviteCode/hr-managers") { authorize(owner) }.andReturn())
        assertEquals(0, afterRoleChange.size(), "changing the profile flag does not create an external hiring assignment")

        assertStatus(suspendMember(owner, team.id, interviewer.id, UUID.randomUUID().toString()), 200, "fixture revokes interviewer membership")
        val afterRevoke = body(mockMvc.get("/api/rooms/$inviteCode/hr-managers") { authorize(owner) }.andReturn())
        assertEquals(0, afterRevoke.size())
    }

    @Test
    fun `room owner and team manager can rename a team interview without changing its identity`() {
        val manager = account("rename-manager")
        val creator = account("rename-creator")
        val colleague = account("rename-colleague")
        val outside = account("rename-outside")
        val team = team(manager, "Rename interview")
        seedMembership(team.id, creator.id, "MEMBER")
        seedMembership(team.id, colleague.id, "MEMBER")
        val created = body(createTeamInterview(creator, team.id, UUID.randomUUID().toString(), "Original title", null, null, null)).path("interview")
        val interviewId = created.path("id").asText()

        val forbidden = mockMvc.patch("/api/teams/${team.id}/interviews/$interviewId") {
            authorize(colleague)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Unwanted title"}"""
        }.andReturn()
        assertStatus(forbidden, 200, "all active team members may rename an interview")

        val concealed = mockMvc.patch("/api/teams/${team.id}/interviews/$interviewId") {
            authorize(outside)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Unwanted title"}"""
        }.andReturn()
        assertStatusAndCode(concealed, 404, "TEAM_NOT_FOUND")

        val invalid = mockMvc.patch("/api/teams/${team.id}/interviews/$interviewId") {
            authorize(creator)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"   "}"""
        }.andReturn()
        assertStatusAndCode(invalid, 400, "INVALID_TEAM_INTERVIEW_TITLE")

        val renamed = mockMvc.patch("/api/teams/${team.id}/interviews/$interviewId") {
            authorize(creator)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"  Technical interview  "}"""
        }.andReturn()
        assertStatus(renamed, 200, "current room owner renames the interview")
        assertEquals("Technical interview", body(renamed).path("interview").path("title").asText())
        assertEquals(created.path("inviteCode").asText(), body(renamed).path("interview").path("inviteCode").asText())

        val managerRename = mockMvc.patch("/api/teams/${team.id}/interviews/$interviewId") {
            authorize(manager)
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Final interview"}"""
        }.andReturn()
        assertStatus(managerRename, 200, "team manager renames a member-owned interview")
        val listed = body(listTeamInterviews(colleague, team.id)).path("items")
            .single { it.path("id").asText() == interviewId }
        assertEquals("Final interview", listed.path("title").asText())
        assertEquals(creator.id, listed.path("createdByUserId").asText())
        assertEquals(creator.id, listed.path("ownerUserId").asText())
    }

    @Test
    fun `team manager can permanently delete an interview after confirmation on the client`() {
        val owner = account("del-int")
        val member = account("del-member")
        val outsider = account("del-outsider")
        val team = team(owner, "Delete interview")
        seedMembership(team.id, member.id, "MEMBER")
        val created = body(createTeamInterview(owner, team.id, UUID.randomUUID().toString(), "Disposable interview", null, null, null)).path("interview")
        val interviewId = created.path("id").asText()
        assertStatusAndCode(mockMvc.delete("/api/teams/${team.id}/interviews/$interviewId") {
            header("Authorization", "Bearer ${outsider.token}")
        }.andReturn(), 404, "TEAM_NOT_FOUND")
        val result = mockMvc.delete("/api/teams/${team.id}/interviews/$interviewId") {
            header("Authorization", "Bearer ${member.token}")
        }.andReturn()
        assertStatus(result, 204, "any active member deletes an interview")
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE id = ?", Int::class.java, interviewId))
    }
    companion object {
        private val postgres = Postgres16TestSupport.create("team_interviews")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun acknowledgedPublishedSnapshotIsDurableWhenVerdictPrecedesDebounce() {
        val owner = account("final-ack-owner")
        val peer = account("final-ack-peer")
        val team = team(owner, "Accepted snapshot finalization")
        val task = body(createTeamTask(owner, team.id, "Accepted code", "Brief", "// starter", "nodejs")).path("task")
        val interview = body(createTeamInterview(
            owner, team.id, UUID.randomUUID().toString(), "Finalize accepted snapshot", null, null, null,
            taskIds = listOf(task.path("id").asText()),
            candidateIds = emptyList(),
        )).path("interview")
        val inviteCode = interview.path("inviteCode").asText()
        val roomId = interview.path("id").asText()
        val sessionId = "finalize-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", sessionId)
            param("displayName", "Finalizing owner")
            authorize(owner)
        }.andReturn()
        assertStatus(stream, 200, "owner connects before finalization")
        val peerSessionId = "finalize-peer-${UUID.randomUUID()}"
        val peerStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", peerSessionId)
            param("displayName", "Concurrent candidate")
            authorize(peer)
        }.andReturn()
        assertStatus(peerStream, 200, "peer connects before the accepted snapshot")
        val peerEventToken = realtimePayload(peerStream).path("eventToken").asText()
        val eventToken = realtimePayload(stream).path("eventToken").asText()
        val acceptedCode = "const acknowledged = 42;"
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "sessionId" to sessionId, "eventToken" to eventToken,
                "clientEventSequence" to 1, "operationId" to UUID.randomUUID().toString(),
                "type" to "yjs_update", "syncKey" to "$inviteCode:0:nodejs",
                "yjsUpdate" to "AQID", "yjsDocumentBase64" to "AQID",
                "yjsClientSequence" to 1, "baseServerYjsSequence" to 0,
                "code" to acceptedCode,
            ))
        }.andReturn(), 204, "published code and snapshot are acknowledged")
        assertEquals("// starter", jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "fixture finishes inside the pending debounce window")
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "sessionId" to peerSessionId, "eventToken" to peerEventToken,
                "clientEventSequence" to 1, "operationId" to UUID.randomUUID().toString(),
                "type" to "yjs_update", "syncKey" to "$inviteCode:0:nodejs",
                "yjsUpdate" to "AQIDBA==", "yjsDocumentBase64" to "AQIDBA==",
                "yjsClientSequence" to 1, "baseServerYjsSequence" to 0,
                "code" to "stale peer snapshot must not replace accepted code",
            ))
        }.andReturn(), 204, "peer delta is relayed while its stale full snapshot is rejected")
        fun verdict(value: String) = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(owner)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to value, "verdictComment" to "Finalized accepted code"))
        }.andReturn()
        assertStatus(verdict("HIRE"), 200, "verdict commits before debounce")
        assertEquals(acceptedCode, jdbcTemplate.queryForObject("SELECT code FROM rooms WHERE id = ?", String::class.java, roomId), "ACKed code survives immediate finalization")
        val storedTask = jdbcTemplate.queryForMap("SELECT solution_code, workspace_yjs_document_base64, workspace_yjs_sequence FROM room_tasks WHERE room_id = ? AND step_index = 0", roomId)
        assertEquals(acceptedCode, storedTask["solution_code"])
        assertEquals("AQID", storedTask["workspace_yjs_document_base64"])
        assertEquals(1L, storedTask["workspace_yjs_sequence"])
        assertStatus(verdict("NO_HIRE"), 200, "finished verdict can still be corrected")
        assertEquals(storedTask, jdbcTemplate.queryForMap("SELECT solution_code, workspace_yjs_document_base64, workspace_yjs_sequence FROM room_tasks WHERE room_id = ? AND step_index = 0", roomId), "verdict correction does not change the historical editor snapshot")
    }

    @Test
    fun emptyRoomLanguagePersistsWithoutTasks() {
        val owner = account("ui2lang-o")
        val candidate = account("ui2lang-c")
        val team = team(owner, "Empty language team")
        val created = createTeamInterview(
            owner, team.id, UUID.randomUUID().toString(), "Empty language room", null, null, null,
            interviewerIds = listOf(owner.id), candidateIds = emptyList(),
        )
        assertStatus(created, 201, "empty room fixture")
        val interview = body(created).path("interview")
        val inviteCode = interview.path("inviteCode").asText()
        val roomId = interview.path("id").asText()
        fun event(actor: HrTestAccount, value: String): MvcResult {
            val sessionId = "empty-language-${UUID.randomUUID()}"
            val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
                param("sessionId", sessionId)
                param("displayName", "Language check")
                authorize(actor)
            }.andReturn()
            assertStatus(stream, 200, "language stream")
            val token = realtimePayload(stream).path("eventToken").asText()
            return mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(mapOf(
                    "sessionId" to sessionId, "eventToken" to token,
                    "type" to "language_update", "language" to value,
                ))
            }.andReturn()
        }
        for (language in listOf("python", "java", "plaintext", "nodejs")) {
            assertStatus(event(owner, language), 204, "owner changes empty room language")
            assertEquals(language, body(mockMvc.get("/api/rooms/$inviteCode") { authorize(owner) }.andReturn()).path("language").asText())
            assertEquals(language, jdbcTemplate.queryForObject("SELECT language FROM rooms WHERE id = ?", String::class.java, roomId))
        }
        assertStatus(event(candidate, "python"), 403, "candidate cannot change language")
        assertEquals("nodejs", body(mockMvc.get("/api/rooms/$inviteCode") { authorize(owner) }.andReturn()).path("language").asText())
    }

    @Test
    fun `team interview can start empty or from individual tasks without a set and creator is owner`() {
        postgres.verifyPostgres16()
        val creator = account("ti-free-creator")
        val team = team(creator, "Flexible interview")
        val empty = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Empty interview",
            taskSetId = null,
            trackId = null,
            vacancyId = null,
        )
        assertStatus(empty, 201, "interview without tasks or a set")
        val emptyInterview = body(empty).path("interview")
        assertTrue(emptyInterview.path("taskSetId").isNull)
        assertTrue(emptyInterview.path("taskSetRevision").isNull)
        assertEquals(0, emptyInterview.path("tasks").size())
        assertEquals("owner", emptyInterview.path("assignees")[0].path("role").asText())
        assertStatus(mockMvc.get("/api/rooms/${emptyInterview.path("inviteCode").asText()}") { authorize(creator) }.andReturn(), 200, "creator enters empty room")

        val task = body(createTeamTask(creator, team.id, "Individual task", "Brief", "// code", "kotlin")).path("task")
        val individual = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Individual interview",
            taskSetId = null,
            trackId = null,
            vacancyId = null,
            taskIds = listOf(task.path("id").asText()),
        )
        assertStatus(individual, 201, "individual task without set")
        val individualInterview = body(individual).path("interview")
        assertEquals(listOf("Individual task"), individualInterview.path("tasks").map { it.path("title").asText() })
        assertTrue(individualInterview.path("taskSetId").isNull)
        assertEquals("kotlin", individualInterview.path("tasks")[0].path("language").asText())
    }

    @Test
    fun `candidate opens team interview from its room link without team membership`() {
        postgres.verifyPostgres16()
        val creator = account("ti-link-owner")
        val team = team(creator, "Candidate link room")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Candidate link interview",
            taskSetId = null,
            trackId = null,
            vacancyId = null,
        )
        assertStatus(created, 201, "room for candidate link")
        val roomId = body(created).path("interview").path("id").asText()
        assertEquals(
            true,
            jdbcTemplate.queryForObject("SELECT team_interview_created FROM rooms WHERE id = ?", Boolean::class.java, roomId),
            "an empty team interview must carry durable creation provenance",
        )
        val inviteCode = body(created).path("interview").path("inviteCode").asText()
        val guestRoom = mockMvc.get("/api/rooms/$inviteCode").andReturn()
        assertStatus(guestRoom, 200, "guest opens candidate link")
        assertEquals("candidate", body(guestRoom).path("role").asText())
        assertEquals(false, body(guestRoom).path("canManageRoom").asBoolean())
        assertEquals(0, body(guestRoom).path("accessMembers").size())
        assertStatus(mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status").andReturn(), 204, "guest candidate joins realtime")
    }

    @Test
    fun `active member creates a team interview from active catalog context with task snapshots and idempotent replay`() {
        postgres.verifyPostgres16()
        val owner = account("ti-owner")
        val member = account("ti-member")
        val team = team(owner, "Interview creation")
        seedMembership(team.id, member.id, role = "MEMBER")

        val graphTask = body(createTeamTask(owner, team.id, "Graph warmup", "Graph brief", "// graph", "kotlin")).path("task")
        val queueTask = body(createTeamTask(owner, team.id, "Queue deep dive", "Queue brief", "// queue", "nodejs")).path("task")
        val graphTaskId = graphTask.path("id").asText()
        val queueTaskId = queueTask.path("id").asText()
        val taskSet = body(createTaskSet(owner, team.id, "Backend interview", listOf(queueTaskId, graphTaskId))).path("taskSet")
        val taskSetId = taskSet.path("id").asText()
        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, trackId, "Kotlin engineer")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()

        val key = UUID.randomUUID().toString()
        val created = createTeamInterview(
            actor = member,
            teamId = team.id,
            key = key,
            title = " Backend pair interview ",
            taskSetId = taskSetId,
            trackId = trackId,
            vacancyId = vacancyId,
        )
        assertStatus(created, 201, "active member creates a team-scoped interview")
        assertProtectedNoStore(created)
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        assertEquals("Backend pair interview", interview.path("title").asText())
        assertEquals(team.id, interview.path("teamId").asText())
        assertEquals(trackId, interview.path("trackId").asText())
        assertEquals(vacancyId, interview.path("vacancyId").asText())
        assertEquals(taskSetId, interview.path("taskSetId").asText())
        assertEquals(0, interview.path("taskSetRevision").asLong())
        assertEquals(listOf("Queue deep dive", "Graph warmup"), interview.path("tasks").map { it.path("title").asText() })
        assertEquals(listOf(queueTaskId, graphTaskId), interview.path("tasks").map { it.path("sourceTaskTemplateId").asText() })
        assertEquals(listOf("nodejs", "kotlin"), interview.path("tasks").map { it.path("language").asText() })
        assertEquals("/api/teams/${team.id}/interviews/$roomId", created.response.getHeader("Location"))

        val row = jdbcTemplate.queryForMap("SELECT team_id, origin_team_id, team_track_id, team_vacancy_id, team_task_set_id, team_task_set_revision, owner_user_id, language, code FROM rooms WHERE id = ?", roomId)
        assertEquals(team.id, row["team_id"])
        assertEquals(team.id, row["origin_team_id"])
        assertEquals(trackId, row["team_track_id"])
        assertEquals(vacancyId, row["team_vacancy_id"])
        assertEquals(taskSetId, row["team_task_set_id"])
        assertEquals(0L, (row["team_task_set_revision"] as Number).toLong())
        assertEquals(member.id, row["owner_user_id"])
        assertEquals("nodejs", row["language"])
        assertEquals("// queue", row["code"])

        updateTeamTask(owner, team.id, queueTaskId, "Queue mutated", "Changed brief", "// changed", "python", revision = 0)
            .also { assertStatus(it, 200, "team task fixture mutation succeeds") }
        val snapshotRows = jdbcTemplate.query(
            "SELECT step_index, title, description, starter_code, language, source_task_template_id FROM room_tasks WHERE room_id = ? ORDER BY step_index",
            { rs, _ ->
                listOf(
                    rs.getInt("step_index"),
                    rs.getString("title"),
                    rs.getString("description"),
                    rs.getString("starter_code"),
                    rs.getString("language"),
                    rs.getString("source_task_template_id"),
                )
            },
            roomId,
        )
        assertEquals(
            listOf(
                listOf(0, "Queue deep dive", "Queue brief", "// queue", "nodejs", queueTaskId),
                listOf(1, "Graph warmup", "Graph brief", "// graph", "kotlin", graphTaskId),
            ),
            snapshotRows,
            "team interview must keep task snapshots even after library changes",
        )

        val replay = createTeamInterview(member, team.id, key, "Backend pair interview", taskSetId, trackId, vacancyId)
        assertStatus(replay, 201, "idempotent replay returns the same team interview")
        assertEquals(roomId, body(replay).path("interview").path("id").asText())
        assertEquals(1L, countRoomsForTeam(team.id), "idempotent replay must not create a duplicate room")

        val reusedForDifferentBody = createTeamInterview(member, team.id, key, "Different interview", taskSetId, trackId, vacancyId)
        assertStatusAndCode(reusedForDifferentBody, 409, "IDEMPOTENCY_KEY_REUSED")

        val legacyRoomRead = mockMvc.get("/api/rooms/${interview.path("inviteCode").asText()}") {
            authorize(member)
        }.andReturn()
        assertStatus(legacyRoomRead, 200, "team interview creator can open the room as owner")
        assertEquals("owner", body(legacyRoomRead).path("role").asText())
        assertEquals(team.id, body(legacyRoomRead).path("teamId").asText())
        assertTrue(body(legacyRoomRead).path("ownerToken").isNull)
    }

    @Test
    fun `team interview pins resolved programme version and prepends mandatory foundation before extra tasks`() {
        postgres.verifyPostgres16()
        val owner = account("ti-prog-owner")
        val creator = account("ti-prog-creator")
        val team = team(owner, "Programme foundation interview")
        seedMembership(team.id, creator.id, role = "MEMBER")

        val foundationTask = body(createTeamTask(owner, team.id, "Foundation systems", "Foundation brief", "// foundation", "kotlin")).path("task")
        val duplicateFoundationTask = foundationTask.path("id").asText()
        val extraTask = body(createTeamTask(owner, team.id, "Extra architecture", "Extra brief", "// extra", "nodejs")).path("task")
        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, trackId, "Kotlin engineer")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()
        val taskSet = body(createTaskSet(owner, team.id, "Extras", listOf(duplicateFoundationTask, extraTask.path("id").asText()))).path("taskSet")

        assertStatus(
            saveVacancyProgrammeDraft(owner, team.id, trackId, vacancyId, listOf(foundationTask.path("id").asText()), revision = null),
            200,
            "vacancy programme draft fixture must save",
        )
        val published = publishVacancyProgramme(owner, team.id, trackId, vacancyId, revision = 0)
        assertStatus(published, 200, "vacancy programme fixture must publish")
        val programme = body(published).path("programme")

        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Interview with mandatory foundation",
            taskSetId = taskSet.path("id").asText(),
            trackId = trackId,
            vacancyId = vacancyId,
            expectedProgrammeId = programme.path("id").asText(),
            expectedProgrammeVersion = 1,
        )
        assertStatus(created, 201, "team interview applies the resolved vacancy programme")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        assertEquals(programme.path("id").asText(), interview.path("programmeId").asText())
        assertEquals("VACANCY", interview.path("programmeOrigin").asText())
        assertEquals(1, interview.path("programmeVersion").asLong())
        assertEquals(
            listOf("Foundation systems", "Extra architecture"),
            interview.path("tasks").map { it.path("title").asText() },
            "mandatory programme task must be the foundation and duplicate extras must be skipped",
        )
        assertEquals(
            listOf(true, false),
            interview.path("tasks").map { it.path("mandatory").asBoolean() },
            "create response must mark programme foundation separately from extra task-set tasks",
        )

        val customized = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Interview with a custom task selection",
            taskSetId = taskSet.path("id").asText(),
            trackId = trackId,
            vacancyId = vacancyId,
            expectedProgrammeId = programme.path("id").asText(),
            expectedProgrammeVersion = 1,
            selectedTaskIds = listOf(extraTask.path("id").asText()),
        )
        assertStatus(customized, 201, "explicit task selection can omit context defaults for one interview")
        val customizedInterview = body(customized).path("interview")
        assertEquals(taskSet.path("id").asText(), customizedInterview.path("taskSetId").asText())
        assertEquals(programme.path("id").asText(), customizedInterview.path("programmeId").asText())
        assertEquals(listOf("Extra architecture"), customizedInterview.path("tasks").map { it.path("title").asText() })
        assertEquals(listOf(false), customizedInterview.path("tasks").map { it.path("mandatory").asBoolean() })

        val roomRow = jdbcTemplate.queryForMap(
            "SELECT team_interview_programme_id, team_interview_programme_origin, team_interview_programme_version FROM rooms WHERE id = ?",
            roomId,
        )
        assertEquals(programme.path("id").asText(), roomRow["team_interview_programme_id"])
        assertEquals("VACANCY", roomRow["team_interview_programme_origin"])
        assertEquals(1L, (roomRow["team_interview_programme_version"] as Number).toLong())
        val taskRows = jdbcTemplate.query(
            "SELECT step_index, title, source_task_template_id, mandatory FROM room_tasks WHERE room_id = ? ORDER BY step_index",
            { rs, _ ->
                listOf(
                    rs.getInt("step_index"),
                    rs.getString("title"),
                    rs.getString("source_task_template_id"),
                    rs.getBoolean("mandatory"),
                )
            },
            roomId,
        )
        assertEquals(
            listOf(
                listOf(0, "Foundation systems", foundationTask.path("id").asText(), true),
                listOf(1, "Extra architecture", extraTask.path("id").asText(), false),
            ),
            taskRows,
            "room task snapshots must preserve mandatory foundation before editable extras",
        )

        assertStatus(
            saveVacancyProgrammeDraft(owner, team.id, trackId, vacancyId, listOf(extraTask.path("id").asText()), revision = 1),
            200,
            "programme can change after interview creation",
        )
        assertStatus(publishVacancyProgramme(owner, team.id, trackId, vacancyId, revision = 2), 200, "programme v2 fixture publishes")
        val roomCountBeforeStaleCreate = countRoomsForTeam(team.id)
        val stale = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Interview from stale programme preview",
            taskSetId = taskSet.path("id").asText(),
            trackId = trackId,
            vacancyId = vacancyId,
            expectedProgrammeId = programme.path("id").asText(),
            expectedProgrammeVersion = 1,
        )
        assertStatusAndCode(stale, 409, "TEAM_PROGRAMME_VERSION_CONFLICT")
        assertEquals(roomCountBeforeStaleCreate, countRoomsForTeam(team.id), "stale programme preview must not create a partial room")
        val replay = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Interview after programme mutation",
            taskSetId = taskSet.path("id").asText(),
            trackId = trackId,
            vacancyId = vacancyId,
            expectedProgrammeId = programme.path("id").asText(),
            expectedProgrammeVersion = 2,
        )
        assertStatus(replay, 201, "new interview uses the current programme version while old one stays pinned")
        assertEquals(2, body(replay).path("interview").path("programmeVersion").asLong())
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT team_interview_programme_version FROM rooms WHERE id = ?",
                Long::class.java,
                roomId,
            ),
            "existing interview must keep the originally pinned programme version",
        )
    }

    @Test
    fun `programme mandatory tasks stay visible and cannot be changed through room task endpoints`() {
        postgres.verifyPostgres16()
        val owner = account("ti-mand-owner")
        val creator = account("ti-mand-maker")
        val interviewer = account("ti-mand-int")
        val candidate = account("ti-mand-candidate")
        val team = team(owner, "Mandatory programme room")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val foundationTask = body(createTeamTask(owner, team.id, "Foundation systems", "Foundation brief", "// foundation", "kotlin")).path("task")
        val guardrailTask = body(createTeamTask(owner, team.id, "Guardrail review", "Guardrail brief", "// guardrail", "nodejs")).path("task")
        val extraTask = body(createTeamTask(owner, team.id, "Editable extra", "Extra brief", "// extra", "python")).path("task")
        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, trackId, "Platform engineer")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()
        val taskSet = body(createTaskSet(owner, team.id, "Extras", listOf(extraTask.path("id").asText()))).path("taskSet")

        assertStatus(
            saveVacancyProgrammeDraft(
                owner,
                team.id,
                trackId,
                vacancyId,
                listOf(foundationTask.path("id").asText(), guardrailTask.path("id").asText()),
                revision = null,
            ),
            200,
            "mandatory programme draft fixture must save",
        )
        val published = publishVacancyProgramme(owner, team.id, trackId, vacancyId, revision = 0)
        assertStatus(published, 200, "mandatory programme fixture must publish")

        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Room with mandatory foundation",
            taskSetId = taskSet.path("id").asText(),
            trackId = trackId,
            vacancyId = vacancyId,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
            expectedProgrammeId = body(published).path("programme").path("id").asText(),
            expectedProgrammeVersion = 1,
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val inviteCode = body(created).path("interview").path("inviteCode").asText()

        val room = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(room, 200, "assigned interviewer can open the room")
        assertEquals(
            listOf("Foundation systems", "Guardrail review", "Editable extra"),
            body(room).path("tasks").map { it.path("title").asText() },
        )
        assertEquals(
            listOf(true, true, false),
            body(room).path("tasks").map { it.path("mandatory").asBoolean() },
            "room response must keep mandatory foundation visible to clients",
        )

        val sessionId = "mandatory-manager-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", sessionId)
            param("displayName", "Programme interviewer")
            authorize(interviewer)
        }.andReturn()
        assertStatus(stream, 200, "assigned interviewer opens the programme room")
        val eventToken = realtimePayload(stream).path("eventToken").asText()
        for ((eventType, field, value) in listOf(
            Triple("language_update", "language", "python"),
            Triple("briefing_markdown_update", "briefingMarkdown", "Changed foundation briefing"),
        )) {
            val structuralEdit = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(
                    mapOf("sessionId" to sessionId, "eventToken" to eventToken, "type" to eventType, field to value),
                )
            }.andReturn()
            assertStatusAndCode(structuralEdit, 409, "ROOM_MANDATORY_TASK_LOCKED")
        }
        val unchanged = mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn()
        assertEquals("kotlin", body(unchanged).path("language").asText())
        assertEquals("Foundation brief", body(unchanged).path("briefingMarkdown").asText())

        val candidateSessionId = "mandatory-candidate-${UUID.randomUUID()}"
        val candidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", candidateSessionId)
            param("displayName", "Programme candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateStream, 200, "assigned candidate can join a mandatory programme room")
        val candidateCode = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to realtimePayload(candidateStream).path("eventToken").asText(),
                    "type" to "code_update",
                    "code" to "// candidate solution",
                    "codeSequence" to 1,
                ),
            )
        }.andReturn()
        assertStatus(candidateCode, 204, "candidate solution remains editable on the mandatory task")
        val solvedRoom = mockMvc.get("/api/rooms/$inviteCode") { authorize(candidate) }.andReturn()
        assertEquals("// candidate solution", body(solvedRoom).path("code").asText())

        val renamedFoundation = mockMvc.patch("/api/rooms/$inviteCode/tasks/0") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Changed foundation"))
        }.andReturn()
        assertStatusAndCode(renamedFoundation, 409, "ROOM_MANDATORY_TASK_LOCKED")

        val deletedFoundation = mockMvc.delete("/api/rooms/$inviteCode/tasks/0") {
            authorize(interviewer)
        }.andReturn()
        assertStatusAndCode(deletedFoundation, 409, "ROOM_MANDATORY_TASK_LOCKED")

        val changedGuardrailWorkspace = mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("briefingMarkdown" to "Changed guardrail", "revision" to 0))
        }.andReturn()
        assertStatusAndCode(changedGuardrailWorkspace, 409, "ROOM_MANDATORY_TASK_LOCKED")

        val renamedExtra = mockMvc.patch("/api/rooms/$inviteCode/tasks/2") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Editable extra renamed"))
        }.andReturn()
        assertStatus(renamedExtra, 200, "extra task remains editable")
        assertEquals("Editable extra renamed", body(renamedExtra).path("tasks")[2].path("title").asText())
        assertEquals(false, body(renamedExtra).path("tasks")[2].path("mandatory").asBoolean())

        val deletedExtra = mockMvc.delete("/api/rooms/$inviteCode/tasks/2") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(deletedExtra, 200, "extra task remains removable")
        assertEquals(
            listOf("Foundation systems", "Guardrail review"),
            body(deletedExtra).path("tasks").map { it.path("title").asText() },
        )
        assertEquals(
            listOf(true, true),
            body(deletedExtra).path("tasks").map { it.path("mandatory").asBoolean() },
        )
    }

    @Test
    fun `active member lists team interviews without leaking other team rooms`() {
        postgres.verifyPostgres16()
        val owner = account("ti-list-owner")
        val member = account("ti-list-member")
        val outsider = account("ti-list-out")
        val team = team(owner, "Interview list")
        val otherTeam = team(outsider, "Other interviews")
        seedMembership(team.id, member.id, role = "MEMBER")

        val graphTask = body(createTeamTask(owner, team.id, "Graph warmup", "Graph brief", "// graph", "kotlin")).path("task")
        val queueTask = body(createTeamTask(owner, team.id, "Queue deep dive", "Queue brief", "// queue", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Backend interview", listOf(queueTask.path("id").asText(), graphTask.path("id").asText()))).path("taskSet")
        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val vacancy = body(createVacancy(owner, team.id, track.path("id").asText(), "Kotlin engineer")).path("vacancy")

        val screen = body(createTeamInterview(
            actor = member,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Backend screen",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val onsite = body(createTeamInterview(
            actor = member,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Platform onsite",
            taskSetId = taskSet.path("id").asText(),
            trackId = track.path("id").asText(),
            vacancyId = vacancy.path("id").asText(),
            interviewerIds = listOf(member.id),
        )).path("interview")

        val foreignTask = body(createTeamTask(outsider, otherTeam.id, "Foreign task", "Hidden", "// hidden", "nodejs")).path("task")
        val foreignSet = body(createTaskSet(outsider, otherTeam.id, "Foreign set", listOf(foreignTask.path("id").asText()))).path("taskSet")
        val foreignInterview = body(createTeamInterview(
            actor = outsider,
            teamId = otherTeam.id,
            key = UUID.randomUUID().toString(),
            title = "Foreign interview",
            taskSetId = foreignSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")

        jdbcTemplate.update("UPDATE rooms SET created_at = TIMESTAMP '2026-01-01 10:00:00' WHERE id = ?", screen.path("id").asText())
        jdbcTemplate.update("UPDATE rooms SET created_at = TIMESTAMP '2026-01-01 11:00:00' WHERE id = ?", onsite.path("id").asText())
        jdbcTemplate.update("UPDATE room_tasks SET score = 4 WHERE room_id = ? AND step_index = 0", onsite.path("id").asText())

        val verdict = mockMvc.post("/api/rooms/${onsite.path("inviteCode").asText()}/verdict") {
            authorize(member)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "Strong team fit"))
        }.andReturn()
        assertStatus(verdict, 200, "assigned interviewer can finish team interview before it appears in history")
        val finishedAt = body(verdict).path("finishedAt").asText()

        val listed = mockMvc.get("/api/teams/${team.id}/interviews") {
            authorize(member)
        }.andReturn()

        assertStatus(listed, 200, "active member lists team-scoped interviews")
        assertProtectedNoStore(listed)
        val items = body(listed).path("items")
        assertEquals(listOf("Platform onsite", "Backend screen"), items.map { it.path("title").asText() })
        assertEquals(listOf(onsite.path("id").asText(), screen.path("id").asText()), items.map { it.path("id").asText() })
        assertEquals(listOf(onsite.path("inviteCode").asText(), screen.path("inviteCode").asText()), items.map { it.path("inviteCode").asText() })
        assertFalse(items.any { it.path("id").asText() == foreignInterview.path("id").asText() }, "team interview list must not leak another team")
        assertEquals(team.id, items[0].path("teamId").asText())
        assertEquals(track.path("id").asText(), items[0].path("trackId").asText())
        assertEquals("Backend", items[0].path("trackName").asText())
        assertEquals(vacancy.path("id").asText(), items[0].path("vacancyId").asText())
        assertEquals("Kotlin engineer", items[0].path("vacancyTitle").asText())
        assertEquals(taskSet.path("id").asText(), items[0].path("taskSetId").asText())
        assertEquals(0, items[0].path("taskSetRevision").asLong())
        assertEquals(2, items[0].path("taskCount").asInt())
        assertEquals("finished", items[0].path("status").asText())
        assertEquals("HIRE", items[0].path("verdict").asText())
        assertEquals("Strong team fit", items[0].path("verdictComment").asText())
        assertEquals(finishedAt, items[0].path("finishedAt").asText())
        assertEquals(
            listOf(4, null),
            items[0].path("taskScores").map { if (it.path("score").isNull) null else it.path("score").asInt() },
            "missing task score must remain null in result history instead of becoming zero",
        )
        assertEquals(listOf("Queue deep dive", "Graph warmup"), items[0].path("tasks").map { it.path("title").asText() })
        assertEquals(listOf("nodejs", "kotlin"), items[0].path("tasks").map { it.path("language").asText() })

        val filtered = mockMvc.get("/api/teams/${team.id}/interviews") {
            authorize(member)
            param("q", "screen")
        }.andReturn()
        assertStatus(filtered, 200, "team interview search filters by visible title")
        assertEquals(listOf("Backend screen"), body(filtered).path("items").map { it.path("title").asText() })
    }

    @Test
    fun `P51 process views and colleague labels derive only from active interview grants`() {
        val owner = account("process-owner")
        val assigned = account("process-assigned")
        val unassigned = account("process-unassigned")
        val team = team(owner, "Process projections")
        seedMembership(team.id, assigned.id, role = "MEMBER")
        seedMembership(team.id, unassigned.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Process task", "Brief", "// process", "kotlin")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Process set", listOf(task.path("id").asText()))).path("taskSet")
        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, trackId, "Kotlin engineer")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()
        val visible = body(createTeamInterview(
            actor = owner, teamId = team.id, key = UUID.randomUUID().toString(),
            title = "My process interview", taskSetId = taskSet.path("id").asText(),
            trackId = trackId, vacancyId = vacancyId, interviewerIds = listOf(assigned.id),
        )).path("interview")
        val secondInterview = body(createTeamInterview(
            actor = owner, teamId = team.id, key = UUID.randomUUID().toString(),
            title = "Private process interview", taskSetId = taskSet.path("id").asText(),
            trackId = trackId, vacancyId = vacancyId, interviewerIds = listOf(unassigned.id),
        )).path("interview")

        val ownProcesses = mockMvc.get("/api/teams/${team.id}/processes") { authorize(assigned) }.andReturn()
        assertStatus(ownProcesses, 200, "assigned member sees one process")
        val process = body(ownProcesses).path("items")
        assertEquals(1, process.size())
        assertEquals(trackId, process[0].path("trackId").asText())
        assertEquals(vacancyId, process[0].path("vacancyId").asText())
        assertFalse(body(ownProcesses).toString().contains("interview"), "process projection must not expose room data")

        val ownInterviews = mockMvc.get("/api/teams/${team.id}/processes/interviews") {
            authorize(assigned)
            param("trackId", trackId)
            param("vacancyId", vacancyId)
        }.andReturn()
        assertStatus(ownInterviews, 200, "assigned member opens own process interviews")
        assertEquals(setOf(visible.path("id").asText(), secondInterview.path("id").asText()), body(ownInterviews).path("items").map { it.path("id").asText() }.toSet())

        val directory = mockMvc.get("/api/teams/${team.id}/members") { authorize(owner) }.andReturn()
        assertStatus(directory, 200, "colleague process labels are available in the directory")
        val assignedItem = body(directory).path("items").first { it.path("userId").asText() == assigned.id }
        assertEquals(listOf("Backend"), assignedItem.path("processes").map { it.path("trackName").asText() })
        assertFalse(assignedItem.toString().contains("interview"))
        assertFalse(assignedItem.toString().contains("candidate"))
        assertFalse(assignedItem.toString().contains("count"))
    }

    @Test
    fun `assigned HR interviewer sees team interview in hiring list and export until team access is revoked`() {
        postgres.verifyPostgres16()
        val owner = account("ti-hr-owner")
        val creator = account("ti-hr-creator")
        val interviewer = HrHttpFixtures.register(mockMvc, objectMapper, true, "ti-hr-interviewer").first
        val otherHr = HrHttpFixtures.register(mockMvc, objectMapper, true, "ti-hr-other").first
        val team = team(owner, "Hiring team history")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")
        seedMembership(team.id, otherHr.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Hiring task", "Brief", "// hiring", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Hiring set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "TEAM hiring cabinet row",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
        )).path("interview")
        val interviewId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val verdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "Team export"))
        }.andReturn()
        assertStatus(verdict, 200, "assigned HR interviewer can finish the team interview")

        val hiringList = mockMvc.get("/api/me/hr/rooms") { authorize(interviewer) }.andReturn()
        assertStatus(hiringList, 200, "assigned HR interviewer reads team interview in hiring list")
        assertEquals(1, body(hiringList).path("totalElements").asInt())
        val item = body(hiringList).path("items")[0]
        assertEquals(interviewId, item.path("roomId").asText())
        assertEquals("TEAM hiring cabinet row", item.path("title").asText())
        assertEquals("finished", item.path("status").asText())
        assertEquals("HIRE", item.path("verdict").asText())
        assertEquals("Team export", item.path("verdictComment").asText())

        val export = mockMvc.get("/api/me/hr/rooms/export") { authorize(interviewer) }.andReturn()
        assertStatus(export, 200, "team hiring row is included in XLSX export")
        assertEquals("1", export.response.getHeader("Interview-Count"))

        val otherList = mockMvc.get("/api/me/hr/rooms") { authorize(otherHr) }.andReturn()
        assertStatus(otherList, 200, "unassigned HR team member reads the shared hiring list")
        assertEquals(1, body(otherList).path("totalElements").asInt())
        val otherDetail = mockMvc.get("/api/me/hr/rooms/$interviewId") { authorize(otherHr) }.andReturn()
        assertStatus(otherDetail, 200, "all active team members can open team hiring detail")

        assertStatus(suspendMember(owner, team.id, interviewer.id, UUID.randomUUID().toString()), 200, "fixture revokes team access")
        val afterSuspend = mockMvc.get("/api/me/hr/rooms") { authorize(interviewer) }.andReturn()
        assertStatus(afterSuspend, 200, "suspended HR account keeps cabinet endpoint but loses team rows")
        assertEquals(0, body(afterSuspend).path("totalElements").asInt())
        val suspendedExport = mockMvc.get("/api/me/hr/rooms/export") { authorize(interviewer) }.andReturn()
        assertStatus(suspendedExport, 200, "suspended HR export stays scoped to remaining rows")
        assertEquals("0", suspendedExport.response.getHeader("Interview-Count"))
    }

    @Test
    fun `P32 managers list orphaned interviews whose room owner is no longer active`() {
        val owner = account("orphan-owner")
        val creator = account("orphan-maker")
        val activeMember = account("orphan-active")
        val team = team(owner, "Orphaned interview queue")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, activeMember.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Orphan task", "Brief", "// orphan", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Orphan set", listOf(task.path("id").asText()))).path("taskSet")
        val orphaned = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Needs new owner",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val healthy = body(createTeamInterview(
            actor = activeMember,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Active owner remains",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")

        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture suspends the room owner")

        val queue = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(queue, 200, "owner reads orphaned interview queue")
        assertProtectedNoStore(queue)
        val items = body(queue).path("items")
        assertEquals(1, items.size())
        assertEquals(orphaned.path("id").asText(), items[0].path("id").asText())
        assertEquals("Needs new owner", items[0].path("title").asText())
        assertEquals(creator.id, items[0].path("ownerUserId").asText())
        assertEquals(displayNameFor(creator.id), items[0].path("ownerDisplayName").asText())
        assertEquals("OWNER_SUSPENDED", items[0].path("ownershipState").asText())
        assertFalse(items.any { it.path("id").asText() == healthy.path("id").asText() }, "active-owner interview must not enter the orphaned queue")
        listOf(owner.token, creator.token, activeMember.token, "owner_session_token", "interviewer_session_token").forEach { privateValue ->
            assertFalse(queue.response.contentAsString.contains(privateValue), "orphaned queue must not expose private values")
        }

        val memberDenied = listTeamInterviews(activeMember, team.id, ownership = "orphaned")
        assertStatus(memberDenied, 200, "all active members can read the interview recovery queue")
        assertEquals(1, body(memberDenied).path("items").size())

        assertStatus(resumeMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture resumes the room owner")
        val afterResume = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(afterResume, 200, "queue remains readable after recovery")
        assertEquals(0, body(afterResume).path("items").size(), "resumed owner removes the interview from the orphaned queue")
    }

    @Test
    fun `finished team result remains readable but cannot enter orphaned ownership lifecycle`() {
        val owner = account("finished-life-owner")
        val creator = account("finished-life-maker")
        val interviewer = account("finished-life-int")
        val candidate = account("finished-life-cand")
        val successor = account("finished-life-new")
        val team = team(owner, "Finished result lifecycle")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")
        seedMembership(team.id, successor.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Finished task", "Brief", "// finished", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Finished set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Finished interview keeps result",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )).path("interview")
        val interviewId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val verdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "Final result"))
        }.andReturn()
        assertStatus(verdict, 200, "assigned interviewer finishes the team interview")
        val finishedAt = body(verdict).path("finishedAt").asText()
        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes finished owner inactive")

        val candidateResult = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateResult, 200, "assigned active candidate can still read a finished result")
        assertEquals("finished", body(candidateResult).path("status").asText())
        assertEquals("HIRE", body(candidateResult).path("verdict").asText())

        val allInterviews = listTeamInterviews(owner, team.id)
        assertStatus(allInterviews, 200, "team history remains readable after finished owner suspension")
        val finishedItem = body(allInterviews).path("items").single { it.path("id").asText() == interviewId }
        assertEquals("finished", finishedItem.path("status").asText())
        assertEquals("HIRE", finishedItem.path("verdict").asText())
        assertEquals("Final result", finishedItem.path("verdictComment").asText())
        assertEquals(finishedAt, finishedItem.path("finishedAt").asText())

        val orphanedQueue = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(orphanedQueue, 200, "orphaned queue remains readable after finished owner suspension")
        assertEquals(0, body(orphanedQueue).path("items").size(), "finished result must not enter orphaned owner queue")

        val offer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatusAndCode(offer, 409, "TEAM_INTERVIEW_FINISHED")
        val archived = archiveTeamInterview(owner, team.id, interviewId)
        assertStatusAndCode(archived, 409, "TEAM_INTERVIEW_FINISHED")
        val frozen = freezeTeamInterview(owner, team.id, interviewId)
        assertStatusAndCode(frozen, 409, "TEAM_INTERVIEW_FINISHED")
        val storedRoom = jdbcTemplate.queryForMap("SELECT status, archived_at, owner_user_id FROM rooms WHERE id = ?", interviewId)
        assertEquals("finished", storedRoom["status"])
        assertEquals(null, storedRoom["archived_at"])
        assertEquals(creator.id, storedRoom["owner_user_id"])
    }

    @Test
    fun `P32 target accepts ownership offer for orphaned interview`() {
        val owner = account("offer-owner")
        val creator = account("offer-maker")
        val successor = account("offer-successor")
        val otherMember = account("offer-other")
        val team = team(owner, "Owner offer lifecycle")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, successor.id, role = "MEMBER")
        seedMembership(team.id, otherMember.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Offer task", "Brief", "// offer", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Offer set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Offer needs owner",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val interviewId = interview.path("id").asText()

        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes interview orphaned")

        val createOffer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatus(createOffer, 201, "manager creates an ownership offer for an orphaned interview")
        assertProtectedNoStore(createOffer)
        val offer = body(createOffer).path("offer")
        assertEquals(team.id, offer.path("teamId").asText())
        assertEquals(interviewId, offer.path("interviewId").asText())
        assertEquals(owner.id, offer.path("fromUserId").asText())
        assertEquals(successor.id, offer.path("toUserId").asText())
        assertEquals("PENDING", offer.path("status").asText())
        assertTrue(offer.path("expiresAt").asText().isNotBlank())
        listOf(owner.token, creator.token, successor.token, interview.path("inviteCode").asText()).forEach { privateValue ->
            assertFalse(createOffer.response.contentAsString.contains(privateValue), "owner offer response must not expose private values")
        }

        val otherAccept = acceptOwnerOffer(otherMember, team.id, interviewId, offer.path("id").asText())
        assertStatusAndCode(otherAccept, 403, "TEAM_INTERVIEW_OWNER_OFFER_FORBIDDEN")

        val successorInbox = listOwnerOffers(successor, team.id)
        assertStatus(successorInbox, 200, "target member sees pending owner offers")
        assertProtectedNoStore(successorInbox)
        val inboxItems = body(successorInbox).path("items")
        assertEquals(1, inboxItems.size())
        assertEquals(offer.path("id").asText(), inboxItems[0].path("id").asText())
        assertEquals(interviewId, inboxItems[0].path("interviewId").asText())
        assertEquals("Offer needs owner", inboxItems[0].path("interviewTitle").asText())
        assertEquals(displayNameFor(owner.id), inboxItems[0].path("fromDisplayName").asText())

        val accepted = acceptOwnerOffer(successor, team.id, interviewId, offer.path("id").asText())
        assertStatus(accepted, 200, "target member accepts the ownership offer")
        val acceptedOffer = body(accepted).path("offer")
        assertEquals("ACCEPTED", acceptedOffer.path("status").asText())
        assertEquals(successor.id, acceptedOffer.path("toUserId").asText())

        val successorInboxAfterAccept = listOwnerOffers(successor, team.id)
        assertStatus(successorInboxAfterAccept, 200, "target inbox remains readable after accept")
        assertEquals(0, body(successorInboxAfterAccept).path("items").size(), "accepted offer leaves pending inbox")

        val queueAfterAccept = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(queueAfterAccept, 200, "orphaned queue remains readable after offer accept")
        assertEquals(0, body(queueAfterAccept).path("items").size(), "accepted offer removes interview from orphaned queue")

        val listAfterAccept = listTeamInterviews(owner, team.id)
        assertStatus(listAfterAccept, 200, "team list shows reassigned owner")
        val reassigned = body(listAfterAccept).path("items").single { it.path("id").asText() == interviewId }
        assertEquals(successor.id, reassigned.path("ownerUserId").asText())
        assertEquals(creator.id, reassigned.path("createdByUserId").asText(), "the interview creator must not change when ownership moves")
        assertEquals(displayNameFor(successor.id), reassigned.path("ownerDisplayName").asText())
        assertEquals("ACTIVE", reassigned.path("ownershipState").asText())
    }

    @Test
    fun `P32 target declines ownership offer without changing orphaned interview owner`() {
        val owner = account("offer-decline-owner")
        val creator = account("offer-decline-maker")
        val successor = account("offer-decline-next")
        val otherMember = account("offer-decline-other")
        val team = team(owner, "Owner offer decline")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, successor.id, role = "MEMBER")
        seedMembership(team.id, otherMember.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Decline offer task", "Brief", "// decline", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Decline offer set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Declined owner offer",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val interviewId = interview.path("id").asText()

        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes interview orphaned")

        val createOffer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatus(createOffer, 201, "manager creates an ownership offer to decline")
        val offerId = body(createOffer).path("offer").path("id").asText()

        val otherDecline = declineOwnerOffer(otherMember, team.id, interviewId, offerId)
        assertStatusAndCode(otherDecline, 403, "TEAM_INTERVIEW_OWNER_OFFER_FORBIDDEN")

        val declined = declineOwnerOffer(successor, team.id, interviewId, offerId)
        assertStatus(declined, 200, "target member declines the ownership offer")
        assertProtectedNoStore(declined)
        val declinedOffer = body(declined).path("offer")
        assertEquals("DECLINED", declinedOffer.path("status").asText())
        assertEquals(successor.id, declinedOffer.path("toUserId").asText())
        assertTrue(declinedOffer.path("respondedAt").asText().isNotBlank())

        val acceptAfterDecline = acceptOwnerOffer(successor, team.id, interviewId, offerId)
        assertStatusAndCode(acceptAfterDecline, 409, "TEAM_INTERVIEW_OWNER_OFFER_NOT_PENDING")

        val successorInboxAfterDecline = listOwnerOffers(successor, team.id)
        assertStatus(successorInboxAfterDecline, 200, "target inbox remains readable after decline")
        assertEquals(0, body(successorInboxAfterDecline).path("items").size(), "declined offer leaves pending inbox")

        val queueAfterDecline = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(queueAfterDecline, 200, "orphaned queue remains readable after offer decline")
        val orphanedItems = body(queueAfterDecline).path("items")
        assertEquals(1, orphanedItems.size(), "declined offer keeps interview in orphaned queue")
        assertEquals(interviewId, orphanedItems[0].path("id").asText())
        assertEquals("OWNER_SUSPENDED", orphanedItems[0].path("ownershipState").asText())

        val listAfterDecline = listTeamInterviews(owner, team.id)
        assertStatus(listAfterDecline, 200, "team list keeps original owner state")
        val unchanged = body(listAfterDecline).path("items").single { it.path("id").asText() == interviewId }
        assertEquals(creator.id, unchanged.path("ownerUserId").asText())
        assertEquals("OWNER_SUSPENDED", unchanged.path("ownershipState").asText())
    }

    @Test
    fun `P32 target inbox expires stale ownership offers before listing`() {
        val owner = account("offer-expire-owner")
        val creator = account("offer-expire-maker")
        val successor = account("offer-expire-next")
        val team = team(owner, "Owner offer expiry")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, successor.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Expire offer task", "Brief", "// expire", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Expire offer set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Expired owner offer",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val interviewId = interview.path("id").asText()

        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes interview orphaned")
        val createOffer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatus(createOffer, 201, "manager creates an ownership offer to expire")
        val offerId = body(createOffer).path("offer").path("id").asText()
        jdbcTemplate.update(
            """
            update team_interview_owner_offers
               set created_at = timestamp '2020-01-01 00:00:00',
                   expires_at = timestamp '2020-01-01 01:00:00'
             where id = ?
            """.trimIndent(),
            offerId,
        )

        val successorInbox = listOwnerOffers(successor, team.id)
        assertStatus(successorInbox, 200, "target inbox remains readable after stale offer cleanup")
        assertEquals(0, body(successorInbox).path("items").size(), "expired offer is not returned in pending inbox")
        val expiredState = jdbcTemplate.queryForMap(
            "select status, responded_at from team_interview_owner_offers where id = ?",
            offerId,
        )
        assertEquals("EXPIRED", expiredState["status"])
        assertTrue(expiredState["responded_at"] != null, "stale offer cleanup must record response timestamp")
    }

    @Test
    fun `P32 manager archives orphaned interview without successor and cancels pending owner offers`() {
        val owner = account("orphan-arch-owner")
        val creator = account("orphan-arch-maker")
        val successor = account("orphan-arch-next")
        val otherMember = account("orphan-arch-other")
        val team = team(owner, "Archive orphaned interview")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, successor.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Archive orphan task", "Brief", "// archive", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Archive orphan set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Archive orphaned interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")
        val interviewId = interview.path("id").asText()
        val healthyInterview = body(createTeamInterview(
            actor = owner,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Healthy interview cannot blind archive",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
        )).path("interview")

        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes interview orphaned")
        val createOffer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatus(createOffer, 201, "manager creates a pending offer before archive")
        val offerId = body(createOffer).path("offer").path("id").asText()

        val memberDenied = archiveTeamInterview(otherMember, team.id, interviewId)
        assertStatusAndCode(memberDenied, 404, "TEAM_NOT_FOUND")

        val activeOwnerDenied = archiveTeamInterview(owner, team.id, healthyInterview.path("id").asText())
        assertStatusAndCode(activeOwnerDenied, 409, "TEAM_INTERVIEW_OWNER_ACTIVE")

        val archived = archiveTeamInterview(owner, team.id, interviewId)
        assertStatus(archived, 200, "manager archives orphaned interview without successor")
        assertProtectedNoStore(archived)
        assertEquals(interviewId, body(archived).path("interview").path("id").asText())

        val queueAfterArchive = listTeamInterviews(owner, team.id, ownership = "orphaned")
        assertStatus(queueAfterArchive, 200, "orphaned queue remains readable after archive")
        assertEquals(0, body(queueAfterArchive).path("items").size(), "archived orphan leaves orphaned queue")

        val listAfterArchive = listTeamInterviews(owner, team.id)
        assertStatus(listAfterArchive, 200, "team interview list remains readable after archive")
        assertFalse(
            body(listAfterArchive).path("items").any { it.path("id").asText() == interviewId },
            "archived interview must not appear in active team interviews",
        )

        val successorInbox = listOwnerOffers(successor, team.id)
        assertStatus(successorInbox, 200, "target inbox remains readable after interview archive")
        assertEquals(0, body(successorInbox).path("items").size(), "archive cancels pending owner offer from target inbox")
        val offerState = jdbcTemplate.queryForMap(
            "select status, responded_at from team_interview_owner_offers where id = ?",
            offerId,
        )
        assertEquals("CANCELLED", offerState["status"])
        assertTrue(offerState["responded_at"] != null, "archive cancellation must record response timestamp")
    }

    @Test
    fun `P32 manager freezes orphaned interview and accepted owner explicitly resumes it`() {
        val owner = account("freeze-owner")
        val creator = account("freeze-maker")
        val successor = account("freeze-new")
        val candidate = account("freeze-cand")
        val otherMember = account("freeze-other")
        val team = team(owner, "Freeze orphaned interview")
        seedMembership(team.id, creator.id, role = "ADMIN")
        seedMembership(team.id, successor.id, role = "MEMBER")
        val task = body(createTeamTask(owner, team.id, "Freeze orphan task", "Brief", "// freeze", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Freeze orphan set", listOf(task.path("id").asText()))).path("taskSet")
        val interview = body(createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Freeze orphaned interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = emptyList(),
            candidateIds = emptyList(),
        )).path("interview")
        val interviewId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(candidate) }.andReturn(),
            200,
            "assigned candidate can open the interview before freeze",
        )
        assertStatus(suspendMember(owner, team.id, creator.id, UUID.randomUUID().toString()), 200, "fixture makes interview orphaned")

        val nonManagerFreeze = freezeTeamInterview(otherMember, team.id, interviewId)
        assertStatusAndCode(nonManagerFreeze, 404, "TEAM_NOT_FOUND")

        val frozen = freezeTeamInterview(owner, team.id, interviewId)
        assertStatus(frozen, 200, "manager freezes orphaned interview")
        assertProtectedNoStore(frozen)
        assertEquals("frozen", body(frozen).path("interview").path("status").asText())
        assertEquals(
            "frozen",
            jdbcTemplate.queryForObject("select status from rooms where id = ?", String::class.java, interviewId),
            "freeze must persist a distinct room status",
        )

        val candidateFrozenRoom = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateFrozenRoom, 200, "candidate can view a frozen team room")
        assertEquals("candidate", body(candidateFrozenRoom).path("role").asText())
        assertEquals(false, body(candidateFrozenRoom).path("canManageRoom").asBoolean())
        assertStatus(
            mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
                authorize(candidate)
            }.andReturn(),
            204,
            "candidate can open realtime to view a frozen team room",
        )

        val createOffer = createOwnerOffer(owner, team.id, interviewId, successor.id, UUID.randomUUID().toString())
        assertStatus(createOffer, 201, "manager can offer ownership while interview remains frozen")
        val offerId = body(createOffer).path("offer").path("id").asText()
        val accepted = acceptOwnerOffer(successor, team.id, interviewId, offerId)
        assertStatus(accepted, 200, "target member accepts ownership for frozen interview")
        assertEquals(
            "frozen",
            jdbcTemplate.queryForObject("select status from rooms where id = ?", String::class.java, interviewId),
            "accepting ownership must not resume the frozen interview automatically",
        )

        val successorFrozenRoom = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(successor)
        }.andReturn()
        assertStatus(successorFrozenRoom, 200, "accepted owner can open the frozen room to decide when to resume")
        assertEquals("owner", body(successorFrozenRoom).path("role").asText())
        assertEquals("frozen", body(successorFrozenRoom).path("status").asText())

        val successorSessionId = "freeze-resume-${UUID.randomUUID()}"
        val successorStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", successorSessionId)
            param("displayName", "Accepted owner")
            authorize(successor)
        }.andReturn()
        assertStatus(successorStream, 200, "accepted owner connects while frozen")
        val successorEventToken = realtimePayload(successorStream).path("eventToken").asText()
        assertEquals("frozen", realtimePayload(successorStream).path("status").asText())
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "sessionId" to successorSessionId, "eventToken" to successorEventToken,
                "type" to "request_state_sync",
            ))
        }.andReturn(), 204, "frozen owner can request read-only state")
        assertEquals("frozen", realtimePayload(successorStream).path("status").asText())

        val otherResume = resumeTeamInterview(otherMember, team.id, interviewId)
        assertStatusAndCode(otherResume, 404, "TEAM_NOT_FOUND")

        val resumed = resumeTeamInterview(successor, team.id, interviewId)
        assertStatus(resumed, 200, "accepted owner explicitly resumes the frozen interview")
        assertProtectedNoStore(resumed)
        assertEquals("active", body(resumed).path("interview").path("status").asText())
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "sessionId" to successorSessionId, "eventToken" to successorEventToken,
                "type" to "request_state_sync",
            ))
        }.andReturn(), 403, "resume invalidates the connection that cached frozen state")
        assertEquals(null, successorStream.getAsyncResult(1000), "resume closes the old SSE transport")
        val successorResumedStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", successorSessionId)
            param("displayName", "Accepted owner")
            authorize(successor)
        }.andReturn()
        assertStatus(successorResumedStream, 200, "the same browser session reconnects after resume")
        val resumedEventToken = realtimePayload(successorResumedStream).path("eventToken").asText()
        assertTrue(resumedEventToken != successorEventToken, "reconnecting must rotate the event token")
        assertEquals("active", realtimePayload(successorResumedStream).path("status").asText(), "reconnecting cannot reuse cached frozen state")
        assertStatus(mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf(
                "sessionId" to successorSessionId, "eventToken" to resumedEventToken,
                "type" to "language_update", "language" to "python",
            ))
        }.andReturn(), 204, "the reconnected owner session can edit again")
        assertEquals("python", realtimePayload(successorResumedStream).path("language").asText())
        assertEquals("python", body(mockMvc.get("/api/rooms/$inviteCode") { authorize(successor) }.andReturn()).path("language").asText())
        assertEquals(
            "active",
            jdbcTemplate.queryForObject("select status from rooms where id = ?", String::class.java, interviewId),
            "resume must persist active room status",
        )

        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(candidate) }.andReturn(),
            200,
            "candidate regains access only after explicit resume",
        )
        assertStatus(
            mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
                authorize(candidate)
            }.andReturn(),
            204,
            "candidate realtime probe reopens only after explicit resume",
        )
    }

    @Test
    fun `team interview creation rejects foreign and archived catalog resources without partial rooms`() {
        postgres.verifyPostgres16()
        val owner = account("ti-neg-owner")
        val creator = account("ti-neg-creator")
        val outsider = account("ti-neg-out")
        val team = team(owner, "Interview negative catalog")
        val otherTeam = team(outsider, "Foreign negative catalog")
        seedMembership(team.id, creator.id, role = "MEMBER")

        val validTask = body(createTeamTask(owner, team.id, "Valid task", "Brief", "// valid", "nodejs")).path("task")
        val validTaskSet = body(createTaskSet(owner, team.id, "Valid set", listOf(validTask.path("id").asText()))).path("taskSet")
        val validTrack = body(createTrack(owner, team.id, "Valid track")).path("track")
        val validVacancy = body(createVacancy(owner, team.id, validTrack.path("id").asText(), "Valid vacancy")).path("vacancy")

        val foreignTask = body(createTeamTask(outsider, otherTeam.id, "Foreign task", "Hidden", "// foreign", "nodejs")).path("task")
        val foreignTaskSet = body(createTaskSet(outsider, otherTeam.id, "Foreign set", listOf(foreignTask.path("id").asText()))).path("taskSet")
        val foreignTrack = body(createTrack(outsider, otherTeam.id, "Foreign track")).path("track")
        val foreignVacancy = body(createVacancy(outsider, otherTeam.id, foreignTrack.path("id").asText(), "Foreign vacancy")).path("vacancy")

        val archivedSetTask = body(createTeamTask(owner, team.id, "Archived set task", "Brief", "// archived set", "nodejs")).path("task")
        val archivedTaskSet = body(createTaskSet(owner, team.id, "Archived set", listOf(archivedSetTask.path("id").asText()))).path("taskSet")
        jdbcTemplate.update("UPDATE team_task_sets SET status = 'ARCHIVED', revision = revision + 1 WHERE id = ?", archivedTaskSet.path("id").asText())

        val archivedTask = body(createTeamTask(owner, team.id, "Archived task", "Brief", "// archived task", "nodejs")).path("task")
        val setWithArchivedTask = body(createTaskSet(owner, team.id, "Set with archived task", listOf(archivedTask.path("id").asText()))).path("taskSet")
        jdbcTemplate.update("UPDATE team_task_templates SET status = 'ARCHIVED', revision = revision + 1 WHERE id = ?", archivedTask.path("id").asText())

        val archivedTrack = body(createTrack(owner, team.id, "Archived track")).path("track")
        jdbcTemplate.update("UPDATE team_tracks SET status = 'ARCHIVED', revision = revision + 1 WHERE id = ?", archivedTrack.path("id").asText())

        val programmeTrack = body(createTrack(owner, team.id, "Programme track")).path("track")
        val programmeTrackId = programmeTrack.path("id").asText()
        assertStatus(saveTrackProgrammeDraft(owner, team.id, programmeTrackId, listOf(validTask.path("id").asText()), revision = null), 200, "programme draft fixture must save")
        assertStatus(publishTrackProgramme(owner, team.id, programmeTrackId, revision = 0), 200, "programme fixture must publish")
        assertStatus(archiveTrackProgramme(owner, team.id, programmeTrackId, revision = 1), 200, "programme fixture must archive")

        val programmeVacancy = body(createVacancy(owner, team.id, validTrack.path("id").asText(), "Programme vacancy")).path("vacancy")
        val programmeVacancyId = programmeVacancy.path("id").asText()
        assertStatus(
            saveVacancyProgrammeDraft(owner, team.id, validTrack.path("id").asText(), programmeVacancyId, listOf(validTask.path("id").asText()), revision = null),
            200,
            "vacancy programme draft fixture must save",
        )
        assertStatus(
            publishVacancyProgramme(owner, team.id, validTrack.path("id").asText(), programmeVacancyId, revision = 0),
            200,
            "vacancy programme fixture must publish",
        )
        assertStatus(
            archiveVacancyProgramme(owner, team.id, validTrack.path("id").asText(), programmeVacancyId, revision = 1),
            200,
            "vacancy programme fixture must archive",
        )

        val archivedVacancy = body(createVacancy(owner, team.id, validTrack.path("id").asText(), "Archived vacancy")).path("vacancy")
        jdbcTemplate.update("UPDATE team_vacancies SET status = 'ARCHIVED', revision = revision + 1 WHERE id = ?", archivedVacancy.path("id").asText())

        fun assertRejected(
            marker: String,
            expectedCode: String,
            taskSetId: String,
            trackId: String? = null,
            vacancyId: String? = null,
            expectedStatus: Int = 404,
        ) {
            val rejected = createTeamInterview(
                actor = creator,
                teamId = team.id,
                key = UUID.randomUUID().toString(),
                title = marker,
                taskSetId = taskSetId,
                trackId = trackId,
                vacancyId = vacancyId,
            )
            assertStatusAndCode(rejected, expectedStatus, expectedCode)
            assertBodyDoesNotContain(
                rejected,
                foreignTaskSet.path("id").asText(),
                foreignTrack.path("id").asText(),
                foreignVacancy.path("id").asText(),
            )
            assertEquals(0L, countRoomsForTeam(team.id), "$marker must not create a partial team room")
        }

        assertRejected("Foreign task set", "TEAM_TASK_SET_NOT_FOUND", foreignTaskSet.path("id").asText())
        assertRejected("Archived task set", "TEAM_TASK_SET_NOT_FOUND", archivedTaskSet.path("id").asText())
        assertRejected("Archived task inside active set", "TEAM_TASK_NOT_FOUND", setWithArchivedTask.path("id").asText())
        assertRejected("Foreign track", "TRACK_NOT_FOUND", validTaskSet.path("id").asText(), foreignTrack.path("id").asText())
        assertRejected("Archived track", "TRACK_NOT_FOUND", validTaskSet.path("id").asText(), archivedTrack.path("id").asText())
        assertRejected(
            "Archived programme",
            "TEAM_PROGRAMME_ARCHIVED",
            validTaskSet.path("id").asText(),
            programmeTrackId,
            expectedStatus = 409,
        )
        assertRejected(
            "Archived vacancy programme",
            "TEAM_PROGRAMME_ARCHIVED",
            validTaskSet.path("id").asText(),
            validTrack.path("id").asText(),
            programmeVacancyId,
            expectedStatus = 409,
        )
        assertRejected("Foreign vacancy", "VACANCY_NOT_FOUND", validTaskSet.path("id").asText(), validTrack.path("id").asText(), foreignVacancy.path("id").asText())
        assertRejected("Archived vacancy", "VACANCY_NOT_FOUND", validTaskSet.path("id").asText(), validTrack.path("id").asText(), archivedVacancy.path("id").asText())
        assertRejected("Vacancy without track", "VACANCY_NOT_FOUND", validTaskSet.path("id").asText(), null, validVacancy.path("id").asText())
    }

    @Test
    fun `active member creates team interview with role assignments for active team employees only`() {
        postgres.verifyPostgres16()
        val owner = account("ti-assign-owner")
        val creator = account("ti-assign-creator")
        val interviewer = account("ti-assign-int")
        val candidate = account("ti-assign-cand")
        val outsider = account("ti-assign-out")
        val team = team(owner, "Interview assignments")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")
        seedMembership(team.id, candidate.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Assignment task", "Brief", "// start", "kotlin")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Assignment set", listOf(task.path("id").asText()))).path("taskSet")
        val key = UUID.randomUUID().toString()
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = key,
            title = "Assigned team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = listOf(candidate.id),
        )
        assertStatus(created, 201, "team interview accepts active team employee assignments")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        assertEquals(
            listOf(listOf(creator.id, "owner"), listOf(interviewer.id, "interviewer"), listOf(candidate.id, "candidate")),
            interview.path("assignees").map { listOf(it.path("userId").asText(), it.path("role").asText()) },
            "create response must show owner access and stable role assignments",
        )
        val participantRows = jdbcTemplate.query(
            "SELECT user_id, role FROM room_participants WHERE room_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'interviewer' THEN 1 ELSE 2 END, user_id ASC",
            { rs, _ -> listOf(rs.getString("user_id"), rs.getString("role")) },
            roomId,
        )
        assertEquals(
            listOf(listOf(creator.id, "owner"), listOf(interviewer.id, "interviewer"), listOf(candidate.id, "candidate")),
            participantRows,
            "team interview assignments must be persisted as room participants",
        )

        val replay = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = key,
            title = "Assigned team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = listOf(candidate.id),
        )
        assertStatus(replay, 201, "same assignment request is idempotent")
        assertEquals(roomId, body(replay).path("interview").path("id").asText())

        val reusedForDifferentAssignments = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = key,
            title = "Assigned team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatusAndCode(reusedForDifferentAssignments, 409, "IDEMPOTENCY_KEY_REUSED")

        val listed = mockMvc.get("/api/teams/${team.id}/interviews") {
            authorize(creator)
        }.andReturn()
        assertStatus(listed, 200, "assigned team interview appears in team list")
        assertEquals(
            listOf(listOf(creator.id, "owner"), listOf(interviewer.id, "interviewer"), listOf(candidate.id, "candidate")),
            body(listed).path("items").first().path("assignees").map { listOf(it.path("userId").asText(), it.path("role").asText()) },
            "list response must include assignments",
        )

        val invalid = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Invalid assignment",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(outsider.id),
            candidateIds = emptyList(),
        )
        assertStatusAndCode(invalid, 404, "TEAM_MEMBER_NOT_FOUND")
        assertEquals(1L, countRoomsForTeam(team.id), "invalid employee assignments must not create a partial room")
    }

    @Test
    fun `active team staff manage rooms while external and former members enter as candidates`() {
        postgres.verifyPostgres16()
        val owner = account("ti-room-owner")
        val creator = account("ti-room-creator")
        val interviewer = account("ti-room-int")
        val candidate = account("ti-room-cand")
        val unassigned = account("ti-room-unassigned")
        val outsider = account("ti-room-outsider")
        val team = team(owner, "Interview room admission")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")
        seedMembership(team.id, unassigned.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Admission task", "Brief", "// admission", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Admission set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Admission team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()
        val tokens = jdbcTemplate.queryForMap(
            "SELECT owner_session_token, interviewer_session_token FROM rooms WHERE id = ?",
            roomId,
        )

        val interviewerRoom = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerRoom, 200, "assigned active interviewer can open team room")
        val interviewerPayload = body(interviewerRoom)
        assertEquals(roomId, interviewerPayload.path("id").asText())
        assertEquals("interviewer", interviewerPayload.path("role").asText())
        assertEquals(true, interviewerPayload.path("canManageRoom").asBoolean())
        assertEquals(false, interviewerPayload.path("canGrantAccess").asBoolean())
        assertEquals(true, interviewerPayload.path("ownerToken").isNull)
        assertEquals(true, interviewerPayload.path("interviewerToken").isNull)

        val candidateRoom = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateRoom, 200, "assigned active candidate can open team room")
        val candidatePayload = body(candidateRoom)
        assertEquals("candidate", candidatePayload.path("role").asText())
        assertEquals(false, candidatePayload.path("canManageRoom").asBoolean())
        assertEquals(0, candidatePayload.path("accessMembers").size(), "candidate response must not expose staff roster")

        val interviewerStatus = mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerStatus, 204, "assigned active interviewer can probe team realtime stream")

        val interviewerSessionId = "team-interviewer-${UUID.randomUUID()}"
        val interviewerStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", interviewerSessionId)
            param("displayName", "Assigned interviewer")
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerStream, 200, "assigned active interviewer can open team realtime stream")
        val interviewerRealtime = realtimePayload(interviewerStream)
        assertEquals("interviewer", interviewerRealtime.path("role").asText())
        assertEquals(true, interviewerRealtime.path("canManageRoom").asBoolean())
        assertEquals(false, interviewerRealtime.path("canGrantAccess").asBoolean())
        assertTrue(interviewerRealtime.path("eventToken").asText().startsWith("evt_"))

        val candidateSessionId = "team-candidate-${UUID.randomUUID()}"
        val candidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", candidateSessionId)
            param("displayName", "Assigned candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateStream, 200, "assigned active candidate can open team realtime stream")
        val candidateRealtime = realtimePayload(candidateStream)
        assertEquals("candidate", candidateRealtime.path("role").asText())
        assertEquals(false, candidateRealtime.path("canManageRoom").asBoolean())
        assertTrue(candidateRealtime.path("eventToken").asText().startsWith("evt_"))

        val relay = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateRealtime.path("eventToken").asText(),
                    "operationId" to UUID.randomUUID().toString(),
                    "type" to "yjs_update",
                    "syncKey" to "$inviteCode:0:nodejs",
                    "yjsUpdate" to "AQ==",
                    "yjsClientSequence" to 1,
                    "baseServerYjsSequence" to 0,
                ),
            )
        }.andReturn()
        assertStatus(relay, 204, "assigned active candidate can relay editor updates in team realtime room")

        val outsiderLinkRoom = mockMvc.get("/api/rooms/$inviteCode") { authorize(outsider) }.andReturn()
        assertStatus(outsiderLinkRoom, 200, "external holder of candidate link enters as candidate")
        assertEquals("candidate", body(outsiderLinkRoom).path("role").asText())
        assertEquals(false, body(outsiderLinkRoom).path("canManageRoom").asBoolean())
        val denials = listOf(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(unassigned) }.andReturn(),
            mockMvc.get("/api/rooms/$inviteCode") {
                header("X-Room-Owner-Token", tokens.getValue("owner_session_token").toString())
            }.andReturn(),
            mockMvc.get("/api/rooms/$inviteCode") {
                header("X-Room-Interviewer-Token", tokens.getValue("interviewer_session_token").toString())
            }.andReturn(),
        )
        denials.forEachIndexed { index, admission ->
            assertStatus(admission, 200, "team member and legacy-token link holder can enter the room")
            assertEquals(if (index == 0) "interviewer" else "candidate", body(admission).path("role").asText())
        }
        val realtimeDenials = listOf(
            mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
                authorize(unassigned)
            }.andReturn(),
            mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
                param("ownerToken", tokens.getValue("owner_session_token").toString())
            }.andReturn(),
        )
        realtimeDenials.forEach { admission ->
            assertStatus(admission, 204, "team realtime admission follows the public link contract")
        }
        assertStatus(mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(outsider)
        }.andReturn(), 204, "external candidate link holder joins realtime")

        jdbcTemplate.update(
            "UPDATE team_memberships SET state = 'REMOVED', epoch = epoch + 1, revision = revision + 1 WHERE team_id = ? AND user_id = ?",
            team.id,
            interviewer.id,
        )
        val removedCandidateRest = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(interviewer)
        }.andReturn()
        val removedCandidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(interviewer)
        }.andReturn()
        val removedCandidateRelay = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerRealtime.path("eventToken").asText(),
                    "type" to "notes_update",
                    "notes" to "revoked manager must not save notes",
                ),
            )
        }.andReturn()
        assertStatus(removedCandidateRest, 200, "former interviewer retains candidate admission")
        assertEquals("candidate", body(removedCandidateRest).path("role").asText())
        assertEquals(false, body(removedCandidateRest).path("canManageRoom").asBoolean())
        assertStatus(removedCandidateStream, 204, "former interviewer can reconnect as a candidate")
        assertStatus(removedCandidateRelay, 403, "old room row cannot restore revoked private authority")
    }

    @Test
    fun `removed assignee rejoin receives shared team access without restoring old assignment rows`() {
        postgres.verifyPostgres16()
        val owner = account("ti-rejoin-owner")
        val creator = account("ti-rejoin-creator")
        val interviewer = account("ti-rejoin-int")
        val team = team(owner, "Interview rejoin assignment")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Rejoin task", "Brief", "// rejoin", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Rejoin set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Rejoin assignment interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val inviteCode = interview.path("inviteCode").asText()

        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn(),
            200,
            "assigned active interviewer can open team room before removal",
        )
        assertStatus(
            removeMember(owner, team.id, interviewer.id),
            200,
            "owner removes assigned interviewer from the team",
        )
        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn(),
            200,
            "removed interviewer enters old team room as candidate",
        )

        val token = invitationToken(createInvitation(owner, team.id), owner, team.id)
        val accepted = acceptInvitation(interviewer, token)
        assertStatus(accepted, 200, "removed interviewer can rejoin with a fresh invitation")
        assertEquals("joined", body(accepted).path("outcome").asText())

        val oldRoomAfterRejoin = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(oldRoomAfterRejoin, 200, "active membership restores shared team room management")
        assertEquals("interviewer", body(oldRoomAfterRejoin).path("role").asText())
        assertStatus(
            mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
                authorize(interviewer)
            }.andReturn(),
            204,
            "rejoin restores shared realtime admission",
        )
    }

    @Test
    fun `team room creator loses owner-user access after leaving the team`() {
        postgres.verifyPostgres16()
        val owner = account("ti-ou-owner")
        val creator = account("ti-ou-creator")
        val team = team(owner, "Interview creator exit")
        seedMembership(team.id, creator.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Creator exit task", "Brief", "// owner-user", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Creator exit set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Creator-owned team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(creator.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created by a non-owner member")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        assertEquals(
            creator.id,
            jdbcTemplate.queryForObject("SELECT owner_user_id FROM rooms WHERE id = ?", String::class.java, roomId),
            "fixture must keep the leaving creator as the room owner_user_id",
        )
        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(creator) }.andReturn(),
            200,
            "assigned creator can open the team room before leaving",
        )

        assertStatus(leaveTeam(creator, team.id), 200, "non-owner creator leaves the team")
        assertEquals(
            creator.id,
            jdbcTemplate.queryForObject("SELECT owner_user_id FROM rooms WHERE id = ?", String::class.java, roomId),
            "team-room owner_user_id remains historical metadata after leave",
        )
        assertEquals(
            0L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM room_participants WHERE room_id = ? AND user_id = ?",
                Long::class.java,
                roomId,
                creator.id,
            ),
            "leaving the team must clear the creator's explicit team-room grant",
        )

        val roomAfterLeave = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(creator)
        }.andReturn()
        assertStatus(roomAfterLeave, 200, "former creator retains candidate link admission")
        assertEquals("candidate", body(roomAfterLeave).path("role").asText())
        assertEquals(false, body(roomAfterLeave).path("canManageRoom").asBoolean())
        val realtimeAfterLeave = mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(creator)
        }.andReturn()
        assertStatus(realtimeAfterLeave, 204, "historical owner can join realtime only as candidate after leave")
    }

    @Test
    fun `suspended assigned member immediately loses team workspace and room access`() {
        postgres.verifyPostgres16()
        val owner = account("ti-sus-owner")
        val creator = account("ti-sus-creator")
        val interviewer = account("ti-sus-int")
        val team = team(owner, "Interview suspend")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Suspend task", "Brief", "// suspend", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Suspend set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Suspend team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()
        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn(),
            200,
            "assigned active interviewer can open team room before suspend",
        )

        val suspendKey = UUID.randomUUID().toString()
        val suspended = suspendMember(owner, team.id, interviewer.id, suspendKey)
        assertStatus(suspended, 200, "owner can suspend a non-owner member")
        val payload = body(suspended)
        assertEquals("MEMBER_SUSPENDED", payload.path("outcome").asText())
        assertEquals(false, payload.path("recovered").asBoolean())
        assertEquals(interviewer.id, payload.path("member").path("userId").asText())
        assertEquals("SUSPENDED", payload.path("member").path("state").asText())
        assertEquals(
            "SUSPENDED",
            jdbcTemplate.queryForObject(
                "SELECT state FROM team_memberships WHERE team_id = ? AND user_id = ?",
                String::class.java,
                team.id,
                interviewer.id,
            ),
        )
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT epoch FROM team_memberships WHERE team_id = ? AND user_id = ?",
                Long::class.java,
                team.id,
                interviewer.id,
            ),
            "suspend must rotate the member epoch",
        )
        assertEquals(
            0L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM room_participants WHERE room_id = ? AND user_id = ?",
                Long::class.java,
                roomId,
                interviewer.id,
            ),
            "suspend must clear explicit team-room grants",
        )

        val replay = suspendMember(owner, team.id, interviewer.id, suspendKey)
        assertStatus(replay, 200, "same suspend key replays the terminal outcome")
        assertEquals(true, body(replay).path("recovered").asBoolean())
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT epoch FROM team_memberships WHERE team_id = ? AND user_id = ?",
                Long::class.java,
                team.id,
                interviewer.id,
            ),
            "suspend replay must not advance epoch",
        )

        val roster = mockMvc.get("/api/teams/${team.id}/members") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(roster, 404, "suspended member cannot read the team roster")
        assertBodyDoesNotContain(roster, team.id, interviewer.id, roomId, inviteCode)
        val workspaces = mockMvc.get("/api/me/workspaces") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(workspaces, 200, "suspended member still keeps personal workspace access")
        assertFalse(
            body(workspaces).any { it.path("id").asText() == team.id },
            "suspended member loses the team workspace",
        )
        val roomAfterSuspend = mockMvc.get("/api/rooms/$inviteCode") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(roomAfterSuspend, 200, "suspended assignee retains public candidate admission")
        assertEquals("candidate", body(roomAfterSuspend).path("role").asText())
        val realtimeAfterSuspend = mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(realtimeAfterSuspend, 204, "suspended assignee can view the candidate realtime stream")
    }

    @Test
    fun `resumed suspended member regains team workspace without old room grants`() {
        postgres.verifyPostgres16()
        val owner = account("ti-res-owner")
        val creator = account("ti-res-creator")
        val interviewer = account("ti-res-int")
        val team = team(owner, "Interview resume")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Resume task", "Brief", "// resume", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Resume set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Resume team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        assertStatus(suspendMember(owner, team.id, interviewer.id, UUID.randomUUID().toString()), 200, "fixture suspends assignee")
        assertEquals("candidate", body(mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn()).path("role").asText(), "suspended member loses management authority")

        val resumeKey = UUID.randomUUID().toString()
        val resumed = resumeMember(owner, team.id, interviewer.id, resumeKey)
        assertStatus(resumed, 200, "owner can resume a suspended member")
        assertEquals("MEMBER_RESUMED", body(resumed).path("outcome").asText())
        assertEquals("ACTIVE", body(resumed).path("member").path("state").asText())
        assertEquals(
            "ACTIVE",
            jdbcTemplate.queryForObject(
                "SELECT state FROM team_memberships WHERE team_id = ? AND user_id = ?",
                String::class.java,
                team.id,
                interviewer.id,
            ),
        )
        assertEquals(
            true,
            body(mockMvc.get("/api/me/workspaces") { authorize(interviewer) }.andReturn())
                .any { it.path("id").asText() == team.id },
            "resumed member regains the team workspace",
        )
        assertEquals(
            true,
            body(mockMvc.get("/api/teams/${team.id}/members") { authorize(interviewer) }.andReturn())
                .path("items")
                .any { it.path("userId").asText() == interviewer.id },
            "resumed member can read the active roster again",
        )
        assertEquals(
            0L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM room_participants WHERE room_id = ? AND user_id = ?",
                Long::class.java,
                roomId,
                interviewer.id,
            ),
            "resume must not recreate old explicit team-room grants",
        )
        assertStatus(
            mockMvc.get("/api/rooms/$inviteCode") { authorize(interviewer) }.andReturn(),
            200,
            "resumed active membership gives shared room access without old assignment rows",
        )

        val replay = resumeMember(owner, team.id, interviewer.id, resumeKey)
        assertStatus(replay, 200, "same resume key replays the terminal outcome")
        assertEquals(true, body(replay).path("recovered").asBoolean())
    }

    @Test
    fun `team membership revocation actively detaches live team realtime connections`() {
        postgres.verifyPostgres16()
        val owner = account("ti-revoke-owner")
        val creator = account("ti-revoke-creator")
        val interviewer = account("ti-revoke-int")
        val candidate = account("ti-revoke-cand")
        val team = team(owner, "Interview room active revocation")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")
        seedMembership(team.id, candidate.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Revocation task", "Brief", "// revocation", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Revocation set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Revocation team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = listOf(candidate.id),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val interviewerStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", "revocation-interviewer-${UUID.randomUUID()}")
            param("displayName", "Revocation interviewer")
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerStream, 200, "assigned interviewer opens stream before revocation")

        val candidateSessionId = "revocation-candidate-${UUID.randomUUID()}"
        val candidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", candidateSessionId)
            param("displayName", "Revocation candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateStream, 200, "assigned candidate opens stream before revocation")
        val candidateEventToken = realtimePayload(candidateStream).path("eventToken").asText()
        assertEquals("interviewer", collaborationService.resolveRoleByEventToken(inviteCode, candidateEventToken)?.wireValue)

        jdbcTemplate.update(
            "UPDATE team_memberships SET state = 'REMOVED', epoch = epoch + 1, revision = revision + 1 WHERE team_id = ? AND user_id = ?",
            team.id,
            candidate.id,
        )
        collaborationService.syncTeamMemberRoomPermissions(team.id, candidate.id)

        assertEquals(null, collaborationService.resolveRoleByEventToken(inviteCode, candidateEventToken), "revoked live team eventToken must be detached")
        val removedCandidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream-status") {
            authorize(candidate)
        }.andReturn()
        assertStatus(removedCandidateStream, 204, "revoked member can reopen a candidate realtime stream")
        val staleRelay = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "operationId" to UUID.randomUUID().toString(),
                    "type" to "yjs_update",
                    "syncKey" to "$inviteCode:0:nodejs",
                    "yjsUpdate" to "AQ==",
                    "yjsClientSequence" to 1,
                    "baseServerYjsSequence" to 0,
                ),
            )
        }.andReturn()
        assertStatus(staleRelay, 403, "actively detached team connection cannot keep relaying with a stale eventToken")
        assertBodyDoesNotContain(staleRelay, roomId, inviteCode, candidate.id)
    }

    @Test
    fun `team room editor snapshot is durably saved for the published task`() {
        postgres.verifyPostgres16()
        val owner = account("ti-snapshot-owner")
        val creator = account("ti-snapshot-creator")
        val candidate = account("ti-snapshot-cand")
        val team = team(owner, "Team room editor snapshot")
        seedMembership(team.id, creator.id, role = "MEMBER")

        val task = body(createTeamTask(owner, team.id, "Snapshot task", "Brief", "// starter", "nodejs")).path("task")
        val taskSet = body(createTaskSet(owner, team.id, "Snapshot set", listOf(task.path("id").asText()))).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Snapshot team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = emptyList(),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()
        val sessionId = "team-snapshot-${UUID.randomUUID()}"
        val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", sessionId)
            param("displayName", "Assigned candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(stream, 200, "assigned candidate can open team realtime stream")
        val realtime = realtimePayload(stream)
        val savedCode = "const answer = 42 // ${UUID.randomUUID()}"
        val savedDocument = "AQIDBA=="

        val relay = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to sessionId,
                    "eventToken" to realtime.path("eventToken").asText(),
                    "operationId" to UUID.randomUUID().toString(),
                    "type" to "yjs_update",
                    "syncKey" to "$inviteCode:0:nodejs",
                    "yjsUpdate" to "AQ==",
                    "code" to savedCode,
                    "yjsDocumentBase64" to savedDocument,
                    "yjsClientSequence" to 1,
                    "baseServerYjsSequence" to 0,
                ),
            )
        }.andReturn()
        assertStatus(relay, 204, "assigned candidate can relay team editor snapshot")

        Thread.sleep(1_000)

        val stored = jdbcTemplate.queryForMap(
            """
            SELECT r.code, rt.solution_code, rt.workspace_yjs_document_base64, rt.workspace_yjs_sequence
            FROM rooms r
            JOIN room_tasks rt ON rt.room_id = r.id AND rt.step_index = 0
            WHERE r.id = ?
            """.trimIndent(),
            roomId,
        )
        assertEquals(savedCode, stored["code"])
        assertEquals(savedCode, stored["solution_code"])
        assertEquals(savedDocument, stored["workspace_yjs_document_base64"])
        assertEquals(1L, stored["workspace_yjs_sequence"])
    }

    @Test
    fun `assigned team interviewer can send idempotent chat messages while candidate cannot`() {
        postgres.verifyPostgres16()
        val owner = account("ti-chat-owner")
        val creator = account("ti-chat-creator")
        val interviewer = account("ti-chat-int")
        val candidate = account("ti-chat-cand")
        val team = team(owner, "Team room chat")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Team chat interview",
            taskSetId = null,
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview must be created before room chat")
        val inviteCode = body(created).path("interview").path("inviteCode").asText()

        fun connect(actor: HrTestAccount, displayName: String): Pair<String, String> {
            val sessionId = "team-chat-${UUID.randomUUID()}"
            val stream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
                param("sessionId", sessionId)
                param("displayName", displayName)
                authorize(actor)
            }.andReturn()
            assertStatus(stream, 200, "$displayName must connect to the assigned team room")
            return sessionId to realtimePayload(stream).path("eventToken").asText()
        }

        val (interviewerSessionId, interviewerEventToken) = connect(interviewer, "Assigned interviewer")
        val (candidateSessionId, candidateEventToken) = connect(candidate, "Assigned candidate")
        val clientMessageId = UUID.randomUUID().toString()
        val message = mapOf(
            "sessionId" to interviewerSessionId,
            "eventToken" to interviewerEventToken,
            "clientEventSequence" to 1,
            "clientMessageId" to clientMessageId,
            "type" to "note_message",
            "noteText" to "Team chat message",
            "noteTimestampEpochMs" to System.currentTimeMillis(),
        )

        val sent = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(message)
        }.andReturn()
        assertStatus(sent, 200, "assigned team interviewer can send an idempotent chat message")
        val ack = body(sent)
        assertEquals(clientMessageId, ack.path("clientMessageId").asText())
        assertTrue(ack.path("messageId").asText().isNotBlank())

        val replay = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(message)
        }.andReturn()
        assertStatus(replay, 200, "retry of an acknowledged team chat message is idempotent")
        assertEquals(ack.path("messageId").asText(), body(replay).path("messageId").asText())

        val candidateMessage = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                message + mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "clientMessageId" to UUID.randomUUID().toString(),
                    "noteText" to "Candidate cannot access interviewer chat",
                ),
            )
        }.andReturn()
        assertStatusAndCode(candidateMessage, 403, "ROOM_ACCESS_DENIED")
        assertEquals("Team chat message", jdbcTemplate.queryForObject(
            "SELECT interviewer_chat::text FROM rooms WHERE invite_code = ?",
            String::class.java,
            inviteCode,
        )?.let { objectMapper.readTree(it).path("messages").last().path("text").asText() })
    }

    @Test
    fun `assigned interviewer can manage team room steps notes ratings and verdict`() {
        postgres.verifyPostgres16()
        val owner = account("ti-command-owner")
        val creator = account("ti-command-creator")
        val interviewer = account("ti-command-int")
        val candidate = account("ti-command-cand")
        val team = team(owner, "Team room commands")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val firstTask = body(createTeamTask(owner, team.id, "Commands one", "First", "// one", "nodejs")).path("task")
        val secondTask = body(createTeamTask(owner, team.id, "Commands two", "Second", "// two", "kotlin")).path("task")
        val taskSet = body(
            createTaskSet(
                owner,
                team.id,
                "Commands set",
                listOf(firstTask.path("id").asText(), secondTask.path("id").asText()),
            ),
        ).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Commands team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val interviewerSessionId = "team-command-int-${UUID.randomUUID()}"
        val interviewerStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", interviewerSessionId)
            param("displayName", "Assigned interviewer")
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerStream, 200, "assigned interviewer can open team realtime stream")
        val interviewerRealtime = realtimePayload(interviewerStream)
        val interviewerEventToken = interviewerRealtime.path("eventToken").asText()

        val candidateSessionId = "team-command-cand-${UUID.randomUUID()}"
        val candidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", candidateSessionId)
            param("displayName", "Assigned candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateStream, 200, "assigned candidate can open team realtime stream")
        val candidateEventToken = realtimePayload(candidateStream).path("eventToken").asText()

        val candidateNotes = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "type" to "notes_update",
                    "notes" to "candidate must not edit notes",
                ),
            )
        }.andReturn()
        assertStatus(candidateNotes, 403, "assigned candidate cannot run manager-only room commands")
        assertBodyDoesNotContain(candidateNotes, roomId, inviteCode, "candidate must not edit notes")

        val notes = "Team interviewer notes ${UUID.randomUUID()}"
        val notesUpdate = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "notes_update",
                    "notes" to notes,
                ),
            )
        }.andReturn()
        assertStatus(notesUpdate, 204, "assigned interviewer can update team notes")

        val ratingUpdate = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "task_rating_update",
                    "stepIndex" to 0,
                    "rating" to 4,
                ),
            )
        }.andReturn()
        assertStatus(ratingUpdate, 204, "assigned interviewer can rate a team task")

        val setStep = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "set_step",
                    "stepIndex" to 1,
                ),
            )
        }.andReturn()
        assertStatus(setStep, 204, "assigned interviewer can switch a team room step")

        val candidateVerdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(candidate)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "candidate"))
        }.andReturn()
        assertStatus(candidateVerdict, 403, "assigned candidate cannot set team room verdict")
        assertBodyDoesNotContain(candidateVerdict, roomId, inviteCode, "candidate")

        val verdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "Team verdict"))
        }.andReturn()
        assertStatus(verdict, 200, "assigned interviewer can set team room verdict")
        val verdictPayload = body(verdict)
        assertEquals("finished", verdictPayload.path("status").asText())
        assertEquals("HIRE", verdictPayload.path("verdict").asText())

        val storedRoom = jdbcTemplate.queryForMap(
            """
            SELECT current_step, code, language, briefing_markdown, notes, private_notes_json, status, verdict, verdict_comment
            FROM rooms
            WHERE id = ?
            """.trimIndent(),
            roomId,
        )
        assertEquals(1, storedRoom["current_step"])
        assertEquals("// two", storedRoom["code"])
        assertEquals("kotlin", storedRoom["language"])
        assertEquals(notes, storedRoom["notes"])
        assertEquals("finished", storedRoom["status"])
        assertEquals("HIRE", storedRoom["verdict"])
        assertEquals("Team verdict", storedRoom["verdict_comment"])
        assertEquals(
            4,
            jdbcTemplate.queryForObject(
                "SELECT score FROM room_tasks WHERE room_id = ? AND step_index = 0",
                Int::class.java,
                roomId,
            ),
        )

        val lateNotes = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "notes_update",
                    "notes" to "late notes must not overwrite result history",
                ),
            )
        }.andReturn()
        assertStatus(lateNotes, 204, "finished manager can update notes")

        val lateRating = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "task_rating_update",
                    "stepIndex" to 0,
                    "rating" to 1,
                ),
            )
        }.andReturn()
        assertStatus(lateRating, 204, "finished manager can update scores")

        val lateStep = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "set_step",
                    "stepIndex" to 0,
                ),
            )
        }.andReturn()
        assertStatus(lateStep, 204, "finished manager can change published step")

        val lateCode = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "type" to "code_update",
                    "code" to "// late code must not overwrite result history",
                    "codeSequence" to 99,
                ),
            )
        }.andReturn()
        assertStatus(lateCode, 403, "finished candidate cannot update code")
        assertEquals("ROOM_READ_ONLY", body(lateCode).path("code").asText())

        val lateLanguage = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "language_update",
                    "language" to "python",
                ),
            )
        }.andReturn()
        assertStatus(lateLanguage, 204, "finished manager can update language")

        val lateBriefing = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "briefing_markdown_update",
                    "briefingMarkdown" to "late briefing must not overwrite result history",
                ),
            )
        }.andReturn()
        assertStatus(lateBriefing, 204, "finished manager can update briefing")

        val lateYjs = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "type" to "yjs_update",
                    "operationId" to UUID.randomUUID().toString(),
                    "yjsUpdate" to "AQ==",
                    "code" to "// late yjs code must not overwrite result history",
                    "yjsDocumentBase64" to "AQID",
                    "baseServerYjsSequence" to 0,
                ),
            )
        }.andReturn()
        assertStatus(lateYjs, 403, "finished candidate cannot submit Yjs updates")
        assertEquals("ROOM_READ_ONLY", body(lateYjs).path("code").asText())

        val latePrivateNote = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to interviewerSessionId,
                    "eventToken" to interviewerEventToken,
                    "type" to "private_note_entry",
                    "privateNoteId" to UUID.randomUUID().toString(),
                    "privateNoteText" to "late private note must not overwrite result history",
                    "privateNoteTimestampEpochMs" to 1_725_000_000_000L,
                ),
            )
        }.andReturn()
        assertStatus(latePrivateNote, 204, "finished manager can add private notes")

        val afterLateMutations = jdbcTemplate.queryForMap(
            """
            SELECT current_step, code, language, briefing_markdown, notes, private_notes_json
            FROM rooms
            WHERE id = ?
            """.trimIndent(),
            roomId,
        )
        assertEquals(0, afterLateMutations["current_step"])
        assertEquals("// one", afterLateMutations["code"], "denied candidate cannot replace manager's published code")
        assertEquals("python", afterLateMutations["language"])
        assertEquals("late briefing must not overwrite result history", afterLateMutations["briefing_markdown"])
        assertEquals("late notes must not overwrite result history", afterLateMutations["notes"])
        assertTrue(afterLateMutations["private_notes_json"].toString().contains("late private note must not overwrite result history"))
        assertEquals(
            1,
            jdbcTemplate.queryForObject(
                "SELECT score FROM room_tasks WHERE room_id = ? AND step_index = 0",
                Int::class.java,
                roomId,
            ),
            "finished result keeps the manager's corrected score",
        )
    }

    @Test
    fun `assigned interviewer can prepare team task through realtime manager workspace`() {
        postgres.verifyPostgres16()
        val owner = account("ti-mgrrt-owner")
        val creator = account("ti-mgrrt-creator")
        val interviewer = account("ti-mgrrt-int")
        val candidate = account("ti-mgrrt-cand")
        val team = team(owner, "Team realtime manager workspace")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val firstTask = body(createTeamTask(owner, team.id, "Public task", "Public", "// public", "nodejs")).path("task")
        val secondTask = body(createTeamTask(owner, team.id, "Prepared realtime task", "Private", "// draft", "kotlin")).path("task")
        val taskSet = body(
            createTaskSet(
                owner,
                team.id,
                "Realtime workspace set",
                listOf(firstTask.path("id").asText(), secondTask.path("id").asText()),
            ),
        ).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Realtime workspace team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val interviewerSessionId = "team-mgrrt-int-${UUID.randomUUID()}"
        val interviewerStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", interviewerSessionId)
            param("displayName", "Assigned interviewer")
            authorize(interviewer)
        }.andReturn()
        assertStatus(interviewerStream, 200, "assigned interviewer can open team realtime stream")
        val interviewerEventToken = realtimePayload(interviewerStream).path("eventToken").asText()

        val candidateSessionId = "team-mgrrt-cand-${UUID.randomUUID()}"
        val candidateStream = mockMvc.get("/api/realtime/rooms/$inviteCode/stream") {
            param("sessionId", candidateSessionId)
            param("displayName", "Assigned candidate")
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateStream, 200, "assigned candidate can open team realtime stream")
        val candidateEventToken = realtimePayload(candidateStream).path("eventToken").asText()

        val candidateOpen = mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "sessionId" to candidateSessionId,
                    "eventToken" to candidateEventToken,
                    "type" to "manager_workspace_open",
                    "stepIndex" to 1,
                ),
            )
        }.andReturn()
        assertStatus(candidateOpen, 403, "candidate cannot open manager workspace")
        assertBodyDoesNotContain(candidateOpen, roomId, inviteCode, "// draft")

        fun managerEvent(type: String, payload: Map<String, Any?>, stepIndex: Int = 1): MvcResult =
            mockMvc.post("/api/realtime/rooms/$inviteCode/events") {
                contentType = MediaType.APPLICATION_JSON
                content = objectMapper.writeValueAsString(
                    mapOf(
                        "sessionId" to interviewerSessionId,
                        "eventToken" to interviewerEventToken,
                        "type" to type,
                        "stepIndex" to stepIndex,
                    ) + payload,
                )
            }.andReturn()

        assertStatus(
            managerEvent("manager_workspace_open", emptyMap()),
            204,
            "assigned interviewer can open manager workspace for inactive team task",
        )
        assertStatus(
            managerEvent("manager_workspace_briefing_update", mapOf("value" to "Realtime private brief", "revision" to 0)),
            204,
            "assigned interviewer can update manager workspace briefing",
        )
        assertStatus(
            managerEvent("manager_workspace_language_update", mapOf("value" to "python", "revision" to 1)),
            204,
            "assigned interviewer can update manager workspace language",
        )
        assertStatus(
            managerEvent("manager_workspace_focus_mode_update", mapOf("focusMode" to true, "revision" to 2)),
            204,
            "assigned interviewer can update manager workspace focus mode",
        )
        assertStatus(
            managerEvent(
                "manager_workspace_yjs_update",
                mapOf(
                    "operationId" to UUID.randomUUID().toString(),
                    "yjsUpdate" to "AQ==",
                    "code" to "// realtime prepared",
                    "yjsDocumentBase64" to "AQIDBAU=",
                    "baseServerYjsSequence" to 0,
                ),
            ),
            204,
            "assigned interviewer can update manager workspace CRDT snapshot",
        )

        val preparedTask = jdbcTemplate.queryForMap(
            """
            SELECT solution_code, solution_language, briefing_markdown, workspace_focus_mode,
                   workspace_yjs_document_base64, workspace_yjs_sequence, workspace_revision
            FROM room_tasks
            WHERE room_id = ? AND step_index = 1
            """.trimIndent(),
            roomId,
        )
        assertEquals("// realtime prepared", preparedTask["solution_code"])
        assertEquals("python", preparedTask["solution_language"])
        assertEquals("Realtime private brief", preparedTask["briefing_markdown"])
        assertEquals(true, preparedTask["workspace_focus_mode"])
        assertEquals("AQIDBAU=", preparedTask["workspace_yjs_document_base64"])
        assertEquals(1L, preparedTask["workspace_yjs_sequence"])
        assertEquals(3L, preparedTask["workspace_revision"])

        assertStatus(
            managerEvent("set_step", mapOf("stepIndex" to 1)),
            204,
            "published team task can use realtime manager workspace snapshot",
        )
        val publishedRoom = jdbcTemplate.queryForMap(
            "SELECT current_step, code, language, briefing_markdown FROM rooms WHERE id = ?",
            roomId,
        )
        assertEquals(1, publishedRoom["current_step"])
        assertEquals("// realtime prepared", publishedRoom["code"])
        assertEquals("python", publishedRoom["language"])
        assertTrue(publishedRoom["briefing_markdown"].toString().contains("Realtime private brief"))

        assertStatus(
            managerEvent("manager_workspace_open", emptyMap(), stepIndex = 0),
            204,
            "assigned interviewer can open inactive workspace before the result is fixed",
        )
        val inactiveWorkspaceBeforeFinish = jdbcTemplate.queryForMap(
            """
            SELECT solution_code, solution_language, briefing_markdown, workspace_focus_mode,
                   workspace_yjs_document_base64, workspace_yjs_sequence, workspace_revision
            FROM room_tasks
            WHERE room_id = ? AND step_index = 0
            """.trimIndent(),
            roomId,
        )
        val verdict = mockMvc.post("/api/rooms/$inviteCode/verdict") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("verdict" to "HIRE", "verdictComment" to "Workspace done"))
        }.andReturn()
        assertStatus(verdict, 200, "assigned interviewer can finish workspace team interview")

        assertStatus(
            managerEvent(
                "manager_workspace_briefing_update",
                mapOf("value" to "late manager workspace brief", "revision" to inactiveWorkspaceBeforeFinish["workspace_revision"]),
                stepIndex = 0,
            ),
            204,
            "finished manager can update workspace briefing",
        )
        assertStatus(
            managerEvent(
                "manager_workspace_language_update",
                mapOf("value" to "java", "revision" to (inactiveWorkspaceBeforeFinish["workspace_revision"] as Number).toLong() + 1),
                stepIndex = 0,
            ),
            204,
            "finished manager can update workspace language",
        )
        assertStatus(
            managerEvent(
                "manager_workspace_focus_mode_update",
                mapOf("focusMode" to false, "revision" to (inactiveWorkspaceBeforeFinish["workspace_revision"] as Number).toLong() + 2),
                stepIndex = 0,
            ),
            204,
            "finished manager can update workspace focus",
        )
        assertStatus(
            managerEvent(
                "manager_workspace_yjs_update",
                mapOf(
                    "operationId" to UUID.randomUUID().toString(),
                    "yjsUpdate" to "AQ==",
                    "code" to "// late manager workspace code",
                    "yjsDocumentBase64" to "AQID",
                    "baseServerYjsSequence" to inactiveWorkspaceBeforeFinish["workspace_yjs_sequence"],
                ),
                stepIndex = 0,
            ),
            204,
            "finished manager can update workspace CRDT",
        )
        val lateRestWorkspace = mockMvc.put("/api/rooms/$inviteCode/tasks/0/workspace") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "code" to "// late REST workspace code",
                    "language" to "java",
                    "briefingMarkdown" to "late REST workspace brief",
                    "focusMode" to false,
                    "revision" to (inactiveWorkspaceBeforeFinish["workspace_revision"] as Number).toLong() + 3,
                    "yjsDocumentBase64" to "AQID",
                    "yjsSequence" to 99,
                ),
            )
        }.andReturn()
        assertStatus(lateRestWorkspace, 200, "finished manager can save REST workspace")
        val inactiveWorkspaceAfterLateWrites = jdbcTemplate.queryForMap(
            """
            SELECT solution_code, solution_language, briefing_markdown, workspace_focus_mode,
                   workspace_yjs_document_base64, workspace_yjs_sequence, workspace_revision
            FROM room_tasks
            WHERE room_id = ? AND step_index = 0
            """.trimIndent(),
            roomId,
        )
        assertEquals("// late REST workspace code", inactiveWorkspaceAfterLateWrites["solution_code"])
        assertEquals("java", inactiveWorkspaceAfterLateWrites["solution_language"])
        assertEquals("late REST workspace brief", inactiveWorkspaceAfterLateWrites["briefing_markdown"])
        assertEquals(false, inactiveWorkspaceAfterLateWrites["workspace_focus_mode"])
        assertEquals("AQID", inactiveWorkspaceAfterLateWrites["workspace_yjs_document_base64"])
        assertEquals(99L, inactiveWorkspaceAfterLateWrites["workspace_yjs_sequence"])
    }

    @Test
    fun `assigned interviewer can prepare and publish team room task workspace while candidate cannot`() {
        postgres.verifyPostgres16()
        val owner = account("ti-ws-owner")
        val creator = account("ti-ws-creator")
        val interviewer = account("ti-ws-int")
        val candidate = account("ti-ws-cand")
        val team = team(owner, "Team room manager workspace")
        seedMembership(team.id, creator.id, role = "MEMBER")
        seedMembership(team.id, interviewer.id, role = "MEMBER")

        val firstTask = body(createTeamTask(owner, team.id, "Published task", "Published brief", "// published", "nodejs")).path("task")
        val secondTask = body(createTeamTask(owner, team.id, "Prepared task", "Prepared brief", "// prepared", "kotlin")).path("task")
        val taskSet = body(
            createTaskSet(
                owner,
                team.id,
                "Workspace set",
                listOf(firstTask.path("id").asText(), secondTask.path("id").asText()),
            ),
        ).path("taskSet")
        val created = createTeamInterview(
            actor = creator,
            teamId = team.id,
            key = UUID.randomUUID().toString(),
            title = "Workspace team interview",
            taskSetId = taskSet.path("id").asText(),
            trackId = null,
            vacancyId = null,
            interviewerIds = listOf(interviewer.id),
            candidateIds = emptyList(),
        )
        assertStatus(created, 201, "team interview fixture must be created")
        val interview = body(created).path("interview")
        val roomId = interview.path("id").asText()
        val inviteCode = interview.path("inviteCode").asText()

        val initialWorkspace = mockMvc.get("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(initialWorkspace, 200, "assigned interviewer can read non-public team task workspace")
        assertEquals("// prepared", body(initialWorkspace).path("code").asText())
        assertEquals("kotlin", body(initialWorkspace).path("language").asText())
        assertEquals(0L, body(initialWorkspace).path("revision").asLong())

        val candidateWorkspace = mockMvc.get("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(candidate)
        }.andReturn()
        assertStatus(candidateWorkspace, 403, "assigned candidate cannot read manager-only workspace")
        assertBodyDoesNotContain(candidateWorkspace, roomId, inviteCode, "// prepared")

        val updatedWorkspace = mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "code" to "// prepared by interviewer",
                    "language" to "python",
                    "briefingMarkdown" to "Prepared private brief",
                    "focusMode" to true,
                    "revision" to 0,
                    "yjsDocumentBase64" to "AQID",
                    "yjsSequence" to 7,
                ),
            )
        }.andReturn()
        assertStatus(updatedWorkspace, 200, "assigned interviewer can save non-public team task workspace")
        val updatedPayload = body(updatedWorkspace)
        assertEquals("// prepared by interviewer", updatedPayload.path("code").asText())
        assertEquals("python", updatedPayload.path("language").asText())
        assertEquals("Prepared private brief", updatedPayload.path("briefingMarkdown").asText())
        assertEquals(true, updatedPayload.path("focusMode").asBoolean())
        assertEquals(1L, updatedPayload.path("revision").asLong())
        assertEquals("AQID", updatedPayload.path("yjsDocumentBase64").asText())
        assertEquals(7L, updatedPayload.path("yjsSequence").asLong())

        val staleWorkspace = mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("code" to "// stale", "revision" to 0))
        }.andReturn()
        assertStatus(staleWorkspace, 409, "team task workspace save must enforce revision")

        val candidateSave = mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(candidate)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("code" to "// candidate overwrite", "revision" to 1))
        }.andReturn()
        assertStatus(candidateSave, 403, "assigned candidate cannot save manager-only workspace")
        assertBodyDoesNotContain(candidateSave, roomId, inviteCode, "// prepared by interviewer")

        val published = mockMvc.post("/api/rooms/$inviteCode/next-step") {
            authorize(interviewer)
        }.andReturn()
        assertStatus(published, 200, "assigned interviewer can publish prepared team task")
        val publishedPayload = body(published)
        assertEquals(1, publishedPayload.path("currentStep").asInt())
        assertEquals("// prepared by interviewer", publishedPayload.path("code").asText())
        assertEquals("python", publishedPayload.path("language").asText())
        assertEquals(true, publishedPayload.path("briefingMarkdown").asText().contains("Prepared private brief"))

        jdbcTemplate.update(
            "UPDATE team_memberships SET state = 'REMOVED', epoch = epoch + 1, revision = revision + 1 WHERE team_id = ? AND user_id = ?",
            team.id,
            interviewer.id,
        )
        val removedInterviewerSave = mockMvc.put("/api/rooms/$inviteCode/tasks/1/workspace") {
            authorize(interviewer)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("code" to "// removed", "revision" to 1))
        }.andReturn()
        assertStatus(removedInterviewerSave, 403, "removed interviewer cannot keep saving a team task workspace")
        assertBodyDoesNotContain(removedInterviewerSave, roomId, inviteCode, interviewer.id, "// removed")
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorize(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "team fixture must exist")
        return TeamFixture(body(result).path("team").path("id").asText())
    }

    private fun seedMembership(teamId: String, userId: String, role: String) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role,
        )
    }

    private fun createTeamTask(
        actor: HrTestAccount,
        teamId: String,
        title: String,
        description: String,
        starterCode: String,
        language: String,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to description,
                    "starterCode" to starterCode,
                    "language" to language,
                ),
            )
        }.andReturn()

    private fun updateTeamTask(
        actor: HrTestAccount,
        teamId: String,
        taskId: String,
        title: String,
        description: String,
        starterCode: String,
        language: String,
        revision: Long,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tasks/$taskId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to description,
                    "starterCode" to starterCode,
                    "language" to language,
                    "revision" to revision,
                ),
            )
        }.andReturn()

    private fun createTaskSet(actor: HrTestAccount, teamId: String, name: String, taskIds: List<String>): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskIds" to taskIds))
        }.andReturn()

    private fun createTrack(actor: HrTestAccount, teamId: String, name: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()

    private fun createVacancy(actor: HrTestAccount, teamId: String, trackId: String, title: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to title))
        }.andReturn()

    private fun saveTrackProgrammeDraft(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        taskIds: List<String>,
        revision: Long?,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId/programme/draft") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                buildMap {
                    put("taskIds", taskIds)
                    revision?.let { put("revision", it) }
                },
            )
        }.andReturn()

    private fun publishTrackProgramme(actor: HrTestAccount, teamId: String, trackId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/programme/publish") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun archiveTrackProgramme(actor: HrTestAccount, teamId: String, trackId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/programme/archive") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun saveVacancyProgrammeDraft(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        taskIds: List<String>,
        revision: Long?,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme/draft") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                buildMap {
                    put("taskIds", taskIds)
                    revision?.let { put("revision", it) }
                },
            )
        }.andReturn()

    private fun publishVacancyProgramme(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        revision: Long,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme/publish") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun archiveVacancyProgramme(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        revision: Long,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme/archive") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun createTeamInterview(
        actor: HrTestAccount,
        teamId: String,
        key: String,
        title: String,
        taskSetId: String?,
        trackId: String?,
        vacancyId: String?,
        interviewerIds: List<String> = emptyList(),
        candidateIds: List<String> = emptyList(),
        expectedProgrammeId: String? = null,
        expectedProgrammeVersion: Long? = null,
        taskIds: List<String> = emptyList(),
        selectedTaskIds: List<String>? = null,
    ): MvcResult {
        val requestBody = mutableMapOf<String, Any?>(
            "title" to title,
            "taskSetId" to taskSetId,
            "taskIds" to taskIds,
            "trackId" to trackId,
            "vacancyId" to vacancyId,
            "interviewerIds" to interviewerIds,
            "candidateIds" to candidateIds,
            "programmeId" to expectedProgrammeId,
            "programmeVersion" to expectedProgrammeVersion,
        )
        selectedTaskIds?.let { requestBody["selectedTaskIds"] = it }
        return mockMvc.post("/api/teams/$teamId/interviews") {
            authorize(actor)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(requestBody)
        }.andReturn()
    }

    private fun listTeamInterviews(actor: HrTestAccount, teamId: String, ownership: String? = null): MvcResult =
        mockMvc.get("/api/teams/$teamId/interviews") {
            authorize(actor)
            ownership?.let { param("ownership", it) }
        }.andReturn()

    private fun createOwnerOffer(
        actor: HrTestAccount,
        teamId: String,
        interviewId: String,
        targetUserId: String,
        key: String,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/owner-offers") {
            authorize(actor)
            header("Idempotency-Key", key)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("targetUserId" to targetUserId))
        }.andReturn()

    private fun acceptOwnerOffer(actor: HrTestAccount, teamId: String, interviewId: String, offerId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/owner-offers/$offerId/accept") {
            authorize(actor)
        }.andReturn()

    private fun declineOwnerOffer(actor: HrTestAccount, teamId: String, interviewId: String, offerId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/owner-offers/$offerId/decline") {
            authorize(actor)
        }.andReturn()

    private fun archiveTeamInterview(actor: HrTestAccount, teamId: String, interviewId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/archive") {
            authorize(actor)
        }.andReturn()

    private fun freezeTeamInterview(actor: HrTestAccount, teamId: String, interviewId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/freeze") {
            authorize(actor)
        }.andReturn()

    private fun resumeTeamInterview(actor: HrTestAccount, teamId: String, interviewId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/interviews/$interviewId/resume") {
            authorize(actor)
        }.andReturn()

    private fun listOwnerOffers(actor: HrTestAccount, teamId: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/interview-owner-offers") {
            authorize(actor)
            param("status", "pending")
        }.andReturn()

    private fun createInvitation(actor: HrTestAccount, teamId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/invitations") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andReturn()

    private fun invitationToken(created: MvcResult, actor: HrTestAccount, teamId: String): String {
        assertStatus(created, 201, "rejoin invitation must be created")
        val invitationId = body(created).path("invitation").path("id").asText()
        val revealed = mockMvc.get("/api/teams/$teamId/invitations/$invitationId/link") {
            authorize(actor)
        }.andReturn()
        assertStatus(revealed, 200, "rejoin invitation link must be revealable by issuer")
        val url = body(revealed).path("url").asText()
        return URI("https://local.test$url").fragment.removePrefix("token=")
    }

    private fun acceptInvitation(actor: HrTestAccount, token: String): MvcResult =
        mockMvc.post("/api/team-invitations/accept") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("token" to token))
        }.andReturn()

    private fun leaveTeam(actor: HrTestAccount, teamId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/leave") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
        }.andReturn()

    private fun suspendMember(actor: HrTestAccount, teamId: String, userId: String, key: String): MvcResult =
        mockMvc.post("/api/__test/teams/$teamId/members/$userId/suspend") {
            authorize(actor)
            header("Idempotency-Key", key)
        }.andReturn()

    private fun resumeMember(actor: HrTestAccount, teamId: String, userId: String, key: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/members/$userId/resume") {
            authorize(actor)
            header("Idempotency-Key", key)
        }.andReturn()

    private fun removeMember(actor: HrTestAccount, teamId: String, userId: String): MvcResult =
        mockMvc.delete("/api/teams/$teamId/members/$userId") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
        }.andReturn()

    private fun countRoomsForTeam(teamId: String): Long =
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE team_id = ?", Long::class.java, teamId) ?: 0

    private fun displayNameFor(userId: String): String = jdbcTemplate.queryForObject(
        "SELECT display_name FROM users WHERE id = ?",
        String::class.java,
        userId,
    ).orEmpty()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.getContentAsString(StandardCharsets.UTF_8))

    private fun realtimePayload(stream: MvcResult): JsonNode {
        val payload = stream.response.contentAsString.lineSequence()
            .filter { it.startsWith("data:") }
            .map { objectMapper.readTree(it.removePrefix("data:")) }
            .filter { it.path("type").asText() == "state_sync" }
            .last().path("payload")
        assertTrue(payload.path("eventToken").asText().startsWith("evt_"), "fixture must obtain a realtime eventToken")
        return payload
    }

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertEquals(expected, result.response.status, "unexpected team-interview status")
        assertEquals(code, body(result).path("code").asText(), "unexpected team-interview error code")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "team interview response must be private and non-cacheable")
    }

    private fun assertBodyDoesNotContain(result: MvcResult, vararg forbidden: String) {
        val responseBody = result.response.getContentAsString(StandardCharsets.UTF_8)
        forbidden.forEach { value ->
            assertFalse(responseBody.contains(value), "denial must not disclose protected value $value")
        }
    }

    private data class TeamFixture(val id: String)
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}

/** Seeds historical suspension states for recovery tests without a public suspend endpoint. */
@RestController
@ConditionalOnProperty(name = ["test.fixture.suspension"], havingValue = "true")
@RequestMapping("/api/__test/teams")
class TeamSuspensionFixtureController(
    private val authService: AuthService,
    private val managementService: TeamManagementService,
) {
    @PostMapping("/{teamId}/members/{userId}/suspend")
    fun suspend(
        @RequestHeader("Authorization") authorization: String,
        @RequestHeader("Idempotency-Key") key: String,
        @PathVariable teamId: String,
        @PathVariable userId: String,
    ) = managementService.suspendMember(
        authService.requireUserByToken(authorization.removePrefix("Bearer ").trim()),
        teamId,
        userId,
        UUID.fromString(key),
    )
}
