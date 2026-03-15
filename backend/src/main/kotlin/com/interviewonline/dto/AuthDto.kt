package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class RegisterRequest(
    @field:NotBlank @field:Size(min = 3, max = 24) val nickname: String,
    @field:Size(min = 6) val password: String,
)

data class LoginRequest(
    @field:NotBlank val nickname: String,
    @field:NotBlank val password: String,
)

data class AuthResponse(
    val token: String,
    val user: UserDto,
)

data class UserDto(
    val id: String,
    val nickname: String,
)
