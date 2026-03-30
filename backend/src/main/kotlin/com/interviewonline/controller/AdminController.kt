package com.interviewonline.controller

import com.interviewonline.dto.AdminUserDto
import com.interviewonline.dto.UpdateUserRoleRequest
import com.interviewonline.service.AdminUserService
import com.interviewonline.service.AuthService
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/admin")
class AdminController(
    private val authService: AuthService,
    private val adminUserService: AdminUserService,
) {
    @GetMapping("/users")
    fun listUsers(
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): List<AdminUserDto> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return adminUserService.listUsers(user)
    }

    @PatchMapping("/users/{userId}/role")
    fun updateUserRole(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable userId: String,
        @Valid @RequestBody request: UpdateUserRoleRequest,
    ): AdminUserDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return adminUserService.updateRole(user, userId, request.role)
    }

    @DeleteMapping("/users/{userId}")
    fun deleteUser(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable userId: String,
    ): Map<String, String> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        adminUserService.deleteUser(user, userId)
        return mapOf("status" to "ok")
    }
}
