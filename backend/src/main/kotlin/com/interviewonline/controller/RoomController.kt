package com.interviewonline.controller

import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RunCodeRequest
import com.interviewonline.dto.RunCodeResponse
import com.interviewonline.service.AuthService
import com.interviewonline.service.CodeExecutionService
import com.interviewonline.service.RoomService
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api")
class RoomController(
    private val roomService: RoomService,
    private val authService: AuthService,
    private val codeExecutionService: CodeExecutionService,
) {
    @PostMapping("/public/rooms")
    fun createGuestRoom(@RequestBody request: CreateGuestRoomRequest): RoomResponse {
        return roomService.createGuestRoom(request)
    }

    @PostMapping("/rooms")
    fun createRoom(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @Valid @RequestBody request: CreateRoomRequest,
    ): RoomResponse {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.requireUserByToken(token)
        return roomService.createUserRoom(request, user)
    }

    @GetMapping("/rooms/{inviteCode}")
    fun getRoom(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.getByInviteCode(inviteCode, ownerToken, interviewerToken, user)
    }

    @PostMapping("/rooms/{inviteCode}/next-step")
    fun nextStep(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
    ): RoomResponse {
        return roomService.nextStep(inviteCode, ownerToken.orEmpty())
    }

    @PostMapping("/rooms/{inviteCode}/run")
    fun runCode(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestBody request: RunCodeRequest,
    ): RunCodeResponse {
        val room = roomService.getByInviteCodeEntity(inviteCode)
        roomService.verifyOwner(room, ownerToken)
        return codeExecutionService.run(request)
    }
}
