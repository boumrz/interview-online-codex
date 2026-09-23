package com.interviewonline.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Stable, fail-closed keying for durable chat receipts.
 *
 * The configured Base64URL value is decoded during component creation and is
 * never retained or included in validation failures.
 */
@Component
class ChatReceiptHmac(
    @Value("\${app.realtime.chat-receipt-hmac-secret}") configuredSecret: String,
) {
    private val keyBytes: ByteArray = decodeSecret(configuredSecret)

    fun senderKey(
        canonicalRoomId: String,
        principalKind: String,
        principalSubject: String,
    ): String {
        val input = listOf(
            "chat-sender:v1",
            canonicalRoomId,
            principalKind,
            principalSubject,
        ).joinToString("\u0000")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        return "h1:${mac.doFinal(input.toByteArray(StandardCharsets.UTF_8)).toHex()}"
    }

    fun requestHash(normalizedMessageBody: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(normalizedMessageBody.toByteArray(StandardCharsets.UTF_8))
            .toHex()

    private fun decodeSecret(configuredSecret: String): ByteArray {
        if (!BASE64_URL_WITHOUT_PADDING.matches(configuredSecret)) {
            throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE)
        }
        val decoded = runCatching { Base64.getUrlDecoder().decode(configuredSecret) }
            .getOrElse { throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE) }
        val canonical = Base64.getUrlEncoder().withoutPadding().encodeToString(decoded)
        if (decoded.size != REQUIRED_KEY_BYTES || canonical != configuredSecret) {
            throw IllegalStateException(INVALID_CONFIGURATION_MESSAGE)
        }
        return decoded
    }

    private fun ByteArray.toHex(): String = joinToString("") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }

    private companion object {
        const val REQUIRED_KEY_BYTES = 32
        const val INVALID_CONFIGURATION_MESSAGE = "Invalid chat receipt HMAC configuration"
        val BASE64_URL_WITHOUT_PADDING = Regex("^[A-Za-z0-9_-]+$")
    }
}
