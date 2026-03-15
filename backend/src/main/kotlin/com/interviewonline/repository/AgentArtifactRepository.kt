package com.interviewonline.repository

import com.interviewonline.model.AgentArtifact
import org.springframework.data.jpa.repository.JpaRepository

interface AgentArtifactRepository : JpaRepository<AgentArtifact, String> {
    fun findAllByRun_IdOrderByCreatedAtAsc(runId: String): List<AgentArtifact>
    fun findAllByLinearIssueIdOrderByCreatedAtDesc(linearIssueId: String): List<AgentArtifact>
    fun findAllByLinearIssueIdAndArtifactTypeOrderByCreatedAtDesc(linearIssueId: String, artifactType: String): List<AgentArtifact>
    fun countByRun_Id(runId: String): Long
}
