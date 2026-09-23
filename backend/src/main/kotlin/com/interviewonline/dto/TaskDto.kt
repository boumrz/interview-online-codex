package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class CreateTaskTemplateRequest(
    @field:NotBlank val title: String,
    val description: String = "",
    val starterCode: String = "",
    @field:NotBlank val language: String,
)

data class UpdateTaskTemplateRequest(
    @field:NotBlank val title: String,
    val description: String = "",
    val starterCode: String = "",
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

data class TeamTaskTemplateDto(
    val id: String,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val status: String,
    val revision: Long,
    val createdByUserId: String,
)

data class TeamTaskLibraryCountsDto(
    val activeTasks: Long,
    val archivedTasks: Long,
)

data class TeamTaskLibraryDto(
    val items: List<TeamTaskTemplateDto>,
    val counts: TeamTaskLibraryCountsDto,
)

data class TeamTaskTemplateResponse(
    val task: TeamTaskTemplateDto,
)

data class TeamTaskSetItemDto(
    val taskId: String,
    val title: String,
    val language: String,
    val position: Int,
)

data class TeamTaskSetDto(
    val id: String,
    val name: String,
    val items: List<TeamTaskSetItemDto>,
    val status: String,
    val revision: Long,
    val createdByUserId: String,
)

data class TeamTaskSetCountsDto(
    val activeSets: Long,
    val archivedSets: Long,
)

data class TeamTaskSetLibraryDto(
    val items: List<TeamTaskSetDto>,
    val counts: TeamTaskSetCountsDto,
)

data class TeamTaskSetResponse(
    val taskSet: TeamTaskSetDto,
)

data class CreateTeamTaskSetRequest(
    @field:NotBlank val name: String,
    val taskIds: List<String> = emptyList(),
)

data class UpdateTeamTaskSetRequest(
    @field:NotBlank val name: String,
    val taskIds: List<String> = emptyList(),
    val revision: Long,
)

data class ImportPersonalTaskRequest(
    @field:NotBlank val sourceTaskId: String,
)

data class ImportPersonalPresetRequest(
    @field:NotBlank val sourcePresetId: String,
)

data class UpdateTeamTaskTemplateRequest(
    val title: String,
    val description: String = "",
    val starterCode: String = "",
    val language: String,
    val revision: Long,
)
