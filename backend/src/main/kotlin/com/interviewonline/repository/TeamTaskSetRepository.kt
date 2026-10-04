package com.interviewonline.repository

import com.interviewonline.model.TeamTaskSet
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface TeamTaskSetRepository : JpaRepository<TeamTaskSet, String> {
    @Query(
        """
        SELECT DISTINCT s FROM TeamTaskSet s
        LEFT JOIN FETCH s.items i
        LEFT JOIN FETCH i.taskTemplate
        WHERE s.teamId = :teamId
        ORDER BY s.createdAt DESC, s.id ASC
        """,
    )
    fun findAllByTeamIdWithItems(teamId: String): List<TeamTaskSet>

    @Query(
        """
        SELECT DISTINCT s FROM TeamTaskSet s
        LEFT JOIN FETCH s.items i
        LEFT JOIN FETCH i.taskTemplate
        WHERE s.id = :id AND s.teamId = :teamId
        """,
    )
    fun findByIdAndTeamIdWithItems(id: String, teamId: String): TeamTaskSet?

    fun countByTeamId(teamId: String): Long
    fun countByTeamIdAndStatus(teamId: String, status: String): Long
    fun existsByTeamIdAndStatusAndNormalizedName(teamId: String, status: String, normalizedName: String): Boolean
    fun existsByTeamIdAndStatusAndNormalizedNameAndIdNot(
        teamId: String,
        status: String,
        normalizedName: String,
        id: String,
    ): Boolean
}
