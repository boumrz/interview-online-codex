package com.interviewonline.repository

import com.interviewonline.model.TeamVacancy
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface TeamVacancyRepository : JpaRepository<TeamVacancy, String> {
    fun findByTrackIdInAndStatusOrderByNormalizedTitleAscIdAsc(trackIds: Collection<String>, status: String): List<TeamVacancy>
    fun findByTrackIdInOrderByNormalizedTitleAscIdAsc(trackIds: Collection<String>): List<TeamVacancy>
    fun findByTeamIdAndStatusOrderByNormalizedTitleAscIdAsc(teamId: String, status: String): List<TeamVacancy>
    fun findByTeamIdAndIdIn(teamId: String, ids: Collection<String>): List<TeamVacancy>
    fun countByTeamIdAndStatus(teamId: String, status: String): Long
    @Query("SELECT COUNT(v) FROM TeamVacancy v, TeamTrack t WHERE v.trackId = t.id AND v.teamId = :teamId AND t.status = 'ACTIVE' AND v.status = :status")
    fun countVisibleByTeamIdAndStatus(teamId: String, status: String): Long
    fun existsByTrackId(trackId: String): Boolean
    fun existsByTrackIdAndNormalizedTitleAndStatus(trackId: String, normalizedTitle: String, status: String): Boolean
    fun existsByTrackIdAndNormalizedTitleAndStatusAndIdNot(trackId: String, normalizedTitle: String, status: String, id: String): Boolean
    fun findByIdAndTeamIdAndTrackId(id: String, teamId: String, trackId: String): TeamVacancy?
}
