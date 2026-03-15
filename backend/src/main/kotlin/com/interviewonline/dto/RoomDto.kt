package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class CreateRoomRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val language: String = "javascript",
    val taskIds: List<String> = emptyList(),
)

data class CreateGuestRoomRequest(
    val title: String = "Комната собеседования",
    val ownerDisplayName: String = "Интервьюер",
    val language: String = "javascript",
)

data class RoomTaskDto(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val categoryName: String?,
)

data class RoomResponse(
    val id: String,
    val title: String,
    val inviteCode: String,
    val language: String,
    val currentStep: Int,
    val code: String,
    val ownerToken: String?,
    val tasks: List<RoomTaskDto>,
)

data class RoomSummaryDto(
    val id: String,
    val title: String,
    val inviteCode: String,
    val language: String,
    val createdAt: String,
)

data class RunCodeRequest(
    val language: String,
    val code: String,
)

data class UpdateRoomRequest(
    @field:NotBlank val title: String,
)

data class RunCodeResponse(
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val timedOut: Boolean,
)
