package com.interviewonline.repository

import com.interviewonline.model.TeamAuditEvent
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository

interface TeamAuditEventRepository : JpaRepository<TeamAuditEvent, String> {
    fun findByTeamId(teamId: String, pageable: Pageable): Page<TeamAuditEvent>
}
