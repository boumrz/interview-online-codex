package com.interviewonline.repository

import com.interviewonline.model.TeamMergePlan
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface TeamMergePlanRepository : JpaRepository<TeamMergePlan, String> {
    fun findAllBySourceTeamIdOrTargetTeamIdOrderByCreatedAtDesc(sourceTeamId: String, targetTeamId: String): List<TeamMergePlan>

    @Query(value = "SELECT id FROM team_merge_plans WHERE id = :planId FOR UPDATE", nativeQuery = true)
    fun lockIdById(@Param("planId") planId: String): String?
}

fun TeamMergePlanRepository.lockById(planId: String): TeamMergePlan? =
    lockIdById(planId)?.let { findById(it).orElse(null) }
