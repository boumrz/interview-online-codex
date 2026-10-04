package com.interviewonline.dto

import com.fasterxml.jackson.annotation.JsonAnySetter
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.JsonMappingException
import com.fasterxml.jackson.databind.annotation.JsonDeserialize
import java.time.Instant

@JsonIgnoreProperties(ignoreUnknown = false)
data class CreateTeamRequest(
    val name: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown create-team field: $name")
    }
}

data class TeamSummaryDto(
    val id: String,
    val name: String,
)

data class TeamMembershipDto(
    val role: String,
    val state: String,
    val epoch: Long,
)

data class TeamCreateResponse(
    val team: TeamSummaryDto,
    val membership: TeamMembershipDto,
    val capabilities: List<String>,
)

data class WorkspaceDto(
    val id: String,
    val name: String,
    val role: String,
    val epoch: Long,
    val capabilities: List<String>,
)

data class TeamDetailDto(
    val id: String,
    val name: String,
    val role: String,
    val epoch: Long,
    val capabilities: List<String>,
    val revision: Long,
)

data class TeamAuditIdentityDto(
    val userId: String,
    val displayName: String,
)

data class TeamAuditEventDto(
    val id: String,
    val action: String,
    val createdAt: java.time.Instant,
    val outcome: String,
    val actor: TeamAuditIdentityDto?,
    val target: TeamAuditIdentityDto?,
    val entityId: String?,
)

data class TeamAuditPageDto(
    val items: List<TeamAuditEventDto>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

data class TeamMemberDirectoryItemDto(
    val userId: String,
    val displayName: String,
    val role: String,
    val state: String,
    val revision: Long,
    val processes: List<TeamProcessLabelDto> = emptyList(),
)

data class TeamProcessLabelDto(
    val trackId: String,
    val trackName: String,
    val vacancyId: String?,
    val vacancyTitle: String?,
)

data class TeamProcessListDto(
    val items: List<TeamProcessLabelDto>,
)

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamMergePlanCreateRequest(
    val targetTeamId: String,
    val destinationTeamId: String,
    val destinationName: String,
    val trackRenames: Map<String, String> = emptyMap(),
    val setRenames: Map<String, String> = emptyMap(),
    val adminPromotions: List<String> = emptyList(),
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-merge-plan field: $name")
    }
}

data class TeamMergePlanDto(
    val id: String,
    val sourceTeamId: String,
    val targetTeamId: String,
    val destinationTeamId: String,
    val destinationName: String,
    val sourceName: String?,
    val targetName: String?,
    val state: String,
    val sourceApproved: Boolean,
    val targetApproved: Boolean,
    val reviewed: Boolean,
    val trackRenames: Map<String, String>,
    val setRenames: Map<String, String>,
    val adminPromotions: List<String>,
    val collisions: List<String>,
    val membershipConflicts: List<String>,
    val members: List<TeamMergeMemberPreviewDto>,
    val materials: List<TeamMergeMaterialPreviewDto>,
)

data class TeamMergeMemberPreviewDto(
    val userId: String,
    val displayName: String,
    val teamId: String,
    val currentRole: String,
    val resultingRole: String,
)

data class TeamMergeMaterialPreviewDto(
    val id: String,
    val teamId: String,
    val kind: String,
    val name: String,
    val status: String,
)

data class TeamMergePlanResponse(val plan: TeamMergePlanDto)
data class TeamMergePlanListDto(val items: List<TeamMergePlanDto>)

data class TeamMergeCommitResponse(
    val sourceTeamId: String,
    val destinationTeamId: String,
    val recovered: Boolean,
)

data class TeamMergeRedirectDto(val teamId: String)

data class TeamMemberDirectoryDto(
    val items: List<TeamMemberDirectoryItemDto>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

data class TeamVacancyDto(
    val id: String,
    val title: String,
    val status: String,
    val revision: Long,
    val programme: TeamInterviewProgrammeDto? = null,
)

data class TeamInterviewProgrammeTaskDto(
    val taskId: String,
    val title: String,
    val language: String,
    val position: Int,
    val mandatory: Boolean,
)

data class TeamInterviewProgrammeDto(
    val id: String,
    val origin: String,
    val targetType: String,
    val targetId: String,
    val status: String,
    val version: Long,
    val revision: Long,
    val mandatory: Boolean,
    val tasks: List<TeamInterviewProgrammeTaskDto>,
)

data class TeamInterviewProgrammeResponse(
    val programme: TeamInterviewProgrammeDto?,
)

data class TeamTrackDto(
    val id: String,
    val name: String,
    val status: String,
    val revision: Long,
    val programme: TeamInterviewProgrammeDto?,
    val vacancies: List<TeamVacancyDto>,
)

data class TeamTrackCountsDto(
    val activeTracks: Long,
    val archivedTracks: Long,
    val activeVacancies: Long,
    val archivedVacancies: Long,
)

data class TeamTracksDto(
    val items: List<TeamTrackDto>,
    val counts: TeamTrackCountsDto,
)

data class TeamTrackResponse(
    val track: TeamTrackDto,
)

data class TeamVacancyResponse(
    val vacancy: TeamVacancyDto,
)

data class TeamInterviewTaskDto(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val sourceTaskTemplateId: String,
    val mandatory: Boolean,
)

data class TeamInterviewAssigneeDto(
    val userId: String,
    val displayName: String,
    val role: String,
)

data class TeamInterviewDto(
    val id: String,
    val title: String,
    val inviteCode: String,
    val teamId: String,
    val status: String,
    val trackId: String?,
    val vacancyId: String?,
    val taskSetId: String?,
    val taskSetRevision: Long?,
    val programmeId: String?,
    val programmeOrigin: String?,
    val programmeVersion: Long?,
    val tasks: List<TeamInterviewTaskDto>,
    val assignees: List<TeamInterviewAssigneeDto>,
)

data class TeamInterviewResponse(
    val interview: TeamInterviewDto,
)

data class TeamInterviewListTaskDto(
    val stepIndex: Int,
    val title: String,
    val language: String,
    val mandatory: Boolean,
)

data class TeamInterviewTaskScoreDto(
    val stepIndex: Int,
    val title: String,
    val score: Int?,
)

data class TeamInterviewListItemDto(
    val id: String,
    val title: String,
    val inviteCode: String,
    val teamId: String,
    val status: String,
    val ownerUserId: String?,
    val createdByUserId: String?,
    val ownerDisplayName: String?,
    val ownershipState: String,
    val trackId: String?,
    val trackName: String?,
    val vacancyId: String?,
    val vacancyTitle: String?,
    val taskSetId: String?,
    val taskSetRevision: Long?,
    val programmeId: String?,
    val programmeOrigin: String?,
    val programmeVersion: Long?,
    val taskCount: Int,
    val createdAt: Instant,
    val finishedAt: Instant?,
    val verdict: String?,
    val verdictComment: String?,
    val tasks: List<TeamInterviewListTaskDto>,
    val taskScores: List<TeamInterviewTaskScoreDto>,
    val assignees: List<TeamInterviewAssigneeDto>,
)

data class TeamInterviewListDto(
    val items: List<TeamInterviewListItemDto>,
)

data class TeamInterviewOwnerOfferDto(
    val id: String,
    val teamId: String,
    val interviewId: String,
    val fromUserId: String,
    val toUserId: String,
    val status: String,
    val createdAt: Instant,
    val expiresAt: Instant,
    val respondedAt: Instant?,
)

data class TeamInterviewOwnerOfferResponse(
    val offer: TeamInterviewOwnerOfferDto,
)

data class TeamInterviewOwnerOfferListItemDto(
    val id: String,
    val teamId: String,
    val interviewId: String,
    val interviewTitle: String,
    val fromUserId: String,
    val fromDisplayName: String,
    val toUserId: String,
    val status: String,
    val createdAt: Instant,
    val expiresAt: Instant,
)

data class TeamInterviewOwnerOfferListDto(
    val items: List<TeamInterviewOwnerOfferListItemDto>,
)

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewCreateRequest(
    val title: String,
    val taskSetId: String? = null,
    val taskIds: List<String> = emptyList(),
    val selectedTaskIds: List<String>? = null,
    val trackId: String? = null,
    val vacancyId: String? = null,
    val programmeId: String? = null,
    val programmeVersion: Long? = null,
    val interviewerIds: List<String> = emptyList(),
    @param:com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = HiringManagerIdsDeserializer::class)
    val hiringManagerIds: List<String> = emptyList(),
    val candidateIds: List<String> = emptyList(),
    @param:JsonDeserialize(using = TeamInterviewMetadataTextDeserializer::class)
    val candidateName: String? = null,
    @param:JsonDeserialize(using = TeamInterviewMetadataTextDeserializer::class)
    val position: String? = null,
    @param:JsonDeserialize(using = TeamInterviewMetadataTextDeserializer::class)
    val scheduledAt: String? = null,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-create field: $name")
    }
}

class TeamInterviewMetadataTextDeserializer : JsonDeserializer<String>() {
    override fun deserialize(parser: JsonParser, context: DeserializationContext): String {
        if (parser.currentToken != JsonToken.VALUE_STRING) {
            throw JsonMappingException.from(parser, "Поле метаданных должно быть строкой или null")
        }
        return parser.text
    }
}

data class TeamInterviewDetailsDto(
    val title: String,
    val candidateName: String?,
    val position: String?,
    val scheduledAt: String?,
    val revision: Long,
)

data class TeamInterviewDetailsUpdateRequest(
    val title: String,
    val candidateName: String?,
    val position: String?,
    val scheduledAt: String?,
    val revision: Long,
)

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewRenameRequest(
    val title: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-rename field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewOwnerOfferCreateRequest(
    val targetUserId: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-owner-offer-create field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamTrackCreateRequest(
    val name: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-track-create field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamVacancyCreateRequest(
    val title: String,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-vacancy-create field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamTrackUpdateRequest(
    val name: String,
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-track-update field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamVacancyUpdateRequest(
    val title: String,
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-vacancy-update field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewProgrammeDraftRequest(
    val taskIds: List<String> = emptyList(),
    val revision: Long? = null,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-programme-draft field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewProgrammePublishRequest(
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-programme-publish field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamInterviewProgrammeRevisionRequest(
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-interview-programme-revision field: $name")
    }
}

data class CommandOutcomeDto(
    val outcome: String,
    val status: Int,
    val resourceId: String,
)

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamRenameRequest(
    val name: String,
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-rename field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamMemberRoleRequest(
    val role: String,
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-member-role field: $name")
    }
}

@JsonIgnoreProperties(ignoreUnknown = false)
data class TeamOwnershipTransferRequest(
    val targetUserId: String,
    val revision: Long,
) {
    @JsonAnySetter
    @Suppress("UNUSED_PARAMETER")
    fun rejectUnknownField(name: String, value: Any?) {
        throw IllegalArgumentException("Unknown team-ownership-transfer field: $name")
    }
}

data class TeamManagementTeamDto(
    val id: String,
    val name: String,
    val role: String,
    val revision: Long,
)

data class TeamManagementMemberDto(
    val userId: String,
    val displayName: String,
    val role: String,
    val state: String,
    val revision: Long,
)

data class TeamRenameResponse(
    val outcome: String,
    val recovered: Boolean,
    val team: TeamManagementTeamDto,
)

data class TeamMemberRoleResponse(
    val outcome: String,
    val recovered: Boolean,
    val member: TeamManagementMemberDto,
)

data class TeamMemberLifecycleResponse(
    val outcome: String,
    val recovered: Boolean,
    val member: TeamManagementMemberDto,
)

data class TeamOwnershipTransferResponse(
    val outcome: String,
    val recovered: Boolean,
    val team: TeamManagementTeamDto,
    val affectedMembers: List<TeamManagementMemberDto>,
)
