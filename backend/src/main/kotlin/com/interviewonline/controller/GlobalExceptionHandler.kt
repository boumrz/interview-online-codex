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
    fun handleApiException(ex: ApiException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(ex.status).headers(ex.headers).contentType(jsonUtf8).body(mapOf("error" to ex.message))
    }

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleIntegrityViolation(ex: DataIntegrityViolationException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .contentType(jsonUtf8)
            .body(mapOf("error" to "Конфликт данных: запись с такими параметрами уже существует"))
    }

    @ExceptionHandler(DataAccessException::class)
    fun handleDataAccess(ex: DataAccessException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).contentType(jsonUtf8).body(
            mapOf(
                "error" to "База данных недоступна. Запустите PostgreSQL (см. README) или backend с профилем local (H2): scripts/start-backend-local.ps1",
            ),
        )
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<Map<String, String>> {
        val msg = ex.bindingResult.fieldErrors.firstOrNull()?.defaultMessage ?: "Некорректный запрос"
        return ResponseEntity.badRequest().contentType(jsonUtf8).body(mapOf("error" to msg))
    }

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadableBody(ex: HttpMessageNotReadableException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.badRequest().contentType(jsonUtf8).body(mapOf("error" to "Некорректный запрос"))
    }
}
