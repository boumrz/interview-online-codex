package com.interviewonline.dto

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.JsonNode

data class RoomDiagramChangeRequest(
    val diagramId: String,
    val operationId: String,
    val baseSequence: Long,
    val xml: String,
    val patch: JsonNode? = null,
    val checksum: String? = null,
)

@JsonInclude(JsonInclude.Include.NON_NULL)
data class RoomDiagramOperationDto(
    val diagramId: String,
    val sequence: Long,
    val operationId: String,
    val sessionId: String,
    val xml: String? = null,
    val patch: JsonNode? = null,
    val checksum: String? = null,
)

data class RoomDiagramDto(
    val diagramId: String,
    val sequence: Long,
    val xml: String,
    val canEdit: Boolean,
    val operations: List<RoomDiagramOperationDto> = emptyList(),
    val requiresSnapshot: Boolean = false,
    val editor: String = "drawio",
    val schemaVersion: Int = 1,
)
