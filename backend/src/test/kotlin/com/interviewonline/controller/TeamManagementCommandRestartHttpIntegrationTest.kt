package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.InterviewOnlineApplication
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.http.MediaType
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/**
 * The restart proof is intentionally real HTTP on a separate random port. It
 * shares only the owned PostgreSQL schema and never touches the user's local
 * :5173/:8080 processes.
 */
class TeamManagementCommandRestartHttpIntegrationTest {
    companion object {
        private val postgres = Postgres16TestSupport.create("team_management_restart")

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    private val objectMapper = ObjectMapper()
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()

    @Test
    fun `M5 rename replay survives restart and returns recorded outcome with current safe team`() {
        postgres.verifyPostgres16()
        var first: ConfigurableApplicationContext? = null
        var restarted: ConfigurableApplicationContext? = null
        try {
            first = startApplication()
            val port = applicationPort(first)
            val owner = register(port, "restart-rename-owner")
            val team = createTeam(port, owner, "Restart rename")
            val keyA = UUID.randomUUID().toString()
            val firstRename = patchJson(port, "/api/teams/${team.id}", mapOf("name" to "First name", "revision" to team.revision), owner.token, keyA)
            assertHttpStatus(firstRename, 200, "M5_RESTART_RENAME_COMMAND_MISSING")
            assertHttpNoStore(firstRename)
            assertExactRenameHttp(firstRename, "First name", recovered = false)
            val firstRevision = json(firstRename).path("team").path("revision").asLong()
            val later = patchJson(port, "/api/teams/${team.id}", mapOf("name" to "Current name", "revision" to firstRevision), owner.token, UUID.randomUUID().toString())
            assertHttpStatus(later, 200, "M5_RESTART_RENAME_LATER_MUTATION_MISSING")
            first.close(); first = null

            restarted = startApplication()
            val replay = patchJson(applicationPort(restarted), "/api/teams/${team.id}", mapOf("name" to "First name", "revision" to team.revision), owner.token, keyA)
            assertHttpStatus(replay, 200, "M5_RESTART_RENAME_REPLAY_MISSING")
            assertHttpNoStore(replay)
            assertExactRenameHttp(replay, "Current name", recovered = true)
            assertEquals("RENAMED", json(replay).path("outcome").asText())
        } finally {
            restarted?.close()
            first?.close()
        }
    }

    @Test
    fun `M5 role replay survives restart and returns recorded outcome with current safe member`() {
        var first: ConfigurableApplicationContext? = null
        var restarted: ConfigurableApplicationContext? = null
        try {
            first = startApplication()
            val port = applicationPort(first)
            val owner = register(port, "restart-role-owner")
            val member = register(port, "restart-role-member")
            val team = createTeam(port, owner, "Restart role")
            seedActiveMember(team.id, member.id, revision = 6)
            val keyA = UUID.randomUUID().toString()
            val firstRole = patchJson(port, "/api/teams/${team.id}/members/${member.id}", mapOf("role" to "ADMIN", "revision" to 6), owner.token, keyA)
            assertHttpStatus(firstRole, 200, "M5_RESTART_ROLE_COMMAND_MISSING")
            assertHttpNoStore(firstRole)
            assertExactRoleHttp(firstRole, member.id, "ADMIN", recovered = false)
            val firstRevision = json(firstRole).path("member").path("revision").asLong()
            val later = patchJson(port, "/api/teams/${team.id}/members/${member.id}", mapOf("role" to "MEMBER", "revision" to firstRevision), owner.token, UUID.randomUUID().toString())
            assertHttpStatus(later, 200, "M5_RESTART_ROLE_LATER_MUTATION_MISSING")
            first.close(); first = null

            restarted = startApplication()
            val replay = patchJson(applicationPort(restarted), "/api/teams/${team.id}/members/${member.id}", mapOf("role" to "ADMIN", "revision" to 6), owner.token, keyA)
            assertHttpStatus(replay, 200, "M5_RESTART_ROLE_REPLAY_MISSING")
            assertHttpNoStore(replay)
            assertExactRoleHttp(replay, member.id, "MEMBER", recovered = true)
            assertEquals("ROLE_UPDATED", json(replay).path("outcome").asText())
        } finally {
            restarted?.close()
            first?.close()
        }
    }

    private fun startApplication(): ConfigurableApplicationContext =
        SpringApplicationBuilder(InterviewOnlineApplication::class.java)
            .web(WebApplicationType.SERVLET)
            .run(
                *(postgres.applicationProperties() + mapOf(
                    "server.port" to 0,
                    "app.team-invitation-link-encryption.active-key-id" to "integration-v1",
                    "app.team-invitation-link-encryption.keys.integration-v1" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                    "spring.main.banner-mode" to "off",
                )).map { (name, value) -> "--$name=$value" }.toTypedArray(),
            )

    private fun applicationPort(application: ConfigurableApplicationContext): Int =
        application.environment.getRequiredProperty("local.server.port").toInt()

    private fun register(port: Int, prefix: String): HttpAccount {
        val suffix = UUID.randomUUID().toString().replace("-", "").take(10)
        val result = postJson(port, "/api/auth/register", mapOf("nickname" to "$prefix-$suffix", "displayName" to "$prefix $suffix", "password" to "secret-$suffix", "isHr" to false))
        assertHttpStatus(result, 200, "M5_RESTART_ACCOUNT_FIXTURE_MISSING")
        val body = json(result)
        return HttpAccount(body.path("user").path("id").asText(), body.path("token").asText())
    }

    private fun createTeam(port: Int, owner: HttpAccount, name: String): HttpTeam {
        val result = postJson(port, "/api/teams", mapOf("name" to name), owner.token, UUID.randomUUID().toString())
        assertHttpStatus(result, 201, "M5_RESTART_TEAM_FIXTURE_MISSING")
        val id = json(result).path("team").path("id").asText()
        return HttpTeam(id, currentTeamRevision(id))
    }

    private fun seedActiveMember(teamId: String, userId: String, revision: Long) {
        postgres.connection().use { connection ->
            connection.prepareStatement(
                "INSERT INTO team_memberships (id,team_id,user_id,role,state,epoch,revision,created_at,updated_at) VALUES (?,?,?,'MEMBER','ACTIVE',0,?,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            ).use { statement ->
                statement.setString(1, UUID.randomUUID().toString())
                statement.setString(2, teamId)
                statement.setString(3, userId)
                statement.setLong(4, revision)
                statement.executeUpdate()
            }
        }
    }

    private fun currentTeamRevision(teamId: String): Long = postgres.connection().use { connection ->
        connection.prepareStatement("SELECT revision FROM teams WHERE id=?").use { statement ->
            statement.setString(1, teamId)
            statement.executeQuery().use { result -> assertTrue(result.next()); result.getLong(1) }
        }
    }

    private fun postJson(port: Int, path: String, payload: Any, token: String? = null, key: String? = null): HttpResult =
        request(port, path, "POST", payload, token, key)

    private fun patchJson(port: Int, path: String, payload: Any, token: String, key: String): HttpResult =
        request(port, path, "PATCH", payload, token, key)

    private fun request(port: Int, path: String, method: String, payload: Any, token: String? = null, key: String? = null): HttpResult {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .method(method, HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload)))
            .apply {
                token?.let { header("Authorization", "Bearer $it") }
                key?.let { header("Idempotency-Key", it) }
            }
            .build()
        val response = http.send(request, HttpResponse.BodyHandlers.ofByteArray())
        return HttpResult(response.statusCode(), response.body(), response.headers())
    }

    private fun json(result: HttpResult): JsonNode = objectMapper.readTree(result.body)

    private fun assertHttpStatus(result: HttpResult, expected: Int, marker: String) {
        assertEquals(expected, result.status, "$marker: ${result.bodyText()}")
    }

    private fun assertHttpNoStore(result: HttpResult) {
        assertEquals("private, no-store", result.headers.firstValue("Cache-Control").orElse(null))
    }

    private fun assertExactRenameHttp(result: HttpResult, name: String, recovered: Boolean) {
        val body = json(result)
        assertEquals(setOf("outcome", "recovered", "team"), body.fieldNames().asSequence().toSet())
        assertEquals(recovered, body.path("recovered").asBoolean())
        assertEquals(setOf("id", "name", "role", "revision"), body.path("team").fieldNames().asSequence().toSet())
        assertEquals(name, body.path("team").path("name").asText())
    }

    private fun assertExactRoleHttp(result: HttpResult, userId: String, role: String, recovered: Boolean) {
        val body = json(result)
        assertEquals(setOf("outcome", "recovered", "member"), body.fieldNames().asSequence().toSet())
        assertEquals(recovered, body.path("recovered").asBoolean())
        val member = body.path("member")
        assertEquals(setOf("userId", "displayName", "role", "state", "revision"), member.fieldNames().asSequence().toSet())
        assertEquals(userId, member.path("userId").asText())
        assertEquals(role, member.path("role").asText())
    }

    private data class HttpAccount(val id: String, val token: String)
    private data class HttpTeam(val id: String, val revision: Long)
    private data class HttpResult(val status: Int, val body: ByteArray, val headers: java.net.http.HttpHeaders) {
        fun bodyText(): String = body.toString(Charsets.UTF_8)
    }
}
