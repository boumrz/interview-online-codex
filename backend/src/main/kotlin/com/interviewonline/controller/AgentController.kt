package com.interviewonline.controller

import com.interviewonline.dto.AgentPolicyGateResultDto
import com.interviewonline.dto.AgentReviewVerdictDto
import com.interviewonline.dto.AgentRunResponse
import com.interviewonline.dto.AgentRunTransitionRequest
import com.interviewonline.dto.AgentTraceEventDto
import com.interviewonline.dto.EnvironmentDoctorReportDto
import com.interviewonline.dto.RealtimeFaultProfileRequest
import com.interviewonline.dto.SaveAgentArtifactRequest
import com.interviewonline.dto.StartAgentRunRequest
import com.interviewonline.dto.SubmitReviewVerdictRequest
import com.interviewonline.service.AuthService
import com.interviewonline.service.EnvironmentDoctorService
import com.interviewonline.service.IndependentReviewerService
import com.interviewonline.service.RealtimeFaultInjectionService
import com.interviewonline.service.WorkflowOrchestratorService
import org.springframework.web.bind.annotation.DeleteMapping
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/agent")
class AgentController(
    private val authService: AuthService,
    private val orchestratorService: WorkflowOrchestratorService,
    private val independentReviewerService: IndependentReviewerService,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val environmentDoctorService: EnvironmentDoctorService,
) {
    @GetMapping("/providers")
    fun listProviders(): List<String> {
        return orchestratorService.listProviders()
    }

    @PostMapping("/runs")
    fun startRun(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @Valid @RequestBody request: StartAgentRunRequest,
    ): AgentRunResponse {
        val actor = resolveActor(authorization)
        return orchestratorService.startRun(request, actor)
    }

    @PostMapping("/runs/{runId}/transition")
    fun transitionRun(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
        @Valid @RequestBody request: AgentRunTransitionRequest,
    ): AgentRunResponse {
        val actor = resolveActor(authorization)
        return orchestratorService.transition(runId, request, actor)
    }

    @PostMapping("/runs/{runId}/verdicts")
    fun submitVerdict(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
        @Valid @RequestBody request: SubmitReviewVerdictRequest,
    ): AgentReviewVerdictDto {
        val actor = resolveActor(authorization)
        return orchestratorService.submitVerdict(runId, request, actor)
    }

    @PostMapping("/runs/{runId}/reviewers/{reviewerType}/execute")
    fun executeReviewer(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
        @PathVariable reviewerType: String,
    ): AgentReviewVerdictDto {
        val actor = resolveActor(authorization)
        return independentReviewerService.executeReviewer(runId, reviewerType, actor)
    }

    @PostMapping("/runs/{runId}/reviewers/execute-all")
    fun executeAllReviewers(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
    ): List<AgentReviewVerdictDto> {
        val actor = resolveActor(authorization)
        return independentReviewerService.executeAll(runId, actor)
    }

    @PostMapping("/runs/{runId}/artifacts")
    fun saveArtifact(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
        @Valid @RequestBody request: SaveAgentArtifactRequest,
    ) = orchestratorService.saveArtifact(runId, request, resolveActor(authorization))

    @GetMapping("/runs/{runId}")
    fun getRun(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
    ): AgentRunResponse {
        resolveActor(authorization)
        return orchestratorService.getRun(runId)
    }

    @GetMapping("/issues/{linearIssueId}/runs")
    fun listRunsByIssue(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable linearIssueId: String,
    ): List<AgentRunResponse> {
        resolveActor(authorization)
        return orchestratorService.listRunsByIssue(linearIssueId)
    }

    @GetMapping("/issues/{linearIssueId}/artifacts")
    fun listArtifactsByIssue(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable linearIssueId: String,
        @RequestParam(required = false) type: String?,
    ) = orchestratorService.listArtifactsByIssue(linearIssueId, type)

    @GetMapping("/runs/{runId}/policy")
    fun evaluatePolicy(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
    ): AgentPolicyGateResultDto {
        resolveActor(authorization)
        return orchestratorService.evaluatePolicy(runId)
    }

    @GetMapping("/runs/{runId}/trace")
    fun listTraceEvents(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable runId: String,
    ): List<AgentTraceEventDto> {
        resolveActor(authorization)
        return orchestratorService.listTraceEvents(runId)
    }

    @GetMapping("/environment/doctor")
    fun runEnvironmentDoctor(): EnvironmentDoctorReportDto {
        return environmentDoctorService.run()
    }

    @PostMapping("/realtime/faults/{inviteCode}")
    fun configureRealtimeFaults(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable inviteCode: String,
        @RequestBody request: RealtimeFaultProfileRequest,
    ): Map<String, Any> {
        resolveActor(authorization)
        val profile = realtimeFaultInjectionService.setProfile(
            inviteCode = inviteCode,
            profile = RealtimeFaultInjectionService.FaultProfile(
                latencyMs = request.latencyMs,
                dropEveryNthMessage = request.dropEveryNthMessage,
            ),
        )
        return mapOf(
            "inviteCode" to inviteCode,
            "latencyMs" to profile.latencyMs,
            "dropEveryNthMessage" to profile.dropEveryNthMessage,
            "status" to "configured",
        )
    }

    @DeleteMapping("/realtime/faults/{inviteCode}")
    fun clearRealtimeFaults(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @PathVariable inviteCode: String,
    ): Map<String, String> {
        resolveActor(authorization)
        realtimeFaultInjectionService.clearProfile(inviteCode)
        return mapOf("status" to "cleared", "inviteCode" to inviteCode)
    }

    private fun resolveActor(authorization: String?): String {
        val token = authorization?.removePrefix("Bearer ")?.trim()
        return authService.requireUserByToken(token).nickname
    }
}
