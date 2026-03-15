package com.interviewonline.service

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.AgentPolicyGateCheckDto
import com.interviewonline.dto.AgentPolicyGateResultDto
import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.ReviewDecision
import com.interviewonline.model.ReviewerType
import com.interviewonline.repository.AgentArtifactRepository
import com.interviewonline.repository.AgentReviewVerdictRepository
import org.springframework.stereotype.Service

@Service
class PolicyGateService(
    private val verdictRepository: AgentReviewVerdictRepository,
    private val artifactRepository: AgentArtifactRepository,
    private val policyRuleRunnerService: PolicyRuleRunnerService,
    private val objectMapper: ObjectMapper,
) {
    fun evaluate(run: AgentTaskRun): AgentPolicyGateResultDto {
        val rules = policyRuleRunnerService.currentRules()
        val checks = mutableListOf<AgentPolicyGateCheckDto>()

        val acceptanceCriteria = parseAcceptanceCriteria(run.acceptanceCriteria)
        if (rules.requireAcceptanceCriteria) {
            checks += AgentPolicyGateCheckDto(
                id = "acceptance_criteria",
                passed = acceptanceCriteria.isNotEmpty(),
                message = if (acceptanceCriteria.isNotEmpty()) {
                    "Acceptance criteria зафиксированы"
                } else {
                    "Нет acceptance criteria"
                },
            )
        }

        val latestVerdicts = policyRuleRunnerService.requiredVerdicts().map { reviewerType ->
            reviewerType to verdictRepository.findTopByRun_IdAndReviewerTypeOrderByCreatedAtDesc(run.id!!, reviewerType)
        }

        latestVerdicts.forEach { (reviewerType, verdict) ->
            val passed = verdict != null && verdict.decision == ReviewDecision.APPROVE && !verdict.isBlocking
            checks += AgentPolicyGateCheckDto(
                id = "${reviewerType.name.lowercase()}_verdict",
                passed = passed,
                message = if (passed) {
                    "${reviewerType.name} verdict: APPROVE"
                } else {
                    "${reviewerType.name} verdict отсутствует или блокирующий"
                },
            )
        }

        if (rules.requireHumanApproval) {
            checks += AgentPolicyGateCheckDto(
                id = "human_approval",
                passed = !run.requiresHumanApproval || run.humanApproved,
                message = if (!run.requiresHumanApproval || run.humanApproved) {
                    "Human approval подтверждён"
                } else {
                    "Нужен human approval"
                },
            )
        }

        val artifactCount = artifactRepository.countByRun_Id(run.id!!)
        if (rules.requireLinkedArtifacts) {
            checks += AgentPolicyGateCheckDto(
                id = "linked_artifacts",
                passed = artifactCount > 0,
                message = if (artifactCount > 0) {
                    "Найдено артефактов: $artifactCount"
                } else {
                    "Нет связанных артефактов"
                },
            )
        }

        return AgentPolicyGateResultDto(
            passed = checks.all { it.passed },
            checks = checks,
        )
    }

    private fun parseAcceptanceCriteria(raw: String): List<String> {
        return try {
            objectMapper.readValue(raw, object : TypeReference<List<String>>() {})
                .map { it.trim() }
                .filter { it.isNotEmpty() }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
