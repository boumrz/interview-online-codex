package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class CreateRoomRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val language: String = "nodejs",
    val taskIds: List<String> = emptyList(),
)

data class CreateGuestRoomRequest(
    val title: String = "Комната собеседования",
    val ownerDisplayName: String = "Интервьюер",
    val language: String = "nodejs",
)

data class RoomTaskDto(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val categoryName: String?,
    val score: Int?,
    val sourceTaskTemplateId: String? = null,
)

data class RoomAccessMemberDto(
    val userId: String,
    val displayName: String,
    val role: String,
    val isOwner: Boolean = false,
)

data class RoomNoteMessageDto(
    val id: String,
    val sessionId: String,
    val displayName: String,
    val role: String,
    val text: String,
    val timestampEpochMs: Long,
)

data class RoomResponse(
    val id: String,
    val title: String,
    val inviteCode: String,
    val language: String,
    val currentStep: Int,
    val code: String,
    val notes: String,
    val notesMessages: List<RoomNoteMessageDto> = emptyList(),
    val briefingMarkdown: String = "",
    val ownerToken: String?,
    val interviewerToken: String?,
    val role: String = "candidate",
    val isOwner: Boolean = false,
    val canManageRoom: Boolean = false,
    val canGrantAccess: Boolean = false,
    val accessMembers: List<RoomAccessMemberDto> = emptyList(),
    val tasks: List<RoomTaskDto>,
)

data class RoomSummaryDto(
    val id: String,
    val title: String,
    val inviteCode: String,
    val language: String,
    val accessRole: String,
    val createdAt: String,
    val ownerToken: String?,
    val interviewerToken: String?,
)

data class RunCodeRequest(
    val language: String,
    val code: String,
)

data class UpdateRoomRequest(
    @field:NotBlank val title: String,
)

data class AddRoomTasksRequest(
    val taskIds: List<String> = emptyList(),
    val customTasks: List<AddRoomCustomTaskRequest> = emptyList(),
)

data class AddRoomCustomTaskRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val description: String,
    val starterCode: String = "",
)

data class UpdateRoomParticipantRoleRequest(
    @field:NotBlank val role: String,
)

data class RunCodeResponse(
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val timedOut: Boolean,
)
