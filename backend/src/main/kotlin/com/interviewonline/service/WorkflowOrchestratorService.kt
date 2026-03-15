package com.interviewonline.service

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.config.AgentProperties
import com.interviewonline.dto.AgentArtifactDto
import com.interviewonline.dto.AgentPolicyGateResultDto
import com.interviewonline.dto.AgentReviewVerdictDto
import com.interviewonline.dto.AgentRunResponse
import com.interviewonline.dto.AgentRunTransitionRequest
import com.interviewonline.dto.AgentTraceEventDto
import com.interviewonline.dto.SaveAgentArtifactRequest
import com.interviewonline.dto.StartAgentRunRequest
import com.interviewonline.dto.SubmitReviewVerdictRequest
import com.interviewonline.model.AgentArtifact
import com.interviewonline.model.AgentReviewVerdict
import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.ReviewDecision
import com.interviewonline.model.ReviewerType
import com.interviewonline.model.WorkflowState
import com.interviewonline.model.WorkflowStateMachine
import com.interviewonline.repository.AgentArtifactRepository
import com.interviewonline.repository.AgentReviewVerdictRepository
import com.interviewonline.repository.AgentTaskRunRepository
import com.interviewonline.repository.AgentTraceEventRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

@Service
class WorkflowOrchestratorService(
    private val runRepository: AgentTaskRunRepository,
    private val artifactRepository: AgentArtifactRepository,
    private val verdictRepository: AgentReviewVerdictRepository,
    private val traceEventRepository: AgentTraceEventRepository,
    workflowProviders: List<WorkflowProvider>,
    private val policyGateService: PolicyGateService,
    private val telemetryService: AgentTelemetryService,
    private val linearSyncService: LinearSyncService,
    private val agentProperties: AgentProperties,
    private val objectMapper: ObjectMapper,
) {
    private val providersByName = workflowProviders.associateBy { it.providerName }

    fun listProviders(): List<String> {
        return providersByName.keys.sorted()
    }

    @Transactional
    fun startRun(request: StartAgentRunRequest, actor: String): AgentRunResponse {
        val linearIssueId = request.linearIssueId.trim().uppercase()
        validateIssueId(linearIssueId)

        val provider = normalizeProvider(request.workflowProvider)
        val now = Instant.now()
        val run = runRepository.save(
            AgentTaskRun(
                linearIssueId = linearIssueId,
                workflowProvider = provider,
                workflowName = request.workflowName?.trim()?.ifBlank { null } ?: agentProperties.defaultWorkflowName,
                currentState = WorkflowState.READY,
                requiresHumanApproval = request.requiresHumanApproval,
                humanApproved = false,
                retryCount = 0,
                maxRetries = request.maxRetries.coerceIn(0, 10),
                timeoutSeconds = request.timeoutSeconds.coerceIn(60, 86_400),
                assignedRole = request.assignedRole?.trim()?.ifBlank { null },
                traceId = "trace_${UUID.randomUUID()}",
                acceptanceCriteria = objectMapper.writeValueAsString(
                    request.acceptanceCriteria.map { it.trim() }.filter { it.isNotBlank() },
                ),
                contextPayload = objectMapper.writeValueAsString(request.context),
                createdBy = actor,
                createdAt = now,
                updatedAt = now,
            ),
        )

        val providerDispatch = resolveProvider(run.workflowProvider).start(run)
        saveArtifact(
            run = run,
            type = "provider_dispatch",
            key = "start",
            payload = mapOf(
                "accepted" to providerDispatch.accepted,
                "externalRunId" to providerDispatch.externalRunId,
                "metadata" to providerDispatch.metadata,
            ),
            actor = actor,
        )

        saveArtifact(
            run = run,
            type = "task_envelope",
            key = "run_start",
            payload = mapOf(
                "workflowProvider" to provider,
                "workflowName" to run.workflowName,
                "state" to run.currentState.name,
                "acceptanceCriteria" to parseList(run.acceptanceCriteria),
                "context" to parseMap(run.contextPayload),
            ),
            actor = actor,
        )

        telemetryService.record(
            run = run,
            eventType = "run_started",
            spanName = "workflow.start",
            payload = mapOf(
                "provider" to provider,
                "state" to run.currentState.name,
                "providerDispatchId" to providerDispatch.externalRunId,
            ),
        )
        linearSyncService.syncState(linearIssueId, run.currentState, run.traceId, "run started")

        return toRunResponse(run)
    }

    @Transactional
    fun transition(runId: String, request: AgentRunTransitionRequest, actor: String): AgentRunResponse {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        val targetState = parseWorkflowState(request.targetState)

        if (run.currentState == targetState) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Run уже находится в состоянии ${targetState.name}")
        }

        if (!WorkflowStateMachine.canTransition(run.currentState, targetState)) {
            val allowed = WorkflowStateMachine.allowedTargets(run.currentState).joinToString(",") { it.name }
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "Недопустимый переход ${run.currentState.name} -> ${targetState.name}. Разрешено: $allowed",
            )
        }

        if (request.humanApproved) {
            run.humanApproved = true
        }

        if (run.requiresHumanApproval && (targetState == WorkflowState.QA || targetState == WorkflowState.DONE) && !run.humanApproved) {
            throw ApiException(HttpStatus.PRECONDITION_FAILED, "Нужен human approval для перехода в ${targetState.name}")
        }

        if (targetState == WorkflowState.QA || targetState == WorkflowState.DONE) {
            val gateResult = policyGateService.evaluate(run)
            if (!gateResult.passed) {
                saveArtifact(
                    run = run,
                    type = "policy_report",
                    key = "gate_block_${targetState.name.lowercase()}",
                    payload = mapOf(
                        "targetState" to targetState.name,
                        "result" to mapOf(
                            "passed" to gateResult.passed,
                            "checks" to gateResult.checks,
                        ),
                    ),
                    actor = actor,
                )
                throw ApiException(HttpStatus.PRECONDITION_FAILED, "Policy gate не пройден: ${gateResult.checks.filterNot { it.passed }.joinToString { it.id }}")
            }
        }

        val previousState = run.currentState
        run.currentState = targetState
        run.lastHandoffReason = request.handoffReason?.trim()?.ifBlank { null }
        run.lastError = request.errorMessage?.trim()?.ifBlank { null }
        run.assignedRole = request.actorRole?.trim()?.ifBlank { null } ?: run.assignedRole

        if (targetState == WorkflowState.BLOCKED && !run.lastError.isNullOrBlank() && run.retryCount < run.maxRetries) {
            run.retryCount += 1
        }

        run.updatedAt = Instant.now()
        val saved = runRepository.save(run)

        val providerDispatch = resolveProvider(saved.workflowProvider).transition(saved, previousState, targetState)

        saveArtifact(
            run = saved,
            type = "state_transition",
            key = "${previousState.name.lowercase()}_${targetState.name.lowercase()}",
            payload = mapOf(
                "from" to previousState.name,
                "to" to targetState.name,
                "handoffReason" to saved.lastHandoffReason,
                "errorMessage" to saved.lastError,
                "retryCount" to saved.retryCount,
            ),
            actor = actor,
        )
        saveArtifact(
            run = saved,
            type = "provider_dispatch",
            key = "transition",
            payload = mapOf(
                "accepted" to providerDispatch.accepted,
                "externalRunId" to providerDispatch.externalRunId,
                "metadata" to providerDispatch.metadata,
            ),
            actor = actor,
        )

        telemetryService.record(
            run = saved,
            eventType = "state_transition",
            spanName = "workflow.transition",
            payload = mapOf(
                "from" to previousState.name,
                "to" to targetState.name,
                "retryCount" to saved.retryCount,
                "providerExternalRunId" to providerDispatch.externalRunId,
            ),
        )

        linearSyncService.syncState(
            issueIdentifier = saved.linearIssueId,
            state = saved.currentState,
            traceId = saved.traceId,
            reason = saved.lastHandoffReason,
        )

        return toRunResponse(saved)
    }

    @Transactional
    fun submitVerdict(runId: String, request: SubmitReviewVerdictRequest, actor: String): AgentReviewVerdictDto {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }

        val reviewerType = parseReviewerType(request.reviewerType)
        val decision = parseDecision(request.decision)

        val verdict = verdictRepository.save(
            AgentReviewVerdict(
                run = run,
                linearIssueId = run.linearIssueId,
                reviewerType = reviewerType,
                decision = decision,
                isBlocking = request.isBlocking ?: (decision != ReviewDecision.APPROVE),
                summary = request.summary.trim(),
                payload = objectMapper.writeValueAsString(
                    mapOf(
                        "findings" to request.findings,
                        "metadata" to request.metadata,
                    ),
                ),
                createdBy = actor,
                createdAt = Instant.now(),
            ),
        )

        saveArtifact(
            run = run,
            type = "review_verdict",
            key = reviewerType.name.lowercase(),
            payload = mapOf(
                "reviewerType" to reviewerType.name,
                "decision" to decision.name,
                "isBlocking" to verdict.isBlocking,
                "summary" to verdict.summary,
            ),
            actor = actor,
        )

        telemetryService.record(
            run = run,
            eventType = "verdict_submitted",
            spanName = "reviewer.${reviewerType.name.lowercase()}",
            payload = mapOf(
                "decision" to decision.name,
                "isBlocking" to verdict.isBlocking,
            ),
        )

        linearSyncService.publishVerdict(
            issueIdentifier = run.linearIssueId,
            reviewerType = reviewerType,
            decision = decision,
            summary = verdict.summary,
            traceId = run.traceId,
        )

        return verdict.toDto()
    }

    @Transactional
    fun saveArtifact(runId: String, request: SaveAgentArtifactRequest, actor: String): AgentArtifactDto {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        val saved = saveArtifact(
            run = run,
            type = request.type.trim().lowercase(),
            key = request.key?.trim()?.ifBlank { null },
            payload = request.payload,
            schemaVersion = request.schemaVersion.ifBlank { "v1" },
            actor = actor,
        )

        telemetryService.record(
            run = run,
            eventType = "artifact_saved",
            spanName = "artifact.${saved.artifactType}",
            payload = mapOf(
                "artifactId" to saved.id,
                "artifactType" to saved.artifactType,
            ),
        )

        return saved.toDto()
    }

    @Transactional(readOnly = true)
    fun getRun(runId: String): AgentRunResponse {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        return toRunResponse(run)
    }

    @Transactional(readOnly = true)
    fun listRunsByIssue(linearIssueId: String): List<AgentRunResponse> {
        val issueId = linearIssueId.trim().uppercase()
        validateIssueId(issueId)
        return runRepository.findAllByLinearIssueIdOrderByCreatedAtDesc(issueId).map { toRunResponse(it) }
    }

    @Transactional(readOnly = true)
    fun listArtifactsByIssue(linearIssueId: String, type: String?): List<AgentArtifactDto> {
        val issueId = linearIssueId.trim().uppercase()
        validateIssueId(issueId)
        val artifacts = if (type.isNullOrBlank()) {
            artifactRepository.findAllByLinearIssueIdOrderByCreatedAtDesc(issueId)
        } else {
            artifactRepository.findAllByLinearIssueIdAndArtifactTypeOrderByCreatedAtDesc(issueId, type.trim().lowercase())
        }
        return artifacts.map { it.toDto() }
    }

    @Transactional(readOnly = true)
    fun evaluatePolicy(runId: String): AgentPolicyGateResultDto {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        return policyGateService.evaluate(run)
    }

    @Transactional(readOnly = true)
    fun listTraceEvents(runId: String): List<AgentTraceEventDto> {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        return traceEventRepository.findAllByRun_IdOrderByCreatedAtAsc(run.id!!).map { event ->
            AgentTraceEventDto(
                id = event.id!!,
                eventType = event.eventType,
                spanName = event.spanName,
                traceId = event.traceId,
                payload = parseMap(event.payload),
                createdAt = DateTimeFormatter.ISO_INSTANT.format(event.createdAt),
            )
        }
    }

    private fun toRunResponse(run: AgentTaskRun): AgentRunResponse {
        val artifacts = artifactRepository.findAllByRun_IdOrderByCreatedAtAsc(run.id!!).map { it.toDto() }
        val verdicts = verdictRepository.findAllByRun_IdOrderByCreatedAtAsc(run.id!!).map { it.toDto() }
        return AgentRunResponse(
            id = run.id!!,
            linearIssueId = run.linearIssueId,
            workflowProvider = run.workflowProvider,
            workflowName = run.workflowName,
            currentState = run.currentState.name,
            allowedTransitions = WorkflowStateMachine.allowedTargets(run.currentState).map { it.name },
            traceId = run.traceId,
            requiresHumanApproval = run.requiresHumanApproval,
            humanApproved = run.humanApproved,
            retryCount = run.retryCount,
            maxRetries = run.maxRetries,
            timeoutSeconds = run.timeoutSeconds,
            assignedRole = run.assignedRole,
            lastHandoffReason = run.lastHandoffReason,
            lastError = run.lastError,
            createdBy = run.createdBy,
            createdAt = DateTimeFormatter.ISO_INSTANT.format(run.createdAt),
            updatedAt = DateTimeFormatter.ISO_INSTANT.format(run.updatedAt),
            acceptanceCriteria = parseList(run.acceptanceCriteria),
            artifacts = artifacts,
            verdicts = verdicts,
        )
    }

    private fun saveArtifact(
        run: AgentTaskRun,
        type: String,
        key: String? = null,
        payload: Any = emptyMap<String, Any>(),
        schemaVersion: String = "v1",
        actor: String,
    ): AgentArtifact {
        return artifactRepository.save(
            AgentArtifact(
                run = run,
                linearIssueId = run.linearIssueId,
                artifactType = type,
                artifactKey = key,
                schemaVersion = schemaVersion,
                payload = objectMapper.writeValueAsString(payload),
                createdBy = actor,
                createdAt = Instant.now(),
            ),
        )
    }

    private fun AgentArtifact.toDto(): AgentArtifactDto {
        return AgentArtifactDto(
            id = id!!,
            type = artifactType,
            key = artifactKey,
            schemaVersion = schemaVersion,
            payload = parseMap(payload),
            createdBy = createdBy,
            createdAt = DateTimeFormatter.ISO_INSTANT.format(createdAt),
        )
    }

    private fun AgentReviewVerdict.toDto(): AgentReviewVerdictDto {
        return AgentReviewVerdictDto(
            id = id!!,
            reviewerType = reviewerType.name,
            decision = decision.name,
            isBlocking = isBlocking,
            summary = summary,
            payload = parseMap(payload),
            createdBy = createdBy,
            createdAt = DateTimeFormatter.ISO_INSTANT.format(createdAt),
        )
    }

    private fun parseMap(raw: String): Map<String, Any?> {
        return runCatching {
            objectMapper.readValue(raw, object : TypeReference<Map<String, Any?>>() {})
        }.getOrDefault(emptyMap())
    }

    private fun parseList(raw: String): List<String> {
        return runCatching {
            objectMapper.readValue(raw, object : TypeReference<List<String>>() {})
        }.getOrDefault(emptyList())
    }

    private fun parseWorkflowState(raw: String): WorkflowState {
        return runCatching {
            WorkflowState.valueOf(raw.trim().uppercase())
        }.getOrElse {
            throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный workflow state: $raw")
        }
    }

    private fun parseReviewerType(raw: String): ReviewerType {
        return when (raw.trim().uppercase()) {
            "SOLUTION", "SOLUTION_REVIEWER" -> ReviewerType.SOLUTION
            "SECURITY", "SECURITY_RELIABILITY", "SECURITY_AND_RELIABILITY" -> ReviewerType.SECURITY_RELIABILITY
            "TEST", "QA", "TEST_REVIEWER" -> ReviewerType.TEST
            "UX", "UX_CRITIC" -> ReviewerType.UX
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный reviewerType: $raw")
        }
    }

    private fun parseDecision(raw: String): ReviewDecision {
        return runCatching {
            ReviewDecision.valueOf(raw.trim().uppercase())
        }.getOrElse {
            throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный review decision: $raw")
        }
    }

    private fun normalizeProvider(raw: String?): String {
        val provider = raw?.trim()?.lowercase()?.ifBlank { null } ?: agentProperties.defaultProvider.lowercase()
        return when (provider) {
            "temporal", "langgraph" -> provider
            else -> throw ApiException(HttpStatus.BAD_REQUEST, "Поддерживаются только providers: temporal, langgraph")
        }
    }

    private fun resolveProvider(providerName: String): WorkflowProvider {
        return providersByName[providerName]
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "Workflow provider '$providerName' не зарегистрирован")
    }

    private fun validateIssueId(issueId: String) {
        val isValid = issueId.matches(Regex("^[A-Z]+-\\d+$"))
        if (!isValid) {
            throw ApiException(HttpStatus.BAD_REQUEST, "linearIssueId обязателен и должен быть в формате KEY-123")
        }
    }
}
