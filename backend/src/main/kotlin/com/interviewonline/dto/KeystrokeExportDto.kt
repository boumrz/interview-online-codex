package com.interviewonline.dto

data class KeystrokeEventDto(
    val id: String,
    val sessionId: String,
    val displayName: String,
    val keyValue: String?,
    val keyCode: String?,
    val ctrlKey: Boolean,
    val altKey: Boolean,
    val shiftKey: Boolean,
    val metaKey: Boolean,
    val eventKind: String,
    val pasteLength: Int?,
    val pastePreview: String?,
    val timestampEpochMs: Long,
)
