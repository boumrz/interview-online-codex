package com.interviewonline.controller

import com.interviewonline.dto.HiringManagerPreviewResponse
import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.HiringManagerPreviewService
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.nio.charset.StandardCharsets

@RestController
@RequestMapping("/api/me")
class HiringManagerPreviewController(
    private val authService: AuthService,
    private val hiringManagerPreviewService: HiringManagerPreviewService,
) {
    private val jsonUtf8 = MediaType("application", "json", StandardCharsets.UTF_8)

    @PostMapping("/hiring-manager-preview")
    fun preview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: ResolveHiringManagerPreviewRequest,
    ): ResponseEntity<Any> {
        try {
            authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
            return ResponseEntity.ok()
                .headers(privacyHeaders())
                .body(hiringManagerPreviewService.resolve(request))
        } catch (ex: ApiException) {
            throw ApiException(ex.status, ex.message, privacyHeaders())
        } catch (_: DataAccessException) {
            return genericError(HttpStatus.SERVICE_UNAVAILABLE, "Временная ошибка сервиса")
        } catch (_: Exception) {
            return genericError(HttpStatus.INTERNAL_SERVER_ERROR, "Внутренняя ошибка сервиса")
        }
    }

    /**
     * A Jackson body-binding failure happens before [preview] is entered, so
     * it needs a local handler to retain the endpoint's no-cache policy.
     */
    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadableBody(): ResponseEntity<Map<String, String>> = ResponseEntity.badRequest()
        .headers(privacyHeaders())
        .contentType(jsonUtf8)
        .body(mapOf("error" to "Некорректный идентификатор нанимающего"))

    private fun genericError(status: HttpStatus, message: String): ResponseEntity<Any> = ResponseEntity.status(status)
        .headers(privacyHeaders())
        .contentType(jsonUtf8)
        .body(mapOf("error" to message))

    private fun privacyHeaders(): HttpHeaders = HttpHeaders().apply {
        set(HttpHeaders.CACHE_CONTROL, "no-store")
        set("Referrer-Policy", "no-referrer")
    }
}
