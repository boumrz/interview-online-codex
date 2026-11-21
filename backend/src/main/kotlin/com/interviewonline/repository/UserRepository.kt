package com.interviewonline.repository

import com.interviewonline.model.User
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant

interface UserRepository : JpaRepository<User, String> {
    fun findByNickname(nickname: String): User?
    fun findAllByOrderByCreatedAtDesc(): List<User>

    @Modifying
    @Query(value = """
        INSERT INTO users(id, nickname, display_name, password_hash, role, is_hr, created_at)
        VALUES (:id, :nickname, :displayName, NULL, 'user', :isHr, :createdAt)
        ON CONFLICT (nickname) DO NOTHING
    """, nativeQuery = true)
    fun insertSocialUserIfAbsent(
        @Param("id") id: String,
        @Param("nickname") nickname: String,
        @Param("displayName") displayName: String,
        @Param("isHr") isHr: Boolean,
        @Param("createdAt") createdAt: Instant
    ): Int

    @Query(value = "SELECT NULLIF(BTRIM(password_hash), '') FROM users WHERE id = :userId", nativeQuery = true)
    fun findLocalPasswordHash(@Param("userId") userId: String): String?

    @Modifying
    @Query(value = """
        UPDATE users SET password_hash = :passwordHash
        WHERE id = :userId AND NULLIF(BTRIM(password_hash), '') IS NULL
    """, nativeQuery = true)
    fun setInitialPassword(@Param("userId") userId: String, @Param("passwordHash") passwordHash: String): Int

    @Query(value = "SELECT * FROM users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("userId") userId: String): User?
}
