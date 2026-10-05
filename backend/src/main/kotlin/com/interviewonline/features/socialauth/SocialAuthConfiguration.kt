package com.interviewonline.features.socialauth

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
    var enabled: Boolean = false
    var publicBaseUrl: String = "http://localhost:5173"
    var flowSecret: String = ""
    var httpTimeoutMillis: Long = 5000
    var google = Google()
    var vk = Vk()
    class Google {
        var enabled = false
        var clientId = ""
        var clientSecret = ""
        var authorizationUri = "https://accounts.google.com/o/oauth2/v2/auth"
        var tokenUri = "https://oauth2.googleapis.com/token"
        var jwkUri = "https://www.googleapis.com/oauth2/v3/certs"
    }
    class Vk {
        var enabled = false
        var clientId = ""
        var serviceToken = ""
        var authorizationUri = "https://id.vk.ru/authorize"
        var tokenUri = "https://id.vk.ru/oauth2/auth"
        var userInfoUri = "https://id.vk.ru/oauth2/user_info"
    }
}

@Configuration(proxyBeanMethods = false)
class SocialAuthConfiguration {
    @Bean fun socialAuthSettings(environment: Environment): SocialAuthSettings {
        try {
            // Do not bind unused typed values while the integration is dormant.
            if (!environment.getProperty("app.social-auth.enabled", Boolean::class.java, false)) {
                return SocialAuthSettings(SocialAuthProperties())
            }
            val properties = Binder.get(environment).bind("app.social-auth", Bindable.of(SocialAuthProperties::class.java)).get()
            return SocialAuthSettings(properties)
        } catch (_: Exception) {
            throw IllegalStateException("Invalid social authentication configuration")
        }
    }
}

class SocialAuthSettings(val properties: SocialAuthProperties) {
    val enabled = properties.enabled
    val providers = if (enabled) listOfNotNull("google".takeIf { properties.google.enabled }, "vk".takeIf { properties.vk.enabled }) else emptyList()
    val origin: String
    val secureCookie: Boolean
    private val secret: ByteArray
    init {
        if (!enabled) {
            // Dormant integrations must not interpret unused endpoints or secrets.
            origin = "http://localhost:5173"
            secureCookie = false
            secret = ByteArray(0)
        } else try {
            val base = URI(properties.publicBaseUrl)
            val scheme = base.scheme?.lowercase(Locale.ROOT)
            val host = base.host?.lowercase(Locale.ROOT)
            require(base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null && base.rawPath in listOf("", "/"))
            require(host != null && base.port in -1..65535)
            require(scheme == "https" || (scheme == "http" && loopback(host)))
            val port = base.port.takeUnless { (scheme == "https" && it == 443) || (scheme == "http" && it == 80) } ?: -1
            origin = URI(scheme, null, host, port, null, null, null).toASCIIString()
            secureCookie = scheme == "https"
            require(properties.httpTimeoutMillis in 100..10000)
            secret = if (providers.isEmpty()) ByteArray(0) else Base64.getUrlDecoder().decode(properties.flowSecret).also {
                require(it.size == 32 && encode(it) == properties.flowSecret)
            }
            if (properties.google.enabled) {
                require(properties.google.clientId.isNotBlank() && properties.google.clientSecret.isNotBlank())
                endpoint(properties.google.authorizationUri, "https://accounts.google.com/o/oauth2/v2/auth")
                endpoint(properties.google.tokenUri, "https://oauth2.googleapis.com/token")
                endpoint(properties.google.jwkUri, "https://www.googleapis.com/oauth2/v3/certs")
            }
            if (properties.vk.enabled) {
                require(properties.vk.clientId.isNotBlank() && properties.vk.serviceToken.isNotBlank())
                endpoint(properties.vk.authorizationUri, "https://id.vk.ru/authorize")
                endpoint(properties.vk.tokenUri, "https://id.vk.ru/oauth2/auth")
                endpoint(properties.vk.userInfoUri, "https://id.vk.ru/oauth2/user_info")
            }
        } catch (_: Exception) { throw IllegalStateException("Invalid social authentication configuration") }
    }
    private fun endpoint(raw: String, expected: String) {
        if (raw == expected) return
        val uri = URI(raw)
        require(!secureCookie && uri.scheme == "http" && loopback(uri.host) && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
    }
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
