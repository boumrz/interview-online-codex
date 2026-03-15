package com.interviewonline.repository

import com.interviewonline.model.AgentTraceEvent
import org.springframework.data.jpa.repository.JpaRepository

interface AgentTraceEventRepository : JpaRepository<AgentTraceEvent, String> {
    fun findAllByRun_IdOrderByCreatedAtAsc(runId: String): List<AgentTraceEvent>
}
