package com.interviewonline.config

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.core.env.MapPropertySource
import java.util.Base64
import java.util.stream.Stream

/**
 * RED contract for the fail-closed chat-receipt HMAC bootstrap.
 *
 * The expected component is loaded reflectively so this test compiles before
 * production implementation exists. Each case uses a tiny isolated Spring
 * context: no web server, datasource, Flyway or repository is involved.
 */
class ChatReceiptHmacConfigurationTest {
    companion object {
        private const val COMPONENT_CLASS = "com.interviewonline.config.ChatReceiptHmac"
        private const val PROPERTY = "app.realtime.chat-receipt-hmac-secret"
        private val validSecret = encode(ByteArray(32) { index -> index.toByte() })

        @JvmStatic
        fun invalidSecrets(): Stream<InvalidSecretCase> = Stream.of(
            InvalidSecretCase("empty", ""),
            InvalidSecretCase("padded base64url", "$validSecret="),
            InvalidSecretCase("malformed base64url", "sensitive-invalid-/+=-must-not-leak"),
            InvalidSecretCase("decoded length 31", encode(ByteArray(31) { 0x31.toByte() })),
            InvalidSecretCase("decoded length 33", encode(ByteArray(33) { 0x33.toByte() })),
        )

        private fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    @Test
    fun `missing secret prevents component startup`() {
        val componentClass = expectedComponentClass()
        val failure = refreshFailure(componentClass, secret = null)
        assertNotNull(failure, "missing $PROPERTY must stop component creation")
        assertDoesNotExposeRawSecret(failure!!, rawSecret = null)
    }

    @ParameterizedTest(name = "{0} prevents startup without exposing its raw value")
    @MethodSource("invalidSecrets")
    fun `invalid secrets prevent component startup without disclosure`(case: InvalidSecretCase) {
        val componentClass = expectedComponentClass()
        val failure = refreshFailure(componentClass, case.rawSecret)
        assertNotNull(failure, "${case.label} must stop component creation")
        assertDoesNotExposeRawSecret(failure!!, case.rawSecret)
    }

    @Test
    fun `exact unpadded base64url thirty two bytes creates the HMAC component`() {
        val componentClass = expectedComponentClass()
        val context = isolatedContext(componentClass, validSecret)
        try {
            context.refresh()
            val component = context.getBean(componentClass)
            assertNotNull(component)
            assertFalse(component.toString().contains(validSecret), "component toString must not expose the raw secret")
            componentClass.declaredFields
                .filter { it.type == String::class.java }
                .forEach { field ->
                    field.isAccessible = true
                    assertFalse(field.get(component) == validSecret, "component must retain decoded key material, not the raw secret")
                }
        } finally {
            context.close()
        }
    }

    private fun expectedComponentClass(): Class<*> = runCatching { Class.forName(COMPONENT_CLASS) }
        .getOrElse {
            fail(
                "Missing fail-closed $COMPONENT_CLASS component required to validate $PROPERTY",
            )
        }

    private fun refreshFailure(componentClass: Class<*>, secret: String?): Throwable? {
        val context = isolatedContext(componentClass, secret)
        return try {
            runCatching { context.refresh() }.exceptionOrNull()
        } finally {
            runCatching { context.close() }
        }
    }

    private fun isolatedContext(componentClass: Class<*>, secret: String?): AnnotationConfigApplicationContext =
        AnnotationConfigApplicationContext().also { context ->
            if (secret != null) {
                context.environment.propertySources.addFirst(
                    MapPropertySource("chat-receipt-test", mapOf(PROPERTY to secret)),
                )
            }
            context.register(componentClass)
        }

    private fun assertDoesNotExposeRawSecret(failure: Throwable, rawSecret: String?) {
        val chain = generateSequence(failure) { it.cause }
            .joinToString("\n") { throwable -> "${throwable::class.java.name}: ${throwable.message.orEmpty()}" }
        if (!rawSecret.isNullOrEmpty()) {
            assertFalse(chain.contains(rawSecret), "startup exception chain must not contain the raw HMAC secret")
        }
        assertTrue(chain.isNotBlank(), "startup failure must remain diagnosable without secret disclosure")
    }

    data class InvalidSecretCase(
        val label: String,
        val rawSecret: String,
    ) {
        override fun toString(): String = label
    }
}
