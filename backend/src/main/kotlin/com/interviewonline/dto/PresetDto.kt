package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class PresetSummaryDto(
    val id: String,
    val name: String,
    val itemCount: Int,
)

data class PresetItemDto(
    val taskTemplateId: String,
    val title: String,
    val language: String,
    val position: Int,
)

data class PresetDetailDto(
    val id: String,
    val name: String,
    val items: List<PresetItemDto>,
)

data class CreatePresetRequest(
    @field:NotBlank @field:Size(max = 255) val name: String,
    val taskTemplateIds: List<String> = emptyList(),
)

data class UpdatePresetRequest(
    @field:NotBlank @field:Size(max = 255) val name: String,
    val taskTemplateIds: List<String> = emptyList(),
)
