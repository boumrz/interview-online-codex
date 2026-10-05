package com.interviewonline.features.socialauth

import com.interviewonline.dto.AuthResponse
import com.interviewonline.service.ApiException
import jakarta.servlet.http.HttpServletRequest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseCookie
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.annotation.*
import java.time.Duration

@RestController
@RequestMapping("/api/auth/social")
class SocialAuthController(private val service: SocialAuthService, private val settings: SocialAuthSettings) {
    @GetMapping("/providers")
    fun providers(): ResponseEntity<Map<String, List<String>>> = secure(ResponseEntity.ok()).body(mapOf("providers" to service.providers()))

    @PostMapping("/{provider}/start")
    fun start(@PathVariable provider: String, request: HttpServletRequest): ResponseEntity<Map<String, String>> {
        origin(request)
        val result = service.start(provider)
        return secure(ResponseEntity.ok()).header(HttpHeaders.SET_COOKIE, cookie(result.cookie, false))
            .body(mapOf("authorizationUrl" to result.authorizationUrl))
    }
    @GetMapping("/{provider}/callback")
    fun callback(@PathVariable provider: String, request: HttpServletRequest): ResponseEntity<Void> {
        if (!settings.enabled) return secure(ResponseEntity.status(HttpStatus.FOUND)).header(HttpHeaders.LOCATION, "/login").build()
        val location = try {
            val state = single(request, "state")
            val code = single(request, "code")
            val deviceId = single(request, "device_id")
            val error = single(request, "error")
            if (error != null && code != null) throw IllegalArgumentException()
            if (service.callback(provider, proof(request), state, code, deviceId, error)) "/login/social" else "/login/social?result=cancelled"
        } catch (_: Exception) { "/login/social?result=failed" }
        return secure(ResponseEntity.status(HttpStatus.FOUND)).header(HttpHeaders.LOCATION, settings.origin + location).build()
    }
    @GetMapping("/pending")
    fun pending(request: HttpServletRequest): ResponseEntity<SocialPendingResponse> {
        val origins = request.getHeaders("Origin").toList()
        if (origins.isNotEmpty()) origin(request)
        val site = request.getHeader("Sec-Fetch-Site")
        if (site != null && site !in setOf("same-origin", "none")) throw ApiException(HttpStatus.FORBIDDEN, "Откройте вход на странице приложения")
        return secure(ResponseEntity.ok()).body(service.pending(proof(request)))
    }
    @PostMapping("/complete")
    fun complete(@RequestBody body: SocialCompleteRequest, request: HttpServletRequest): ResponseEntity<AuthResponse> {
        origin(request)
        val result = service.complete(proof(request), body)
        return secure(ResponseEntity.ok()).header(HttpHeaders.SET_COOKIE, cookie("", true)).body(result)
    }
    @PostMapping("/link")
    fun link(@RequestBody body: SocialLinkRequest, request: HttpServletRequest): ResponseEntity<AuthResponse> {
        origin(request)
        val result = service.link(proof(request), body)
        return secure(ResponseEntity.ok()).header(HttpHeaders.SET_COOKIE, cookie("", true)).body(result)
    }
    @ExceptionHandler(ApiException::class)
    fun apiError(error: ApiException): ResponseEntity<Map<String, String>> = secure(ResponseEntity.status(error.status))
        .body(mapOf("error" to error.message, "code" to (error.code ?: error.status.name)))
    @ExceptionHandler(DataIntegrityViolationException::class)
    fun conflict(): ResponseEntity<Map<String, String>> = secure(ResponseEntity.status(HttpStatus.CONFLICT))
        .body(mapOf("error" to "Ник или аккаунт провайдера уже занят. Повторите вход", "code" to "SOCIAL_IDENTITY_CONFLICT"))
    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(): ResponseEntity<Map<String, String>> = secure(ResponseEntity.badRequest())
        .body(mapOf("error" to "Некорректный запрос", "code" to "INVALID_REQUEST"))
    private fun origin(request: HttpServletRequest) {
        val origins = request.getHeaders("Origin").toList()
        service.requireOrigin(origins.singleOrNull())
    }
    private fun proof(request: HttpServletRequest): String? {
        val cookies = request.cookies.orEmpty().filter { it.name == cookieName() }
        return cookies.singleOrNull()?.value
    }
    private fun single(request: HttpServletRequest, key: String): String? {
        val values = request.getParameterValues(key) ?: return null
        require(values.size == 1)
        return values.single()
    }
    private fun cookieName() = if (settings.secureCookie) "__Host-interhub_social" else "interhub_social"
    private fun cookie(value: String, clear: Boolean): String = ResponseCookie.from(cookieName(), value)
        .httpOnly(true).secure(settings.secureCookie).sameSite("Lax").path(if (settings.secureCookie) "/" else "/api/auth/social")
        .maxAge(if (clear) Duration.ZERO else Duration.ofMinutes(10)).build().toString()
    private fun <T : ResponseEntity.BodyBuilder> secure(builder: T): T = builder.apply {
        header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        header("Referrer-Policy", "no-referrer")
        header("X-Content-Type-Options", "nosniff")
    }
}
