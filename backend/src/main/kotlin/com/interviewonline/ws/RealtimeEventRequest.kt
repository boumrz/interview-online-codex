package com.interviewonline.ws

data class RealtimeEventRequest(
    val sessionId: String,
    val type: String,
    val code: String? = null,
    val language: String? = null,
    val stepIndex: Int? = null,
    val notes: String? = null,
    val presenceStatus: String? = null,
)
