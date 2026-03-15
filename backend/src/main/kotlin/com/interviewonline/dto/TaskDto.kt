package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class CreateTaskTemplateRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val description: String,
    @field:NotBlank val starterCode: String,
    @field:NotBlank val language: String,
)

data class UpdateTaskTemplateRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val description: String,
    @field:NotBlank val starterCode: String,
    @field:NotBlank val language: String,
)

data class TaskTemplateDto(
    val id: String,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
)

data class TaskLanguageGroupDto(
    val language: String,
    val tasks: List<TaskTemplateDto>,
)
