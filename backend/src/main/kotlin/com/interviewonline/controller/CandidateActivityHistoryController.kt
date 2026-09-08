package com.interviewonline.controller

import com.interviewonline.dto.CandidateActivityHistoryDto
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
import com.interviewonline.service.CandidateActivityHistoryService
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/rooms/{inviteCode}/activity-history")
class CandidateActivityHistoryController(
    private val authService: AuthService,
    private val historyService: CandidateActivityHistoryService,
) {
    @GetMapping
    fun history(
        @PathVariable inviteCode: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestParam(required = false) limit: String?,
        @RequestParam(required = false) beforeSequence: String?,
        @RequestParam(required = false) afterSequence: String?,
        @RequestParam(required = false) throughSequence: String?,
    ): ResponseEntity<CandidateActivityHistoryDto> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(historyService.history(
            inviteCode = inviteCode,
            user = authService.resolveUserByToken(authorization?.removePrefix("Bearer ")?.trim()),
            ownerToken = ownerToken,
            interviewerToken = interviewerToken,
            eventToken = eventToken,
            limit = limit?.let { it.toIntOrNull() ?: invalidParameter() } ?: 200,
            beforeSequence = beforeSequence?.let(::parseSequence),
            afterSequence = afterSequence?.let(::parseSequence),
            throughSequence = throughSequence?.let(::parseSequence),
        ))

    private fun parseSequence(value: String): Long = value.toLongOrNull() ?: invalidParameter()
    private fun invalidParameter(): Nothing = throw ApiException(HttpStatus.BAD_REQUEST, "Некорректные параметры истории активности")
}
