package com.interviewonline.dto

import com.fasterxml.jackson.databind.JsonNode

data class RoomWhiteboardChangeRequest(
    val boardId: String,
    val operationId: String,
    val baseSequence: Long,
    val elements: List<JsonNode>,
)

data class RoomWhiteboardDto(
    val boardId: String,
    val sequence: Long,
    val elements: List<JsonNode>,
    val canEdit: Boolean,
)

data class RoomWhiteboardOperationDto(
    val boardId: String,
    val sequence: Long,
    val operationId: String,
)

data class RoomWhiteboardChangedDto(val boardId: String, val sequence: Long)
