package com.interviewonline.features.socialauth

import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.bind.Bindable
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class SocialAuthProperties {
    var publicBaseUrl: String = "http://localhost:5173"
    var flowSecret: String = ""
    var httpTimeoutMillis: String = "5000"
    var google = Google()
    var github = Github()
    class Google {
        var clientId = ""
        var clientSecret = ""
        var authorizationUri = "https://accounts.google.com/o/oauth2/v2/auth"
        var tokenUri = "https://oauth2.googleapis.com/token"
        var jwkUri = "https://www.googleapis.com/oauth2/v3/certs"
    }
    class Github {
        var clientId = ""
        var clientSecret = ""
        var authorizationUri = "https://github.com/login/oauth/authorize"
        var tokenUri = "https://github.com/login/oauth/access_token"
        var userInfoUri = "https://api.github.com/user"
    }
}

@Configuration(proxyBeanMethods = false)
class SocialAuthConfiguration {
    private val logger = LoggerFactory.getLogger(SocialAuthConfiguration::class.java)

    @Bean fun socialAuthSettings(environment: Environment): SocialAuthSettings {
        try {
            val properties = Binder.get(environment).bind("app.social-auth", Bindable.of(SocialAuthProperties::class.java))
                .orElseGet { SocialAuthProperties() }
            warnIfIncomplete("GOOGLE", properties.google.clientId, properties.google.clientSecret)
            warnIfIncomplete("GITHUB", properties.github.clientId, properties.github.clientSecret)
            return SocialAuthSettings(properties)
        } catch (_: Exception) {
            throw IllegalStateException("Invalid social authentication configuration")
        }
    }

    private fun warnIfIncomplete(provider: String, clientId: String, clientSecret: String) {
        val missing = when {
            clientId.isBlank() && clientSecret.isNotBlank() -> "CLIENT_ID"
            clientSecret.isBlank() && clientId.isNotBlank() -> "CLIENT_SECRET"
            else -> return
        }
        logger.warn("OAuth sign-in for {} is unavailable: missing {}_{}", provider, provider, missing)
    }
}

class SocialAuthSettings(val properties: SocialAuthProperties) {
    val providers = listOfNotNull(
        "google".takeIf { properties.google.clientId.isNotBlank() && properties.google.clientSecret.isNotBlank() },
        "github".takeIf { properties.github.clientId.isNotBlank() && properties.github.clientSecret.isNotBlank() },
    )
    private val trustedOrigin = runCatching { normalizeOrigin(properties.publicBaseUrl) }.getOrNull()
    val origin: String get() = checkNotNull(trustedOrigin) { "Invalid social authentication configuration" }
    val secureCookie = trustedOrigin?.startsWith("https://") == true
    val httpTimeoutMillis: Long
    private val secret: ByteArray
    init {
        if (providers.isEmpty()) {
            // No provider request needs a configured timeout or flow secret in this state.
            httpTimeoutMillis = 5000
            secret = ByteArray(0)
        } else try {
            requireNotNull(trustedOrigin)
            httpTimeoutMillis = properties.httpTimeoutMillis.trim().toLong().also { require(it in 100..10000) }
            secret = Base64.getUrlDecoder().decode(properties.flowSecret).also {
                require(it.size == 32 && encode(it) == properties.flowSecret)
            }
            if ("google" in providers) {
                endpoint(properties.google.authorizationUri, "https://accounts.google.com/o/oauth2/v2/auth")
                endpoint(properties.google.tokenUri, "https://oauth2.googleapis.com/token")
                endpoint(properties.google.jwkUri, "https://www.googleapis.com/oauth2/v3/certs")
            }
            if ("github" in providers) {
                endpoint(properties.github.authorizationUri, "https://github.com/login/oauth/authorize")
                endpoint(properties.github.tokenUri, "https://github.com/login/oauth/access_token")
                endpoint(properties.github.userInfoUri, "https://api.github.com/user")
            }
        } catch (_: Exception) { throw IllegalStateException("Invalid social authentication configuration") }
    }
    private fun normalizeOrigin(raw: String): String {
        val base = URI(raw)
        val scheme = base.scheme?.lowercase(Locale.ROOT)
        val host = base.host?.lowercase(Locale.ROOT)
        require(base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null && base.rawPath in listOf("", "/"))
        require(host != null && base.port in -1..65535)
        require(scheme == "https" || (scheme == "http" && loopback(host)))
        val port = base.port.takeUnless { (scheme == "https" && it == 443) || (scheme == "http" && it == 80) } ?: -1
        return URI(scheme, null, host, port, null, null, null).toASCIIString()
    }
    private fun endpoint(raw: String, expected: String) {
        if (raw == expected) return
        val uri = URI(raw)
        require(!secureCookie && uri.scheme == "http" && loopback(uri.host) && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
    }
    fun matchesOrigin(origin: String?): Boolean = origin != null && origin == trustedOrigin
    fun callback(provider: String) = "$origin/api/auth/social/$provider/callback"
    fun derive(purpose: String, flowId: String, browserProof: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret, "HmacSHA256"))
        return encode(mac.doFinal("$purpose:$flowId:$browserProof".toByteArray(StandardCharsets.US_ASCII)))
    }
    companion object {
        private val random = SecureRandom()
        fun randomProof() = encode(ByteArray(32).also(random::nextBytes))
        fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
        fun encode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
        private fun loopback(host: String?) = host in setOf("localhost", "127.0.0.1", "::1", "[::1]")
    }
}
