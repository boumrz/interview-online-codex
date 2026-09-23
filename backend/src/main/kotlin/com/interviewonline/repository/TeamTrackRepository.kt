package com.interviewonline.repository

import com.interviewonline.model.TeamTrack
import org.springframework.data.jpa.repository.JpaRepository

interface TeamTrackRepository : JpaRepository<TeamTrack, String> {
    fun findByTeamIdAndStatusOrderByNormalizedNameAscIdAsc(teamId: String, status: String): List<TeamTrack>
    fun findByTeamIdAndIdIn(teamId: String, ids: Collection<String>): List<TeamTrack>
    fun countByTeamIdAndStatus(teamId: String, status: String): Long
    fun existsByTeamIdAndNormalizedNameAndStatus(teamId: String, normalizedName: String, status: String): Boolean
    fun existsByTeamIdAndNormalizedNameAndStatusAndIdNot(teamId: String, normalizedName: String, status: String, id: String): Boolean
    fun findByIdAndTeamId(id: String, teamId: String): TeamTrack?
}
