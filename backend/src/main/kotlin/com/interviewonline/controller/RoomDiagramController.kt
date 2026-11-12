package com.interviewonline.controller

import com.interviewonline.dto.RoomDiagramChangeRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.RoomDiagramService
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/rooms/{inviteCode}/diagram")
class RoomDiagramController(
    private val diagrams: RoomDiagramService,
    private val auth: AuthService,
) {
    @GetMapping
    fun get(
        @PathVariable inviteCode: String,
        @RequestParam(required = false) sessionId: String?,
        @RequestParam(required = false) afterSequence: Long?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ) = privateResponse(diagrams.get(inviteCode, credentials(authorization, ownerToken, interviewerToken, eventToken, sessionId), afterSequence))

    @PostMapping("/changes")
    fun change(
        @PathVariable inviteCode: String,
        @RequestParam sessionId: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestBody request: RoomDiagramChangeRequest,
    ) = privateResponse(diagrams.change(inviteCode, credentials(authorization, ownerToken, interviewerToken, eventToken, sessionId), request))

    private fun credentials(authorization: String?, ownerToken: String?, interviewerToken: String?, eventToken: String?, sessionId: String?) =
        RoomDiagramService.Credentials(auth.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim()),
            ownerToken, interviewerToken, eventToken, sessionId)

    private fun <T> privateResponse(body: T): ResponseEntity<T> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore().cachePrivate()).body(body)
}
