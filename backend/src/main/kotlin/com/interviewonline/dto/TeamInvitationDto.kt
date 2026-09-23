package com.interviewonline.dto

import com.fasterxml.jackson.annotation.JsonAnySetter
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import java.time.Instant

@JsonIgnoreProperties(ignoreUnknown = false)
class EmptyInvitationRequest {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown invitation create field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class InvitationTokenRequest(
    val token: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown invitation field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class InvitationRevisionRequest(
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown invitation revision field: $name")
    }
}

data class TeamInvitationDto(
    val id: String,
    val state: String,
    val role: String,
    val expiresAt: Instant,
    val revision: Long,
    val canReveal: Boolean,
    val linkRecoverability: String,
)

data class TeamInvitationResponse(
    val invitation: TeamInvitationDto,
)

data class TeamInvitationPreviewDto(
    val teamName: String,
    val role: String,
    val expiresAt: Instant,
)

data class TeamInvitationAcceptDto(
    val teamId: String,
    val outcome: String,
)

data class TeamInvitationListDto(
    val items: List<TeamInvitationDto>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

data class TeamInvitationLinkDto(
    val url: String,
)
