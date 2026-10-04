package com.interviewonline.controller

import com.interviewonline.dto.EmptyInvitationRequest
import com.interviewonline.dto.InvitationRevisionRequest
import com.interviewonline.dto.InvitationTokenRequest
import com.interviewonline.dto.TeamInvitationAcceptDto
import com.interviewonline.dto.TeamInvitationLinkDto
import com.interviewonline.dto.TeamInvitationListDto
import com.interviewonline.dto.TeamInvitationPreviewDto
import com.interviewonline.dto.TeamInvitationResponse
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.TeamInvitationService
import com.interviewonline.service.ClientIpResolver
import com.interviewonline.service.InvitationIssuanceGate
import com.interviewonline.service.InvitationRateLimiter
import com.interviewonline.service.secure
import jakarta.servlet.http.HttpServletRequest
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.Collections
import java.sql.SQLException

@RestController
@RequestMapping("/api")
class TeamInvitationController(
    private val authService: AuthService,
    private val invitationService: TeamInvitationService,
    private val clientIpResolver: ClientIpResolver,
    private val issuanceGate: InvitationIssuanceGate,
    private val rateLimiter: InvitationRateLimiter,
) {
    private val jsonUtf8 = MediaType("application", "json", StandardCharsets.UTF_8)

    @PostMapping("/teams/{teamId}/invitations")
    fun create(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @RequestBody request: EmptyInvitationRequest,
    ): ResponseEntity<TeamInvitationResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        val result = invitationCommand {
            issuanceGate.admit(actor, teamId)
            invitationService.create(actor, teamId, key)
        }
        return ResponseEntity.created(URI.create(result.location)).protectedJson()
            .body(TeamInvitationResponse(result.invitation))
    }

    @GetMapping("/teams/{teamId}/invitations")
    fun list(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("page", required = false) page: String?,
        @RequestParam("size", required = false) size: String?,
    ): ResponseEntity<TeamInvitationListDto> = ResponseEntity.ok().protectedJson()
        .body(invitationCommand { invitationService.list(requireUser(authorization), teamId, page, size) })

    @GetMapping("/teams/{teamId}/invitations/{invitationId}/link")
    fun reveal(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable invitationId: String,
    ): ResponseEntity<TeamInvitationLinkDto> = ResponseEntity.ok().protectedJson()
        .header(HttpHeaders.PRAGMA, "no-cache")
        .body(invitationCommand { invitationService.reveal(requireUser(authorization), teamId, invitationId) })

    @PostMapping("/team-invitations/preview")
    fun preview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: InvitationTokenRequest,
        servletRequest: HttpServletRequest,
    ): ResponseEntity<TeamInvitationPreviewDto> {
        val actorId = authService.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim())?.id
        val clientIp = clientIpResolver.resolve(
            servletRequest.remoteAddr.orEmpty(),
            Collections.list(servletRequest.getHeaders("Forwarded")),
            Collections.list(servletRequest.getHeaders("X-Forwarded-For")),
        )
        rateLimiter.consumePreview(clientIp, actorId)
        return ResponseEntity.ok().protectedJson().body(invitationService.preview(request.token, clientIp, actorId))
    }

    @PostMapping("/team-invitations/accept")
    fun accept(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @RequestBody request: InvitationTokenRequest,
        servletRequest: HttpServletRequest,
    ): ResponseEntity<TeamInvitationAcceptDto> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        val clientIp = clientIpResolver.resolve(
            servletRequest.remoteAddr.orEmpty(),
            Collections.list(servletRequest.getHeaders("Forwarded")),
            Collections.list(servletRequest.getHeaders("X-Forwarded-For")),
        )
        rateLimiter.consumeAccept(clientIp, requireNotNull(actor.id))
        return ResponseEntity.ok().protectedJson()
            .body(invitationCommand { invitationService.accept(actor, request.token, key, clientIp) })
    }

    @PostMapping("/teams/{teamId}/invitations/{invitationId}/revoke")
    fun revoke(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable invitationId: String,
        @RequestBody request: InvitationRevisionRequest,
    ): ResponseEntity<TeamInvitationResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        val result = invitationCommand { invitationService.revoke(actor, teamId, invitationId, request.revision, key) }
        return ResponseEntity.ok().protectedJson().body(TeamInvitationResponse(result.invitation))
    }

    @PostMapping("/teams/{teamId}/invitations/{invitationId}/reissue")
    fun reissue(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable invitationId: String,
        @RequestBody request: InvitationRevisionRequest,
    ): ResponseEntity<TeamInvitationResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        val result = invitationCommand {
            issuanceGate.admit(actor, teamId)
            invitationService.reissue(actor, teamId, invitationId, request.revision, key)
        }
        return ResponseEntity.created(URI.create(result.location)).protectedJson()
            .body(TeamInvitationResponse(result.invitation))
    }

    private fun requireUser(authorization: String?) = try {
        authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
    } catch (ex: ApiException) {
        throw secure(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Требуется авторизация")
    }

    private fun requireIdempotencyKey(raw: String?): UUID {
        if (raw.isNullOrBlank()) {
            throw secure(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Требуется Idempotency-Key")
        }
        val parsed = runCatching { UUID.fromString(raw) }.getOrNull()
            ?: throw secure(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key должен быть UUID")
        if (!parsed.toString().equals(raw, ignoreCase = true)) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key должен быть UUID")
        }
        return parsed
    }

    private fun <T> invitationCommand(action: () -> T): T = try {
        action()
    } catch (ex: DataAccessException) {
        if (!hasLockTimeout(ex)) throw ex
        val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, "5") }
        throw ApiException(
            status = HttpStatus.SERVICE_UNAVAILABLE,
            message = "Приглашение временно занято",
            headers = headers,
            code = "INVITATION_BUSY",
        )
    }

    private fun hasLockTimeout(error: Throwable): Boolean {
        var current: Throwable? = error
        while (current != null) {
            if (current is SQLException && current.sqlState == "55P03") return true
            current = current.cause
        }
        return false
    }

    private fun <T : ResponseEntity.BodyBuilder> T.protectedJson(): T = apply {
        header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        contentType(jsonUtf8)
    }
}
