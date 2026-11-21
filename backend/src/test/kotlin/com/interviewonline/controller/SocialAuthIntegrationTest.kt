package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.service.AuthService
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.support.Postgres16TestSupport
import com.sun.net.httpserver.HttpServer
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

@ExtendWith(OutputCaptureExtension::class)
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SocialAuthIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val sessions: UserSessionRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val auth: AuthService,
) {
    companion object {
        private const val ORIGIN = "http://localhost:5173"
        private val postgres = Postgres16TestSupport.create("social_auth")
        private val provider = FakeGithubProvider()
        private val subjectSequence = AtomicLong(10_000_000_000)
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            postgres.register(registry)
            mapOf(
                "app.social-auth.public-base-url" to ORIGIN,
                "app.social-auth.flow-secret" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                "app.social-auth.http-timeout-millis" to "500",
                "app.social-auth.github.client-id" to "github-test-client",
                "app.social-auth.github.client-secret" to "github-test-secret",
                "app.social-auth.github.authorization-uri" to "${provider.base}/github/authorize",
                "app.social-auth.github.token-uri" to "${provider.base}/github/token",
                "app.social-auth.github.user-info-uri" to "${provider.base}/github/userinfo",
            ).forEach { (key, value) -> registry.add(key) { value } }
        }
        @JvmStatic @AfterAll fun cleanup() { provider.close(); postgres.close() }
    }

    @Test fun `provider start uses canonical callback PKCE and protected cookie`() {
        postgres.verifyPostgres16()
        mvc.get("/api/auth/social/providers").andExpect {
            status { isOk() }; jsonPath("$.providers", org.hamcrest.Matchers.contains("github"))
            header { string("Cache-Control", "private, no-store") }
        }
        val attempt = start()
        assertEquals("$ORIGIN/api/auth/social/github/callback", attempt.params["redirect_uri"])
        assertEquals("S256", attempt.params["code_challenge_method"])
        assertEquals("", attempt.params["scope"])
        assertNull(attempt.params["nonce"])
        assertTrue(attempt.cookieHeader.contains("HttpOnly"))
        assertTrue(attempt.cookieHeader.contains("SameSite=Lax"))
        assertTrue(attempt.cookieHeader.contains("Path=/api/auth/social"))
        assertFalse(attempt.cookieHeader.contains("Secure"), "loopback HTTP is explicitly supported")
        val stored = jdbc.queryForMap("SELECT state_hash, browser_proof_hash FROM social_auth_flows WHERE id=?", attempt.id)
        assertNotEquals(attempt.params["state"], stored["state_hash"])
        assertFalse(stored.values.any { it == attempt.cookie.value })
    }

    @Test fun `GitHub exchange creates social profile and later login preserves identity without local password`() {
        val subject = githubSubject()
        val ready = ready(subject = subject)
        assertPending(ready, false)
        val nickname = "social_${suffix()}"
        val result = complete(ready, mapOf("nickname" to nickname, "displayName" to "Иван", "isHr" to true))
        assertEquals(200, result.response.status)
        assertPrivate(result)
        val auth = mapper.readTree(result.response.contentAsByteArray)
        val id = auth.path("user").path("id").asText()
        assertEquals("user", auth.path("user").path("role").asText())
        assertEquals(true, auth.path("user").path("isHr").booleanValue())
        assertNull(jdbc.queryForObject("SELECT password_hash FROM users WHERE id=?", String::class.java, id))
        assertEquals(0L, jdbc.queryForObject("SELECT count(*) FROM user_task_categories WHERE owner_user_id=?", Long::class.java, id), "new task bank follows the current empty-bank behavior")
        mvc.post("/api/auth/login") { contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("nickname" to nickname, "password" to "anything123")) }
            .andExpect { status { isUnauthorized() }; jsonPath("$.error") { value("Неверный ник или пароль") } }
        assertEquals(401, complete(ready).response.status, "completion is one-use")
        val next = ready(subject = subject)
        assertPending(next, true)
        val repeated = complete(next)
        assertEquals(200, repeated.response.status)
        assertEquals(id, mapper.readTree(repeated.response.contentAsByteArray).path("user").path("id").asText())
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider='github' AND subject=?", Long::class.java, subject))
    }

    @Test fun `GitHub login uses stable id empty scopes and only authenticated user endpoint`() {
        val ready = ready("github", "1234567")
        assertPending(ready, false)
        assertEquals("", ready.params["scope"])
        assertEquals("S256", ready.params["code_challenge_method"])
        val result = complete(ready, mapOf("nickname" to "gh_${suffix()}", "displayName" to "GitHub Имя"))
        assertEquals(200, result.response.status)
        assertEquals("github-test-secret", provider.forms[ready.code]?.get("client_secret"))
        assertEquals("Bearer github-access-${ready.code}", provider.userInfoForms[ready.code]?.get("authorization"))
        assertFalse(result.response.contentAsString.contains("github-access"))
        val id = mapper.readTree(result.response.contentAsByteArray).path("user").path("id").asText()
        val again = ready("github", "1234567")
        assertPending(again, true)
        assertEquals(id, mapper.readTree(complete(again).response.contentAsByteArray).path("user").path("id").asText())
    }

    @Test fun `VK stays unavailable with configured GitHub`() {
        mvc.post("/api/auth/social/vk/start") { header("Origin", ORIGIN) }.andExpect { status { isNotFound() } }
    }

    @Test fun `wrong Origin missing proof wrong state and wrong provider cannot authorize`() {
        val beforeUsers = users.count(); val beforeSessions = sessions.count()
        mvc.post("/api/auth/social/github/start") { header("Origin", "https://attacker.example"); contentType=MediaType.APPLICATION_JSON; content="{}" }
            .andExpect { status { isForbidden() } }
        mvc.post("/api/auth/social/github/start") { contentType=MediaType.APPLICATION_JSON; content="{}" }
            .andExpect { status { isForbidden() } }
        val attempt = start(); val code = provider.code(attempt.params, githubSubject())
        val calls = provider.exchanges.get()
        for ((cookie, state, kind) in listOf(Triple(null, attempt.params.getValue("state"), "github"), Triple(Cookie("interhub_social", "forged"), attempt.params.getValue("state"), "github"), Triple(attempt.cookie, "wrong-state", "github"), Triple(attempt.cookie, attempt.params.getValue("state"), "vk"))) {
            val result = callback(attempt.copy(cookie = cookie ?: Cookie("none", "")), code, state, kind)
            assertEquals(302, result.response.status)
            assertEquals("$ORIGIN/login/social?result=failed", result.response.getHeader("Location"))
            assertPrivate(result)
        }
        assertEquals(calls, provider.exchanges.get())
        assertEquals(beforeUsers, users.count()); assertEquals(beforeSessions, sessions.count())
        assertEquals(403, complete(attempt, origin="https://attacker.example").response.status)
    }

    @Test fun `callback replay and simultaneous completion are one use`() {
        val ready = ready(subject = githubSubject())
        val count = provider.exchanges.get()
        assertEquals("$ORIGIN/login/social?result=failed", callback(ready, ready.code).response.getHeader("Location"))
        assertEquals(count, provider.exchanges.get())
        val executor = Executors.newFixedThreadPool(2)
        try {
            val body = mapOf("nickname" to "race_${suffix()}", "displayName" to "Гонка")
            val results = executor.invokeAll(List(2) { java.util.concurrent.Callable { complete(ready, body).response.status } }).map { it.get() }.sorted()
            assertEquals(listOf(200,401), results)
        } finally { executor.shutdownNow() }
    }

    @Test fun `distinct flows completing one provider subject create one account and preserve retry`(output: CapturedOutput) {
        val subject=githubSubject()
        val attempts=List(2) { ready(subject=subject) }
        val beforeUsers=users.count()
        val executor=Executors.newFixedThreadPool(2)
        val start=java.util.concurrent.CountDownLatch(1)
        try {
            val futures=attempts.map { attempt -> executor.submit<MvcResult> {
                start.await()
                complete(attempt,mapOf("nickname" to "cross_${suffix()}","displayName" to "Первый вход"))
            } }
            start.countDown()
            val results=futures.map { it.get() }
            assertTrue(results.all { it.response.status in listOf(200,409) })
            assertTrue(results.any { it.response.status==200 })
            val completed=results.mapIndexed { index,result ->
                if(result.response.status==409) {
                    assertPending(attempts[index],true)
                    complete(attempts[index]).also { assertEquals(200,it.response.status) }
                } else result
            }
            val ids=completed.map { mapper.readTree(it.response.contentAsByteArray).path("user").path("id").asText() }.toSet()
            assertEquals(1,ids.size)
            assertEquals(beforeUsers+1,users.count())
            assertFalse(output.all.contains("Key (provider, subject)"), "provider subjects must not appear in SQL failure logs")
            assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider='github' AND subject=?",Long::class.java,subject))
        } finally { executor.shutdownNow() }
    }

    @Test fun `concurrent first registrations preserve one nickname and keep profile fields out of logs`(output: CapturedOutput) {
        val attempts = List(2) { ready(subject = githubSubject()) }
        val nickname = "private_nick_${suffix()}"
        val beforeUsers = users.count()
        val beforeSessions = sessions.count()
        val executor = Executors.newFixedThreadPool(2)
        val results = try {
            postgres.connection().use { blocker ->
                blocker.autoCommit = false
                blocker.createStatement().use { it.execute("LOCK TABLE users IN SHARE MODE") }
                val futures = attempts.map { attempt -> executor.submit<MvcResult> {
                    complete(attempt, mapOf("nickname" to nickname, "displayName" to "Приватное имя"))
                } }
                try {
                    val deadline = System.nanoTime() + 5_000_000_000L
                    var waiting = 0
                    while (waiting < 2 && System.nanoTime() < deadline) {
                        waiting = jdbc.queryForObject("""
                            SELECT count(*) FROM pg_locks l
                            JOIN pg_class c ON c.oid = l.relation
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = ? AND c.relname = 'users'
                              AND l.mode = 'RowExclusiveLock' AND NOT l.granted
                        """.trimIndent(), Int::class.java, postgres.schema) ?: 0
                        if (waiting < 2) Thread.sleep(20)
                    }
                    assertEquals(2, waiting, "both requests must reach insertion before releasing the lock")
                } finally {
                    blocker.commit()
                }
                futures.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS) }
            }
        } finally {
            executor.shutdownNow()
        }
        assertEquals(listOf(200, 409), results.map { it.response.status }.sorted())
        val loser = results.indexOfFirst { it.response.status == 409 }
        assertEquals("NICKNAME_TAKEN", mapper.readTree(results[loser].response.contentAsByteArray).path("code").asText())
        assertEquals(beforeUsers + 1, users.count())
        assertEquals(beforeSessions + 1, sessions.count())
        assertFalse(output.all.contains(nickname), "nickname must not appear in SQL failure logs")
        assertFalse(output.all.contains("Приватное имя"), "provider profile must not appear in logs")
        assertPending(attempts[loser], false)
        val retry = complete(attempts[loser], mapOf("nickname" to "corrected_${suffix()}", "displayName" to "Имя"))
        assertEquals(200, retry.response.status)
    }

    @Test fun `distinct provider flows cannot concurrently link identity to different local users`(output: CapturedOutput) {
        val subject=githubSubject()
        val attempts=List(2) { ready(subject=subject) }
        val accounts=List(2) { users.saveAndFlush(User(nickname="local_${suffix()}",displayName="Прежний",passwordHash=BCryptPasswordEncoder().encode("local-password123"))) }
        val beforeSessions=sessions.count()
        val executor=Executors.newFixedThreadPool(2)
        val start=java.util.concurrent.CountDownLatch(1)
        try {
            val futures=attempts.mapIndexed { index,attempt -> executor.submit<MvcResult> { start.await(); link(attempt,accounts[index].nickname,"local-password123") } }
            start.countDown()
            val results=futures.map { it.get() }
            assertEquals(listOf(200,409),results.map { it.response.status }.sorted())
            val winner=results.indexOfFirst { it.response.status==200 }
            val loser=1-winner
            assertEquals(accounts[winner].id,jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE provider='github' AND subject=?",String::class.java,subject))
            assertEquals(beforeSessions+1,sessions.count())
            assertFalse(output.all.contains("Key (provider, subject)"), "provider subjects must not appear in SQL failure logs")
            assertPending(attempts[loser],true)
            assertEquals(409,link(attempts[loser],accounts[loser].nickname,"local-password123").response.status)
        } finally { executor.shutdownNow() }
    }

    @Test fun `GitHub rejects missing id unexpected scopes and malformed token before session creation`() {
        val beforeUsers = users.count()
        val beforeSessions = sessions.count()
        for (overrides in listOf(mapOf("scope" to "repo"), mapOf("userinfo-sub" to ""), mapOf("userinfo-sub" to "-1"), mapOf("token_type" to "mac"))) {
            val attempt = start("github")
            val code = provider.code(attempt.params, "12345", overrides)
            assertEquals("$ORIGIN/login/social?result=failed", callback(attempt, code).response.getHeader("Location"))
            assertEquals(401, pending(attempt).response.status)
        }
        assertEquals(beforeUsers, users.count())
        assertEquals(beforeSessions, sessions.count())
        val attempt = start("github")
        val code = provider.code(attempt.params, "99999", mapOf("name" to ""))
        assertEquals("$ORIGIN/login/social", callback(attempt, code).response.getHeader("Location"))
        assertEquals("", mapper.readTree(pending(attempt).response.contentAsByteArray).path("displayName").asText())
    }

    @Test fun `expired callback and completion fail and next start cleans expired flows`() {
        val attempt=start(); val code=provider.code(attempt.params, githubSubject())
        expire(attempt)
        assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code).response.getHeader("Location"))
        val ready=ready(subject=githubSubject()); expire(ready)
        assertEquals(401,complete(ready,mapOf("nickname" to "expired_${suffix()}","displayName" to "Истёк")).response.status)
        start()
        assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM social_auth_flows WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",Long::class.java))
    }

    @Test fun `occupied Cyrillic reserved nickname and invalid name are retryable without account writes`() {
        val occupied="occupied_${suffix()}"
        users.saveAndFlush(User(nickname=occupied,displayName="Другой",passwordHash=BCryptPasswordEncoder().encode("password123")))
        val ready=ready(subject=githubSubject()); val beforeUsers=users.count(); val beforeSessions=sessions.count()
        for ((nickname,name,status) in listOf(Triple(occupied,"Имя",409), Triple("кириллица","Имя",400),Triple("Boumrz","Имя",400),Triple("ab","Имя",400),Triple("name_${suffix()}","x",400))) {
            assertEquals(status,complete(ready,mapOf("nickname" to nickname,"displayName" to name)).response.status)
            assertEquals(beforeUsers,users.count()); assertEquals(beforeSessions,sessions.count())
            assertEquals(200,pending(ready).response.status)
        }
        assertEquals(200,complete(ready,mapOf("nickname" to "correct_${suffix()}","displayName" to "Исправлено")).response.status)
    }

    @Test fun `explicit linking requires exact local credentials preserves old account and cannot reassign identity`() {
        val nickname="старый${suffix()}"; val password="Старый пароль123"
        val local=users.saveAndFlush(User(nickname=nickname,displayName="Прежнее имя",passwordHash=BCryptPasswordEncoder().encode(password),isHr=true))
        val ready=ready(subject=githubSubject()); val before=sessions.count()
        assertEquals(401,link(ready,nickname,"wrong").response.status)
        assertEquals(before,sessions.count())
        assertEquals(200,pending(ready).response.status)
        val linked=link(ready,nickname,password)
        assertEquals(200,linked.response.status)
        val result=mapper.readTree(linked.response.contentAsByteArray).path("user")
        assertEquals(local.id,result.path("id").asText()); assertEquals("Прежнее имя",result.path("displayName").asText()); assertTrue(result.path("isHr").booleanValue())
        mvc.post("/api/auth/login") { contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password)) }.andExpect { status { isOk() } }
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Long::class.java, local.id))
        val another=users.saveAndFlush(User(nickname="other_${suffix()}",displayName="Другой",passwordHash=BCryptPasswordEncoder().encode("secret123")))
        val again=ready(subject=provider.subject(ready.code))
        assertEquals(409,link(again,another.nickname,"secret123").response.status)
        assertEquals(local.id,jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE subject=?",String::class.java,provider.subject(ready.code)))
    }

    @Test fun `provider cancellation malformed duplicate callback and finite transport failure leak no secrets`() {
        val attempt=start()
        val cancelled=mvc.get("/api/auth/social/github/callback") { cookie(attempt.cookie); param("state",attempt.params.getValue("state")); param("error","access_denied"); param("error_description","SECRET_DO_NOT_ECHO") }.andReturn()
        assertEquals("$ORIGIN/login/social?result=cancelled",cancelled.response.getHeader("Location")); assertPrivate(cancelled)
        assertFalse(cancelled.response.contentAsString.contains("SECRET_DO_NOT_ECHO"))
        val duplicate=start(); val duplicateCode=provider.code(duplicate.params, githubSubject())
        val dup=mvc.get("/api/auth/social/github/callback") { cookie(duplicate.cookie); param("state",duplicate.params.getValue("state"),"attacker"); param("code",duplicateCode) }.andReturn()
        assertEquals("$ORIGIN/login/social?result=failed",dup.response.getHeader("Location"))
        val slow=start(); val code=provider.code(slow.params, githubSubject(),mapOf("slow" to true)); val began=System.nanoTime()
        assertEquals("$ORIGIN/login/social?result=failed",callback(slow,code).response.getHeader("Location"))
        assertTrue(System.nanoTime()-began < 2_000_000_000L,"provider deadline is finite")
        assertEquals(401,pending(slow).response.status)
    }

    @Test fun `provider response body stall is bounded after headers arrive`() {
        val attempt=start(); val code=provider.code(attempt.params, githubSubject(),mapOf("slow-body" to true))
        val began=System.nanoTime()
        assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code).response.getHeader("Location"))
        assertTrue(System.nanoTime()-began < 1_200_000_000L,"deadline includes response body")
        assertEquals(401,pending(attempt).response.status)
    }

    @Test fun `room return requires current admission and is bound to browser and issued session`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "return-${suffix()}", ownerSessionToken = "owner", interviewerSessionToken = "manager"))
        val connection = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", "return-${suffix()}"); param("participantId", "guest-${suffix()}"); param("displayName", "Кандидат")
        }.andReturn()
        val state = connection.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        val eventToken = state.path("eventToken").asText()
        val context = mvc.post("/api/auth/social/room-context") {
            header("Origin", ORIGIN); header("X-Room-Event-Token", eventToken)
            contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("roomId" to room.id))
        }.andExpect { status { isOk() } }.andReturn()
        val cookiePair = context.response.getHeader("Set-Cookie")!!.substringBefore(';').split('=', limit = 2)
        val contextCookie = Cookie(cookiePair[0], cookiePair[1])
        mvc.post("/api/auth/social/room-context") {
            header("Origin", ORIGIN); header("X-Room-Event-Token", "forged")
            contentType = MediaType.APPLICATION_JSON; content = mapper.writeValueAsString(mapOf("roomId" to room.id))
        }.andExpect { status { isForbidden() } }
        val contextId = mapper.readTree(context.response.contentAsByteArray).path("contextId").asText()
        val attempt = start("github", contextCookie, true, contextId)
        assertFalse(attempt.params.values.any { it.contains(room.inviteCode) || it.contains(room.id!!) })
        val code = provider.code(attempt.params, "56789")
        callback(attempt, code)
        val completed = complete(attempt, mapOf("nickname" to "return_${suffix()}", "displayName" to "Кандидат"))
        assertEquals(200, completed.response.status)
        val session = mapper.readTree(completed.response.contentAsByteArray).path("token").asText()
        mvc.post("/api/auth/social/continue") {
            cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer wrong")
        }.andExpect { status { isUnauthorized() } }
        val otherAccount = users.saveAndFlush(User(nickname = "other_return_${suffix()}", displayName = "Другой"))
        val otherSession = auth.createSession(otherAccount).token
        mvc.post("/api/auth/social/continue") {
            cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $otherSession")
        }.andExpect { status { isUnauthorized() } }
        mvc.post("/api/auth/social/continue") {
            header("Origin", ORIGIN); header("Authorization", "Bearer $session")
        }.andExpect { status { isUnauthorized() } }
        val continuation = mvc.post("/api/auth/social/continue") {
            cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $session")
        }.andExpect { status { isOk() } }.andReturn()
        assertEquals("/room/${room.inviteCode}", mapper.readTree(continuation.response.contentAsByteArray).path("path").asText())
        mvc.get("/api/rooms/${room.inviteCode}") { header("Authorization", "Bearer $session") }
            .andExpect { status { isOk() }; jsonPath("$.role") { value("candidate") } }

        mvc.post("/api/auth/social/continue") {
            cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $session")
        }.andExpect { status { isUnauthorized() } }
    }

    @Test fun `missing or expired room context falls back without disclosing a room`() {
        val attempt = start("github", roomReturn = true)
        val code = provider.code(attempt.params, "678901")
        callback(attempt, code)
        val response = complete(attempt, mapOf("nickname" to "fallback_${suffix()}", "displayName" to "Имя"))
        val token = mapper.readTree(response.response.contentAsByteArray).path("token").asText()
        mvc.post("/api/auth/social/continue") {
            cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $token")
        }.andExpect {
            status { isOk() }; jsonPath("$.path") { value("/workspace/personal/interviews") }
            jsonPath("$.notice") { isString() }
        }
    }

    @Test fun `before joining a guest can authorize with the current public room link`() {
        val room = rooms.saveAndFlush(Room(inviteCode = "prejoin-${suffix()}", ownerSessionToken = "owner", interviewerSessionToken = "manager"))
        val archived = rooms.saveAndFlush(Room(inviteCode = "archived-${suffix()}", ownerSessionToken = "owner", interviewerSessionToken = "manager", archivedAt = Instant.now()))

        fun roomContext(body: Map<String, String>) = mvc.post("/api/auth/social/room-context") {
            header("Origin", ORIGIN)
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(body)
        }

        for (body in listOf(mapOf("roomId" to requireNotNull(room.id)), mapOf("inviteCode" to "missing-${suffix()}"),
            mapOf("inviteCode" to archived.inviteCode))) {
            roomContext(body).andExpect { status { isForbidden() }; header { doesNotExist("Set-Cookie") } }
        }
        val context = roomContext(mapOf("inviteCode" to room.inviteCode))
            .andExpect { status { isOk() } }.andReturn()
        val cookiePair = context.response.getHeader("Set-Cookie")!!.substringBefore(';').split('=', limit = 2)
        val contextId = mapper.readTree(context.response.contentAsByteArray).path("contextId").asText()
        val attempt = start("github", Cookie(cookiePair[0], cookiePair[1]), true, contextId)
        assertFalse(attempt.params.values.any { it.contains(room.inviteCode) || it.contains(room.id!!) })
        callback(attempt, provider.code(attempt.params, githubSubject()))
        val completed = complete(attempt, mapOf("nickname" to "prejoin_${suffix()}", "displayName" to "Кандидат"))
        assertEquals(200, completed.response.status)
        val token = mapper.readTree(completed.response.contentAsByteArray).path("token").asText()
        mvc.post("/api/auth/social/continue") {
            header("Origin", ORIGIN); header("Authorization", "Bearer $token"); cookie(attempt.cookie)
        }.andExpect { status { isOk() }; jsonPath("$.path") { value("/room/${room.inviteCode}") } }
    }

    @Test fun `another tab's room cookie does not select its room for this login`() {
        val firstRoom = rooms.saveAndFlush(Room(inviteCode = "first-${suffix()}", ownerSessionToken = "owner", interviewerSessionToken = "manager"))
        val secondRoom = rooms.saveAndFlush(Room(inviteCode = "second-${suffix()}", ownerSessionToken = "owner", interviewerSessionToken = "manager"))
        fun prepareRoom(room: Room) = mvc.post("/api/auth/social/room-context") {
            header("Origin", ORIGIN)
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("inviteCode" to room.inviteCode))
        }.andExpect { status { isOk() } }.andReturn()

        val first = prepareRoom(firstRoom)
        val second = prepareRoom(secondRoom)
        val firstId = mapper.readTree(first.response.contentAsByteArray).path("contextId").asText()
        val cookiePair = second.response.getHeader("Set-Cookie")!!.substringBefore(';').split('=', limit = 2)
        val attempt = start("github", Cookie(cookiePair[0], cookiePair[1]), true, firstId)
        callback(attempt, provider.code(attempt.params, githubSubject()))
        val completed = complete(attempt, mapOf("nickname" to "second_tab_${suffix()}", "displayName" to "Кандидат"))
        assertEquals(200, completed.response.status)
        val token = mapper.readTree(completed.response.contentAsByteArray).path("token").asText()
        mvc.post("/api/auth/social/continue") {
            header("Origin", ORIGIN); header("Authorization", "Bearer $token"); cookie(attempt.cookie)
        }.andExpect {
            status { isOk() }; jsonPath("$.path") { value("/workspace/personal/interviews") }; jsonPath("$.notice") { isString() }
        }
    }

    @Test fun `active passwordless profile can connect GitHub despite a historical Google identity`() {
        val account = users.saveAndFlush(User(nickname = "старый_${suffix()}", displayName = "Прежнее имя", isHr = true))
        val legacySubject = "retired-${suffix()}"
        addIdentity(requireNotNull(account.id), "google", legacySubject)
        val token = auth.createSession(account).token
        val beforeUsers = users.count()
        val beforeSessions = sessions.count()
        val initial = connections(token)
        assertEquals(200, initial.response.status)
        assertPrivate(initial)
        assertEquals(setOf("connections"), mapper.readTree(initial.response.contentAsByteArray).fieldNames().asSequence().toSet())
        assertEquals(listOf("github"), mapper.readTree(initial.response.contentAsByteArray).path("connections").map { it.path("provider").asText() })
        assertTrue(mapper.readTree(initial.response.contentAsByteArray).path("connections").all { !it.path("linked").asBoolean() && it.path("available").asBoolean() })

        val subject = githubSubject()
        val attempt = profileReady(token, subject = subject)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider=? AND subject=?", Int::class.java, "github", subject), "callback must not bind an identity")
        assertEquals(beforeSessions, sessions.count(), "callback must not issue a session")
        val response = profileComplete(attempt, token)
        assertEquals(200, response.response.status)
        assertPrivate(response)
        assertEquals(mapOf("provider" to "github", "linked" to true), mapper.readValue(response.response.contentAsByteArray, Map::class.java))
        assertEquals(200, profileComplete(attempt, token).response.status, "retry is idempotent for the same browser and session")
        assertEquals(account.id, jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE provider=? AND subject=?", String::class.java, "github", subject))
        assertEquals(account.id, jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE provider=? AND subject=?", String::class.java, "google", legacySubject))
        assertEquals(null, jdbc.queryForObject("SELECT subject FROM social_auth_flows WHERE id=?", String::class.java, attempt.id))
        assertEquals(null, jdbc.queryForObject("SELECT display_name FROM social_auth_flows WHERE id=?", String::class.java, attempt.id))
        assertTrue(mapper.readTree(connections(token).response.contentAsByteArray).path("connections").all { it.path("linked").asBoolean() })
        assertEquals(beforeUsers, users.count())
        assertEquals(beforeSessions, sessions.count())
        mvc.get("/api/me/profile") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }; jsonPath("$.id") { value(account.id) }; jsonPath("$.displayName") { value("Прежнее имя") }; jsonPath("$.isHr") { value(true) }
        }
    }

    @Test fun `profile completion requires the exact initiating active session origin and browser`() {
        val account = users.saveAndFlush(User(nickname = "guard_${suffix()}", displayName = "Имя"))
        val token = auth.createSession(account).token
        val replacement = auth.createSession(account).token
        val other = auth.createSession(users.saveAndFlush(User(nickname = "other_${suffix()}", displayName = "Другой"))).token
        assertEquals(401, connections(null).response.status)
        assertEquals(401, mvc.post("/api/auth/social/github/profile-link/start") { header("Origin", ORIGIN) }.andReturn().response.status)
        assertEquals(403, mvc.post("/api/auth/social/github/profile-link/start") { header("Authorization", "Bearer $token"); header("Origin", "https://evil.example") }.andReturn().response.status)
        val attempt = profileReady(token)
        val beforeSessions = sessions.count()
        for (invalidToken in listOf(null, "missing", replacement, other)) {
            assertEquals(401, profileComplete(attempt, invalidToken).response.status)
        }
        assertEquals(403, profileComplete(attempt, token, "https://evil.example").response.status)
        assertEquals(401, mvc.post("/api/auth/social/profile-link/complete") { header("Origin", ORIGIN); header("Authorization", "Bearer $token") }.andReturn().response.status)
        assertEquals(401, profileComplete(attempt.copy(cookie = Cookie(attempt.cookie.name, attempt.id + "." + "a".repeat(43))), token).response.status)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id))
        assertEquals(beforeSessions, sessions.count())
        assertEquals(200, profileComplete(attempt, token).response.status)
        assertEquals(401, profileComplete(attempt, replacement).response.status, "idempotent replay still checks original session")
        val own = mapper.readTree(connections(other).response.contentAsByteArray).path("connections")
        assertTrue(own.all { !it.path("linked").asBoolean() })
    }

    @Test fun `provider unlink removes all of its identities only from the current profile`() {
        val account = users.saveAndFlush(User(nickname = "unlink_${suffix()}", displayName = "Прежнее имя", isHr = true,
            passwordHash = BCryptPasswordEncoder().encode("password123")))
        val other = users.saveAndFlush(User(nickname = "other_${suffix()}", displayName = "Другой"))
        val token = auth.createSession(account).token
        val removedSubjects = List(2) { githubSubject() }
        removedSubjects.forEach { addIdentity(requireNotNull(account.id), "github", it) }
        addIdentity(requireNotNull(other.id), "github", githubSubject())
        val beforeUsers = users.count()
        val beforeSessions = sessions.count()

        assertTrue(connectionRows(connections(token)).getValue("github").path("canUnlink").asBoolean())
        val response = unlink("github", token)
        assertEquals(200, response.response.status)
        assertPrivate(response)
        assertEquals(mapper.readTree(connections(token).response.contentAsByteArray), mapper.readTree(response.response.contentAsByteArray))
        assertFalse(connectionRows(response).getValue("github").path("linked").asBoolean())
        assertFalse(connectionRows(response).getValue("github").path("canUnlink").asBoolean())
        val retry = unlink("github", token)
        assertEquals(200, retry.response.status)
        assertEquals(connectionRows(response), connectionRows(retry))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, other.id))
        removedSubjects.forEach { assertPending(ready(subject = it), exists = false) }
        assertEquals(account.id, auth.verifyLocalCredentials(account.nickname, "password123").id)
        assertEquals(beforeUsers, users.count())
        assertEquals(beforeSessions, sessions.count())
        mvc.get("/api/me/profile") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }; jsonPath("$.id") { value(account.id) }; jsonPath("$.displayName") { value("Прежнее имя") }; jsonPath("$.isHr") { value(true) }
        }
    }

    @Test fun `unlink requires exact origin and a current authenticated session`() {
        val account = users.saveAndFlush(User(nickname = "unlink_guard_${suffix()}", displayName = "Имя"))
        val token = auth.createSession(account).token
        val revoked = auth.createSession(account).token
        addIdentity(requireNotNull(account.id), "github", githubSubject())
        jdbc.update("DELETE FROM user_sessions WHERE token=?", revoked)

        assertEquals(401, unlink("github", null).response.status)
        assertEquals(401, unlink("github", revoked).response.status)
        assertEquals(403, unlink("github", token, origin = null).response.status)
        assertEquals(403, unlink("github", token, origin = "https://other.example").response.status)
        assertEquals(404, unlink("vk", token).response.status)
        assertTrue(connectionRows(connections(token)).getValue("github").path("linked").asBoolean())
    }

    @Test fun `passwordless profile can set its first local password and remove its only provider`() {
        val account = users.saveAndFlush(User(nickname = "unlink_first_${suffix()}", displayName = "Имя", isHr = true))
        val token = auth.createSession(account).token
        addIdentity(requireNotNull(account.id), "github", githubSubject())
        val initial = connectionRows(connections(token)).getValue("github")
        assertTrue(initial.path("requiresPassword").asBoolean())
        assertFalse(initial.path("canUnlink").asBoolean())
        val missingPassword = unlink("github", token)
        assertEquals(409, missingPassword.response.status)
        assertEquals("SOCIAL_PASSWORD_REQUIRED", mapper.readTree(missingPassword.response.contentAsByteArray).path("code").asText())
        for (invalidPassword in listOf("12345", "      ", "пароль123", "A".repeat(73))) {
            val response = unlink("github", token, newPassword = invalidPassword)
            assertEquals(400, response.response.status)
            assertFalse(response.response.contentAsString.contains(invalidPassword))
            assertTrue(connectionRows(connections(token)).getValue("github").path("linked").asBoolean())
            assertNull(users.findById(requireNotNull(account.id)).orElseThrow().passwordHash)
        }
        val beforeSessions = sessions.count()
        val password = "A1b2C3"
        val detached = unlink("github", token, newPassword = password)
        assertPrivate(detached)
        assertEquals(200, detached.response.status)
        assertFalse(detached.response.contentAsString.contains(password))
        val github = connectionRows(detached).getValue("github")
        assertFalse(github.path("linked").asBoolean())
        assertFalse(github.path("requiresPassword").asBoolean())
        assertEquals(connectionRows(detached), connectionRows(unlink("github", token, newPassword = password)))
        val conflictingRetry = unlink("github", token, newPassword = "other-password")
        assertEquals(409, conflictingRetry.response.status)
        assertEquals("SOCIAL_CONNECTION_CHANGED", mapper.readTree(conflictingRetry.response.contentAsByteArray).path("code").asText())
        assertEquals(beforeSessions, sessions.count())
        val loggedIn = mvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to account.nickname, "password" to password))
        }.andReturn()
        assertEquals(200, loggedIn.response.status)
        assertEquals(account.id, mapper.readTree(loggedIn.response.contentAsByteArray).path("user").path("id").asText())
        mvc.get("/api/me/profile") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(account.id) }
            jsonPath("$.isHr") { value(true) }
        }
    }

    @Test fun `passwordless unlink requests need a password and cannot overwrite a concurrent first password`() {
        val account = users.saveAndFlush(User(nickname = "unlink_race_${suffix()}", displayName = "Имя"))
        val tokens = List(2) { auth.createSession(account).token }
        addIdentity(requireNotNull(account.id), "github", githubSubject())
        val initial = connectionRows(connections(tokens.first()))
        assertTrue(initial.values.all { it.path("requiresPassword").asBoolean() })
        assertTrue(initial.values.none { it.path("canUnlink").asBoolean() })
        val beforeSessions = sessions.count()
        fun race(passwords: List<String?>): List<MvcResult> {
            val executor = Executors.newFixedThreadPool(2)
            return try {
                val gate = java.util.concurrent.CountDownLatch(1)
                val futures = tokens.indices.map { index ->
                    executor.submit<MvcResult> { gate.await(); unlink("github", tokens[index], newPassword = passwords[index]) }
                }
                gate.countDown()
                futures.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS) }
            } finally { executor.shutdownNow() }
        }
        assertEquals(listOf(409, 409), race(listOf(null, null)).map { it.response.status })
        assertEquals(initial, connectionRows(connections(tokens.first())))
        val passwords = listOf("first-password-1", "first-password-2")
        val responses = race(passwords)
        assertEquals(listOf(200, 409), responses.map { it.response.status }.sorted())
        val winner = responses.indexOfFirst { it.response.status == 200 }
        val failure = responses[1 - winner]
        assertEquals("SOCIAL_CONNECTION_CHANGED", mapper.readTree(failure.response.contentAsByteArray).path("code").asText())
        assertFalse(connectionRows(connections(tokens.first())).getValue("github").path("linked").asBoolean())
        assertEquals(account.id, auth.verifyLocalCredentials(account.nickname, passwords[winner]).id)
        assertEquals(beforeSessions, sessions.count())
    }

    @Test fun `unlink invalidates outstanding same-provider profile attempts without affecting other attempts`() {
        val account = users.saveAndFlush(User(nickname = "unlink_pending_${suffix()}", displayName = "Имя",
            passwordHash = BCryptPasswordEncoder().encode("password123")))
        val token = auth.createSession(account).token
        val pendingLink = profileReady(token)
        val linkedSubject = githubSubject()
        val completedLink = profileReady(token, subject = linkedSubject)
        val otherAccount = users.saveAndFlush(User(nickname = "other_${suffix()}", displayName = "Другое имя"))
        val otherToken = auth.createSession(otherAccount).token
        val otherProfileLink = profileReady(otherToken)
        val normalLogin = ready(subject = linkedSubject)
        assertEquals(200, profileComplete(completedLink, token).response.status)
        assertPending(normalLogin, exists = true)

        assertEquals(200, unlink("github", token).response.status)
        assertEquals(401, profileComplete(pendingLink, token).response.status)
        assertEquals(401, profileComplete(completedLink, token).response.status)
        assertPending(normalLogin, exists = false)
        assertEquals(200, profileComplete(otherProfileLink, otherToken).response.status)
        assertFalse(connectionRows(connections(token)).getValue("github").path("linked").asBoolean())
    }

    @Test fun `role change waits for passwordless unlink and preserves the newly set password`() {
        val account = users.saveAndFlush(User(nickname = "role_unlink_${suffix()}", displayName = "Имя"))
        val admin = users.saveAndFlush(User(nickname = "role_admin_${suffix()}", displayName = "Имя", role = AuthService.ROLE_ADMIN))
        val token = auth.createSession(account).token
        val adminToken = auth.createSession(admin).token
        addIdentity(requireNotNull(account.id), "github", githubSubject())
        val password = "new-password-123"
        val executor = Executors.newFixedThreadPool(2)
        try {
            postgres.connection().use { blocker ->
                blocker.autoCommit = false
                blocker.createStatement().use { it.execute("LOCK TABLE social_auth_identities IN SHARE MODE") }
                val detach = executor.submit<MvcResult> { unlink("github", token, newPassword = password) }
                val roleChange = try {
                    val deadline = System.nanoTime() + 5_000_000_000L
                    var unlinkWaiting = 0
                    while (unlinkWaiting == 0 && System.nanoTime() < deadline) {
                        unlinkWaiting = jdbc.queryForObject("""
                            SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = ? AND c.relname = 'social_auth_identities'
                              AND l.mode = 'RowExclusiveLock' AND NOT l.granted
                        """.trimIndent(), Int::class.java, postgres.schema) ?: 0
                        if (unlinkWaiting == 0) Thread.sleep(20)
                    }
                    assertEquals(1, unlinkWaiting, "unlink holds the account lock before deleting the identity")
                    val update = executor.submit<MvcResult> {
                        mvc.patch("/api/admin/users/${account.id}/role") {
                            header("Authorization", "Bearer $adminToken")
                            contentType = MediaType.APPLICATION_JSON
                            content = """{"role":"admin"}"""
                        }.andReturn()
                    }
                    val lockDeadline = System.nanoTime() + 5_000_000_000L
                    var roleWaiting = 0
                    while (roleWaiting == 0 && System.nanoTime() < lockDeadline) {
                        roleWaiting = jdbc.queryForObject("""
                            SELECT count(DISTINCT a.pid) FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid
                            JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = ? AND c.relname = 'users'
                              AND a.wait_event_type = 'Lock' AND a.query LIKE 'SELECT * FROM users WHERE id =%FOR UPDATE%'
                        """.trimIndent(), Int::class.java, postgres.schema) ?: 0
                        if (roleWaiting == 0) Thread.sleep(20)
                    }
                    assertEquals(1, roleWaiting, "role change waits before reading the account")
                    update
                } finally { blocker.commit() }
                assertEquals(200, detach.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status)
                assertEquals(200, roleChange.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status)
            }
        } finally { executor.shutdownNow() }
        assertEquals(AuthService.ROLE_ADMIN, auth.verifyLocalCredentials(account.nickname, password).role)
        assertFalse(connectionRows(connections(token)).getValue("github").path("linked").asBoolean())
    }

    @Test fun `provider login waits for unlink and rejects the detached identity`() {
        val account = users.saveAndFlush(User(nickname = "detach_race_${suffix()}", displayName = "Имя",
            passwordHash = BCryptPasswordEncoder().encode("password123")))
        val token = auth.createSession(account).token
        val subject = githubSubject()
        addIdentity(requireNotNull(account.id), "github", subject)
        val attempt = ready(subject = subject)
        assertPending(attempt, exists = true)
        val beforeSessions = sessions.count()
        val executor = Executors.newFixedThreadPool(2)
        try {
            postgres.connection().use { blocker ->
                blocker.autoCommit = false
                blocker.createStatement().use { it.execute("LOCK TABLE social_auth_identities IN SHARE MODE") }
                val detach = executor.submit<MvcResult> { unlink("github", token) }
                val login = try {
                    // Stop unlink just before deletion. Its user row lock is already held.
                    val deadline = System.nanoTime() + 5_000_000_000L
                    var unlinkPid: Int? = null
                    while (unlinkPid == null && System.nanoTime() < deadline) {
                        unlinkPid = jdbc.query("""
                            SELECT l.pid FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = ? AND c.relname = 'social_auth_identities'
                              AND l.mode = 'RowExclusiveLock' AND NOT l.granted
                        """.trimIndent(), { row, _ -> row.getInt(1) }, postgres.schema).firstOrNull()
                        if (unlinkPid == null) Thread.sleep(20)
                    }
                    assertNotNull(unlinkPid, "unlink must wait at identity deletion")
                    val pendingLogin = executor.submit<MvcResult> { complete(attempt) }
                    val loginDeadline = System.nanoTime() + 5_000_000_000L
                    var waiters = 0
                    while (waiters == 0 && !pendingLogin.isDone && System.nanoTime() < loginDeadline) {
                        waiters = jdbc.queryForObject("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database() AND ? = ANY(pg_blocking_pids(pid))
                        """.trimIndent(), Int::class.java, unlinkPid) ?: 0
                        if (waiters == 0) Thread.sleep(20)
                    }
                    assertEquals(1, waiters, "the login must wait for the same account's unlink")
                    pendingLogin
                } finally { blocker.commit() }
                assertEquals(200, detach.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status)
                assertEquals(401, login.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status)
            }
            assertEquals(beforeSessions, sessions.count())
            assertPending(ready(subject = subject), exists = false)
        } finally { executor.shutdownNow() }
    }

    @Test fun `profile intent cannot be consumed by login endpoints and login cannot bind in profile`() {
        val account = users.saveAndFlush(User(nickname = "intent_${suffix()}", displayName = "Имя", passwordHash = BCryptPasswordEncoder().encode("password123")))
        val token = auth.createSession(account).token
        val subject = githubSubject()
        val attempt = profileReady(token, subject = subject)
        val beforeSessions = sessions.count()
        assertEquals(401, pending(attempt).response.status)
        assertEquals(401, complete(attempt, mapOf("nickname" to "unexpected_${suffix()}", "displayName" to "Лишний")).response.status)
        assertEquals(401, link(attempt, account.nickname, "password123").response.status)
        assertEquals(401, mvc.post("/api/auth/social/continue") { cookie(attempt.cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $token") }.andReturn().response.status)
        val loginAttempt = ready(subject = subject)
        assertEquals(401, profileComplete(loginAttempt, token).response.status)
        assertEquals(beforeSessions, sessions.count())
        assertEquals(200, profileComplete(attempt, token).response.status)
        assertEquals(200, link(loginAttempt, account.nickname, "password123").response.status, "existing explicit password linking stays available")
    }

    @Test fun `expired revoked or deleted profile attempts cannot create identity or session`() {
        for (reason in listOf("expired", "revoked", "deleted")) {
            val account = users.saveAndFlush(User(nickname = "stale_${suffix()}", displayName = "Имя"))
            val token = auth.createSession(account).token
            val attempt = profileReady(token)
            when (reason) {
                "expired" -> expire(attempt)
                "revoked" -> jdbc.update("DELETE FROM user_sessions WHERE token=?", token)
                "deleted" -> { jdbc.update("DELETE FROM user_sessions WHERE user_id=?", account.id); jdbc.update("DELETE FROM users WHERE id=?", account.id) }
            }
            val beforeSessions = sessions.count()
            assertEquals(401, profileComplete(attempt, token).response.status, reason)
            assertEquals(beforeSessions, sessions.count())
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id))
        }
    }

    @Test fun `profile cancellation invalid callback and expiry return to profile without linking`() {
        val token = auth.createSession(users.saveAndFlush(User(nickname = "cancel_${suffix()}", displayName = "Имя"))).token
        val beforeSessions = sessions.count()
        val cancelled = profileStart(token)
        mvc.get("/api/auth/social/github/callback") { cookie(cancelled.cookie); param("state", cancelled.params.getValue("state")); param("error", "access_denied") }
            .andExpect { status { isFound() }; header { string("Location", "$ORIGIN/profile?social_link=cancelled") } }
        assertEquals(401, profileComplete(cancelled, token).response.status)
        val wrongState = profileStart(token)
        assertEquals("$ORIGIN/profile?social_link=failed", callback(wrongState, provider.code(wrongState.params, githubSubject()), "wrong-state").response.getHeader("Location"))
        val expired = profileStart(token)
        expire(expired)
        assertEquals("$ORIGIN/profile?social_link=failed", callback(expired, provider.code(expired.params, githubSubject())).response.getHeader("Location"))
        assertEquals(beforeSessions, sessions.count())
    }

    @Test fun `occupied profile provider and identity preserve existing connections including historical duplicates`() {
        val account = users.saveAndFlush(User(nickname = "occupied_${suffix()}", displayName = "Имя"))
        val token = auth.createSession(account).token
        val firstSubject = githubSubject()
        val sameSubject = profileReady(token, subject = firstSubject)
        val first = profileReady(token, subject = firstSubject)
        val otherSubject = profileReady(token)
        assertEquals(200, profileComplete(first, token).response.status)
        assertEquals(200, profileComplete(sameSubject, token).response.status, "same identity and account is idempotent across attempts")
        val rejected = profileComplete(otherSubject, token)
        assertEquals(409, rejected.response.status)
        assertEquals("SOCIAL_PROVIDER_ALREADY_LINKED", mapper.readTree(rejected.response.contentAsByteArray).path("code").asText())
        mvc.post("/api/auth/social/github/profile-link/start") { header("Origin", ORIGIN); header("Authorization", "Bearer $token") }
            .andExpect { status { isConflict() }; jsonPath("$.code") { value("SOCIAL_PROVIDER_ALREADY_LINKED") } }
        val secondAccount = users.saveAndFlush(User(nickname = "occupied_other_${suffix()}", displayName = "Другой"))
        val secondToken = auth.createSession(secondAccount).token
        val occupiedIdentity = profileReady(secondToken, subject = firstSubject)
        assertEquals(409, profileComplete(occupiedIdentity, secondToken).response.status)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, secondAccount.id))
        jdbc.update("INSERT INTO social_auth_identities(id,provider,subject,user_id,created_at) VALUES (?,'github',?,?,CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), githubSubject(), account.id)
        assertTrue(mapper.readTree(connections(token).response.contentAsByteArray).path("connections").first().path("linked").asBoolean())
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id), "historical multiple identities remain untouched")
    }

    @Test fun `concurrent profile attempts serialize provider slot and identity ownership`(output: CapturedOutput) {
        val account = users.saveAndFlush(User(nickname = "parallel_${suffix()}", displayName = "Имя"))
        val token = auth.createSession(account).token
        val attempts = List(2) { profileReady(token) }
        val beforeSessions = sessions.count()
        val executor = Executors.newFixedThreadPool(2)
        try {
            val gate = java.util.concurrent.CountDownLatch(1)
            val futures = attempts.map { attempt -> executor.submit<MvcResult> { gate.await(); profileComplete(attempt, token) } }
            gate.countDown()
            assertEquals(listOf(200, 409), futures.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status }.sorted())
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=? AND provider='github'", Int::class.java, account.id))

            val subject = githubSubject()
            val accounts = List(2) { auth.createSession(users.saveAndFlush(User(nickname = "race_${suffix()}", displayName = "Имя"))).token }
            val competing = accounts.map { profileReady(it, subject = subject) }
            val secondGate = java.util.concurrent.CountDownLatch(1)
            val competingFutures = competing.mapIndexed { index, attempt -> executor.submit<MvcResult> { secondGate.await(); profileComplete(attempt, accounts[index]) } }
            secondGate.countDown()
            assertEquals(listOf(200, 409), competingFutures.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status }.sorted())
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider='github' AND subject=?", Int::class.java, subject))
            assertEquals(beforeSessions + 2, sessions.count())
            assertFalse(output.all.contains(subject), "profile identity must not leak through SQL errors")
        } finally { executor.shutdownNow() }
    }

    @Test fun `mixed legacy and profile linking serialize the same provider without replacing or deadlocking`() {
        for (sameIdentity in listOf(false, true)) {
            val account = users.saveAndFlush(User(nickname = "mixed_${suffix()}", displayName = "Имя", passwordHash = BCryptPasswordEncoder().encode("password123")))
            val token = auth.createSession(account).token
            val subject = githubSubject()
            val legacy = ready(subject = subject)
            val profile = profileReady(token, subject = if (sameIdentity) subject else githubSubject())
            val beforeSessions = sessions.count()
            val executor = Executors.newFixedThreadPool(2)
            val results = try {
                postgres.connection().use { blocker ->
                    blocker.autoCommit = false
                    blocker.createStatement().use { it.execute("LOCK TABLE users IN EXCLUSIVE MODE") }
                    val futures = listOf(
                        executor.submit<MvcResult> { link(legacy, account.nickname, "password123") },
                        executor.submit<MvcResult> { profileComplete(profile, token) },
                    )
                    try {
                        val deadline = System.nanoTime() + 5_000_000_000L
                        var waiting = 0
                        while (waiting < 2 && System.nanoTime() < deadline) {
                            waiting = jdbc.queryForObject("""SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
                                WHERE n.nspname=? AND c.relname='users' AND l.mode='RowShareLock' AND NOT l.granted""", Int::class.java, postgres.schema) ?: 0
                            if (waiting < 2) Thread.sleep(20)
                        }
                        assertEquals(2, waiting, "both paths must lock the same user before attempting identity insertion")
                    } finally { blocker.commit() }
                    futures.map { it.get(10, java.util.concurrent.TimeUnit.SECONDS) }
                }
            } finally { executor.shutdownNow() }
            assertEquals(if (sameIdentity) listOf(200, 200) else listOf(200, 409), results.map { it.response.status }.sorted())
            assertEquals(beforeSessions + if (results.first().response.status == 200) 1 else 0, sessions.count())
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=? AND provider='github'", Int::class.java, account.id))
        }
    }

    @Test fun `legacy link refuses a new occupied provider while historical identities still log in`() {
        val account = users.saveAndFlush(User(nickname = "history_${suffix()}", displayName = "Имя", passwordHash = BCryptPasswordEncoder().encode("password123")))
        val originalSubject = githubSubject()
        assertEquals(200, link(ready(subject = originalSubject), account.nickname, "password123").response.status)
        val beforeSessions = sessions.count()
        val rejected = link(ready(), account.nickname, "password123")
        assertEquals(409, rejected.response.status)
        assertEquals("SOCIAL_PROVIDER_ALREADY_LINKED", mapper.readTree(rejected.response.contentAsByteArray).path("code").asText())
        assertEquals(beforeSessions, sessions.count())
        val historicalSubject = githubSubject()
        jdbc.update("INSERT INTO social_auth_identities(id,provider,subject,user_id,created_at) VALUES (?,'github',?,?,CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), historicalSubject, account.id)
        for (subject in listOf(originalSubject, historicalSubject)) {
            val login = complete(ready(subject = subject))
            assertEquals(200, login.response.status)
            assertEquals(account.id, mapper.readTree(login.response.contentAsByteArray).path("user").path("id").asText())
            assertEquals(200, link(ready(subject = subject), account.nickname, "password123").response.status)
        }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id))
    }

    @Test fun `revocation or deletion while profile completion waits cannot use stale authorization`() {
        for (deleteAccount in listOf(false, true)) {
            val account = users.saveAndFlush(User(nickname = "revoke_${suffix()}", displayName = "Имя"))
            val token = auth.createSession(account).token
            val attempt = profileReady(token)
            val executor = Executors.newSingleThreadExecutor()
            try {
                postgres.connection().use { blocker ->
                    blocker.autoCommit = false
                    blocker.createStatement().use { it.execute("LOCK TABLE users IN EXCLUSIVE MODE") }
                    val future = executor.submit<MvcResult> { profileComplete(attempt, token) }
                    try {
                        val deadline = System.nanoTime() + 5_000_000_000L
                        var waiting = 0
                        while (waiting == 0 && System.nanoTime() < deadline) {
                            waiting = jdbc.queryForObject("""SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
                                WHERE n.nspname=? AND c.relname='users' AND l.mode='RowShareLock' AND NOT l.granted""", Int::class.java, postgres.schema) ?: 0
                            if (waiting == 0) Thread.sleep(20)
                        }
                        assertEquals(1, waiting, "completion must have read its original authentication before revocation")
                        blocker.prepareStatement("DELETE FROM user_sessions WHERE token=?").use { it.setString(1, token); assertEquals(1, it.executeUpdate()) }
                        if (deleteAccount) blocker.prepareStatement("DELETE FROM users WHERE id=?").use { it.setString(1, account.id); assertEquals(1, it.executeUpdate()) }
                    } finally { blocker.commit() }
                    assertEquals(401, future.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status)
                }
                assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE user_id=?", Int::class.java, account.id))
                assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM user_sessions WHERE user_id=?", Int::class.java, account.id))
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun `ordinary login and legacy link of the same known attempt cannot deadlock`() {
        val account = users.saveAndFlush(User(nickname = "login_race_${suffix()}", displayName = "Имя", passwordHash = BCryptPasswordEncoder().encode("password123")))
        val subject = githubSubject()
        assertEquals(200, link(ready(subject = subject), account.nickname, "password123").response.status)
        val attempt = ready(subject = subject)
        val beforeSessions = sessions.count()
        val executor = Executors.newFixedThreadPool(2)
        try {
            postgres.connection().use { blocker ->
                blocker.autoCommit = false
                blocker.createStatement().use { it.execute("LOCK TABLE user_sessions IN SHARE MODE") }
                val ordinary = executor.submit<MvcResult> { complete(attempt) }
                var explicit: java.util.concurrent.Future<MvcResult>? = null
                try {
                    val deadline = System.nanoTime() + 5_000_000_000L
                    var waiting = 0
                    while (waiting == 0 && System.nanoTime() < deadline) {
                        waiting = jdbc.queryForObject("""SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
                            WHERE n.nspname=? AND c.relname='user_sessions' AND l.mode='RowExclusiveLock' AND NOT l.granted""", Int::class.java, postgres.schema) ?: 0
                        if (waiting == 0) Thread.sleep(20)
                    }
                    assertEquals(1, waiting, "ordinary login must hold the flow while waiting to create its session")
                    explicit = executor.submit<MvcResult> { link(attempt, account.nickname, "password123") }
                    val lockDeadline = System.nanoTime() + 5_000_000_000L
                    var userWaiting = 0
                    while (userWaiting == 0 && System.nanoTime() < lockDeadline) {
                        userWaiting = jdbc.queryForObject("""
                            SELECT count(DISTINCT a.pid) FROM pg_stat_activity a
                            JOIN pg_locks l ON l.pid = a.pid JOIN pg_class c ON c.oid = l.relation
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = ? AND c.relname = 'users' AND a.wait_event_type = 'Lock'
                              AND a.query LIKE 'SELECT * FROM users WHERE id=%FOR NO KEY UPDATE%'
                        """.trimIndent(), Int::class.java, postgres.schema) ?: 0
                        if (userWaiting == 0) Thread.sleep(20)
                    }
                    assertEquals(1, userWaiting, "explicit link must wait on the user before locking the shared flow")
                } finally { blocker.commit() }
                assertEquals(listOf(200, 401), listOf(ordinary, requireNotNull(explicit)).map { it.get(10, java.util.concurrent.TimeUnit.SECONDS).response.status }.sorted())
            }
            assertEquals(beforeSessions + 1, sessions.count())
        } finally { executor.shutdownNow() }
    }

    private fun connections(token: String?) = mvc.get("/api/auth/social/connections") { if (token != null) header("Authorization", "Bearer $token") }.andReturn()
    private fun connectionRows(response: MvcResult): Map<String, JsonNode> = mapper.readTree(response.response.contentAsByteArray)
        .path("connections").associateBy { it.path("provider").asText() }
    private fun unlink(provider: String, token: String?, origin: String? = ORIGIN, newPassword: String? = null) = mvc.post("/api/auth/social/$provider/unlink") {
        if (token != null) header("Authorization", "Bearer $token")
        if (origin != null) header("Origin", origin)
        if (newPassword != null) {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("newPassword" to newPassword))
        }
    }.andReturn()
    private fun addIdentity(userId: String, provider: String, subject: String) {
        jdbc.update("INSERT INTO social_auth_identities(id,provider,subject,user_id,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)",
            UUID.randomUUID().toString(), provider, subject, userId)
    }
    private fun profileStart(token: String, kind: String = "github"): Attempt {
        val result = mvc.post("/api/auth/social/$kind/profile-link/start") { header("Origin", ORIGIN); header("Authorization", "Bearer $token") }.andExpect { status { isOk() } }.andReturn()
        assertPrivate(result)
        val params = parseForm(URI(mapper.readTree(result.response.contentAsByteArray).path("authorizationUrl").asText()).rawQuery)
        val cookieHeader = requireNotNull(result.response.getHeader("Set-Cookie"))
        val cookiePair = cookieHeader.substringBefore(';').split('=', limit = 2)
        return Attempt(kind, params, Cookie(cookiePair[0], cookiePair[1]), cookieHeader, cookiePair[1].substringBefore('.'))
    }
    private fun profileReady(token: String, kind: String = "github", subject: String = githubSubject()): Attempt {
        val attempt = profileStart(token, kind)
        assertEquals("$ORIGIN/profile?social_link=ready", callback(attempt, provider.code(attempt.params, subject)).response.getHeader("Location"))
        return attempt
    }
    private fun profileComplete(attempt: Attempt, token: String?, origin: String = ORIGIN) = mvc.post("/api/auth/social/profile-link/complete") {
        cookie(attempt.cookie); header("Origin", origin); if (token != null) header("Authorization", "Bearer $token")
    }.andReturn()

    private data class Attempt(val provider:String,val params:Map<String,String>,val cookie:Cookie,val cookieHeader:String,val id:String,val code:String="")
    private fun start(provider:String="github", contextCookie:Cookie?=null, roomReturn:Boolean=false, roomContextId:String?=null):Attempt {
        val result=mvc.post("/api/auth/social/$provider/start") { header("Origin",ORIGIN); header("Host","attacker.example"); header("X-Forwarded-Host","attacker.example"); if(contextCookie != null) cookie(contextCookie); contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("roomReturn" to roomReturn, "roomContextId" to roomContextId)) }.andExpect { status { isOk() } }.andReturn()
        assertPrivate(result)
        val url=URI(mapper.readTree(result.response.contentAsByteArray).path("authorizationUrl").asText())
        val cookieHeader=requireNotNull(result.response.getHeader("Set-Cookie")); val pair=cookieHeader.substringBefore(';').split('=',limit=2)
        return Attempt(provider,parseForm(url.rawQuery),Cookie(pair[0],pair[1]),cookieHeader,pair[1].substringBefore('.'))
    }
    private fun ready(kind:String="github",subject:String=githubSubject()):Attempt {
        val attempt=start(kind); val code=provider.code(attempt.params, subject)
        assertEquals("$ORIGIN/login/social",callback(attempt,code).response.getHeader("Location"))
        return attempt.copy(code=code)
    }
    private fun callback(attempt:Attempt,code:String,state:String=attempt.params.getValue("state"),kind:String=attempt.provider,deviceId:String="vk-device"):MvcResult = mvc.get("/api/auth/social/$kind/callback") { cookie(attempt.cookie); param("state",state); param("code",code); if(kind=="vk") param("device_id",deviceId) }.andReturn()
    private fun pending(attempt:Attempt)=mvc.get("/api/auth/social/pending") { cookie(attempt.cookie); header("Origin",ORIGIN) }.andReturn()
    private fun assertPending(attempt:Attempt,exists:Boolean) {
        val result=pending(attempt); assertEquals(200,result.response.status); assertPrivate(result)
        val body=mapper.readTree(result.response.contentAsByteArray)
        assertEquals(setOf("provider","displayName","accountExists"),body.fieldNames().asSequence().toSet())
        assertEquals(attempt.provider,body.path("provider").asText()); assertEquals(exists,body.path("accountExists").booleanValue())
    }
    private fun complete(attempt:Attempt,body:Map<String,Any?> = emptyMap(),origin:String=ORIGIN)=mvc.post("/api/auth/social/complete") { cookie(attempt.cookie); header("Origin",origin); contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(body) }.andReturn()
    private fun link(attempt:Attempt,nickname:String,password:String)=mvc.post("/api/auth/social/link") { cookie(attempt.cookie); header("Origin",ORIGIN); contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password)) }.andReturn()
    private fun expire(attempt:Attempt) {
        // PostgreSQL TIMESTAMP has no zone; avoid JdbcTemplate's JVM-zone conversion of java.sql.Timestamp.
        assertEquals(1,jdbc.update("UPDATE social_auth_flows SET expires_at=TIMESTAMP '2000-01-01 00:00:00' WHERE id=?",attempt.id))
    }
    private fun assertPrivate(result:MvcResult) { assertEquals("private, no-store",result.response.getHeader("Cache-Control")); assertEquals("no-referrer",result.response.getHeader("Referrer-Policy")) }
    private fun suffix()=UUID.randomUUID().toString().take(8)
    private fun githubSubject() = subjectSequence.incrementAndGet().toString()
}

private fun parseForm(value:String?) = value.orEmpty().split('&').filter(String::isNotEmpty).associate { val parts=it.split('=',limit=2); URLDecoder.decode(parts[0],StandardCharsets.UTF_8) to URLDecoder.decode(parts.getOrElse(1){""},StandardCharsets.UTF_8) }

private class FakeGithubProvider:AutoCloseable {
    private val mapper=ObjectMapper()
    private val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
    private val executor=Executors.newCachedThreadPool()
    private data class Fixture(val params:Map<String,String>,val subject:String,val overrides:Map<String,Any>)
    private val fixtures=ConcurrentHashMap<String,Fixture>()
    val forms=ConcurrentHashMap<String,Map<String,String>>(); val userInfoForms=ConcurrentHashMap<String,Map<String,String>>(); val exchanges=AtomicInteger()
    val base="http://127.0.0.1:${server.address.port}"
    init {
        server.executor=executor
        server.createContext("/") { exchange ->
            val path=exchange.requestURI.path
            val form=parseForm(exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8))
            val body:Any = when(path) {
                "/github/token" -> {
                    exchanges.incrementAndGet(); val code=form["code"].orEmpty(); val fixture=requireNotNull(fixtures[code]); forms[code]=form
                    assertEquals(fixture.params["code_challenge"],encode(MessageDigest.getInstance("SHA-256").digest(form.getValue("code_verifier").toByteArray(StandardCharsets.US_ASCII))))
                    assertEquals(fixture.params["redirect_uri"],form["redirect_uri"])
                    if(fixture.overrides["slow"]==true) Thread.sleep(1500)
                    mapOf("access_token" to "github-access-$code", "token_type" to (fixture.overrides["token_type"] ?: "bearer"), "scope" to (fixture.overrides["scope"] ?: ""))
                }
                "/github/userinfo" -> {
                    val authorization = exchange.requestHeaders.getFirst("Authorization")
                    val code = authorization.removePrefix("Bearer github-access-")
                    val fixture = requireNotNull(fixtures[code])
                    userInfoForms[code] = mapOf("authorization" to authorization)
                    mapOf("id" to (fixture.overrides["userinfo-sub"] ?: fixture.subject), "login" to "renamed-user", "name" to (fixture.overrides["name"] ?: "Иван GitHub"), "email" to null)
                }
                else -> mapOf("error" to "unknown")
            }
            val bytes=mapper.writeValueAsBytes(body)
            val bodyStalls = form["code"]?.let { fixtures[it]?.overrides?.get("slow-body") } == true
            runCatching {
                exchange.responseHeaders.add("Content-Type","application/json")
                exchange.sendResponseHeaders(200,bytes.size.toLong())
                if(bodyStalls) { exchange.responseBody.write(bytes,0,1); exchange.responseBody.flush(); Thread.sleep(1500) }
                exchange.responseBody.use { if(bodyStalls) it.write(bytes,1,bytes.size-1) else it.write(bytes) }
            }
            exchange.close()
        }
        server.start()
    }
    fun code(params:Map<String,String>,subject:String,overrides:Map<String,Any> = emptyMap()):String = UUID.randomUUID().toString().also { fixtures[it]=Fixture(params,subject,overrides) }
    fun subject(code:String)=fixtures.getValue(code).subject
    private fun encode(value:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(value)
    override fun close() { server.stop(0); executor.shutdownNow() }
}
