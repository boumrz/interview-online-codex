package com.interviewonline.dto

data class RoomLanguageObservationRequest(
    val sessionId: String,
    val eventToken: String,
    val taskId: String,
    val language: String,
)

data class RoomLanguageObservationResponse(
    val language: String,
    val firstForRoom: Boolean = false,
    val firstForStep: Boolean = false,
    val firstMultilanguageRoom: Boolean = false,
)
