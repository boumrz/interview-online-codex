package com.interviewonline.controller

import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.UpdateProfileRequest
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.dto.UserDto
import com.interviewonline.dto.WorkspaceDto
import com.interviewonline.dto.CommandOutcomeDto
import com.interviewonline.service.AuthService
import com.interviewonline.service.ApiException
import com.interviewonline.service.RoomService
import com.interviewonline.service.WorkspaceService
import com.interviewonline.service.secure
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import java.nio.charset.StandardCharsets

@RestController
@RequestMapping("/api/me")
class MeController(
    private val authService: AuthService,
    private val roomService: RoomService,
    private val workspaceService: WorkspaceService,
) {
    private val jsonUtf8 = MediaType("application", "json", StandardCharsets.UTF_8)

    @GetMapping("/workspaces")
    fun getWorkspaces(
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): ResponseEntity<List<WorkspaceDto>> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(workspaceService.listWorkspaces(requireUser(authorization)))

    @GetMapping("/commands/{idempotencyKey}")
    fun getCommandOutcome(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable idempotencyKey: String,
        @RequestParam(required = false) scope: String?,
        @RequestParam(required = false) operation: String?,
    ): ResponseEntity<CommandOutcomeDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(workspaceService.commandOutcome(requireUser(authorization), idempotencyKey, scope, operation))

    @GetMapping("/profile")
    fun getMyProfile(
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): UserDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return UserDto(
            id = user.id!!,
            nickname = user.nickname,
            displayName = user.displayName.orEmpty(),
            role = user.role,
            isHr = user.isHr,
        )
    }

    @GetMapping("/rooms")
    fun getMyRooms(
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): List<RoomSummaryDto> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return roomService.listRoomsForUser(user)
    }

    @PatchMapping("/rooms/{roomId}")
    fun updateRoom(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable roomId: String,
        @Valid @RequestBody request: UpdateRoomRequest,
    ): RoomSummaryDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return roomService.updateRoomForUser(user, roomId, request)
    }

    @DeleteMapping("/rooms/{roomId}")
    fun deleteRoom(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable roomId: String,
    ): Map<String, Any> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        val archived = roomService.deleteRoomForUser(user, roomId)
        return mapOf("status" to "ok", "archived" to archived)
    }

    @PatchMapping("/profile")
    fun updateProfile(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @Valid @RequestBody request: UpdateProfileRequest,
    ): UserDto {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return authService.updateProfile(user, request)
    }

    private fun requireUser(authorization: String?) = try {
        authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
    } catch (ex: ApiException) {
        throw secure(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", ex.message)
    }
}
