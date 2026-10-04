package com.interviewonline.repository

import com.interviewonline.model.TeamTaskTemplate
import org.springframework.data.jpa.repository.JpaRepository

interface TeamTaskTemplateRepository : JpaRepository<TeamTaskTemplate, String> {
    fun findByTeamIdOrderByCreatedAtDescIdAsc(teamId: String): List<TeamTaskTemplate>
    fun findByTeamIdAndLanguageOrderByCreatedAtDescIdAsc(
        teamId: String,
        language: String,
    ): List<TeamTaskTemplate>
    fun countByTeamId(teamId: String): Long
    fun countByTeamIdAndStatus(teamId: String, status: String): Long
    fun findByIdAndTeamId(id: String, teamId: String): TeamTaskTemplate?
}
