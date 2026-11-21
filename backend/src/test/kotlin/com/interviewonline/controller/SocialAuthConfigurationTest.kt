package com.interviewonline.controller

import com.interviewonline.features.socialauth.*
import com.interviewonline.service.ApiException
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.Mockito.*
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.http.HttpStatus
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.setup.MockMvcBuilders

@ExtendWith(OutputCaptureExtension::class)
class SocialAuthConfigurationTest {
    @Test fun `full credentials determine provider availability with no feature toggles`() {
        assertEquals(listOf("google"), SocialAuthSettings(configuredGoogle()).providers)
        ApplicationContextRunner().withUserConfiguration(SocialAuthConfiguration::class.java)
            .withPropertyValues(
                "app.social-auth.enabled=false", "app.social-auth.google.enabled=false", "app.social-auth.github.enabled=false",
                "app.social-auth.flow-secret=$SECRET",
                "app.social-auth.google.client-id=google-client", "app.social-auth.google.client-secret=google-secret",
                "app.social-auth.github.client-id=github-client", "app.social-auth.github.client-secret=github-secret",
            ).run { context ->
                assertNull(context.startupFailure)
                assertEquals(listOf("google", "github"), context.getBean(SocialAuthSettings::class.java).providers)
            }
    }

    @Test fun `absence of credentials ignores unusable social configuration and client construction`() {
        ApplicationContextRunner().withUserConfiguration(SocialAuthConfiguration::class.java)
            .withPropertyValues(
                "app.social-auth.enabled=false", "app.social-auth.google.enabled=true", "app.social-auth.vk.enabled=true",
                "app.social-auth.public-base-url=NOT_A_URL", "app.social-auth.flow-secret=NOT_A_SECRET",
                "app.social-auth.http-timeout-millis=-1", "app.social-auth.google.token-uri=NOT_AN_ENDPOINT",
            ).run { context ->
                assertNull(context.startupFailure)
                val settings = context.getBean(SocialAuthSettings::class.java)
                assertTrue(settings.providers.isEmpty())
                assertFalse(settings.matchesOrigin("http://localhost:5173"))
                assertFalse(settings.matchesOrigin(null))
                assertDoesNotThrow { SocialProviderClient(settings, ObjectMapper()) }
            }
    }

    @Test fun `dormant provider ignores unavailable timeout and legacy flags`() {
        ApplicationContextRunner().withUserConfiguration(SocialAuthConfiguration::class.java)
            .withPropertyValues("app.social-auth.enabled=false", "app.social-auth.google.enabled=NOT_A_BOOLEAN", "app.social-auth.http-timeout-millis=NOT_A_NUMBER")
            .run { context ->
                assertNull(context.startupFailure)
                assertTrue(context.getBean(SocialAuthSettings::class.java).providers.isEmpty())
            }
    }

    @Test fun `partial provider warns without revealing its configured value or disabling a ready provider`(output: CapturedOutput) {
        val incompleteSecret = "PRIVATE_PARTIAL_GOOGLE_SECRET"
        ApplicationContextRunner().withUserConfiguration(SocialAuthConfiguration::class.java)
            .withPropertyValues(
                "app.social-auth.google.client-secret=$incompleteSecret",
                "app.social-auth.github.client-id=github-client", "app.social-auth.github.client-secret=github-secret",
                "app.social-auth.flow-secret=$SECRET",
            ).run { context ->
                assertNull(context.startupFailure)
                assertEquals(listOf("github"), context.getBean(SocialAuthSettings::class.java).providers)
            }
        assertTrue(output.all.contains("missing GOOGLE_CLIENT_ID"))
        assertFalse(output.all.contains(incompleteSecret))
    }

    @Test fun `active timeout validation hides offending value and original cause`() {
        ApplicationContextRunner().withUserConfiguration(SocialAuthConfiguration::class.java)
            .withPropertyValues("app.social-auth.google.client-id=google-client", "app.social-auth.google.client-secret=google-secret",
                "app.social-auth.flow-secret=$SECRET", "app.social-auth.http-timeout-millis=PRIVATE_BINDING_VALUE")
            .run { context ->
                val failure=requireNotNull(context.startupFailure)
                var last:Throwable=failure
                while(last.cause!=null) last=requireNotNull(last.cause)
                assertEquals("Invalid social authentication configuration",last.message)
                assertFalse(failure.toString().contains("PRIVATE_BINDING_VALUE"))
            }
    }

    @Test fun `disabled defaults need no secret and publish no provider`() {
        val settings = SocialAuthSettings(SocialAuthProperties())
        assertTrue(settings.providers.isEmpty())
        assertEquals("http://localhost:5173", settings.origin)
    }

    @Test fun `malformed enabled configuration fails without revealing values or cause`() {
        val invalid = listOf<(SocialAuthProperties) -> Unit>(
            { it.flowSecret = "PRIVATE_SECRET_NEVER_PRINT" },
            { it.google.tokenUri = "https://attacker.example/PRIVATE_SECRET_NEVER_PRINT" },
            { it.publicBaseUrl = "http://example.com" },
            { it.publicBaseUrl = "https://user:PRIVATE_SECRET_NEVER_PRINT@example.com" },
            { it.publicBaseUrl = "https://example.com/next?token=PRIVATE_SECRET_NEVER_PRINT" },
            { it.httpTimeoutMillis = "0" },
        )
        invalid.forEach { mutate ->
            val properties = configuredGoogle()
            mutate(properties)
            val failure = assertThrows(IllegalStateException::class.java) { SocialAuthSettings(properties) }
            assertEquals("Invalid social authentication configuration", failure.message)
            assertNull(failure.cause)
            assertFalse(failure.toString().contains("PRIVATE_SECRET_NEVER_PRINT"))
        }
    }

    @Test fun `public origin canonicalizes hostname and default port`() {
        val settings = SocialAuthSettings(configuredGoogle().apply { publicBaseUrl = "https://EXAMPLE.com:443/" })
        assertEquals("https://example.com", settings.origin)
        assertEquals("https://example.com/api/auth/social/google/callback", settings.callback("google"))
    }

    @Test fun `HTTPS proof uses Host prefix and ignores plain legacy cookie`() {
        val settings = SocialAuthSettings(configuredGoogle().apply { publicBaseUrl = "https://example.com" })
        val service = mock(SocialAuthService::class.java)
        `when`(service.start("google")).thenReturn(SocialStartResult("https://accounts.google.com/o/oauth2/v2/auth", "proof"))
        `when`(service.pending("proof")).thenReturn(SocialPendingResponse("google", "Имя", true))
        `when`(service.pending(null)).thenThrow(ApiException(HttpStatus.UNAUTHORIZED, "Начните вход заново"))
        val mvc = MockMvcBuilders.standaloneSetup(SocialAuthController(service, settings)).build()
        val start = mvc.post("/api/auth/social/google/start") { header("Origin", settings.origin) }.andReturn()
        val cookie = requireNotNull(start.response.getHeader("Set-Cookie"))
        assertTrue(cookie.startsWith("__Host-interhub_social=proof;"))
        assertTrue(cookie.contains("Path=/;")); assertTrue(cookie.contains("Secure"))
        assertTrue(cookie.contains("HttpOnly")); assertTrue(cookie.contains("SameSite=Lax")); assertFalse(cookie.contains("Domain="))
        mvc.get("/api/auth/social/pending") { cookie(Cookie("interhub_social", "proof")) }.andExpect { status { isUnauthorized() } }
        mvc.get("/api/auth/social/pending") { cookie(Cookie("__Host-interhub_social", "proof")) }.andExpect { status { isOk() } }
        mvc.get("/api/auth/social/pending") { cookie(Cookie("__Host-interhub_social", "proof"), Cookie("__Host-interhub_social", "attacker")) }.andExpect { status { isUnauthorized() } }
    }

    private fun configuredGoogle() = SocialAuthProperties().apply {
        flowSecret = SECRET; google.clientId = "google-client"; google.clientSecret = "google-secret"
    }
    companion object { private const val SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" }
}
