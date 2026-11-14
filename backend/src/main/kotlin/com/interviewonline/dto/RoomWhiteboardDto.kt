package com.interviewonline.dto

import com.fasterxml.jackson.databind.JsonNode

data class RoomWhiteboardChangeRequest(
    val boardId: String,
    val operationId: String,
    val baseSequence: Long,
    val elements: List<JsonNode>,
    val files: Map<String, JsonNode> = emptyMap(),
)

data class RoomWhiteboardDto(
    val boardId: String,
    val sequence: Long,
    val elements: List<JsonNode>,
    val canEdit: Boolean,
    val taskId: String? = null,
    val files: Map<String, JsonNode> = emptyMap(),
)

data class RoomWhiteboardOperationDto(
    val boardId: String,
    val sequence: Long,
    val operationId: String,
    val taskId: String? = null,
)

data class RoomWhiteboardChangedDto(val boardId: String, val sequence: Long, val taskId: String? = null)
