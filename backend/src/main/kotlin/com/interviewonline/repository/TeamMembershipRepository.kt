package com.interviewonline.repository

import com.interviewonline.model.TeamMembership
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface TeamMembershipRepository : JpaRepository<TeamMembership, String> {
    fun findByTeamIdAndUserId(teamId: String, userId: String): TeamMembership?

    @Query(value = "SELECT * FROM team_memberships WHERE team_id = :teamId AND user_id = :userId FOR UPDATE", nativeQuery = true)
    fun lockByTeamIdAndUserId(@Param("teamId") teamId: String, @Param("userId") userId: String): TeamMembership?

    fun findByTeamIdAndState(teamId: String, state: String): List<TeamMembership>
    fun existsByTeamIdAndUserIdAndState(teamId: String, userId: String, state: String): Boolean
    fun existsByUserId(userId: String): Boolean

    @Query(
        """
        select membership from TeamMembership membership, Team team
        where membership.teamId = team.id and membership.userId = :userId
          and membership.state = 'ACTIVE' and team.state = 'ACTIVE'
        order by team.normalizedName asc, team.id asc
        """,
    )
    fun findActiveForUser(@Param("userId") userId: String): List<TeamMembership>
}
