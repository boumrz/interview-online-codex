package com.interviewonline.controller

import com.interviewonline.dto.AuthResponse
import com.interviewonline.dto.LoginRequest
import com.interviewonline.dto.RegisterRequest
import com.interviewonline.service.AuthService
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/auth")
class AuthController(
    private val authService: AuthService,
) {
    @PostMapping("/register")
    fun register(@Valid @RequestBody request: RegisterRequest): AuthResponse = authService.register(request)

    @PostMapping("/login")
    fun login(@Valid @RequestBody request: LoginRequest): AuthResponse = authService.login(request)
}
