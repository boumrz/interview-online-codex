package com.interviewonline.controller

import com.interviewonline.features.socialauth.*
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.service.AuthService
import com.interviewonline.support.Postgres16TestSupport
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
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
class SocialAuthProviderDisabledIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val users: UserRepository,
    @Autowired private val sessions: UserSessionRepository,
    @Autowired private val identities: SocialAuthIdentityRepository,
    @Autowired private val flows: SocialAuthFlowRepository,
    @Autowired private val auth: AuthService,
) {
    companion object {
        private const val ORIGIN = "http://localhost:5173"
        private val postgres = Postgres16TestSupport.create("social_provider_disabled")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            postgres.register(registry)
            mapOf("app.social-auth.public-base-url" to ORIGIN,
                "app.social-auth.flow-secret" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                "app.social-auth.google.client-id" to "unpaired-google-client", "app.social-auth.google.client-secret" to "",
                "app.social-auth.github.client-id" to "github-test-client", "app.social-auth.github.client-secret" to "github-test-secret",
            ).forEach { (key, value) -> registry.add(key) { value } }
        }
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `provider without a complete credential pair keeps status and refuses profile authentication`() {
        val account = users.saveAndFlush(User(nickname = "disabled_${UUID.randomUUID().toString().take(8)}", displayName = "Имя"))
        val token = auth.createSession(account).token
        identities.saveAndFlush(SocialAuthIdentity(provider = "google", subject = "existing", user = account))
        val proof = SocialAuthSettings.randomProof()
        val flow = flows.saveAndFlush(SocialAuthFlow(id = UUID.randomUUID().toString(), provider = "google",
            stateHash = SocialAuthSettings.hash("state"), browserProofHash = SocialAuthSettings.hash(proof),
            status = "READY", subject = "existing", intent = "profile_link", initiatingUserId = account.id,
            initiatingSessionHash = SocialAuthSettings.hash(token), expiresAt = Instant.now().plusSeconds(600)))
        val cookie = Cookie("interhub_social", "${flow.id}.$proof")
        val beforeSessions = sessions.count()
        mvc.get("/api/auth/social/connections") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }
            jsonPath("$.connections[0].provider") { value("google") }; jsonPath("$.connections[0].linked") { value(true) }; jsonPath("$.connections[0].available") { value(false) }
            jsonPath("$.connections[1].provider") { value("github") }; jsonPath("$.connections[1].linked") { value(false) }; jsonPath("$.connections[1].available") { value(true) }
        }
        mvc.post("/api/auth/social/google/profile-link/start") { header("Authorization", "Bearer $token"); header("Origin", ORIGIN) }
            .andExpect { status { isNotFound() }; jsonPath("$.code") { value("SOCIAL_PROVIDER_DISABLED") } }
        mvc.post("/api/auth/social/profile-link/complete") { cookie(cookie); header("Authorization", "Bearer $token"); header("Origin", ORIGIN) }
            .andExpect { status { isNotFound() }; jsonPath("$.code") { value("SOCIAL_PROVIDER_DISABLED") } }
        assertEquals(beforeSessions, sessions.count())
        assertEquals("READY", flows.findById(flow.id).orElseThrow().status)
        assertEquals(account.id, identities.findByProviderAndSubject("google", "existing")?.user?.id)
    }

    @Test fun `complete GitHub credentials are available despite incomplete Google configuration`() {
        mvc.get("/api/auth/social/providers").andExpect {
            status { isOk() }; jsonPath("$.providers", org.hamcrest.Matchers.contains("github"))
        }
        mvc.post("/api/auth/social/github/start") { header("Origin", ORIGIN) }.andExpect { status { isOk() } }
    }

    @Test fun `password can be set while removing a disabled linked provider`() {
        val account = users.saveAndFlush(User(nickname = "unlink_disabled_${UUID.randomUUID().toString().take(8)}", displayName = "Имя"))
        val token = auth.createSession(account).token
        identities.saveAndFlush(SocialAuthIdentity(provider = "google", subject = "disabled-unlink", user = account))
        identities.saveAndFlush(SocialAuthIdentity(provider = "github", subject = "97123675", user = account))
        mvc.get("/api/auth/social/connections") { header("Authorization", "Bearer $token") }.andExpect {
            status { isOk() }
            jsonPath("$.connections[0].linked") { value(true) }; jsonPath("$.connections[0].available") { value(false) }
            jsonPath("$.connections[0].requiresPassword") { value(true) }; jsonPath("$.connections[1].requiresPassword") { value(true) }
            jsonPath("$.connections[0].canUnlink") { value(false) }; jsonPath("$.connections[1].canUnlink") { value(false) }
        }
        mvc.post("/api/auth/social/github/unlink") { header("Origin", ORIGIN); header("Authorization", "Bearer $token") }.andExpect {
            status { isConflict() }; jsonPath("$.code") { value("SOCIAL_PASSWORD_REQUIRED") }
        }
        mvc.post("/api/auth/social/google/unlink") {
            header("Origin", ORIGIN)
            header("Authorization", "Bearer $token")
            contentType = MediaType.APPLICATION_JSON
            content = """{"newPassword":"first-password-123"}"""
        }.andExpect {
            status { isOk() }; jsonPath("$.connections[0].linked") { value(false) }; jsonPath("$.connections[1].linked") { value(true) }
            jsonPath("$.connections[1].canUnlink") { value(true) }
        }
        assertEquals(account.id, auth.verifyLocalCredentials(account.nickname, "first-password-123").id)
    }
}
