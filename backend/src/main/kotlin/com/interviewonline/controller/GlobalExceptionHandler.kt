package com.interviewonline.controller

import com.interviewonline.service.ApiException
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

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<Map<String, String>> {
        val msg = ex.bindingResult.fieldErrors.firstOrNull()?.defaultMessage ?: "Некорректный запрос"
        return ResponseEntity.badRequest().body(mapOf("error" to msg))
    }
}
