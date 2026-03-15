package com.interviewonline.service

import com.interviewonline.model.ReviewDecision
import com.interviewonline.model.ReviewerType

data class ReviewerInput(
    val runId: String,
    val linearIssueId: String,
    val currentState: String,
    val traceId: String,
    val acceptanceCriteria: List<String>,
    val artifactTypes: Set<String>,
)

data class ReviewerOutput(
    val reviewerType: ReviewerType,
    val decision: ReviewDecision,
    val isBlocking: Boolean,
    val summary: String,
    val findings: List<String> = emptyList(),
    val metadata: Map<String, Any?> = emptyMap(),
)

interface IndependentReviewerRuntime {
    val reviewerType: ReviewerType
    fun review(input: ReviewerInput): ReviewerOutput
}
