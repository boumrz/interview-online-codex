package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class RegisterRequest(
    @field:NotBlank(message = "Ник обязателен")
    @field:Size(min = 3, max = 32, message = "Ник должен быть от 3 до 32 символов")
    val nickname: String,
    @field:NotBlank(message = "Имя обязательно")
    @field:Size(min = 2, max = 64)
    val displayName: String,
    @field:NotBlank(message = "Пароль обязателен")
    @field:Size(min = 6, message = "Пароль должен быть не короче 6 символов")
    val password: String,
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
    val displayName: String,
    val role: String,
)

data class UpdateProfileRequest(
    @field:NotBlank(message = "Имя обязательно")
    @field:Size(min = 2, max = 64)
    val displayName: String,
)
