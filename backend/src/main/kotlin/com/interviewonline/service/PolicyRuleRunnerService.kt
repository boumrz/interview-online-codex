package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.ReviewerType
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Service

@Service
class PolicyRuleRunnerService(
    private val objectMapper: ObjectMapper,
) {
    private val defaultRules = PolicyRules(
        requireAcceptanceCriteria = true,
        requireLinkedArtifacts = true,
        requireHumanApproval = true,
        requiredVerdicts = listOf(
            ReviewerType.SOLUTION.name,
            ReviewerType.SECURITY_RELIABILITY.name,
            ReviewerType.TEST.name,
        ),
    )

    private val configuredRules: PolicyRules by lazy {
        val resource = ClassPathResource("policy-gates.json")
        if (!resource.exists()) return@lazy defaultRules

        runCatching {
            resource.inputStream.use { input ->
                objectMapper.readValue(input, PolicyRules::class.java)
            }
        }.getOrElse {
            defaultRules
        }
    }

    fun currentRules(): PolicyRules {
        return configuredRules
    }

    fun requiredVerdicts(): Set<ReviewerType> {
        return configuredRules.requiredVerdicts.mapNotNull { raw ->
            runCatching { ReviewerType.valueOf(raw.trim().uppercase()) }.getOrNull()
        }.toSet()
    }
}

data class PolicyRules(
    val requireAcceptanceCriteria: Boolean = true,
    val requireLinkedArtifacts: Boolean = true,
    val requireHumanApproval: Boolean = true,
    val requiredVerdicts: List<String> = emptyList(),
)
