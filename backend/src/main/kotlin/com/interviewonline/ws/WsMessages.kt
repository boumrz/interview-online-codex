package com.interviewonline.ws

data class WsIncomingMessage(
    val type: String,
    val code: String? = null,
    val language: String? = null,
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
    val participants: List<ParticipantPayload>,
    val isOwner: Boolean = false,
)

data class ParticipantPayload(
    val sessionId: String,
    val displayName: String,
)
