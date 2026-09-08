package com.interviewonline.repository

import com.interviewonline.model.User
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface UserRepository : JpaRepository<User, String> {
    fun findByNickname(nickname: String): User?
    fun findAllByOrderByCreatedAtDesc(): List<User>

    @Query(value = "SELECT * FROM users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("userId") userId: String): User?
}
