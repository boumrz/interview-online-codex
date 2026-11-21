package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.features.socialauth.SocialAuthFlow
import com.interviewonline.features.socialauth.SocialAuthFlowRepository
import com.interviewonline.features.socialauth.SocialAuthIdentity
import com.interviewonline.features.socialauth.SocialAuthIdentityRepository
import com.interviewonline.features.socialauth.SocialAuthSettings
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.support.Postgres16TestSupport
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Instant
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SocialAuthDisabledIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val sessions: UserSessionRepository,
    @Autowired private val flows: SocialAuthFlowRepository,
    @Autowired private val identities: SocialAuthIdentityRepository,
) {
    companion object {
        private const val ORIGIN="http://localhost:5173"
        private val postgres=Postgres16TestSupport.create("social_auth_disabled")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            postgres.register(registry)
            mapOf(
                "app.social-auth.enabled" to "true",
                "app.social-auth.google.enabled" to "true",
                "app.social-auth.google.client-id" to "",
                "app.social-auth.google.client-secret" to "",
                "app.social-auth.github.enabled" to "true",
                "app.social-auth.github.client-id" to "",
                "app.social-auth.github.client-secret" to "",
                "app.social-auth.vk.enabled" to "true",
                "app.social-auth.vk.client-id" to "accidentally-set",
                "app.social-auth.vk.service-token" to "accidentally-set",
                "app.social-auth.public-base-url" to ORIGIN,
                "app.social-auth.flow-secret" to "NOT_A_SECRET",
                "app.social-auth.http-timeout-millis" to "NOT_A_NUMBER",
                "app.social-auth.google.token-uri" to "NOT_AN_ENDPOINT",
            ).forEach { (key,value) -> registry.add(key) { value } }
        }
        @JvmStatic @AfterAll fun cleanup()=postgres.close()
    }

    @Test fun `providers and start remain unavailable without credentials despite legacy flags`() {
        postgres.verifyPostgres16()
        mvc.get("/api/auth/social/providers").andExpect { status { isOk() }; jsonPath("$.providers") { isEmpty() } }
        val count=flows.count()
        for(provider in listOf("google","github","vk")) mvc.post("/api/auth/social/$provider/start") { header("Origin",ORIGIN); contentType=MediaType.APPLICATION_JSON; content="{}" }.andExpect { status { isNotFound() } }
        assertEquals(count,flows.count())
    }

    @Test fun `without credentials profile linking is unavailable and private statuses still require a session`() {
        val local = users.saveAndFlush(User(nickname = "profile_off_${UUID.randomUUID().toString().take(8)}", displayName = "Имя"))
        val token = "usr_${UUID.randomUUID()}"
        sessions.saveAndFlush(com.interviewonline.model.UserSession(user = local, token = token))
        val (flow, cookie) = ready()
        val beforeSessions = sessions.count()
        mvc.get("/api/auth/social/connections").andExpect {
            status { isUnauthorized() }; jsonPath("$.connections") { doesNotExist() }
        }
        mvc.get("/api/auth/social/connections") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }
            jsonPath("$.connections[0].available") { value(false) }; jsonPath("$.connections[0].linked") { value(false) }
            jsonPath("$.connections[1].available") { value(false) }; jsonPath("$.connections[1].linked") { value(false) }
        }
        for (provider in listOf("google", "github")) mvc.post("/api/auth/social/$provider/profile-link/start") {
            header("Origin", ORIGIN); header("Authorization", "Bearer $token")
        }.andExpect { status { isNotFound() }; jsonPath("$.code") { value("SOCIAL_AUTH_DISABLED") } }
        mvc.post("/api/auth/social/profile-link/complete") { cookie(cookie); header("Origin", ORIGIN); header("Authorization", "Bearer $token") }
            .andExpect { status { isNotFound() }; jsonPath("$.code") { value("SOCIAL_AUTH_DISABLED") } }
        assertEquals(beforeSessions, sessions.count())
        assertEquals("READY", flows.findById(flow.id).orElseThrow().status)
    }

    @Test fun `password profile retains and can unlink an unavailable provider with no OAuth credentials`() {
        val local = users.saveAndFlush(User(nickname = "retained_${UUID.randomUUID().toString().take(8)}", displayName = "Имя",
            passwordHash = BCryptPasswordEncoder().encode("password123")))
        val token = "usr_${UUID.randomUUID()}"
        sessions.saveAndFlush(com.interviewonline.model.UserSession(user = local, token = token))
        identities.saveAndFlush(SocialAuthIdentity(provider = "google", subject = "retained-link", user = local))
        mvc.get("/api/auth/social/connections") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }
            jsonPath("$.connections[0].available") { value(false) }; jsonPath("$.connections[0].linked") { value(true) }
            jsonPath("$.connections[0].canUnlink") { value(true) }
        }
        mvc.post("/api/auth/social/google/unlink") { header("Authorization", "Bearer $token") }
            .andExpect { status { isForbidden() } }
        mvc.post("/api/auth/social/google/unlink") { header("Origin", ORIGIN); header("Authorization", "Bearer $token") }
            .andExpect { status { isOk() }; jsonPath("$.connections[0].linked") { value(false) } }
        assertNull(identities.findByProviderAndSubject("google", "retained-link"))
        mvc.get("/api/me/profile") { header("Authorization", "Bearer $token") }
            .andExpect { status { isOk() }; jsonPath("$.id") { value(local.id) } }
    }

    @Test fun `disabled pending cannot reveal a previously verified flow`() {
        val (flow,cookie)=ready()
        mvc.get("/api/auth/social/pending") { cookie(cookie); header("Origin",ORIGIN) }.andExpect { status { isNotFound() } }
        assertEquals("READY",flows.findById(flow.id).orElseThrow().status)
    }

    @Test fun `disabled completion cannot create account identity or session from a previous ready flow`() {
        val (flow,cookie)=ready()
        val userCount=users.count(); val sessionCount=sessions.count(); val identityCount=identities.count()
        mvc.post("/api/auth/social/complete") {
            cookie(cookie); header("Origin",ORIGIN); contentType=MediaType.APPLICATION_JSON
            content=mapper.writeValueAsString(mapOf("nickname" to "dormant_${UUID.randomUUID().toString().take(8)}","displayName" to "Имя"))
        }.andExpect { status { isNotFound() } }
        assertEquals(userCount,users.count()); assertEquals(sessionCount,sessions.count()); assertEquals(identityCount,identities.count())
        assertEquals("READY",flows.findById(flow.id).orElseThrow().status)
    }

    @Test fun `disabled link cannot reauthenticate or attach a previous verified identity`() {
        val local=users.saveAndFlush(User(nickname="old_${UUID.randomUUID().toString().take(8)}",displayName="Старый",passwordHash=BCryptPasswordEncoder().encode("password123")))
        val (flow,cookie)=ready()
        val sessionCount=sessions.count(); val identityCount=identities.count()
        mvc.post("/api/auth/social/link") {
            cookie(cookie); header("Origin",ORIGIN); contentType=MediaType.APPLICATION_JSON
            content=mapper.writeValueAsString(mapOf("nickname" to local.nickname,"password" to "password123"))
        }.andExpect { status { isNotFound() } }
        assertEquals(sessionCount,sessions.count()); assertEquals(identityCount,identities.count())
        assertEquals("READY",flows.findById(flow.id).orElseThrow().status)
    }

    @Test fun `disabled callback returns ordinary login without exchange or flow mutation`() {
        val (flow,cookie)=ready("CREATED")
        mvc.get("/api/auth/social/google/callback") { cookie(cookie); param("state","known-state"); param("error","access_denied") }
            .andExpect { status { isFound() }; header { string("Location","/login") }; header { string("Cache-Control","private, no-store") } }
        assertEquals("CREATED",flows.findById(flow.id).orElseThrow().status)
        mvc.get("/api/auth/social/vk/callback") { param("code","must-not-exchange") }.andExpect { status { isFound() }; header { string("Location","/login") } }
    }

    @Test fun `disabled social integration preserves ordinary legacy credential login`() {
        val nickname="старый_${UUID.randomUUID().toString().take(8)}"
        val password=" Старый пароль123 "
        val local=users.saveAndFlush(User(nickname=nickname,displayName="Старый",passwordHash=BCryptPasswordEncoder().encode(password)))
        mvc.post("/api/auth/login") { contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password)) }
            .andExpect { status { isOk() }; jsonPath("$.user.id") { value(local.id) } }
    }

    private fun ready(status:String="READY"):Pair<SocialAuthFlow,Cookie> {
        val proof=SocialAuthSettings.randomProof()
        val flow=flows.saveAndFlush(SocialAuthFlow(id=UUID.randomUUID().toString(),provider="google",stateHash=SocialAuthSettings.hash("known-state-${UUID.randomUUID()}"),browserProofHash=SocialAuthSettings.hash(proof),status=status,subject="verified-${UUID.randomUUID()}",displayName="Имя",expiresAt=Instant.now().plusSeconds(600)))
        if(status=="CREATED") { flow.stateHash=SocialAuthSettings.hash("known-state"); flows.saveAndFlush(flow) }
        return flow to Cookie("interhub_social","${flow.id}.$proof")
    }
}
