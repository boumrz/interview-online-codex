package com.interviewonline.dto

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonDeserializer
import com.fasterxml.jackson.databind.JsonMappingException
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.annotation.JsonDeserialize
import jakarta.validation.constraints.NotBlank

class HiringManagerIdsDeserializer : JsonDeserializer<List<String>>() {
    override fun deserialize(parser: JsonParser, context: DeserializationContext): List<String> {
        val node = parser.codec.readTree<JsonNode>(parser)
        if (!node.isArray) throw malformed(parser)
        return node.map { value ->
            if (!value.isTextual) throw malformed(parser)
            value.textValue()
        }
    }

    override fun getNullValue(context: DeserializationContext): List<String>? {
        throw malformed(context.parser)
    }

    private fun malformed(parser: JsonParser): JsonMappingException =
        JsonMappingException.from(parser, "hiringManagerIds должен быть массивом строк")
}

data class CreateRoomRequest(
    @field:NotBlank val title: String,
    @field:NotBlank val language: String = "nodejs",
    val taskIds: List<String> = emptyList(),
    @param:JsonDeserialize(using = HiringManagerIdsDeserializer::class)
    val hiringManagerIds: List<String>? = null,
)

data class CreateGuestRoomRequest(
    val title: String = "Комната собеседования",
    val ownerDisplayName: String = "Интервьюер",
    val language: String = "nodejs",
    /** Rejected by the public endpoint instead of silently ignoring it. */
    @param:JsonDeserialize(using = HiringManagerIdsDeserializer::class)
    val hiringManagerIds: List<String>? = null,
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

/**
 * Read-only saved workspace for a task that is not currently published to the
 * whole room. This is deliberately a separate response from [RoomResponse]
 * so inactive task code and briefing never enter the room-wide SSE payload.
 */
data class RoomTaskWorkspaceDto(
    val stepIndex: Int,
    val title: String,
    val language: String,
    val code: String,
    val briefingMarkdown: String,
    val revision: Long = 0,
    val yjsDocumentBase64: String? = null,
    val yjsSequence: Long = 0,
    val focusMode: Boolean = false,
)

/**
 * Durable non-public task preparation update.  The revision is intentionally
 * separate from code: code collaboration is CRDT-based, while these fields
 * use optimistic concurrency and return a resync on a stale write.
 */
data class UpdateRoomTaskWorkspaceRequest(
    val code: String? = null,
    val language: String? = null,
    val briefingMarkdown: String? = null,
    val focusMode: Boolean? = null,
    val revision: Long? = null,
    val yjsDocumentBase64: String? = null,
    val yjsSequence: Long? = null,
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
    val verdict: String? = null,
    val verdictComment: String? = null,
    val status: String = "active",
    val finishedAt: String? = null,
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
    val verdict: String? = null,
    val status: String = "active",
)

data class SetVerdictRequest(
    val verdict: String,
    val verdictComment: String? = null,
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
    val description: String = "",
    val starterCode: String = "",
    /**
     * Optional override for the task language. When blank/null we fall back to
     * the language currently set on the room (legacy behavior). Allows
     * interviewers to mix tasks of different languages within the same room.
     */
    val language: String? = null,
)

data class UpdateRoomParticipantRoleRequest(
    @field:NotBlank val role: String,
)

/**
 * In-room task editing payload. All fields optional (PATCH semantics) — at
 * minimum one must be supplied. Lets interviewers tweak the title (or other
 * fields later) without leaving the live coding session.
 */
data class UpdateRoomTaskRequest(
    val title: String? = null,
)
