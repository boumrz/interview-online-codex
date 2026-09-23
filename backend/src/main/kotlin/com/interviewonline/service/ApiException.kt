package com.interviewonline.service

import org.springframework.http.HttpStatus
import org.springframework.http.HttpHeaders

class ApiException(
    val status: HttpStatus,
    override val message: String,
    val headers: HttpHeaders = HttpHeaders(),
    val code: String? = null,
    val currentRevision: Long? = null,
) : RuntimeException(message)
