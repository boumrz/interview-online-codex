package com.interviewonline.dto

data class InterviewMetadataDto(
    val candidateName: String?,
    val position: String?,
    val scheduledAt: String?,
    val revision: Long,
)

data class InterviewMetadataUpdateRequest(
    val candidateName: String?,
    val position: String?,
    val scheduledAt: String?,
    val revision: Long,
)

data class HrManagerDto(
    val userId: String,
    val displayName: String,
    val isOwner: Boolean,
)

data class HrTrackingDto(
    val roomId: String,
    val tracked: Boolean = true,
)

data class HrTaskScoreDto(
    val taskId: String,
    val stepIndex: Int,
    val title: String,
    val score: Int?,
)

data class HrInterviewDto(
    val roomId: String,
    val title: String,
    val inviteCode: String,
    val candidateName: String?,
    val position: String?,
    val scheduledAt: String?,
    val createdAt: String,
    val finishedAt: String?,
    val archivedAt: String?,
    val status: String,
    val interviewState: String,
    val verdict: String?,
    val verdictComment: String?,
    val effectiveAt: String,
    val dateSource: String,
    val taskScores: List<HrTaskScoreDto>,
)

data class HrInterviewPageDto(
    val items: List<HrInterviewDto>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
    val timezone: String = "Europe/Moscow",
    val from: String?,
    val to: String?,
)
