package com.interviewonline.service

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.AgentReviewVerdictDto
import com.interviewonline.dto.SubmitReviewVerdictRequest
import com.interviewonline.model.ReviewerType
import com.interviewonline.repository.AgentArtifactRepository
import com.interviewonline.repository.AgentTaskRunRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class IndependentReviewerService(
    runtimes: List<IndependentReviewerRuntime>,
    private val runRepository: AgentTaskRunRepository,
    private val artifactRepository: AgentArtifactRepository,
    private val orchestratorService: WorkflowOrchestratorService,
    private val objectMapper: ObjectMapper,
) {
    private val runtimesByType = runtimes.associateBy { it.reviewerType }

    @Transactional
    fun executeReviewer(runId: String, reviewerTypeRaw: String, actor: String): AgentReviewVerdictDto {
        val reviewerType = parseReviewerType(reviewerTypeRaw)
        val runtime = runtimesByType[reviewerType]
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "Reviewer runtime ${reviewerType.name} не найден")
        val input = buildInput(runId)
        val output = runtime.review(input)

        return orchestratorService.submitVerdict(
            runId = runId,
            request = SubmitReviewVerdictRequest(
                reviewerType = output.reviewerType.name,
                decision = output.decision.name,
                summary = output.summary,
                isBlocking = output.isBlocking,
                findings = output.findings,
                metadata = output.metadata + mapOf("independentRuntime" to true),
            ),
            actor = actor,
        )
    }

    @Transactional
    fun executeAll(runId: String, actor: String): List<AgentReviewVerdictDto> {
        return listOf(
            ReviewerType.SOLUTION,
            ReviewerType.SECURITY_RELIABILITY,
            ReviewerType.TEST,
            ReviewerType.UX,
        ).map { type ->
            executeReviewer(runId, type.name, actor)
        }
    }

    private fun buildInput(runId: String): ReviewerInput {
        val run = runRepository.findById(runId).orElseThrow {
            ApiException(HttpStatus.NOT_FOUND, "Agent run не найден")
        }
        val artifactTypes = artifactRepository.findAllByRun_IdOrderByCreatedAtAsc(runId)
            .map { it.artifactType }
            .toSet()

        val acceptanceCriteria = runCatching {
            objectMapper.readValue(run.acceptanceCriteria, object : TypeReference<List<String>>() {})
        }.getOrDefault(emptyList())

        return ReviewerInput(
            runId = run.id!!,
            linearIssueId = run.linearIssueId,
            currentState = run.currentState.name,
            traceId = run.traceId,
            acceptanceCriteria = acceptanceCriteria,
            artifactTypes = artifactTypes,
        )
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
}
