package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class AdminUserDto(
    val id: String,
    val nickname: String,
    val role: String,
    val createdAt: String,
)

data class UpdateUserRoleRequest(
    @field:NotBlank val role: String,
)
