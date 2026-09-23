package com.interviewonline.controller

import com.interviewonline.service.ApiException
import org.springframework.dao.DataAccessException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.http.converter.HttpMessageNotReadableException
import java.nio.charset.StandardCharsets

@RestControllerAdvice
class GlobalExceptionHandler {
    private val jsonUtf8 = MediaType("application", "json", StandardCharsets.UTF_8)

    @ExceptionHandler(ApiException::class)
    fun handleApiException(ex: ApiException): ResponseEntity<Map<String, Any>> {
        return ResponseEntity.status(ex.status).headers(ex.headers).secure().contentType(jsonUtf8)
            .body(buildMap<String, Any> {
                put("error", ex.message)
                val preservesErrorOnlyContract = ex.headers.getFirst("Referrer-Policy") == "no-referrer"
                if (!preservesErrorOnlyContract) {
                    put("code", ex.code ?: ex.status.name)
                    ex.currentRevision?.let { put("currentRevision", it) }
                }
            })
    }

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleIntegrityViolation(ex: DataIntegrityViolationException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(HttpStatus.CONFLICT).secure()
            .contentType(jsonUtf8)
            .body(mapOf("error" to "Конфликт данных", "code" to "DATA_CONFLICT"))
    }

    @ExceptionHandler(DataAccessException::class)
    fun handleDataAccess(ex: DataAccessException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).secure().contentType(jsonUtf8).body(
            mapOf(
                "error" to "Временная ошибка хранилища",
                "code" to "DATABASE_UNAVAILABLE",
            ),
        )
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<Map<String, String>> {
        val msg = ex.bindingResult.fieldErrors.firstOrNull()?.defaultMessage ?: "Некорректный запрос"
        return ResponseEntity.badRequest().secure().contentType(jsonUtf8)
            .body(mapOf("error" to msg, "code" to "INVALID_REQUEST"))
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadableBody(ex: HttpMessageNotReadableException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.badRequest().secure().contentType(jsonUtf8)
            .body(mapOf("error" to "Некорректный запрос", "code" to "INVALID_REQUEST"))
    }

    private fun <T : ResponseEntity.BodyBuilder> T.secure(): T = apply {
        header("Cache-Control", "private, no-store")
    }
}
