package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.InterviewOnlineApplication
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.WebApplicationType
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.ApplicationContext
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.post
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(properties = [
    "app.features.team-workspaces-enabled=true",
    "app.http.trusted-proxy-cidrs=127.0.0.1/32",
])
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InvitationRateLimitPostgresIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
    @Autowired private val applicationContext: ApplicationContext,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("invitation_rate_limit")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @BeforeEach
    fun resetBuckets() {
        if (tableExists("invitation_rate_limit_buckets")) jdbcTemplate.update("DELETE FROM invitation_rate_limit_buckets")
    }

    @Test
    fun `loopback consumes the same PostgreSQL preview IP bucket`() {
        repeat(30) { index ->
            assertEquals(410, preview().response.status, "loopback preview ${index + 1} must consume but remain below the limit")
        }
        assertEquals(429, preview().response.status, "loopback must never bypass abuse limits")
    }

    @Test
    fun `repeated Forwarded fields over the aggregate hop cap use the trusted socket peer bucket`() {
        val attacker = "198.51.100.40"
        val result = preview(forwardedHeaders = List(17) { "for=$attacker" })
        assertEquals(410, result.response.status)
        assertPeerBucketUsedInsteadOfAttacker(attacker)
    }

    @Test
    fun `repeated XFF fields over the aggregate hop cap use the trusted socket peer bucket`() {
        val attacker = "198.51.100.40"
        val result = preview(xForwardedForHeaders = List(17) { attacker })
        assertEquals(410, result.response.status)
        assertPeerBucketUsedInsteadOfAttacker(attacker)
    }

    @Test
    fun `repeated Forwarded fields over the aggregate byte cap use the trusted socket peer bucket`() {
        val attacker = "198.51.100.40"
        val individuallyValidField = "for=$attacker;by=${"a".repeat(510)}"
        val result = preview(forwardedHeaders = listOf(individuallyValidField, individuallyValidField))
        assertEquals(410, result.response.status)
        assertPeerBucketUsedInsteadOfAttacker(attacker)
    }

    @Test
    fun `repeated XFF fields over the aggregate byte cap use the trusted socket peer bucket`() {
        val attacker = "198.51.100.40"
        val individuallyValidField = "${" ".repeat(510)}$attacker${" ".repeat(10)}"
        val result = preview(xForwardedForHeaders = listOf(individuallyValidField, individuallyValidField))
        assertEquals(410, result.response.status)
        assertPeerBucketUsedInsteadOfAttacker(attacker)
    }

    @Test
    fun `preview consumes account only for valid optional authentication`() {
        val account = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-account").first
        repeat(30) { index ->
            assertEquals(
                410,
                preview(account.token, "198.51.100.${index + 1}").response.status,
                "valid optional authentication consumes the account dimension",
            )
        }
        assertEquals(
            429,
            preview(account.token, "203.0.113.31").response.status,
            "a fresh IP must still observe the exhausted preview account bucket",
        )
        assertEquals(
            410,
            preview("invalid-session", "203.0.113.32").response.status,
            "invalid optional authentication stays on the public IP-only path",
        )
        assertEquals(
            30,
            jdbcTemplate.queryForObject(
                "SELECT request_count FROM invitation_rate_limit_buckets WHERE dimension='PREVIEW_ACCOUNT' AND subject_hash=?",
                Int::class.java,
                sha256(account.id),
            ),
        )
    }

    @Test
    fun `PostgreSQL buckets survive restart and are shared by another application replica`() {
        repeat(15) { assertEquals(410, preview().response.status) }
        var replica: ConfigurableApplicationContext? = null
        try {
            replica = SpringApplicationBuilder(InterviewOnlineApplication::class.java)
                .web(WebApplicationType.SERVLET)
                .run(*(postgres.applicationProperties() + mapOf(
                    "server.port" to 0,
                    "app.features.team-workspaces-enabled" to "true",
                    "spring.main.banner-mode" to "off",
                )).map { (name, value) -> "--$name=$value" }.toTypedArray())
            val port = replica.environment.getRequiredProperty("local.server.port").toInt()
            repeat(15) { assertEquals(410, httpPreview(port)) }
            assertEquals(429, httpPreview(port), "the next replica request must observe the shared fixed window")
        } finally {
            replica?.close()
        }
    }

    @Test
    fun `create and reissue share one twenty-per-team issuance bucket`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "shared-issue").first
        val teamResponse = mockMvc.post("/api/teams") {
            header("Authorization", "Bearer ${owner.token}")
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Shared issuance"}"""
        }.andReturn()
        assertEquals(201, teamResponse.response.status)
        val teamId = objectMapper.readTree(teamResponse.response.contentAsString).path("team").path("id").asText()
        val first = create(owner.token, teamId)
        assertEquals(201, first.response.status)
        val invitationId = objectMapper.readTree(first.response.contentAsString).path("invitation").path("id").asText()
        repeat(18) { assertEquals(201, create(owner.token, teamId).response.status) }
        val reissued = mockMvc.post("/api/teams/$teamId/invitations/$invitationId/reissue") {
            header("Authorization", "Bearer ${owner.token}")
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = """{"revision":0}"""
        }.andReturn()
        assertEquals(201, reissued.response.status, "reissue is the shared twentieth logical issuance")
        assertEquals(429, create(owner.token, teamId).response.status, "create must observe reissue consumption")
    }

    @Test
    fun `scheduled cleanup skips locked rows and deletes at most ten thousand stale buckets`() {
        assertTrue(tableExists("invitation_rate_limit_buckets"), "V14 must install durable rate-limit storage")
        jdbcTemplate.update(
            """
            INSERT INTO invitation_rate_limit_buckets(dimension,subject_hash,window_started_at,request_count,updated_at)
            SELECT 'PREVIEW_IP', lpad(value::text, 64, '0'), date_trunc('minute', CURRENT_TIMESTAMP) - INTERVAL '2 hours', 1,
                   CURRENT_TIMESTAMP - INTERVAL '2 hours'
            FROM generate_series(1, 10010) value
            """.trimIndent(),
        )
        val lockConnection = postgres.connection().apply { autoCommit = false }
        lockConnection.createStatement().use { statement ->
            statement.executeQuery(
                "SELECT subject_hash FROM ${postgres.schema}.invitation_rate_limit_buckets ORDER BY subject_hash LIMIT 10 FOR UPDATE",
            ).use { result -> repeat(10) { assertTrue(result.next()) } }
        }
        try {
            val cleanupClass = Class.forName("com.interviewonline.service.InvitationRateLimitBucketCleanup")
            val cleanup = applicationContext.getBean(cleanupClass)
            val method = cleanupClass.getMethod("cleanupExpiredBuckets")
            val scheduled = method.getAnnotation(org.springframework.scheduling.annotation.Scheduled::class.java)
            assertEquals(60_000L, scheduled.fixedDelay, "cleanup cadence is exactly sixty seconds")
            method.invoke(cleanup)
            val remaining = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM invitation_rate_limit_buckets", Long::class.java)
            assertEquals(10L, remaining, "SKIP LOCKED leaves locked rows while one batch deletes at most 10000")
        } finally {
            lockConnection.rollback()
            lockConnection.close()
        }
    }

    @Test
    fun `invitation row-lock contention fails closed within five seconds without partial state`() {
        val owner = HrHttpFixtures.register(mockMvc, objectMapper, false, "lock-timeout").first
        val teamResponse = mockMvc.post("/api/teams") {
            header("Authorization", "Bearer ${owner.token}")
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = """{"name":"Lock timeout"}"""
        }.andReturn()
        val teamId = objectMapper.readTree(teamResponse.response.contentAsString).path("team").path("id").asText()
        val lockConnection = postgres.connection().apply { autoCommit = false }
        lockConnection.prepareStatement("SELECT id FROM ${postgres.schema}.teams WHERE id=? FOR UPDATE").use { statement ->
            statement.setString(1, teamId)
            statement.executeQuery().use { result -> assertTrue(result.next()) }
        }
        val release = Executors.newSingleThreadScheduledExecutor()
        release.schedule({
            runCatching { lockConnection.rollback() }
            runCatching { lockConnection.close() }
        }, 7, TimeUnit.SECONDS)
        val started = System.nanoTime()
        val result = try {
            create(owner.token, teamId)
        } finally {
            release.shutdownNow()
            if (!lockConnection.isClosed) {
                lockConnection.rollback()
                lockConnection.close()
            }
        }
        val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
        assertEquals(503, result.response.status, "lock timeout must translate to a recoverable service response")
        assertTrue(elapsedMillis in 4_000..6_500, "SET LOCAL lock_timeout must bound the wait near five seconds, got ${elapsedMillis}ms")
        assertEquals("INVITATION_BUSY", objectMapper.readTree(result.response.contentAsString).path("code").asText())
        assertEquals("5", result.response.getHeader("Retry-After"))
        assertEquals(0L, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_invitations WHERE team_id=?", Long::class.java, teamId))
        assertTrue(!result.response.contentAsString.contains(teamId) && !result.response.contentAsString.contains(owner.id))
    }

    @Test
    fun `rate-limit bucket contention fails closed with its exact recoverable response`() {
        val clientIp = "192.0.2.55"
        jdbcTemplate.update(
            """
            INSERT INTO invitation_rate_limit_buckets(dimension,subject_hash,window_started_at,request_count,updated_at)
            VALUES ('PREVIEW_IP', ?, date_trunc('minute', CURRENT_TIMESTAMP), 1, CURRENT_TIMESTAMP)
            """.trimIndent(),
            sha256(clientIp),
        )
        val lockConnection = postgres.connection().apply { autoCommit = false }
        lockConnection.prepareStatement(
            "SELECT subject_hash FROM ${postgres.schema}.invitation_rate_limit_buckets WHERE dimension='PREVIEW_IP' AND subject_hash=? FOR UPDATE",
        ).use { statement ->
            statement.setString(1, sha256(clientIp))
            statement.executeQuery().use { result -> assertTrue(result.next()) }
        }
        val release = Executors.newSingleThreadScheduledExecutor()
        release.schedule({
            runCatching { lockConnection.rollback() }
            runCatching { lockConnection.close() }
        }, 7, TimeUnit.SECONDS)
        val started = System.nanoTime()
        val result = try {
            preview(clientIp = clientIp)
        } finally {
            release.shutdownNow()
            if (!lockConnection.isClosed) {
                lockConnection.rollback()
                lockConnection.close()
            }
        }
        val elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
        assertEquals(503, result.response.status)
        assertTrue(elapsedMillis in 4_000..6_500, "limiter lock wait is bounded near five seconds, got ${elapsedMillis}ms")
        assertEquals("RATE_LIMIT_UNAVAILABLE", objectMapper.readTree(result.response.contentAsString).path("code").asText())
        assertEquals("5", result.response.getHeader("Retry-After"))
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"))
        assertTrue(!result.response.contentAsString.contains(clientIp))
        assertEquals(
            1,
            jdbcTemplate.queryForObject(
                "SELECT request_count FROM invitation_rate_limit_buckets WHERE dimension='PREVIEW_IP' AND subject_hash=?",
                Int::class.java,
                sha256(clientIp),
            ),
            "failed limiter transaction must not increment its bucket",
        )
    }

    private fun create(token: String, teamId: String): MvcResult = mockMvc.post("/api/teams/$teamId/invitations") {
        header("Authorization", "Bearer $token")
        header("Idempotency-Key", UUID.randomUUID().toString())
        contentType = MediaType.APPLICATION_JSON
        content = "{}"
    }.andReturn()

    private fun preview(
        token: String? = null,
        clientIp: String? = null,
        forwardedHeaders: List<String> = emptyList(),
        xForwardedForHeaders: List<String> = emptyList(),
    ): MvcResult = mockMvc.post("/api/team-invitations/preview") {
        token?.let { header("Authorization", "Bearer $it") }
        clientIp?.let { ip -> with { request -> request.remoteAddr = ip; request } }
        forwardedHeaders.forEach { header("Forwarded", it) }
        xForwardedForHeaders.forEach { header("X-Forwarded-For", it) }
        contentType = MediaType.APPLICATION_JSON
        content = """{"token":"${"A".repeat(43)}"}"""
    }.andReturn()

    private fun assertPeerBucketUsedInsteadOfAttacker(attacker: String) {
        assertEquals(
            1L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM invitation_rate_limit_buckets WHERE dimension='PREVIEW_IP' AND subject_hash=?",
                Long::class.java,
                sha256("127.0.0.1"),
            ),
            "malformed aggregate metadata must consume the trusted socket peer bucket",
        )
        assertEquals(
            0L,
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM invitation_rate_limit_buckets WHERE dimension='PREVIEW_IP' AND subject_hash=?",
                Long::class.java,
                sha256(attacker),
            ),
            "attacker-controlled forwarding metadata must not choose the bucket",
        )
    }

    private fun httpPreview(port: Int): Int {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port/api/team-invitations/preview"))
            .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .POST(HttpRequest.BodyPublishers.ofString("""{"token":"${"A".repeat(43)}"}"""))
            .build()
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding()).statusCode()
    }

    private fun tableExists(table: String): Boolean = jdbcTemplate.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?)",
        Boolean::class.java,
        table,
    ) ?: false

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }
}
