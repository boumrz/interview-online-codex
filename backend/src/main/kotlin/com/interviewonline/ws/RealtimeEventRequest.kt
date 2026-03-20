package com.interviewonline.ws

data class RealtimeEventRequest(
    val sessionId: String,
    val type: String,
    val code: String? = null,
    val language: String? = null,
    val stepIndex: Int? = null,
    val notes: String? = null,
    val presenceStatus: String? = null,
    val lineNumber: Int? = null,
    val column: Int? = null,
    val key: String? = null,
    val keyCode: String? = null,
    val ctrlKey: Boolean? = null,
    val altKey: Boolean? = null,
    val shiftKey: Boolean? = null,
    val metaKey: Boolean? = null,
)
