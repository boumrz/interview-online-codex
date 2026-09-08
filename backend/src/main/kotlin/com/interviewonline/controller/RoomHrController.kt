package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.interviewonline.dto.HrManagerDto
import com.interviewonline.dto.HrTrackingDto
import com.interviewonline.dto.InterviewMetadataDto
import com.interviewonline.dto.InterviewMetadataUpdateRequest
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.RoomHrTrackingService
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/rooms/{inviteCode}")
class RoomHrController(
    private val authService: AuthService,
    private val roomHrTrackingService: RoomHrTrackingService,
) {
    @GetMapping("/interview-metadata")
    fun getMetadata(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ): ResponseEntity<InterviewMetadataDto> = noStore(
        roomHrTrackingService.getMetadata(
            inviteCode,
            resolveUser(authorization),
            ownerToken,
            interviewerToken,
            eventToken,
        ),
    )

    @PutMapping("/interview-metadata")
    fun updateMetadata(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestBody body: JsonNode,
    ): ResponseEntity<InterviewMetadataDto> {
        val requiredKeys = setOf("candidateName", "position", "scheduledAt", "revision")
        if (!requiredKeys.all(body::has)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нужно передать все поля метаданных и ревизию")
        }
        val revisionNode = body.path("revision")
        if (!revisionNode.isIntegralNumber || !revisionNode.canConvertToLong()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная ревизия метаданных")
        }
        fun nullableText(key: String): String? {
            val node = body.path(key)
            if (node.isNull) return null
            if (!node.isTextual) throw ApiException(HttpStatus.BAD_REQUEST, "Поле $key должно быть строкой или null")
            return node.textValue()
        }
        return noStore(
            roomHrTrackingService.updateMetadata(
                inviteCode,
                InterviewMetadataUpdateRequest(
                    candidateName = nullableText("candidateName"),
                    position = nullableText("position"),
                    scheduledAt = nullableText("scheduledAt"),
                    revision = revisionNode.longValue(),
                ),
                resolveUser(authorization),
                ownerToken,
                interviewerToken,
                eventToken,
            ),
        )
    }

    @GetMapping("/hr-managers")
    fun listManagers(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ): ResponseEntity<List<HrManagerDto>> = noStore(
        roomHrTrackingService.listManagers(
            inviteCode,
            resolveUser(authorization),
            ownerToken,
            interviewerToken,
            eventToken,
        ),
    )

    @PutMapping("/hr-managers/{userId}")
    fun invite(
        @PathVariable inviteCode: String,
        @PathVariable userId: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ): ResponseEntity<List<HrManagerDto>> = noStore(
        roomHrTrackingService.invite(
            inviteCode,
            userId,
            resolveUser(authorization),
            ownerToken,
            interviewerToken,
            eventToken,
        ),
    )

    @DeleteMapping("/hr-managers/{userId}")
    fun remove(
        @PathVariable inviteCode: String,
        @PathVariable userId: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ): ResponseEntity<Void> {
        roomHrTrackingService.remove(inviteCode, userId, resolveUser(authorization), ownerToken, interviewerToken, eventToken)
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
    }

    @PostMapping("/hr-tracking")
    fun track(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
    ): ResponseEntity<HrTrackingDto> {
        val user = authService.requireUserByToken(bearerToken(authorization))
        return noStore(roomHrTrackingService.track(inviteCode, user, ownerToken, interviewerToken, eventToken))
    }

    private fun resolveUser(authorization: String?) = authService.resolveUserByToken(bearerToken(authorization))
    private fun bearerToken(authorization: String?) = authorization?.removePrefix("Bearer ")?.trim()
    private fun <T> noStore(body: T): ResponseEntity<T> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(body)
}
