package com.interviewonline.controller

import com.interviewonline.dto.CreateGuestRoomRequest
import com.interviewonline.dto.CreateRoomRequest
import com.interviewonline.dto.RoomResponse
import com.interviewonline.dto.RoomAccessMemberDto
import com.interviewonline.dto.AddRoomTasksRequest
import com.interviewonline.dto.SetVerdictRequest
import com.interviewonline.dto.UpdateRoomParticipantRoleRequest
import com.interviewonline.dto.UpdateRoomTaskRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.RoomService
import jakarta.validation.Valid
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api")
class RoomController(
    private val roomService: RoomService,
    private val authService: AuthService,
) {
    @PostMapping("/public/rooms")
    fun createGuestRoom(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: CreateGuestRoomRequest,
    ): RoomResponse {
        // Quick room from the landing page. We accept an optional Bearer
        // token so an authenticated user creating a "quick" room still gets
        // the room saved into their personal account ("Мои комнаты"),
        // without having to go through the dashboard creation flow.
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.createGuestRoom(request, user)
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
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.nextStep(inviteCode, ownerToken, interviewerToken, user)
    }

    @PostMapping("/rooms/{inviteCode}/tasks")
    fun addRoomTasks(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: AddRoomTasksRequest,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.addTasksToRoom(inviteCode, request, ownerToken, interviewerToken, user, eventToken)
    }

    @PatchMapping("/rooms/{inviteCode}/tasks/{stepIndex}")
    fun updateRoomTask(
        @PathVariable inviteCode: String,
        @PathVariable stepIndex: Int,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: UpdateRoomTaskRequest,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.updateRoomTask(inviteCode, stepIndex, request, ownerToken, interviewerToken, user, eventToken)
    }

    @DeleteMapping("/rooms/{inviteCode}/tasks/{stepIndex}")
    fun deleteRoomTask(
        @PathVariable inviteCode: String,
        @PathVariable stepIndex: Int,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.removeRoomTask(inviteCode, stepIndex, ownerToken, interviewerToken, user, eventToken)
    }

    @GetMapping("/rooms/{inviteCode}/participants")
    fun listRoomParticipants(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
    ): List<RoomAccessMemberDto> {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.listAccessMembers(inviteCode, ownerToken, interviewerToken, user)
    }

    @PostMapping("/rooms/{inviteCode}/participants/{userId}/role")
    fun updateRoomParticipantRole(
        @PathVariable inviteCode: String,
        @PathVariable userId: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: UpdateRoomParticipantRoleRequest,
    ): List<RoomAccessMemberDto> {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.updateParticipantRole(inviteCode, request, userId, ownerToken, interviewerToken, user)
    }

    @PostMapping("/rooms/{inviteCode}/verdict")
    fun setVerdict(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: SetVerdictRequest,
    ): RoomResponse {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        return roomService.setVerdict(inviteCode, request, ownerToken, interviewerToken, user, eventToken)
    }

    @GetMapping("/rooms/{inviteCode}/keystroke-events")
    fun getKeystrokeEvents(
        @PathVariable inviteCode: String,
        @RequestHeader("X-Room-Owner-Token", required = false) ownerToken: String?,
        @RequestHeader("X-Room-Interviewer-Token", required = false) interviewerToken: String?,
        @RequestHeader("X-Room-Event-Token", required = false) eventToken: String?,
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestParam(value = "format", defaultValue = "json") format: String,
    ): Any {
        val authToken = authorization?.removePrefix("Bearer ")?.trim()
        val user = authService.resolveUserByToken(authToken)
        val dtos = roomService.getKeystrokeEvents(inviteCode, ownerToken, interviewerToken, user, eventToken)
        return if (format == "csv") {
            val sb = StringBuilder()
            sb.appendLine("timestamp_epoch_ms,session_id,display_name,event_kind,key_value,key_code,ctrl_key,alt_key,shift_key,meta_key,paste_length,paste_preview")
            dtos.forEach { d ->
                // All user-controlled string fields are wrapped in RFC-4180 quotes
                // (csvQuote) to prevent formula injection and handle special chars.
                // Only boolean/numeric fields that come from server code use csvSafe.
                sb.appendLine(
                    "${d.timestampEpochMs}," +
                    "${csvQuote(d.sessionId)}," +
                    "${csvQuote(d.displayName)}," +
                    "${csvSafe(d.eventKind)}," +
                    "${csvQuote(d.keyValue ?: "")}," +
                    "${csvQuote(d.keyCode ?: "")}," +
                    "${d.ctrlKey},${d.altKey},${d.shiftKey},${d.metaKey}," +
                    "${d.pasteLength ?: ""}," +
                    "${csvQuote(d.pastePreview ?: "")}"
                )
            }
            ResponseEntity.ok()
                .header("Content-Type", "text/csv; charset=utf-8")
                .header("Content-Disposition", "attachment; filename=\"keystrokes-${inviteCode}.csv\"")
                .body(sb.toString())
        } else {
            dtos
        }
    }

    /**
     * Wraps [value] in RFC-4180 double-quotes and escapes any embedded double-quotes
     * by doubling them. Also prefixes cells that start with formula-injection
     * characters (=, +, -, @, TAB, CR) with a single space so spreadsheet programs
     * do not treat the cell as a formula.
     */
    private fun csvQuote(value: String): String {
        val sanitized = sanitizeCsvFormula(value)
        // Escape internal double-quotes (RFC 4180 §2.7)
        val escaped = sanitized.replace("\"", "\"\"")
        return "\"$escaped\""
    }

    /**
     * For unquoted CSV cells (numeric-like fields, known-safe enums): strip newlines
     * and commas, and apply formula prefix sanitization as a belt-and-suspenders guard.
     */
    private fun csvSafe(value: String): String {
        val cleaned = value.replace(",", "").replace("\n", "").replace("\r", "")
        return sanitizeCsvFormula(cleaned)
    }

    /**
     * Prefixes any value that starts with a CSV/spreadsheet formula-injection
     * character with a space so the cell is treated as plain text by Excel,
     * LibreOffice, and Google Sheets (OWASP CSV Injection prevention).
     */
    private fun sanitizeCsvFormula(value: String): String {
        if (value.isEmpty()) return value
        return when (value[0]) {
            '=', '+', '-', '@', '\t', '\r' -> " $value"
            else -> value
        }
    }
}
