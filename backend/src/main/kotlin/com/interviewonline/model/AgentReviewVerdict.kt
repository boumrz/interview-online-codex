package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import java.time.Instant

enum class ReviewerType {
    SOLUTION,
    SECURITY_RELIABILITY,
    TEST,
    UX,
}

enum class ReviewDecision {
    APPROVE,
    REVISE,
    REJECT,
}

@Entity
@Table(name = "agent_review_verdicts")
class AgentReviewVerdict(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "run_id")
    var run: AgentTaskRun? = null,

    @Column(name = "linear_issue_id", nullable = false)
    var linearIssueId: String = "",

    @Enumerated(EnumType.STRING)
    @Column(name = "reviewer_type", nullable = false)
    var reviewerType: ReviewerType = ReviewerType.SOLUTION,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var decision: ReviewDecision = ReviewDecision.REVISE,

    @Column(name = "is_blocking", nullable = false)
    var isBlocking: Boolean = true,

    @Column(nullable = false, columnDefinition = "TEXT")
    var summary: String = "",

    @Column(name = "payload", nullable = false, columnDefinition = "jsonb")
    var payload: String = "{}",

    @Column(name = "created_by", nullable = false)
    var createdBy: String = "system",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
