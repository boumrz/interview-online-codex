package com.interviewonline.repository

import com.interviewonline.model.TeamTaskTemplate
import org.springframework.data.jpa.repository.JpaRepository

interface TeamTaskTemplateRepository : JpaRepository<TeamTaskTemplate, String> {
    fun findByTeamIdAndStatusOrderByCreatedAtDescIdAsc(teamId: String, status: String): List<TeamTaskTemplate>
    fun findByTeamIdAndStatusAndLanguageOrderByCreatedAtDescIdAsc(
        teamId: String,
        status: String,
        language: String,
    ): List<TeamTaskTemplate>
    fun countByTeamIdAndStatus(teamId: String, status: String): Long
    fun findByIdAndTeamId(id: String, teamId: String): TeamTaskTemplate?
}
