package com.interviewonline.controller

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
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.http.MediaType
import java.util.UUID

/** The retired rollout property must not alter availability or authorization. */
@SpringBootTest(properties = ["app.features.team-workspaces-enabled=false"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamWorkspaceLegacyConfigurationIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_legacy_configuration")
        @JvmStatic @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `legacy false configuration permits team and invitation lifecycle while preserving access boundaries`() {
        verifyTeamAvailability(mockMvc, objectMapper, jdbcTemplate, "legacy")
    }
}

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamWorkspaceDefaultConfigurationIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_default_configuration")
        @JvmStatic @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `default configuration permits team and invitation lifecycle while preserving access boundaries`() {
        assertFalse(System.getenv().containsKey("FEATURE_TEAM_WORKSPACES"), "Default configuration runs without the retired environment variable")
        verifyTeamAvailability(mockMvc, objectMapper, jdbcTemplate, "default")
    }
}

private fun verifyTeamAvailability(mockMvc: MockMvc, objectMapper: ObjectMapper, jdbcTemplate: JdbcTemplate, prefix: String) {
    val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "$prefix-owner").first
    val member = HrHttpFixtures.register(mockMvc, objectMapper, false, "$prefix-member").first
    val stranger = HrHttpFixtures.register(mockMvc, objectMapper, false, "$prefix-stranger").first
    fun request(path: String, actor: HrTestAccount?, body: String): MvcResult = mockMvc.post(path) {
        actor?.let { header("Authorization", "Bearer ${it.token}") }
        header("Idempotency-Key", UUID.randomUUID().toString())
        contentType = MediaType.APPLICATION_JSON
        content = body
    }.andReturn()
    fun protected(result: MvcResult, status: Int) {
        assertEquals(status, result.response.status)
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"))
    }
    val created = request("/api/teams", owner, """{"name":"Available $prefix team"}""")
    protected(created, 201)
    val teamId = objectMapper.readTree(created.response.contentAsString).path("team").path("id").asText()
    assertTrue(teamId.isNotBlank())
    val workspaces = mockMvc.get("/api/me/workspaces") { header("Authorization", "Bearer ${owner.token}") }.andReturn()
    protected(workspaces, 200)
    assertTrue(workspaces.response.contentAsString.contains(teamId))
    val issued = request("/api/teams/$teamId/invitations", owner, "{}")
    protected(issued, 201)
    assertFalse(issued.response.contentAsString.contains("url"), "Invitation metadata does not disclose a bearer")
    val invitationId = objectMapper.readTree(issued.response.contentAsString).path("invitation").path("id").asText()
    val revealed = mockMvc.get("/api/teams/$teamId/invitations/$invitationId/link") {
        header("Authorization", "Bearer ${owner.token}")
    }.andReturn()
    protected(revealed, 200)
    val token = objectMapper.readTree(revealed.response.contentAsString).path("url").asText().substringAfter("#token=")
    assertTrue(token.isNotBlank())
    protected(request("/api/team-invitations/preview", null, """{"token":"$token"}"""), 200)
    protected(request("/api/team-invitations/accept", member, """{"token":"$token"}"""), 200)
    val invitationsBeforeDenials = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations WHERE team_id=?", Long::class.java, teamId)
    val memberDenied = request("/api/teams/$teamId/invitations", member, "{}")
    protected(memberDenied, 403)
    assertEquals("INVITATION_MANAGEMENT_FORBIDDEN", objectMapper.readTree(memberDenied.response.contentAsString).path("code").asText())
    val strangerDenied = request("/api/teams/$teamId/invitations", stranger, "{}")
    protected(strangerDenied, 404)
    assertEquals("TEAM_NOT_FOUND", objectMapper.readTree(strangerDenied.response.contentAsString).path("code").asText())
    val anonymousDenied = request("/api/teams", null, """{"name":"Unauthorized team"}""")
    protected(anonymousDenied, 401)
    listOf(memberDenied, strangerDenied, anonymousDenied).forEach { denied ->
        assertFalse(denied.response.contentAsString.contains(token), "Access denials do not disclose invitation bearers")
        assertFalse(denied.response.contentAsString.contains(owner.token), "Access denials do not disclose authorization bearers")
    }
    assertEquals(invitationsBeforeDenials, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations WHERE team_id=?", Long::class.java, teamId), "Permission denials do not mutate the shared link")
    val revoked = request("/api/teams/$teamId/invitations/$invitationId/revoke", owner, """{"revision":0}""")
    protected(revoked, 200)
    protected(request("/api/team-invitations/preview", null, """{"token":"$token"}"""), 410)
    val persisted = jdbcTemplate.queryForList("SELECT row_to_json(receipt)::text FROM command_receipts receipt WHERE scope_id=? UNION ALL SELECT row_to_json(event)::text FROM team_audit_events event WHERE team_id=?", String::class.java, teamId, teamId).joinToString()
    assertFalse(persisted.contains(token), "Command recovery and audit do not persist invitation bearers")
}
