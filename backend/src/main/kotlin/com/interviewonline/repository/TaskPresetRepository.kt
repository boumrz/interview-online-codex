package com.interviewonline.repository

import com.interviewonline.model.TaskPreset
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface TaskPresetRepository : JpaRepository<TaskPreset, String> {
    fun findAllByOwnerUserIdOrderByCreatedAtDesc(ownerUserId: String): List<TaskPreset>
    fun findByIdAndOwnerUserId(id: String, ownerUserId: String): TaskPreset?
    fun deleteByIdAndOwnerUserId(id: String, ownerUserId: String): Long
    fun existsByOwnerUserIdAndNameIgnoreCase(ownerUserId: String, name: String): Boolean
    fun existsByOwnerUserIdAndNameIgnoreCaseAndIdNot(ownerUserId: String, name: String, id: String): Boolean

    @Query("""
        SELECT DISTINCT p FROM TaskPreset p
        LEFT JOIN FETCH p.items i
        LEFT JOIN FETCH i.taskTemplate
        WHERE p.id = :id AND p.ownerUser.id = :ownerUserId
    """)
    fun findByIdWithItems(id: String, ownerUserId: String): TaskPreset?
}
