package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.interviewonline.service.AuthService
import com.interviewonline.service.RoomWhiteboardService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/rooms/{inviteCode}/whiteboard")
class RoomWhiteboardController(private val boards: RoomWhiteboardService, private val auth: AuthService) {
    @GetMapping
    fun get(
        @PathVariable inviteCode: String,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) taskId: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ) = privateResponse(boards.get(inviteCode, credentials(authorization, ownerToken, interviewerToken, eventToken, sessionId), taskId))

    @PostMapping("/changes")
    fun change(
        @PathVariable inviteCode: String,
        @RequestParam sessionId: String,
        @RequestParam(required = false) taskId: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestBody request: JsonNode,
    ) = privateResponse(boards.change(inviteCode, credentials(authorization, ownerToken, interviewerToken, eventToken, sessionId), request, taskId))

    private fun credentials(authorization: String?, ownerToken: String?, interviewerToken: String?, eventToken: String?, sessionId: String?) =
        RoomWhiteboardService.Credentials(auth.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim()), ownerToken, interviewerToken, eventToken, sessionId)

    private fun <T> privateResponse(body: T) = ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate()).body(body)
}
