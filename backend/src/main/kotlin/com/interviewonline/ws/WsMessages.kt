package com.interviewonline.ws

data class WsIncomingMessage(
    val type: String,
    val code: String? = null,
    val language: String? = null,
    val stepIndex: Int? = null,
    val notes: String? = null,
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
)

data class ParticipantPayload(
    val sessionId: String,
    val displayName: String,
    val presenceStatus: String = "active",
)
