package com.interviewonline.controller

import com.interviewonline.service.AuthService
import com.interviewonline.service.CollaborationService
import com.interviewonline.ws.RealtimeEventRequest
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.CookieValue
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

@RestController
@RequestMapping("/api/realtime/rooms")
class RealtimeController(
    private val collaborationService: CollaborationService,
    private val authService: AuthService,
) {
    @GetMapping("/{inviteCode}/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun streamRoomState(
        @PathVariable inviteCode: String,
        @RequestParam sessionId: String,
        @RequestParam(required = false) participantId: String?,
        @RequestParam(required = false) displayNameEncoded: String?,
        @RequestParam(required = false) displayName: String?,
        @RequestParam(required = false) ownerToken: String?,
        @RequestParam(required = false) interviewerToken: String?,
        @RequestParam(required = false) authToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader(HttpHeaders.COOKIE, required = false) cookieHeader: String?,
        @CookieValue(name = GUEST_RECONNECT_COOKIE, required = false) reconnectCapability: String?,
        servletRequest: HttpServletRequest,
        servletResponse: HttpServletResponse,
    ): SseEmitter {
        val user = resolveRealtimeUser(authorization, authToken)
        val connection = collaborationService.joinRoomSseWithReconnectCapability(
            inviteCode = inviteCode,
            sessionId = sessionId,
            participantId = participantId,
            displayName = decodeDisplayName(displayNameEncoded, displayName),
            ownerToken = ownerToken,
            interviewerToken = interviewerToken,
            user = user,
            reconnectCapability = resolveReconnectCapability(reconnectCapability, cookieHeader),
        )
        connection.mintedReconnectCapability?.let { capability ->
            servletResponse.addHeader(
                HttpHeaders.SET_COOKIE,
                buildGuestReconnectCookieHeader(inviteCode, capability, servletRequest.isSecure),
            )
        }
        return connection.emitter
    }

    /**
     * A one-shot, side-effect-free probe for an EventSource failure. It must
     * use the same room/role inputs as the stream without opening a session.
     */
    @GetMapping("/{inviteCode}/stream-status")
    fun streamRoomStatus(
        @PathVariable inviteCode: String,
        @RequestParam(required = false) ownerToken: String?,
        @RequestParam(required = false) interviewerToken: String?,
        @RequestParam(required = false) authToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): ResponseEntity<Void> {
        val canOpenStream = collaborationService.canOpenRoomStream(
            inviteCode = inviteCode,
            ownerToken = ownerToken,
            interviewerToken = interviewerToken,
            user = resolveRealtimeUser(authorization, authToken),
        )
        return if (canOpenStream) {
            ResponseEntity.noContent()
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .build()
        } else {
            ResponseEntity.notFound()
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .build()
        }
    }

    @PostMapping("/{inviteCode}/events")
    fun postRealtimeEvent(
        @PathVariable inviteCode: String,
        @RequestBody request: RealtimeEventRequest,
        @RequestHeader(HttpHeaders.COOKIE, required = false) cookieHeader: String?,
        @CookieValue(name = GUEST_RECONNECT_COOKIE, required = false) reconnectCapability: String?,
    ): ResponseEntity<*> {
        val ack = collaborationService.handleRealtimeEvent(
            inviteCode,
            request,
            resolveReconnectCapability(reconnectCapability, cookieHeader),
        )
        return if (ack != null) {
            ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .contentType(MediaType.APPLICATION_JSON)
                .body(ack)
        } else {
            ResponseEntity.noContent().build<Void>()
        }
    }

    private fun resolveRealtimeUser(authorization: String?, authToken: String?) =
        authService.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim() ?: authToken)

    private fun decodeDisplayName(encoded: String?, fallback: String?): String {
        val rawInput = when {
            !encoded.isNullOrBlank() -> runCatching {
                URLDecoder.decode(encoded, StandardCharsets.UTF_8)
            }.getOrNull()
            !fallback.isNullOrBlank() -> fallback
            else -> null
        } ?: "Участник"

        val decoded = runCatching {
            URLDecoder.decode(rawInput, StandardCharsets.UTF_8)
        }.getOrDefault(rawInput)

        return decoded.trim().ifBlank { "Участник" }.take(64)
    }

    private fun resolveReconnectCapability(cookieValue: String?, cookieHeader: String?): String? {
        if (!cookieValue.isNullOrBlank()) return cookieValue
        return cookieHeader
            ?.split(';')
            ?.map(String::trim)
            ?.firstOrNull { it.startsWith("$GUEST_RECONNECT_COOKIE=") }
            ?.substringAfter('=')
            ?.takeIf(String::isNotBlank)
    }

    private companion object {
        const val GUEST_RECONNECT_COOKIE = "io_guest_reconnect"
    }
}

internal fun buildGuestReconnectCookieHeader(inviteCode: String, capability: String, secure: Boolean): String {
    val secureAttribute = if (secure) "; Secure" else ""
    return "io_guest_reconnect=$capability; " +
        "Path=/api/realtime/rooms/$inviteCode/; " +
        "Max-Age=43200; HttpOnly$secureAttribute; SameSite=Strict"
}
