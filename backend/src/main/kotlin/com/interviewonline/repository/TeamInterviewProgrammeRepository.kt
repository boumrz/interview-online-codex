package com.interviewonline.repository

import com.interviewonline.model.TeamInterviewProgramme
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface TeamInterviewProgrammeRepository : JpaRepository<TeamInterviewProgramme, String> {
    @Query(
        """
        SELECT DISTINCT p FROM TeamInterviewProgramme p
        LEFT JOIN FETCH p.items i
        LEFT JOIN FETCH i.taskTemplate
        WHERE p.teamId = :teamId AND p.targetType = :targetType AND p.targetId = :targetId
        """,
    )
    fun findByTeamAndTargetWithItems(teamId: String, targetType: String, targetId: String): TeamInterviewProgramme?

    @Query(
        """
        SELECT DISTINCT p FROM TeamInterviewProgramme p
        LEFT JOIN FETCH p.items i
        LEFT JOIN FETCH i.taskTemplate
        WHERE p.teamId = :teamId AND p.targetType = :targetType AND p.targetId IN :targetIds
        """,
    )
    fun findByTeamAndTargetIdsWithItems(
        teamId: String,
        targetType: String,
        targetIds: Collection<String>,
    ): List<TeamInterviewProgramme>
}
