package com.interviewonline.controller

import com.interviewonline.dto.CreatePresetRequest
import com.interviewonline.dto.PresetDetailDto
import com.interviewonline.dto.PresetSummaryDto
import com.interviewonline.dto.UpdatePresetRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.UserPresetService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/me/presets")
class PresetController(
    private val authService: AuthService,
    private val userPresetService: UserPresetService,
) {
    @GetMapping
    fun listPresets(@RequestHeader("Authorization", required = false) authorization: String?): List<PresetSummaryDto> {
        val user = authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
        return userPresetService.listPresets(user)
    }

    @GetMapping("/{id}")
    fun getPreset(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable id: String,
    ): PresetDetailDto {
        val user = authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
        return userPresetService.getPreset(user, id)
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun createPreset(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @Valid @RequestBody request: CreatePresetRequest,
    ): PresetDetailDto {
        val user = authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
        return userPresetService.createPreset(user, request)
    }

    @PutMapping("/{id}")
    fun updatePreset(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable id: String,
        @Valid @RequestBody request: UpdatePresetRequest,
    ): PresetDetailDto {
        val user = authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
        return userPresetService.updatePreset(user, id, request)
    }

    @DeleteMapping("/{id}")
    fun deletePreset(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable id: String,
    ): Map<String, String> {
        val user = authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
        userPresetService.deletePreset(user, id)
        return mapOf("status" to "ok")
    }
}
