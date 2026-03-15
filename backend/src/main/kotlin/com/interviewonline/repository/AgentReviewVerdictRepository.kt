package com.interviewonline.repository

import com.interviewonline.model.AgentReviewVerdict
import com.interviewonline.model.ReviewerType
import org.springframework.data.jpa.repository.JpaRepository

interface AgentReviewVerdictRepository : JpaRepository<AgentReviewVerdict, String> {
    fun findAllByRun_IdOrderByCreatedAtAsc(runId: String): List<AgentReviewVerdict>
    fun findTopByRun_IdAndReviewerTypeOrderByCreatedAtDesc(runId: String, reviewerType: ReviewerType): AgentReviewVerdict?
}
