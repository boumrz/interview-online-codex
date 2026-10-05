package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.support.Postgres16TestSupport
import com.sun.net.httpserver.HttpServer
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
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
import org.springframework.test.web.servlet.post
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SocialAuthIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val sessions: UserSessionRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private const val ORIGIN = "http://localhost:5173"
        private val postgres = Postgres16TestSupport.create("social_auth")
        private val provider = FakeSocialProvider()
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            postgres.register(registry)
            mapOf(
                "app.social-auth.enabled" to "true",
                "app.social-auth.public-base-url" to ORIGIN,
                "app.social-auth.flow-secret" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                "app.social-auth.http-timeout-millis" to "500",
                "app.social-auth.google.enabled" to "true",
                "app.social-auth.google.client-id" to "google-test-client",
                "app.social-auth.google.client-secret" to "google-test-secret",
                "app.social-auth.google.authorization-uri" to "${provider.base}/google/authorize",
                "app.social-auth.google.token-uri" to "${provider.base}/google/token",
                "app.social-auth.google.jwk-uri" to "${provider.base}/google/keys",
                "app.social-auth.vk.enabled" to "true",
                "app.social-auth.vk.client-id" to "vk-test-client",
                "app.social-auth.vk.service-token" to "vk-test-service-token",
                "app.social-auth.vk.authorization-uri" to "${provider.base}/vk/authorize",
                "app.social-auth.vk.token-uri" to "${provider.base}/vk/token",
                "app.social-auth.vk.user-info-uri" to "${provider.base}/vk/userinfo",
            ).forEach { (key, value) -> registry.add(key) { value } }
        }
        @JvmStatic @AfterAll fun cleanup() { provider.close(); postgres.close() }
    }

    @Test fun `provider start uses canonical callback PKCE nonce and protected cookie`() {
        postgres.verifyPostgres16()
        mvc.get("/api/auth/social/providers").andExpect {
            status { isOk() }; jsonPath("$.providers[0]") { value("google") }; jsonPath("$.providers[1]") { value("vk") }
            header { string("Cache-Control", "private, no-store") }
        }
        val attempt = start()
        assertEquals("$ORIGIN/api/auth/social/google/callback", attempt.params["redirect_uri"])
        assertEquals("S256", attempt.params["code_challenge_method"])
        assertEquals("openid profile", attempt.params["scope"])
        assertNotNull(attempt.params["nonce"])
        assertTrue(attempt.cookieHeader.contains("HttpOnly"))
        assertTrue(attempt.cookieHeader.contains("SameSite=Lax"))
        assertTrue(attempt.cookieHeader.contains("Path=/api/auth/social"))
        assertFalse(attempt.cookieHeader.contains("Secure"), "loopback HTTP is explicitly supported")
        val stored = jdbc.queryForMap("SELECT state_hash, browser_proof_hash FROM social_auth_flows WHERE id=?", attempt.id)
        assertNotEquals(attempt.params["state"], stored["state_hash"])
        assertFalse(stored.values.any { it == attempt.cookie.value })
    }

    @Test fun `Google exchange creates social profile and later login preserves identity without local password`() {
        val subject = "google-${suffix()}"
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
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider='google' AND subject=?", Long::class.java, subject))
    }

    @Test fun `VK exchanges device id and PKCE then verifies token state and server user info`() {
        val ready = ready("vk", "${Instant.now().epochSecond}")
        assertPending(ready, false)
        val result = complete(ready, mapOf("nickname" to "vk_${suffix()}", "displayName" to "VK Имя"))
        assertEquals(200, result.response.status)
        assertPrivate(result)
        assertEquals("vk-device", provider.forms[ready.code]?.get("device_id"))
        assertEquals("vk-test-service-token", provider.forms[ready.code]?.get("service_token"))
        assertEquals("vk-test-client", provider.userInfoForms[ready.code]?.get("client_id"))
        assertFalse(provider.forms[ready.code].orEmpty().containsKey("client_secret"))
        assertFalse(result.response.contentAsString.contains("vk-access"))
        assertFalse(result.response.contentAsString.contains("vk-refresh"))
    }

    @Test fun `wrong Origin missing proof wrong state and wrong provider cannot authorize`() {
        val beforeUsers = users.count(); val beforeSessions = sessions.count()
        mvc.post("/api/auth/social/google/start") { header("Origin", "https://attacker.example"); contentType=MediaType.APPLICATION_JSON; content="{}" }
            .andExpect { status { isForbidden() } }
        mvc.post("/api/auth/social/google/start") { contentType=MediaType.APPLICATION_JSON; content="{}" }
            .andExpect { status { isForbidden() } }
        val attempt = start(); val code = provider.code(attempt.params, "google", "forged")
        val calls = provider.exchanges.get()
        for ((cookie, state, kind) in listOf(Triple(null, attempt.params.getValue("state"), "google"), Triple(Cookie("interhub_social", "forged"), attempt.params.getValue("state"), "google"), Triple(attempt.cookie, "wrong-state", "google"), Triple(attempt.cookie, attempt.params.getValue("state"), "vk"))) {
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
        val ready = ready(subject = "race-${suffix()}")
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

    @Test fun `invalid Google signature issuer audience expiry nonce subject and algorithm deny identity`() {
        for ((key,value) in listOf("iss" to "https://evil.example", "aud" to "wrong-client", "exp" to 1, "nonce" to "wrong-nonce", "sub" to "", "alg" to "HS256", "bad-signature" to true, "iat" to (Instant.now().epochSecond + 3600))) {
            val attempt=start(); val code=provider.code(attempt.params,"google","negative-${suffix()}",mapOf(key to value))
            val result=callback(attempt,code)
            assertEquals("$ORIGIN/login/social?result=failed",result.response.getHeader("Location"))
            assertEquals(401,pending(attempt).response.status)
        }
    }

    @Test fun `distinct flows completing one provider subject create one account and preserve retry`() {
        val subject="cross-flow-${suffix()}"
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
            assertEquals(1L,jdbc.queryForObject("SELECT count(*) FROM social_auth_identities WHERE provider='google' AND subject=?",Long::class.java,subject))
        } finally { executor.shutdownNow() }
    }

    @Test fun `distinct provider flows cannot concurrently link identity to different local users`() {
        val subject="cross-link-${suffix()}"
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
            assertEquals(accounts[winner].id,jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE provider='google' AND subject=?",String::class.java,subject))
            assertEquals(beforeSessions+1,sessions.count())
            assertPending(attempts[loser],true)
            assertEquals(409,link(attempts[loser],accounts[loser].nickname,"local-password123").response.status)
        } finally { executor.shutdownNow() }
    }

    @Test fun `VK missing device id mismatched token state and mismatched user info deny identity`() {
        for (overrides in listOf(mapOf("state" to "wrong-state"), mapOf("userinfo-sub" to "99999999"))) {
            val attempt=start("vk"); val code=provider.code(attempt.params,"vk","12345",overrides)
            assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code).response.getHeader("Location"))
            assertEquals(401,pending(attempt).response.status)
        }
        val attempt=start("vk"); val code=provider.code(attempt.params,"vk","12345")
        val calls=provider.exchanges.get()
        assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code,deviceId="").response.getHeader("Location"))
        assertEquals(calls,provider.exchanges.get())
    }

    @Test fun `expired callback and completion fail and next start cleans expired flows`() {
        val attempt=start(); val code=provider.code(attempt.params,"google","expire-${suffix()}")
        expire(attempt)
        assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code).response.getHeader("Location"))
        val ready=ready(subject="expire-${suffix()}"); expire(ready)
        assertEquals(401,complete(ready,mapOf("nickname" to "expired_${suffix()}","displayName" to "Истёк")).response.status)
        start()
        assertEquals(0L,jdbc.queryForObject("SELECT count(*) FROM social_auth_flows WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",Long::class.java))
    }

    @Test fun `occupied Cyrillic reserved nickname and invalid name are retryable without account writes`() {
        val occupied="occupied_${suffix()}"
        users.saveAndFlush(User(nickname=occupied,displayName="Другой",passwordHash=BCryptPasswordEncoder().encode("password123")))
        val ready=ready(subject="retry-${suffix()}"); val beforeUsers=users.count(); val beforeSessions=sessions.count()
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
        val ready=ready(subject="linked-${suffix()}"); val before=sessions.count()
        assertEquals(401,link(ready,nickname,"wrong").response.status)
        assertEquals(before,sessions.count())
        assertEquals(200,pending(ready).response.status)
        val linked=link(ready,nickname,password)
        assertEquals(200,linked.response.status)
        val result=mapper.readTree(linked.response.contentAsByteArray).path("user")
        assertEquals(local.id,result.path("id").asText()); assertEquals("Прежнее имя",result.path("displayName").asText()); assertTrue(result.path("isHr").booleanValue())
        mvc.post("/api/auth/login") { contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password)) }.andExpect { status { isOk() } }
        val another=users.saveAndFlush(User(nickname="other_${suffix()}",displayName="Другой",passwordHash=BCryptPasswordEncoder().encode("secret123")))
        val again=ready(subject=provider.subject(ready.code))
        assertEquals(409,link(again,another.nickname,"secret123").response.status)
        assertEquals(local.id,jdbc.queryForObject("SELECT user_id FROM social_auth_identities WHERE subject=?",String::class.java,provider.subject(ready.code)))
    }

    @Test fun `provider cancellation malformed duplicate callback and finite transport failure leak no secrets`() {
        val attempt=start()
        val cancelled=mvc.get("/api/auth/social/google/callback") { cookie(attempt.cookie); param("state",attempt.params.getValue("state")); param("error","access_denied"); param("error_description","SECRET_DO_NOT_ECHO") }.andReturn()
        assertEquals("$ORIGIN/login/social?result=cancelled",cancelled.response.getHeader("Location")); assertPrivate(cancelled)
        assertFalse(cancelled.response.contentAsString.contains("SECRET_DO_NOT_ECHO"))
        val duplicate=start(); val duplicateCode=provider.code(duplicate.params,"google","duplicate")
        val dup=mvc.get("/api/auth/social/google/callback") { cookie(duplicate.cookie); param("state",duplicate.params.getValue("state"),"attacker"); param("code",duplicateCode) }.andReturn()
        assertEquals("$ORIGIN/login/social?result=failed",dup.response.getHeader("Location"))
        val slow=start(); val code=provider.code(slow.params,"google","slow",mapOf("slow" to true)); val began=System.nanoTime()
        assertEquals("$ORIGIN/login/social?result=failed",callback(slow,code).response.getHeader("Location"))
        assertTrue(System.nanoTime()-began < 2_000_000_000L,"provider deadline is finite")
        assertEquals(401,pending(slow).response.status)
    }

    @Test fun `provider response body stall is bounded after headers arrive`() {
        val attempt=start(); val code=provider.code(attempt.params,"google","slow-body",mapOf("slow-body" to true))
        val began=System.nanoTime()
        assertEquals("$ORIGIN/login/social?result=failed",callback(attempt,code).response.getHeader("Location"))
        assertTrue(System.nanoTime()-began < 1_200_000_000L,"deadline includes response body")
        assertEquals(401,pending(attempt).response.status)
    }

    private data class Attempt(val provider:String,val params:Map<String,String>,val cookie:Cookie,val cookieHeader:String,val id:String,val code:String="")
    private fun start(provider:String="google"):Attempt {
        val result=mvc.post("/api/auth/social/$provider/start") { header("Origin",ORIGIN); header("Host","attacker.example"); header("X-Forwarded-Host","attacker.example"); contentType=MediaType.APPLICATION_JSON; content="{}" }.andExpect { status { isOk() } }.andReturn()
        assertPrivate(result)
        val url=URI(mapper.readTree(result.response.contentAsByteArray).path("authorizationUrl").asText())
        val cookieHeader=requireNotNull(result.response.getHeader("Set-Cookie")); val pair=cookieHeader.substringBefore(';').split('=',limit=2)
        return Attempt(provider,parseForm(url.rawQuery),Cookie(pair[0],pair[1]),cookieHeader,pair[1].substringBefore('.'))
    }
    private fun ready(kind:String="google",subject:String="subject-${suffix()}"):Attempt {
        val attempt=start(kind); val code=provider.code(attempt.params,kind,subject)
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
}

private fun parseForm(value:String?) = value.orEmpty().split('&').filter(String::isNotEmpty).associate { val parts=it.split('=',limit=2); URLDecoder.decode(parts[0],StandardCharsets.UTF_8) to URLDecoder.decode(parts.getOrElse(1){""},StandardCharsets.UTF_8) }

private class FakeSocialProvider:AutoCloseable {
    private val mapper=ObjectMapper(); private val key=KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
    private val executor=Executors.newCachedThreadPool()
    private data class Fixture(val params:Map<String,String>,val provider:String,val subject:String,val overrides:Map<String,Any>)
    private val fixtures=ConcurrentHashMap<String,Fixture>()
    val forms=ConcurrentHashMap<String,Map<String,String>>(); val userInfoForms=ConcurrentHashMap<String,Map<String,String>>(); val exchanges=AtomicInteger()
    val base="http://127.0.0.1:${server.address.port}"
    init {
        server.executor=executor
        server.createContext("/") { exchange ->
            val path=exchange.requestURI.path
            val form=parseForm(exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8))
            val body:Any = when(path) {
                "/google/keys" -> { val public=key.public as RSAPublicKey; mapOf("keys" to listOf(mapOf("kty" to "RSA","use" to "sig","alg" to "RS256","kid" to "local-key","n" to encode(public.modulus.toByteArray().dropWhile { it==0.toByte() }.toByteArray()),"e" to encode(public.publicExponent.toByteArray())))) }
                "/google/token","/vk/token" -> {
                    exchanges.incrementAndGet(); val code=form["code"].orEmpty(); val fixture=requireNotNull(fixtures[code]); forms[code]=form
                    assertEquals(fixture.params["code_challenge"],encode(MessageDigest.getInstance("SHA-256").digest(form.getValue("code_verifier").toByteArray(StandardCharsets.US_ASCII))))
                    assertEquals(fixture.params["redirect_uri"],form["redirect_uri"])
                    if(fixture.overrides["slow"]==true) Thread.sleep(1500)
                    if(fixture.provider=="google") mapOf("access_token" to "GOOGLE_ACCESS_SECRET","id_token" to token(fixture))
                    else mapOf("access_token" to "vk-access-$code","refresh_token" to "vk-refresh-$code","id_token" to "UNTRUSTED_VK_TOKEN","state" to (fixture.overrides["state"] ?: fixture.params.getValue("state")),"user_id" to fixture.subject)
                }
                "/vk/userinfo" -> { val code=form.getValue("access_token").removePrefix("vk-access-"); val fixture=requireNotNull(fixtures[code]); userInfoForms[code]=form; mapOf("user" to mapOf("user_id" to (fixture.overrides["userinfo-sub"] ?: fixture.subject),"first_name" to "Иван","last_name" to "VK")) }
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
    fun code(params:Map<String,String>,provider:String,subject:String,overrides:Map<String,Any> = emptyMap()):String = UUID.randomUUID().toString().also { fixtures[it]=Fixture(params,provider,subject,overrides) }
    fun subject(code:String)=fixtures.getValue(code).subject
    private fun token(fixture:Fixture):String {
        val header=mapOf("alg" to (fixture.overrides["alg"] ?: "RS256"),"kid" to "local-key")
        val claims=mutableMapOf<String,Any>("iss" to "https://accounts.google.com","aud" to "google-test-client","sub" to fixture.subject,"iat" to Instant.now().epochSecond,"exp" to (Instant.now().epochSecond+300),"nonce" to fixture.params.getValue("nonce"),"name" to "Имя Google")
        claims.putAll(fixture.overrides.filterKeys { it !in setOf("alg","bad-signature","slow") })
        val signingInput="${encode(mapper.writeValueAsBytes(header))}.${encode(mapper.writeValueAsBytes(claims))}"
        val signer=Signature.getInstance("SHA256withRSA"); signer.initSign(key.private); signer.update(signingInput.toByteArray(StandardCharsets.US_ASCII))
        val signed=signer.sign(); if(fixture.overrides["bad-signature"]==true) signed[0]=(signed[0].toInt() xor 1).toByte()
        return "$signingInput.${encode(signed)}"
    }
    private fun encode(value:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(value)
    override fun close() { server.stop(0); executor.shutdownNow() }
}
