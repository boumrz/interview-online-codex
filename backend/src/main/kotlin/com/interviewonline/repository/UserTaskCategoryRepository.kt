package com.interviewonline.repository

import com.interviewonline.model.UserTaskCategory
import org.springframework.data.jpa.repository.JpaRepository

interface UserTaskCategoryRepository : JpaRepository<UserTaskCategory, String> {
    fun findAllByOwnerUserIdOrderByNameAsc(ownerUserId: String): List<UserTaskCategory>
    fun findByIdAndOwnerUserId(id: String, ownerUserId: String): UserTaskCategory?
    fun findByOwnerUserIdAndNameIgnoreCase(ownerUserId: String, name: String): UserTaskCategory?
}
