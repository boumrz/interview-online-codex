package com.interviewonline.ws

data class WsIncomingMessage(
    val type: String,
    val code: String? = null,
    val language: String? = null,
    val stepIndex: Int? = null,
    val notes: String? = null,
    val lineNumber: Int? = null,
    val column: Int? = null,
    val key: String? = null,
    val keyCode: String? = null,
    val ctrlKey: Boolean? = null,
    val altKey: Boolean? = null,
    val shiftKey: Boolean? = null,
    val metaKey: Boolean? = null,
    val presenceStatus: String? = null,
    val displayName: String? = null,
    val ownerToken: String? = null,
)

data class WsOutgoingMessage(
    val type: String,
    val payload: Any,
)

data class RoomRealtimePayload(
    val inviteCode: String,
    val language: String,
    val code: String,
    val currentStep: Int,
    val notes: String,
    val participants: List<ParticipantPayload>,
    val isOwner: Boolean = false,
    val role: String = "candidate",
    val canManageRoom: Boolean = false,
    val notesLockedBySessionId: String? = null,
    val notesLockedByDisplayName: String? = null,
    val notesLockedUntilEpochMs: Long? = null,
    val cursors: List<CursorPayload> = emptyList(),
    val lastCandidateKey: CandidateKeyPayload? = null,
)

data class ParticipantPayload(
    val sessionId: String,
    val displayName: String,
    val presenceStatus: String = "active",
)

data class CursorPayload(
    val sessionId: String,
    val displayName: String,
    val role: String,
    val lineNumber: Int,
    val column: Int,
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
