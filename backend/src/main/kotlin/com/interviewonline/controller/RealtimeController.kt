package com.interviewonline.controller

import com.interviewonline.service.AuthService
import com.interviewonline.service.CollaborationService
import com.interviewonline.ws.RealtimeEventRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
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
        @RequestParam(required = false) displayNameEncoded: String?,
        @RequestParam(required = false) displayName: String?,
        @RequestParam(required = false) ownerToken: String?,
        @RequestParam(required = false) interviewerToken: String?,
        @RequestParam(required = false) authToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): SseEmitter {
        val bearerToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(bearerToken ?: authToken)
        return collaborationService.joinRoomSse(
            inviteCode = inviteCode,
            sessionId = sessionId,
            displayName = decodeDisplayName(displayNameEncoded, displayName),
            ownerToken = ownerToken,
            interviewerToken = interviewerToken,
            user = user,
        )
    }

    @PostMapping("/{inviteCode}/events")
    fun postRealtimeEvent(
        @PathVariable inviteCode: String,
        @RequestBody request: RealtimeEventRequest,
    ): ResponseEntity<Void> {
        collaborationService.handleRealtimeEvent(inviteCode, request)
        return ResponseEntity.noContent().build()
    }

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
}
