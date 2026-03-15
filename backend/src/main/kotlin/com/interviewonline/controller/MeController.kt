package com.interviewonline.controller

import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.dto.UpdateRoomRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.RoomService
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/me")
class MeController(
    private val authService: AuthService,
    private val roomService: RoomService,
) {
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
    ): Map<String, String> {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        roomService.deleteRoomForUser(user, roomId)
        return mapOf("status" to "ok")
    }
}
