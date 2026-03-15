package com.interviewonline.service

import org.springframework.http.HttpStatus

class ApiException(
    val status: HttpStatus,
    override val message: String,
) : RuntimeException(message)
