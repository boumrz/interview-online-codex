package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import com.interviewonline.InterviewOnlineApplication
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.sql.Timestamp
import java.time.ZoneOffset
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Feature-off and exact parsing checks retained after replacing the one-use invitation contract. */
private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}

@SpringBootTest(properties = ["app.features.team-workspaces-enabled=false"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamInvitationFeatureOffIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_invitation_feature_off")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `INT-02 explicitly disabled invitations preserve safe reads reject capability increases and still allow revoke`() {
        val actor = HrHttpFixtures.register(mockMvc, objectMapper, false, "invite-off").first
        val teamId = seedReadableTeam(jdbcTemplate, actor, "Feature off team")
        val workspaces = mockMvc.get("/api/me/workspaces") { authorize(actor) }.andReturn()
        assertEquals(200, workspaces.response.status, "AC03_DISABLED_SAFE_READ_MISSING")
        assertEquals("private, no-store", workspaces.response.getHeader("Cache-Control"))
        assertTrue(workspaces.response.contentAsString.contains(teamId))
        val invitationsBefore = if (tableExists(jdbcTemplate, "team_invitations")) jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations", Long::class.java) else null
        val receiptsBefore = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM command_receipts", Long::class.java) ?: -1L
        val auditBefore = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_audit_events", Long::class.java) ?: -1L
        listOf(
            mockMvc.post("/api/teams/$teamId/invitations") {
                authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = "{}"
            }.andReturn(),
            mockMvc.post("/api/team-invitations/preview") {
                contentType = MediaType.APPLICATION_JSON; content = """{"token":"${"A".repeat(43)}"}"""
            }.andReturn(),
            mockMvc.post("/api/team-invitations/accept") {
                authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = """{"token":"${"A".repeat(43)}"}"""
            }.andReturn(),
            mockMvc.post("/api/teams/$teamId/invitations/${UUID.randomUUID()}/reissue") {
                authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = """{"revision":0}"""
            }.andReturn(),
        ).forEach { result -> assertFeatureDisabled(result, "AC03_FEATURE_OFF_INVITATION_NOT_DISABLED") }
        invitationsBefore?.let { assertEquals(it, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations", Long::class.java), "feature-off invitation paths must not mutate invitations") }
        assertEquals(receiptsBefore, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM command_receipts", Long::class.java), "feature-off invitation paths must not mutate receipts")
        assertEquals(auditBefore, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_audit_events", Long::class.java), "feature-off invitation paths must not mutate audit")

        assertTrue(tableExists(jdbcTemplate, "team_invitations"), "AC03_FEATURE_OFF_INVITATION_SCHEMA_MISSING")
        val pending = seedPendingInvitation(jdbcTemplate, teamId, actor.id)
        val revoked = mockMvc.post("/api/teams/$teamId/invitations/${pending.id}/revoke") {
            authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = """{"revision":0}"""
        }.andReturn()
        assertEquals(200, revoked.response.status, "AC03_FEATURE_OFF_REVOKE_MISSING")
        assertEquals("private, no-store", revoked.response.getHeader("Cache-Control"), "security-reducing revoke remains protected when flag is off")
        assertEquals("REVOKED", jdbcTemplate.queryForObject("SELECT state FROM team_invitations WHERE id=?", String::class.java, pending.id))
        val persistedAfterRevoke = jdbcTemplate.queryForList(
            "SELECT row_to_json(receipt)::text FROM command_receipts receipt WHERE scope_id=? UNION ALL SELECT row_to_json(event)::text FROM team_audit_events event WHERE team_id=?",
            String::class.java,
            teamId,
            teamId,
        ).joinToString()
        assertFalse(persistedAfterRevoke.contains(pending.token), "feature-off revoke must not persist its raw secret in receipt/audit rows")
    }
}

/**
 * This boots the real application with no feature override. The verification
 * command removes FEATURE_TEAM_WORKSPACES from its process environment.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamInvitationFeatureDefaultConfigurationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_invitation_feature_default")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `INT-02 absent environment feature default disables actual invitation endpoints without mutation`() {
        assertFalse(System.getenv().containsKey("FEATURE_TEAM_WORKSPACES"), "AC03_DEFAULT_TEST_REQUIRES_ENV_ABSENT")
        val actor = HrHttpFixtures.register(mockMvc, objectMapper, false, "invite-default").first
        val teamId = seedReadableTeam(jdbcTemplate, actor, "Feature default team")
        val invitationsBefore = if (tableExists(jdbcTemplate, "team_invitations")) jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations", Long::class.java) else null
        val receiptsBefore = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM command_receipts", Long::class.java) ?: -1L
        val auditBefore = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_audit_events", Long::class.java) ?: -1L
        listOf(
            mockMvc.post("/api/teams/$teamId/invitations") { authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = "{}" }.andReturn(),
            mockMvc.post("/api/team-invitations/preview") { contentType = MediaType.APPLICATION_JSON; content = """{"token":"${"A".repeat(43)}"}""" }.andReturn(),
            mockMvc.post("/api/team-invitations/accept") { authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = """{"token":"${"A".repeat(43)}"}""" }.andReturn(),
            mockMvc.post("/api/teams/$teamId/invitations/${UUID.randomUUID()}/reissue") { authorize(actor); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; content = """{"revision":0}""" }.andReturn(),
        ).forEach { assertFeatureDisabled(it, "AC03_FEATURE_DEFAULT_ENDPOINT_NOT_DISABLED") }
        invitationsBefore?.let { assertEquals(it, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations", Long::class.java), "default-off invitation paths must not mutate invitations") }
        assertEquals(receiptsBefore, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM command_receipts", Long::class.java), "default-off invitation paths must not mutate receipts")
        assertEquals(auditBefore, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_audit_events", Long::class.java), "default-off invitation paths must not mutate audit")
    }
}

@SpringBootTest(properties = ["app.features.team-workspaces-enabled=TRUE"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamWorkspaceFeatureExactParsingIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_feature_exact")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `only the exact raw lowercase true enables workspace and invitation capabilities`() {
        val actor = HrHttpFixtures.register(mockMvc, objectMapper, false, "feature-exact").first
        val teamId = seedReadableTeam(jdbcTemplate, actor, "Strict feature team")
        val createTeam = mockMvc.post("/api/teams") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Must remain disabled"}"""
        }.andReturn()
        assertFeatureDisabled(createTeam, "FEATURE_GATE_WORKSPACE_CASE_FOLDING")
        val createInvitation = mockMvc.post("/api/teams/$teamId/invitations") {
            authorize(actor)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = "{}"
        }.andReturn()
        assertFeatureDisabled(createInvitation, "FEATURE_GATE_INVITATION_CASE_FOLDING")
        val preview = mockMvc.post("/api/team-invitations/preview") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"token":"${"A".repeat(43)}"}"""
        }.andReturn()
        assertFeatureDisabled(preview, "FEATURE_GATE_PREVIEW_CASE_FOLDING")
    }
}

private fun seedReadableTeam(jdbcTemplate: JdbcTemplate, actor: HrTestAccount, name: String): String {
    val teamId = UUID.randomUUID().toString()
    jdbcTemplate.update(
        """
        INSERT INTO teams (id, name, normalized_name, owner_user_id, state, revision, security_revision, merge_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        """.trimIndent(),
        teamId, name, name.lowercase(), actor.id,
    )
    jdbcTemplate.update(
        """
        INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
        VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        """.trimIndent(),
        UUID.randomUUID().toString(), teamId, actor.id,
    )
    return teamId
}

private fun seedPendingInvitation(jdbcTemplate: JdbcTemplate, teamId: String, creatorId: String): PendingInvitationFixture {
    val tokenBytes = ByteArray(32).also(SecureRandom()::nextBytes)
    val token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes)
    val invitationId = UUID.randomUUID().toString()
    jdbcTemplate.update(
        """
        INSERT INTO team_invitations (id, team_id, token_hash, creator_user_id, role, expires_at, state, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'MEMBER', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '7 days', 'PENDING', 0,
                CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        """.trimIndent(),
        invitationId, teamId, MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }, creatorId,
    )
    return PendingInvitationFixture(invitationId, token)
}

private data class PendingInvitationFixture(val id: String, val token: String)

private fun tableExists(jdbcTemplate: JdbcTemplate, table: String): Boolean = jdbcTemplate.queryForObject(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?)",
    Boolean::class.java,
    table,
) ?: false

private fun assertFeatureDisabled(result: MvcResult, marker: String) {
    assertEquals(404, result.response.status, marker)
    assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "$marker must not be cacheable")
    val node = ObjectMapper().readTree(result.response.contentAsString)
    assertEquals(setOf("error", "code"), node.fieldNames().asSequence().toSet(), "$marker uses the exact safe D6 envelope")
    assertEquals("FEATURE_DISABLED", node.path("code").asText(), "$marker must return safe feature code")
    assertFalse(result.response.contentAsString.contains("token"), "$marker must not disclose secret material")
}

