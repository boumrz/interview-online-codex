package com.interviewonline.service

import com.interviewonline.model.ReviewDecision
import com.interviewonline.model.ReviewerType
import org.springframework.stereotype.Component

@Component
class SolutionReviewerRuntime : IndependentReviewerRuntime {
    override val reviewerType: ReviewerType = ReviewerType.SOLUTION

    override fun review(input: ReviewerInput): ReviewerOutput {
        val findings = mutableListOf<String>()
        if (input.acceptanceCriteria.isEmpty()) {
            findings += "Не зафиксированы acceptance criteria"
        }
        if (!input.artifactTypes.contains("task_envelope")) {
            findings += "Отсутствует task_envelope artifact"
        }

        val decision = if (findings.isEmpty()) ReviewDecision.APPROVE else ReviewDecision.REVISE
        return ReviewerOutput(
            reviewerType = reviewerType,
            decision = decision,
            isBlocking = decision != ReviewDecision.APPROVE,
            summary = if (decision == ReviewDecision.APPROVE) {
                "Solution review passed"
            } else {
                "Solution review requested updates"
            },
            findings = findings,
            metadata = mapOf("runtime" to "solution-isolated"),
        )
    }
}

@Component
class SecurityReliabilityReviewerRuntime : IndependentReviewerRuntime {
    override val reviewerType: ReviewerType = ReviewerType.SECURITY_RELIABILITY

    override fun review(input: ReviewerInput): ReviewerOutput {
        val findings = mutableListOf<String>()
        val hasSecurityArtifact = input.artifactTypes.any { it == "security_verdict" || it == "policy_report" }
        if (!hasSecurityArtifact) {
            findings += "Нет security/policy artifacts"
        }

        val decision = if (findings.isEmpty()) ReviewDecision.APPROVE else ReviewDecision.REVISE
        return ReviewerOutput(
            reviewerType = reviewerType,
            decision = decision,
            isBlocking = true,
            summary = if (decision == ReviewDecision.APPROVE) {
                "Security & reliability checks passed"
            } else {
                "Security & reliability review needs additional evidence"
            },
            findings = findings,
            metadata = mapOf("runtime" to "security-isolated"),
        )
    }
}

@Component
class TestReviewerRuntime : IndependentReviewerRuntime {
    override val reviewerType: ReviewerType = ReviewerType.TEST

    override fun review(input: ReviewerInput): ReviewerOutput {
        val findings = mutableListOf<String>()
        val hasTestArtifacts = input.artifactTypes.any { it == "test_matrix" || it == "chaos_report" }
        if (!hasTestArtifacts) {
            findings += "Нет test matrix / chaos report artifacts"
        }

        val decision = if (findings.isEmpty()) ReviewDecision.APPROVE else ReviewDecision.REVISE
        return ReviewerOutput(
            reviewerType = reviewerType,
            decision = decision,
            isBlocking = decision != ReviewDecision.APPROVE,
            summary = if (decision == ReviewDecision.APPROVE) {
                "Test review passed"
            } else {
                "Test reviewer requested additional coverage"
            },
            findings = findings,
            metadata = mapOf("runtime" to "test-isolated"),
        )
    }
}

@Component
class UxCriticReviewerRuntime : IndependentReviewerRuntime {
    override val reviewerType: ReviewerType = ReviewerType.UX

    override fun review(input: ReviewerInput): ReviewerOutput {
        val findings = mutableListOf<String>()
        val hasUxArtifacts = input.artifactTypes.any { it == "ux_review" || it == "design_spec" }
        if (!hasUxArtifacts) {
            findings += "Нет UX artifacts (ux_review/design_spec)"
        }

        val decision = if (findings.isEmpty()) ReviewDecision.APPROVE else ReviewDecision.REVISE
        return ReviewerOutput(
            reviewerType = reviewerType,
            decision = decision,
            isBlocking = false,
            summary = if (decision == ReviewDecision.APPROVE) {
                "UX critic approved"
            } else {
                "UX critic suggested improvements"
            },
            findings = findings,
            metadata = mapOf("runtime" to "ux-isolated"),
        )
    }
}
