package com.interviewonline.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

@ConfigurationProperties(prefix = "app.team-invitation-link-encryption")
class TeamInvitationLinkEncryptionProperties {
    var activeKeyId: String? = null
    var keys: Map<String, String> = emptyMap()
}

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(TeamInvitationLinkEncryptionProperties::class)
class TeamInvitationLinkEncryptionConfiguration {
    @Bean
    fun teamInvitationLinkCipher(
        properties: TeamInvitationLinkEncryptionProperties,
    ): TeamInvitationLinkCipher = TeamInvitationLinkCipher(properties)
}

/**
 * Keeps the invitation bearer recoverable only in a server-held AES-GCM envelope.
 * The configuration values themselves are intentionally never retained after
 * their decoded key material has been built.
 */
class TeamInvitationLinkCipher(
    properties: TeamInvitationLinkEncryptionProperties,
) {
    private val activeKeyId: String
    private val keys: Map<String, SecretKeySpec>

    init {
        val configuredKeys = properties.keys
        val configuredActiveKeyId = properties.activeKeyId?.trim().orEmpty()
        if (configuredActiveKeyId.isEmpty() || configuredKeys.isEmpty() || configuredActiveKeyId !in configuredKeys) {
            throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE)
        }
        val decoded = configuredKeys.mapValues { (_, value) -> SecretKeySpec(decodeCanonicalKey(value), "AES") }
        activeKeyId = configuredActiveKeyId
        keys = decoded
    }

    fun activeKeyId(): String = activeKeyId

    fun encrypt(token: String, aad: String): String {
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(activeKeyId()), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        val encrypted = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        return "$ENVELOPE_VERSION.${encode(nonce)}.${encode(encrypted)}"
    }

    fun decrypt(keyId: String, envelope: String, aad: String): String {
        val parts = envelope.split('.')
        if (parts.size != 3 || parts[0] != ENVELOPE_VERSION) throw IllegalArgumentException("Invalid invitation envelope")
        val nonce = decodeCanonicalValue(parts[1])
        val encrypted = decodeCanonicalValue(parts[2])
        if (nonce.size != NONCE_BYTES || encrypted.size < TAG_BYTES) throw IllegalArgumentException("Invalid invitation envelope")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(keyId), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        return cipher.doFinal(encrypted).toString(StandardCharsets.UTF_8)
    }

    private fun key(keyId: String): SecretKeySpec = keys[keyId] ?: throw IllegalArgumentException("Unknown invitation recovery key")

    private fun decodeCanonicalKey(value: String): ByteArray {
        val decoded = runCatching { decodeCanonicalValue(value) }
            .getOrElse { throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE) }
        if (decoded.size != KEY_BYTES) throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE)
        return decoded
    }

    private fun decodeCanonicalValue(value: String): ByteArray {
        if (!BASE64_URL_WITHOUT_PADDING.matches(value)) throw IllegalArgumentException("Invalid base64url")
        val decoded = runCatching { Base64.getUrlDecoder().decode(value) }
            .getOrElse { throw IllegalArgumentException("Invalid base64url") }
        if (encode(decoded) != value) throw IllegalArgumentException("Invalid base64url")
        return decoded
    }

    private fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    private companion object {
        const val KEY_BYTES = 32
        const val NONCE_BYTES = 12
        const val TAG_BYTES = 16
        const val TAG_BITS = 128
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val ENVELOPE_VERSION = "v1"
        const val INVALID_CONFIGURATION_MESSAGE = "Invalid team invitation link encryption configuration"
        val BASE64_URL_WITHOUT_PADDING = Regex("^[A-Za-z0-9_-]+$")
        val secureRandom = SecureRandom()
    }
}
