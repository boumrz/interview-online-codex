package com.interviewonline.features.socialauth

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.crypto.RSASSAVerifier
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.KeyUse
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jwt.SignedJWT
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.Flow
import java.util.concurrent.TimeUnit

class SocialProviderFailure : RuntimeException("Не удалось подтвердить вход через провайдера")
data class VerifiedSocialIdentity(val subject: String, val displayName: String)

@Component
class SocialProviderClient(private val settings: SocialAuthSettings, private val mapper: ObjectMapper) {
    private val client by lazy {
        HttpClient.newBuilder().connectTimeout(Duration.ofMillis(settings.properties.httpTimeoutMillis))
            .followRedirects(HttpClient.Redirect.NEVER).build()
    }
    fun authorizationUrl(provider: String, flowId: String, proof: String, state: String): String {
        val verifier = settings.derive("verifier", flowId, proof)
        val params = linkedMapOf(
            "client_id" to clientId(provider), "response_type" to "code", "redirect_uri" to settings.callback(provider),
            "state" to state, "code_challenge_method" to "S256",
            "code_challenge" to SocialAuthSettings.encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII))),
        )
        val endpoint = if (provider == "google") {
            params["scope"] = "openid profile"
            params["nonce"] = settings.derive("nonce", flowId, proof)
            settings.properties.google.authorizationUri
        } else settings.properties.vk.authorizationUri
        return "$endpoint?${form(params)}"
    }
    fun exchange(provider: String, flowId: String, proof: String, code: String, state: String, deviceId: String?): VerifiedSocialIdentity {
        try {
            val params = linkedMapOf("grant_type" to "authorization_code", "code" to code, "client_id" to clientId(provider),
                "redirect_uri" to settings.callback(provider), "code_verifier" to settings.derive("verifier", flowId, proof))
            return if (provider == "google") {
                params["client_secret"] = settings.properties.google.clientSecret
                val token = post(settings.properties.google.tokenUri, params)
                googleIdentity(token.path("id_token").asText(), settings.derive("nonce", flowId, proof))
            } else {
                params["state"] = state
                params["device_id"] = requireNotNull(deviceId)
                params["service_token"] = settings.properties.vk.serviceToken
                val token = post(settings.properties.vk.tokenUri, params)
                require(token.path("state").isTextual && constantEquals(token.path("state").asText(), state))
                val subject = numericSubject(token.path("user_id"))
                val accessToken = token.path("access_token").takeIf { it.isTextual && it.asText().isNotBlank() }?.asText() ?: throw SocialProviderFailure()
                val info = post(settings.properties.vk.userInfoUri, mapOf("client_id" to clientId(provider), "access_token" to accessToken)).path("user")
                require(numericSubject(info.path("user_id")) == subject)
                VerifiedSocialIdentity(subject, name(listOf(info.path("first_name").asText(""), info.path("last_name").asText("")).filter(String::isNotBlank).joinToString(" ")))
            }
        } catch (_: Exception) { throw SocialProviderFailure() }
    }
    private fun googleIdentity(raw: String, nonce: String): VerifiedSocialIdentity {
        require(raw.length in 1..16384)
        val jwt = SignedJWT.parse(raw)
        require(jwt.header.algorithm == JWSAlgorithm.RS256 && !jwt.header.keyID.isNullOrBlank())
        val keys = JWKSet.parse(get(settings.properties.google.jwkUri).toString()).keys.filterIsInstance<RSAKey>()
            .filter { it.keyID == jwt.header.keyID && (it.algorithm == null || it.algorithm == JWSAlgorithm.RS256) && (it.keyUse == null || it.keyUse == KeyUse.SIGNATURE) }
        require(keys.size == 1 && jwt.verify(RSASSAVerifier(keys.single().toRSAPublicKey())))
        val claims = jwt.jwtClaimsSet
        val now = Instant.now()
        require(claims.issuer in setOf("https://accounts.google.com", "accounts.google.com"))
        require(claims.audience.contains(settings.properties.google.clientId))
        if (claims.audience.size > 1) require(claims.getStringClaim("azp") == settings.properties.google.clientId)
        require(claims.getStringClaim("azp") == null || claims.getStringClaim("azp") == settings.properties.google.clientId)
        require(claims.expirationTime?.toInstant()?.isAfter(now) == true)
        require(claims.issueTime != null && !claims.issueTime.toInstant().isAfter(now.plusSeconds(60)))
        require(claims.notBeforeTime == null || !claims.notBeforeTime.toInstant().isAfter(now.plusSeconds(60)))
        require(constantEquals(claims.getStringClaim("nonce").orEmpty(), nonce))
        val subject = claims.subject
        require(subject != null && subject.length in 1..255 && subject.all { it.code in 0x21..0x7E })
        return VerifiedSocialIdentity(subject, name(claims.getStringClaim("name").orEmpty()))
    }
    private fun numericSubject(node: JsonNode): String {
        require(node.isTextual || node.isIntegralNumber)
        val value = node.asText()
        require(value.matches(Regex("[1-9][0-9]{0,19}")))
        return value
    }
    private fun name(raw: String): String = raw.trim().let { value ->
        if (value.length <= 64) value else value.take(64).dropLastWhile(Char::isHighSurrogate)
    }
    private fun clientId(provider: String) = if (provider == "google") settings.properties.google.clientId else settings.properties.vk.clientId
    private fun post(url: String, params: Map<String, String>) = request(HttpRequest.newBuilder(URI(url))
        .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form(params))))
    private fun get(url: String) = request(HttpRequest.newBuilder(URI(url)).GET())
    private fun request(builder: HttpRequest.Builder): JsonNode {
        val timeout = settings.properties.httpTimeoutMillis
        val future = client.sendAsync(builder.timeout(Duration.ofMillis(timeout)).build(), HttpResponse.BodyHandler { LimitedBody() })
        val response = try {
            // HttpRequest.timeout alone stops at headers on JDK 17. Bound the complete body too.
            future.get(timeout, TimeUnit.MILLISECONDS)
        } catch (error: Exception) {
            future.cancel(true)
            if (error is InterruptedException) Thread.currentThread().interrupt()
            throw SocialProviderFailure()
        }
        require(response.statusCode() == 200)
        val json = mapper.readTree(response.body())
        require(json.isObject)
        return json
    }
    private fun constantEquals(first: String, second: String) = MessageDigest.isEqual(first.toByteArray(StandardCharsets.UTF_8), second.toByteArray(StandardCharsets.UTF_8))
    private fun form(params: Map<String, String>) = params.entries.joinToString("&") { "${encode(it.key)}=${encode(it.value)}" }
    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)
    private class LimitedBody : HttpResponse.BodySubscriber<ByteArray> {
        private val body = ByteArrayOutputStream()
        private val result = CompletableFuture<ByteArray>()
        private lateinit var subscription: Flow.Subscription
        override fun getBody(): CompletionStage<ByteArray> = result
        override fun onSubscribe(value: Flow.Subscription) { subscription = value; value.request(1) }
        override fun onNext(items: List<ByteBuffer>) {
            if (items.sumOf { it.remaining().toLong() } + body.size() > 65536) {
                subscription.cancel(); result.completeExceptionally(SocialProviderFailure()); return
            }
            items.forEach { item -> val bytes = ByteArray(item.remaining()); item.get(bytes); body.write(bytes) }
            subscription.request(1)
        }
        override fun onError(error: Throwable) { result.completeExceptionally(SocialProviderFailure()) }
        override fun onComplete() { result.complete(body.toByteArray()) }
    }
}
