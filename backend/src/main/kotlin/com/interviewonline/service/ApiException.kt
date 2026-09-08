package com.interviewonline.service

import org.springframework.http.HttpStatus
import org.springframework.http.HttpHeaders

class ApiException(
    val status: HttpStatus,
    override val message: String,
    val headers: HttpHeaders = HttpHeaders(),
) : RuntimeException(message)
