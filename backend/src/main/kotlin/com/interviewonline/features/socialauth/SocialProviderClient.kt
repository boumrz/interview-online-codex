package com.interviewonline.features.socialauth

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
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
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.Flow
import java.util.concurrent.TimeUnit

class SocialProviderFailure : RuntimeException("Не удалось подтвердить вход через провайдера")
data class VerifiedSocialIdentity(val subject: String, val displayName: String)

@Component
class SocialProviderClient(private val settings: SocialAuthSettings, private val mapper: ObjectMapper) {
    private val client by lazy {
        HttpClient.newBuilder().connectTimeout(Duration.ofMillis(settings.httpTimeoutMillis))
            .followRedirects(HttpClient.Redirect.NEVER).build()
    }
    fun authorizationUrl(flowId: String, proof: String, state: String): String {
        val verifier = settings.derive("verifier", flowId, proof)
        val params = linkedMapOf(
            "client_id" to settings.properties.github.clientId, "response_type" to "code", "redirect_uri" to settings.callback(),
            "state" to state, "code_challenge_method" to "S256", "scope" to "",
            "code_challenge" to SocialAuthSettings.encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII))),
        )
        return "${settings.properties.github.authorizationUri}?${form(params)}"
    }
    fun exchange(flowId: String, proof: String, code: String): VerifiedSocialIdentity {
        try {
            val github = settings.properties.github
            val params = linkedMapOf("grant_type" to "authorization_code", "code" to code, "client_id" to github.clientId,
                "redirect_uri" to settings.callback(), "code_verifier" to settings.derive("verifier", flowId, proof),
                "client_secret" to github.clientSecret)
            val token = post(github.tokenUri, params)
            require(token.path("scope").isTextual && token.path("scope").asText().isBlank())
            require(token.path("token_type").asText().equals("bearer", ignoreCase = true))
            val accessToken = token.path("access_token").takeIf { it.isTextual && it.asText().isNotBlank() }?.asText()
                ?: throw SocialProviderFailure()
            val info = request(HttpRequest.newBuilder(URI(github.userInfoUri))
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2026-03-10")
                .header("User-Agent", "InterHub").GET())
            return VerifiedSocialIdentity(numericSubject(info.path("id")), name(info.path("name").asText("")))
        } catch (_: Exception) { throw SocialProviderFailure() }
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
    private fun post(url: String, params: Map<String, String>) = request(HttpRequest.newBuilder(URI(url))
        .header("Accept", "application/json").header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form(params))))
    private fun request(builder: HttpRequest.Builder): JsonNode {
        val timeout = settings.httpTimeoutMillis
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
