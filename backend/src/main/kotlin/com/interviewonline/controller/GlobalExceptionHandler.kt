package com.interviewonline.controller

import com.interviewonline.service.ApiException
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(ApiException::class)
    fun handleApiException(ex: ApiException): ResponseEntity<Map<String, String>> {
        return ResponseEntity.status(ex.status).body(mapOf("error" to ex.message))
    }

    @ExceptionHandler(DataAccessException::class)
    fun handleDataAccess(ex: DataAccessException): ResponseEntity<Map<String, String>> {
        val root = ex.mostSpecificCause?.message ?: ex.message ?: "database_error"
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(
            mapOf(
                "error" to "База данных недоступна. Запустите PostgreSQL (см. README) или backend с профилем local (H2): scripts/start-backend-local.ps1",
                "detail" to root,
            ),
        )
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<Map<String, String>> {
        val msg = ex.bindingResult.fieldErrors.firstOrNull()?.defaultMessage ?: "Некорректный запрос"
        return ResponseEntity.badRequest().body(mapOf("error" to msg))
    }
}
