package com.interviewonline.repository

import com.interviewonline.model.AgentTaskRun
import org.springframework.data.jpa.repository.JpaRepository

interface AgentTaskRunRepository : JpaRepository<AgentTaskRun, String> {
    fun findAllByLinearIssueIdOrderByCreatedAtDesc(linearIssueId: String): List<AgentTaskRun>
}
