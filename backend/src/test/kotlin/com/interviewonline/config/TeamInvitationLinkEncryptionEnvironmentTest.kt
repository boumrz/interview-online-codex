package com.interviewonline.config

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.junit.jupiter.api.Test
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.boot.context.properties.source.ConfigurationPropertySources
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.env.SystemEnvironmentPropertySource

class TeamInvitationLinkEncryptionEnvironmentTest {
    @Test
    fun `deployment canonical environment variable binds the primary encryption key`() {
        val testKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
        val environment = StandardEnvironment()
        environment.propertySources.replace(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, SystemEnvironmentPropertySource(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, mapOf(
            "APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY" to testKey,
        )))
        environment.propertySources.addFirst(MapPropertySource("active-key", mapOf(
            "app.team-invitation-link-encryption.active-key-id" to "primary",
        )))
        ConfigurationPropertySources.attach(environment)
        val properties = Binder.get(environment).bind(
            "app.team-invitation-link-encryption",
            TeamInvitationLinkEncryptionProperties::class.java,
        ).get()
        assertEquals("primary", properties.activeKeyId)
        assertEquals(mapOf("primary" to testKey), properties.keys)
    }

    @Test
    fun `invalid key configuration fails startup with a constant message and no key material`() {
        val fakeKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
        val invalidConfigurations = listOf(
            emptyArray(),
            arrayOf("app.team-invitation-link-encryption.active-key-id=unknown", "app.team-invitation-link-encryption.keys.primary=$fakeKey"),
            arrayOf("app.team-invitation-link-encryption.active-key-id=primary", "app.team-invitation-link-encryption.keys.primary=${fakeKey}="),
            arrayOf("app.team-invitation-link-encryption.active-key-id=primary", "app.team-invitation-link-encryption.keys.primary=${fakeKey.dropLast(1)}+"),
        )
        for (configuration in invalidConfigurations) {
            ApplicationContextRunner().withUserConfiguration(TeamInvitationLinkEncryptionConfiguration::class.java)
                .withPropertyValues("app.features.team-workspaces-enabled=false", *configuration)
                .run { context ->
                    val failure = context.startupFailure
                    assertNotNull(failure, "Missing or malformed keys fail startup even with the retired false property")
                    val causes = generateSequence(failure) { it.cause }.toList()
                    assertEquals("Invalid team invitation link encryption configuration", causes.last().message)
                    assertFalse(causes.joinToString { it.message.orEmpty() }.contains(fakeKey), "Startup errors do not contain key material")
                }
        }
    }

    @Test
    fun `valid key remains usable across application restarts without a rollout property`() {
        val configuration = arrayOf(
            "app.team-invitation-link-encryption.active-key-id=primary",
            "app.team-invitation-link-encryption.keys.primary=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        )
        val runner = ApplicationContextRunner().withUserConfiguration(TeamInvitationLinkEncryptionConfiguration::class.java)
            .withPropertyValues(*configuration)
        var encrypted: String? = null
        runner.run { context ->
            assertNull(context.startupFailure)
            encrypted = context.getBean(TeamInvitationLinkCipher::class.java).encrypt("synthetic-invitation-bearer", "synthetic-team")
        }
        runner.withPropertyValues("app.features.team-workspaces-enabled=false").run { context ->
            assertNull(context.startupFailure)
            val cipher = context.getBean(TeamInvitationLinkCipher::class.java)
            assertEquals("synthetic-invitation-bearer", cipher.decrypt("primary", requireNotNull(encrypted), "synthetic-team"))
        }
    }

}
