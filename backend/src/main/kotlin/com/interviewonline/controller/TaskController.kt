package com.interviewonline.controller

import com.interviewonline.dto.CreateTaskTemplateRequest
import com.interviewonline.dto.TaskLanguageGroupDto
import com.interviewonline.dto.TaskTemplateDto
import com.interviewonline.dto.UpdateTaskTemplateRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.UserTaskService
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/me")
class TaskController(
    private val authService: AuthService,
    private val userTaskService: UserTaskService,
) {
    @GetMapping("/tasks")
    fun listTasksGrouped(
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): List<TaskLanguageGroupDto> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return userTaskService.listTasksGrouped(user)
    }

    @PostMapping("/tasks")
    fun createTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @Valid @RequestBody request: CreateTaskTemplateRequest,
    ): TaskTemplateDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return userTaskService.createTask(user, request)
    }

    @PatchMapping("/tasks/{taskId}")
    fun updateTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable taskId: String,
        @Valid @RequestBody request: UpdateTaskTemplateRequest,
    ): TaskTemplateDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return userTaskService.updateTask(user, taskId, request)
    }

    @DeleteMapping("/tasks/{taskId}")
    fun deleteTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable taskId: String,
    ): Map<String, String> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        userTaskService.deleteTask(user, taskId)
        return mapOf("status" to "ok")
    }
}
