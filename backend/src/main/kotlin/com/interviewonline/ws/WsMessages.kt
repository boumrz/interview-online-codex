package com.interviewonline.ws

data class WsOutgoingMessage(
    val type: String,
    val payload: Any,
)

data class RoomRealtimePayload(
    val inviteCode: String,
    val language: String,
    val code: String,
    val lastCodeUpdatedBySessionId: String? = null,
    /** Base64 of Y.encodeStateAsUpdate (full CRDT state) so reconnecting clients match live peers. */
    val yjsDocumentBase64: String? = null,
    val lastYjsSequence: Long = 0,
    val currentStep: Int,
    val notes: String,
    val notesMessages: List<NoteMessagePayload> = emptyList(),
    val briefingMarkdown: String = "",
    val participants: List<ParticipantPayload>,
    val isOwner: Boolean = false,
    val role: String = "candidate",
    val canManageRoom: Boolean = false,
    val canGrantAccess: Boolean = false,
    val eventToken: String? = null,
    val notesLockedBySessionId: String? = null,
    val notesLockedByDisplayName: String? = null,
    val notesLockedUntilEpochMs: Long? = null,
    val tasks: List<RoomTaskPayload> = emptyList(),
    val taskScores: Map<Int, Int?> = emptyMap(),
    val cursors: List<CursorPayload> = emptyList(),
    val lastCandidateKey: CandidateKeyPayload? = null,
    val candidateKeyHistory: List<CandidateKeyPayload> = emptyList(),
)

data class RoomTaskPayload(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val categoryName: String?,
    val score: Int?,
    val sourceTaskTemplateId: String? = null,
)

data class NoteMessagePayload(
    val id: String,
    val sessionId: String,
    val displayName: String,
    val role: String,
    val text: String,
    val timestampEpochMs: Long,
)

data class ParticipantPayload(
    val sessionId: String,
    val displayName: String,
    val userId: String? = null,
    val role: String = "candidate",
    val presenceStatus: String = "active",
    val isAuthenticated: Boolean = false,
    val canBeGrantedInterviewerAccess: Boolean = false,
)

data class CursorPayload(
    val sessionId: String,
    val displayName: String,
    val role: String,
    val cursorSequence: Long? = null,
    val lineNumber: Int,
    val column: Int,
    val selectionStartLineNumber: Int? = null,
    val selectionStartColumn: Int? = null,
    val selectionEndLineNumber: Int? = null,
    val selectionEndColumn: Int? = null,
)

data class CandidateKeyPayload(
    val sessionId: String,
    val displayName: String,
    val key: String,
    val keyCode: String,
    val ctrlKey: Boolean,
    val altKey: Boolean,
    val shiftKey: Boolean,
    val metaKey: Boolean,
    val timestampEpochMs: Long,
)
