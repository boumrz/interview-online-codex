package com.interviewonline.controller

import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.HiringManagerPreviewService
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/rooms/{inviteCode}")
class RoomHiringManagerPreviewController(
    private val authService: AuthService,
    private val hiringManagerPreviewService: HiringManagerPreviewService,
) {
    @PostMapping("/hiring-manager-preview")
    fun preview(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestBody request: ResolveHiringManagerPreviewRequest,
    ): ResponseEntity<Any> {
        try {
            val actor = authService.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim())
            return ResponseEntity.ok().headers(privacyHeaders()).body(
                hiringManagerPreviewService.resolveInRoom(inviteCode, request, actor, ownerToken, interviewerToken, eventToken),
            )
        } catch (ex: ApiException) {
            throw ApiException(ex.status, ex.message, privacyHeaders())
        } catch (_: DataAccessException) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "Временная ошибка сервиса")
        } catch (_: Exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Внутренняя ошибка сервиса")
        }
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(): ResponseEntity<Any> = error(HttpStatus.BAD_REQUEST, "Некорректный ник нанимающего")

    private fun error(status: HttpStatus, message: String): ResponseEntity<Any> = ResponseEntity.status(status)
        .headers(privacyHeaders()).body(mapOf("error" to message))

    private fun privacyHeaders() = HttpHeaders().apply {
        set(HttpHeaders.CACHE_CONTROL, "no-store")
        set("Referrer-Policy", "no-referrer")
    }
}
