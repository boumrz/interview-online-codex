package com.interviewonline.repository

import com.interviewonline.model.Team
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface TeamRepository : JpaRepository<Team, String> {
    fun existsByOwnerUserId(ownerUserId: String): Boolean

    @Query(value = "SELECT * FROM teams WHERE id = :teamId FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("teamId") teamId: String): Team?
}
