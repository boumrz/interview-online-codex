package com.interviewonline.controller

import com.interviewonline.dto.HrInterviewDto
import com.interviewonline.dto.HrInterviewPageDto
import com.interviewonline.service.AuthService
import com.interviewonline.service.HrInterviewService
import com.interviewonline.service.HrWorkbookService
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.LocalDate
import java.time.ZoneId

@RestController
@RequestMapping("/api/me/hr/rooms")
class HrController(
    private val authService: AuthService,
    private val interviewService: HrInterviewService,
    private val workbookService: HrWorkbookService,
) {
    @GetMapping
    fun list(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
        @RequestParam(required = false) from: String?,
        @RequestParam(required = false) to: String?,
    ): ResponseEntity<HrInterviewPageDto> = noStore(
        interviewService.page(requireUser(authorization), page, size, from, to),
    )

    @GetMapping("/export")
    fun export(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestParam(required = false) from: String?,
        @RequestParam(required = false) to: String?,
    ): ResponseEntity<ByteArray> {
        val result = workbookService.generate(requireUser(authorization), from, to)
        val today = LocalDate.now(ZoneId.of("Europe/Moscow"))
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"hr-interviews-$today.xlsx\"")
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Interview-Count", result.interviewCount.toString())
            .body(result.bytes)
    }

    @GetMapping("/{roomId}")
    fun detail(
        @PathVariable roomId: String,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): ResponseEntity<HrInterviewDto> = noStore(interviewService.detail(requireUser(authorization), roomId))

    private fun requireUser(authorization: String?) =
        authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())

    private fun <T> noStore(body: T): ResponseEntity<T> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(body)
}
