package com.interviewonline.repository

import com.interviewonline.model.UserTaskTemplate
import org.springframework.data.jpa.repository.JpaRepository

interface UserTaskTemplateRepository : JpaRepository<UserTaskTemplate, String> {
    fun findAllByOwnerUserIdOrderByCreatedAtDesc(ownerUserId: String): List<UserTaskTemplate>
    fun findAllByOwnerUserIdAndLanguageOrderByCreatedAtAsc(ownerUserId: String, language: String): List<UserTaskTemplate>
    fun findAllByIdInAndOwnerUserId(ids: List<String>, ownerUserId: String): List<UserTaskTemplate>
    fun existsByOwnerUserId(ownerUserId: String): Boolean
    fun findByIdAndOwnerUserId(id: String, ownerUserId: String): UserTaskTemplate?
    fun deleteByIdAndOwnerUserId(id: String, ownerUserId: String): Long
    fun deleteAllByOwnerUserId(ownerUserId: String): Long
}
