package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.interviewonline.dto.CreateTeamRequest
import com.interviewonline.dto.CreateTeamTaskSetRequest
import com.interviewonline.dto.CreateTaskTemplateRequest
import com.interviewonline.dto.ImportPersonalPresetRequest
import com.interviewonline.dto.ImportPersonalTaskRequest
import com.interviewonline.dto.TeamInterviewCreateRequest
import com.interviewonline.dto.TeamInterviewDetailsDto
import com.interviewonline.dto.TeamInterviewDetailsUpdateRequest
import com.interviewonline.dto.TeamInterviewRenameRequest
import com.interviewonline.dto.TeamInterviewListDto
import com.interviewonline.dto.TeamProcessListDto
import com.interviewonline.dto.TeamMergeRedirectDto
import com.interviewonline.dto.TeamInterviewOwnerOfferListDto
import com.interviewonline.dto.TeamInterviewOwnerOfferCreateRequest
import com.interviewonline.dto.TeamInterviewOwnerOfferResponse
import com.interviewonline.dto.TeamInterviewProgrammeDraftRequest
import com.interviewonline.dto.TeamInterviewProgrammePublishRequest
import com.interviewonline.dto.TeamInterviewProgrammeResponse
import com.interviewonline.dto.TeamInterviewProgrammeRevisionRequest
import com.interviewonline.dto.TeamInterviewResponse
import com.interviewonline.dto.TeamCreateResponse
import com.interviewonline.dto.TeamDetailDto
import com.interviewonline.dto.TeamTaskLibraryDto
import com.interviewonline.dto.TeamTaskSetLibraryDto
import com.interviewonline.dto.TeamTaskSetResponse
import com.interviewonline.dto.TeamTaskTemplateResponse
import com.interviewonline.dto.TeamMemberDirectoryDto
import com.interviewonline.dto.TeamMemberLifecycleResponse
import com.interviewonline.dto.TeamMemberRoleRequest
import com.interviewonline.dto.TeamMemberRoleResponse
import com.interviewonline.dto.TeamOwnershipTransferRequest
import com.interviewonline.dto.TeamOwnershipTransferResponse
import com.interviewonline.dto.TeamRenameRequest
import com.interviewonline.dto.TeamRenameResponse
import com.interviewonline.dto.TeamTrackCreateRequest
import com.interviewonline.dto.TeamTrackResponse
import com.interviewonline.dto.TeamTracksDto
import com.interviewonline.dto.TeamTrackUpdateRequest
import com.interviewonline.dto.TeamVacancyCreateRequest
import com.interviewonline.dto.TeamVacancyResponse
import com.interviewonline.dto.TeamVacancyUpdateRequest
import com.interviewonline.dto.UpdateTeamTaskTemplateRequest
import com.interviewonline.dto.UpdateTeamTaskSetRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.ApiException
import com.interviewonline.service.TeamManagementService
import com.interviewonline.service.TeamInterviewService
import com.interviewonline.service.TeamTaskLibraryService
import com.interviewonline.service.TeamTaskSetService
import com.interviewonline.service.TeamTrackService
import com.interviewonline.service.WorkspaceService
import com.interviewonline.service.TeamMemberDirectoryService
import com.interviewonline.service.TeamProcessService
import com.interviewonline.service.TeamMergePlanService
import com.interviewonline.service.secure
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.dao.DataAccessException
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.sql.SQLException

@RestController
@RequestMapping("/api/teams")
class TeamController(
    private val authService: AuthService,
    private val workspaceService: WorkspaceService,
    private val memberDirectoryService: TeamMemberDirectoryService,
    private val processService: TeamProcessService,
    private val mergePlanService: TeamMergePlanService,
    private val teamManagementService: TeamManagementService,
    private val teamInterviewService: TeamInterviewService,
    private val teamTrackService: TeamTrackService,
    private val teamTaskLibraryService: TeamTaskLibraryService,
    private val teamTaskSetService: TeamTaskSetService,
) {
    private val jsonUtf8 = MediaType("application", "json", StandardCharsets.UTF_8)

    @PostMapping
    fun create(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @RequestBody request: CreateTeamRequest,
    ): ResponseEntity<TeamCreateResponse> {
        val actor = requireUser(authorization)
        if (rawKey.isNullOrBlank()) {
            throw secure(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Требуется Idempotency-Key")
        }
        val key = canonicalUuid(rawKey)
            ?: throw secure(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key должен быть UUID")
        val body = workspaceService.createTeam(actor, request.name, key)
        return ResponseEntity.created(URI.create("/api/teams/${body.team.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @GetMapping("/{teamId}")
    fun detail(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
    ): ResponseEntity<TeamDetailDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(workspaceService.teamDetail(requireUser(authorization), teamId))

    @GetMapping("/{teamId}/interviews")
    fun teamInterviews(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("q", required = false) query: String?,
        @RequestParam("ownership", required = false) ownership: String?,
        @RequestParam(required = false) trackId: String?,
        @RequestParam(required = false) vacancyId: String?,
    ): ResponseEntity<TeamInterviewListDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.list(requireUser(authorization), teamId, query, ownership, trackId, vacancyId))

    @GetMapping("/{teamId}/processes")
    fun processes(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
    ): ResponseEntity<TeamProcessListDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(processService.list(requireUser(authorization), teamId))

    @GetMapping("/{teamId}/processes/interviews")
    fun processInterviews(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("trackId", required = false) trackId: String?,
        @RequestParam("vacancyId", required = false) vacancyId: String?,
    ): ResponseEntity<TeamInterviewListDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.listMineByProcess(requireUser(authorization), teamId, trackId, vacancyId))

    @GetMapping("/{teamId}/redirect")
    fun mergedTeamRedirect(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
    ): ResponseEntity<TeamMergeRedirectDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(mergePlanService.redirect(requireUser(authorization), teamId))

    @GetMapping("/{teamId}/interview-owner-offers")
    fun interviewOwnerOffers(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("status", required = false) status: String?,
    ): ResponseEntity<TeamInterviewOwnerOfferListDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.listOwnerOffers(requireUser(authorization), teamId, status))

    @PostMapping("/{teamId}/interviews")
    fun createInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @RequestBody request: TeamInterviewCreateRequest,
    ): ResponseEntity<TeamInterviewResponse> {
        val body = teamInterviewService.create(requireUser(authorization), teamId, request, requireIdempotencyKey(rawKey))
        return ResponseEntity.created(URI.create("/api/teams/$teamId/interviews/${body.interview.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PatchMapping("/{teamId}/interviews/{interviewId}")
    fun renameInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
        @RequestBody request: TeamInterviewRenameRequest,
    ): ResponseEntity<TeamInterviewResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.rename(requireUser(authorization), teamId, interviewId, request))

    @GetMapping("/{teamId}/interviews/{interviewId}/details")
    fun interviewDetails(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
    ): ResponseEntity<TeamInterviewDetailsDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.details(requireUser(authorization), teamId, interviewId))

    @PatchMapping("/{teamId}/interviews/{interviewId}/details")
    fun updateInterviewDetails(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
        @RequestBody body: JsonNode,
    ): ResponseEntity<TeamInterviewDetailsDto> {
        val actor = requireUser(authorization)
        val keys = setOf("title", "candidateName", "position", "scheduledAt", "revision")
        val fields = body.fieldNames().asSequence().toSet()
        if (!body.isObject || !fields.containsAll(keys) || !keys.plus(setOf("context", "interviewerIds")).containsAll(fields)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нужно передать название, все поля метаданных и ревизию")
        }
        val title = body.path("title")
        val revision = body.path("revision")
        if (!title.isTextual) throw ApiException(HttpStatus.BAD_REQUEST, "Название должно быть строкой")
        if (!revision.isIntegralNumber || !revision.canConvertToLong()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная ревизия метаданных")
        }
        fun nullableText(key: String): String? {
            val node = body.path(key)
            if (node.isNull) return null
            if (!node.isTextual) throw ApiException(HttpStatus.BAD_REQUEST, "Поле $key должно быть строкой или null")
            return node.textValue()
        }
        val context = body.get("context")?.let { selection ->
            if (!selection.isObject || selection.fieldNames().asSequence().toSet() != setOf("trackId", "vacancyId")) {
                throw ApiException(HttpStatus.BAD_REQUEST, "Нужно передать трек и вакансию")
            }
            fun nullableId(key: String): String? {
                val value = selection.path(key)
                if (value.isNull) return null
                if (!value.isTextual) throw ApiException(HttpStatus.BAD_REQUEST, "Поле $key должно быть строкой или null")
                return value.textValue()
            }
            com.interviewonline.dto.TeamInterviewContextSelection(nullableId("trackId"), nullableId("vacancyId"))
        }
        val request = TeamInterviewDetailsUpdateRequest(
            title = title.textValue(),
            candidateName = nullableText("candidateName"),
            position = nullableText("position"),
            scheduledAt = nullableText("scheduledAt"),
            revision = revision.longValue(),
            context = context,
            interviewerIds = body.get("interviewerIds")?.let { ids ->
                if (!ids.isArray || ids.any { !it.isTextual }) {
                    throw ApiException(HttpStatus.BAD_REQUEST, "Интервьюеры должны быть списком участников")
                }
                ids.map { it.textValue() }
            },
        )
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(teamInterviewService.updateDetails(actor, teamId, interviewId, request))
    }

    @PostMapping("/{teamId}/interviews/{interviewId}/owner-offers")
    fun createInterviewOwnerOffer(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
        @RequestBody request: TeamInterviewOwnerOfferCreateRequest,
    ): ResponseEntity<TeamInterviewOwnerOfferResponse> {
        val body = teamInterviewService.createOwnerOffer(
            requireUser(authorization),
            teamId,
            interviewId,
            request,
            requireIdempotencyKey(rawKey),
        )
        return ResponseEntity.created(URI.create("/api/teams/$teamId/interviews/$interviewId/owner-offers/${body.offer.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PostMapping("/{teamId}/interviews/{interviewId}/owner-offers/{offerId}/accept")
    fun acceptInterviewOwnerOffer(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
        @PathVariable offerId: String,
    ): ResponseEntity<TeamInterviewOwnerOfferResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.acceptOwnerOffer(requireUser(authorization), teamId, interviewId, offerId))

    @PostMapping("/{teamId}/interviews/{interviewId}/owner-offers/{offerId}/decline")
    fun declineInterviewOwnerOffer(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
        @PathVariable offerId: String,
    ): ResponseEntity<TeamInterviewOwnerOfferResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.declineOwnerOffer(requireUser(authorization), teamId, interviewId, offerId))

    @PostMapping("/{teamId}/interviews/{interviewId}/archive")
    fun archiveInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
    ): ResponseEntity<TeamInterviewResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.archive(requireUser(authorization), teamId, interviewId))

    @DeleteMapping("/{teamId}/interviews/{interviewId}")
    fun deleteInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
    ): ResponseEntity<Void> {
        teamInterviewService.delete(requireUser(authorization), teamId, interviewId)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{teamId}/interviews/{interviewId}/freeze")
    fun freezeInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
    ): ResponseEntity<TeamInterviewResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.freeze(requireUser(authorization), teamId, interviewId))

    @PostMapping("/{teamId}/interviews/{interviewId}/resume")
    fun resumeInterview(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable interviewId: String,
    ): ResponseEntity<TeamInterviewResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamInterviewService.resume(requireUser(authorization), teamId, interviewId))

    @GetMapping("/{teamId}/members")
    fun members(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("page", required = false) page: String?,
        @RequestParam("size", required = false) size: String?,
        @RequestParam("q", required = false) query: String?,
        @RequestParam("state", required = false) state: String?,
    ): ResponseEntity<TeamMemberDirectoryDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(memberDirectoryService.list(requireUser(authorization), teamId, page, size, query, state))

    @GetMapping("/{teamId}/tasks")
    fun teamTasks(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("language", required = false) language: String?,
        @RequestParam("q", required = false) query: String?,
    ): ResponseEntity<TeamTaskLibraryDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTaskLibraryService.list(requireUser(authorization), teamId, language, query))

    @PostMapping("/{teamId}/tasks")
    fun createTeamTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestBody request: CreateTaskTemplateRequest,
    ): ResponseEntity<TeamTaskTemplateResponse> {
        val body = teamTaskLibraryService.create(requireUser(authorization), teamId, request)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/tasks/${body.task.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PostMapping("/{teamId}/tasks/import-personal")
    fun importPersonalTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestBody request: ImportPersonalTaskRequest,
    ): ResponseEntity<TeamTaskTemplateResponse> {
        val body = teamTaskLibraryService.importPersonal(requireUser(authorization), teamId, request.sourceTaskId)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/tasks/${body.task.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PostMapping("/{teamId}/tasks/{taskId}/copy")
    fun copyTeamTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable taskId: String,
    ): ResponseEntity<TeamTaskTemplateResponse> {
        val body = teamTaskLibraryService.copyTeamTask(requireUser(authorization), teamId, taskId)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/tasks/${body.task.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PatchMapping("/{teamId}/tasks/{taskId}")
    fun updateTeamTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable taskId: String,
        @RequestBody request: UpdateTeamTaskTemplateRequest,
    ): ResponseEntity<TeamTaskTemplateResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTaskLibraryService.update(requireUser(authorization), teamId, taskId, request))

    @DeleteMapping("/{teamId}/tasks/{taskId}")
    fun deleteTeamTask(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable taskId: String,
    ): ResponseEntity<Void> {
        teamTaskLibraryService.delete(requireUser(authorization), teamId, taskId)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{teamId}/task-sets")
    fun teamTaskSets(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
    ): ResponseEntity<TeamTaskSetLibraryDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTaskSetService.list(requireUser(authorization), teamId))

    @PostMapping("/{teamId}/task-sets")
    fun createTeamTaskSet(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestBody request: CreateTeamTaskSetRequest,
    ): ResponseEntity<TeamTaskSetResponse> {
        val body = teamTaskSetService.create(requireUser(authorization), teamId, request)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/task-sets/${body.taskSet.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PostMapping("/{teamId}/task-sets/import-personal")
    fun importPersonalPreset(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestBody request: ImportPersonalPresetRequest,
    ): ResponseEntity<TeamTaskSetResponse> {
        val body = teamTaskSetService.importPersonalPreset(requireUser(authorization), teamId, request.sourcePresetId)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/task-sets/${body.taskSet.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PatchMapping("/{teamId}/task-sets/{setId}")
    fun updateTeamTaskSet(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable setId: String,
        @RequestBody request: UpdateTeamTaskSetRequest,
    ): ResponseEntity<TeamTaskSetResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTaskSetService.update(requireUser(authorization), teamId, setId, request))

    @PostMapping("/{teamId}/task-sets/{setId}/copy")
    fun copyTeamTaskSet(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable setId: String,
    ): ResponseEntity<TeamTaskSetResponse> {
        val body = teamTaskSetService.copy(requireUser(authorization), teamId, setId)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/task-sets/${body.taskSet.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @DeleteMapping("/{teamId}/task-sets/{setId}")
    fun deleteTeamTaskSet(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable setId: String,
    ): ResponseEntity<Void> {
        teamTaskSetService.delete(requireUser(authorization), teamId, setId)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{teamId}/tracks")
    fun tracks(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestParam("status", required = false) status: String?,
        @RequestParam("q", required = false) query: String?,
    ): ResponseEntity<TeamTracksDto> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.list(requireUser(authorization), teamId, status, query))

    @PostMapping("/{teamId}/tracks")
    fun createTrack(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @RequestBody request: TeamTrackCreateRequest,
    ): ResponseEntity<TeamTrackResponse> {
        val body = teamTrackService.createTrack(requireUser(authorization), teamId, request.name)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/tracks/${body.track.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies")
    fun createVacancy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamVacancyCreateRequest,
    ): ResponseEntity<TeamVacancyResponse> {
        val body = teamTrackService.createVacancy(requireUser(authorization), teamId, trackId, request.title)
        return ResponseEntity.created(URI.create("/api/teams/$teamId/tracks/$trackId/vacancies/${body.vacancy.id}"))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .contentType(jsonUtf8)
            .body(body)
    }

    @PatchMapping("/{teamId}/tracks/{trackId}")
    fun updateTrack(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamTrackUpdateRequest,
    ): ResponseEntity<TeamTrackResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.updateTrack(requireUser(authorization), teamId, trackId, request.name, request.revision))

    @PostMapping("/{teamId}/tracks/{trackId}/archive")
    fun archiveTrack(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
    ): ResponseEntity<TeamTrackResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.archiveTrack(requireUser(authorization), teamId, trackId))

    @PostMapping("/{teamId}/tracks/{trackId}/restore")
    fun restoreTrack(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
    ): ResponseEntity<TeamTrackResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.restoreTrack(requireUser(authorization), teamId, trackId))

    @DeleteMapping("/{teamId}/tracks/{trackId}")
    fun deleteTrack(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
    ): ResponseEntity<Void> {
        teamTrackService.deleteTrack(requireUser(authorization), teamId, trackId)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{teamId}/tracks/{trackId}/programme")
    fun trackProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.trackProgramme(requireUser(authorization), teamId, trackId))

    @PatchMapping("/{teamId}/tracks/{trackId}/programme/draft")
    fun saveTrackProgrammeDraft(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamInterviewProgrammeDraftRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.saveTrackProgrammeDraft(requireUser(authorization), teamId, trackId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/programme/publish")
    fun publishTrackProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamInterviewProgrammePublishRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.publishTrackProgramme(requireUser(authorization), teamId, trackId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/programme/archive")
    fun archiveTrackProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamInterviewProgrammeRevisionRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.archiveTrackProgramme(requireUser(authorization), teamId, trackId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/programme/restore")
    fun restoreTrackProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @RequestBody request: TeamInterviewProgrammeRevisionRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.restoreTrackProgramme(requireUser(authorization), teamId, trackId, request))

    @GetMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/programme")
    fun vacancyProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.vacancyProgramme(requireUser(authorization), teamId, trackId, vacancyId))

    @PatchMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/programme/draft")
    fun saveVacancyProgrammeDraft(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
        @RequestBody request: TeamInterviewProgrammeDraftRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.saveVacancyProgrammeDraft(requireUser(authorization), teamId, trackId, vacancyId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/programme/publish")
    fun publishVacancyProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
        @RequestBody request: TeamInterviewProgrammePublishRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.publishVacancyProgramme(requireUser(authorization), teamId, trackId, vacancyId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/programme/archive")
    fun archiveVacancyProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
        @RequestBody request: TeamInterviewProgrammeRevisionRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.archiveVacancyProgramme(requireUser(authorization), teamId, trackId, vacancyId, request))

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/programme/restore")
    fun restoreVacancyProgramme(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
        @RequestBody request: TeamInterviewProgrammeRevisionRequest,
    ): ResponseEntity<TeamInterviewProgrammeResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.restoreVacancyProgramme(requireUser(authorization), teamId, trackId, vacancyId, request))

    @PatchMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}")
    fun updateVacancy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
        @RequestBody request: TeamVacancyUpdateRequest,
    ): ResponseEntity<TeamVacancyResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.updateVacancy(requireUser(authorization), teamId, trackId, vacancyId, request.title, request.revision))

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/archive")
    fun archiveVacancy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
    ): ResponseEntity<TeamVacancyResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.archiveVacancy(requireUser(authorization), teamId, trackId, vacancyId))

    @PostMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}/restore")
    fun restoreVacancy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
    ): ResponseEntity<TeamVacancyResponse> = ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        .contentType(jsonUtf8)
        .body(teamTrackService.restoreVacancy(requireUser(authorization), teamId, trackId, vacancyId))

    @DeleteMapping("/{teamId}/tracks/{trackId}/vacancies/{vacancyId}")
    fun deleteVacancy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable teamId: String,
        @PathVariable trackId: String,
        @PathVariable vacancyId: String,
    ): ResponseEntity<Void> {
        teamTrackService.deleteVacancy(requireUser(authorization), teamId, trackId, vacancyId)
        return ResponseEntity.noContent().build()
    }

    @PatchMapping("/{teamId}")
    fun rename(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @RequestBody request: TeamRenameRequest,
    ): ResponseEntity<TeamRenameResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand { teamManagementService.rename(actor, teamId, request.name, request.revision, key) },
        )
    }

    @PatchMapping("/{teamId}/members/{userId}")
    fun updateMemberRole(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable userId: String,
        @RequestBody request: TeamMemberRoleRequest,
    ): ResponseEntity<TeamMemberRoleResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand { teamManagementService.updateRole(actor, teamId, userId, request.role, request.revision, key) },
        )
    }

    @PostMapping("/{teamId}/leave")
    fun leaveTeam(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
    ): ResponseEntity<TeamMemberLifecycleResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand { teamManagementService.leave(actor, teamId, key) },
        )
    }

    @DeleteMapping("/{teamId}/members/{userId}")
    fun removeMember(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable userId: String,
    ): ResponseEntity<TeamMemberLifecycleResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand { teamManagementService.removeMember(actor, teamId, userId, key) },
        )
    }

    @PostMapping("/{teamId}/members/{userId}/resume")
    fun resumeMember(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @PathVariable userId: String,
    ): ResponseEntity<TeamMemberLifecycleResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand { teamManagementService.resumeMember(actor, teamId, userId, key) },
        )
    }

    @PostMapping("/{teamId}/ownership-transfer")
    fun transferOwnership(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestHeader("Idempotency-Key", required = false) rawKey: String?,
        @PathVariable teamId: String,
        @RequestBody request: TeamOwnershipTransferRequest,
    ): ResponseEntity<TeamOwnershipTransferResponse> {
        val actor = requireUser(authorization)
        val key = requireIdempotencyKey(rawKey)
        return ResponseEntity.ok().protectedJson().body(
            managementCommand {
                teamManagementService.transferOwnership(actor, teamId, request.targetUserId, request.revision, key)
            },
        )
    }

    private fun requireUser(authorization: String?) = try {
        authService.requireUserByToken(authorization?.removePrefix("Bearer ")?.trim())
    } catch (ex: ApiException) {
        throw secure(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", ex.message)
    }

    private fun canonicalUuid(raw: String): UUID? {
        val parsed = runCatching { UUID.fromString(raw) }.getOrNull() ?: return null
        return parsed.takeIf { it.toString().equals(raw, ignoreCase = true) }
    }

    private fun requireIdempotencyKey(raw: String?): UUID {
        if (raw.isNullOrBlank()) {
            throw secure(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "Требуется Idempotency-Key")
        }
        return canonicalUuid(raw)
            ?: throw secure(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key должен быть UUID")
    }

    private fun <T> managementCommand(action: () -> T): T = try {
        action()
    } catch (ex: DataAccessException) {
        if (!hasLockTimeout(ex)) throw ex
        val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, "5") }
        throw ApiException(
            status = HttpStatus.SERVICE_UNAVAILABLE,
            message = "Команда временно занята",
            headers = headers,
            code = "TEAM_MANAGEMENT_BUSY",
        )
    }

    private fun hasLockTimeout(error: Throwable): Boolean {
        var current: Throwable? = error
        while (current != null) {
            if (current is SQLException && current.sqlState == "55P03") return true
            current = current.cause
        }
        return false
    }

    private fun <T : ResponseEntity.BodyBuilder> T.protectedJson(): T = apply {
        header(HttpHeaders.CACHE_CONTROL, "private, no-store")
        contentType(jsonUtf8)
    }
}
