package com.interviewonline.repository

import com.interviewonline.model.UserSession
import org.springframework.data.jpa.repository.JpaRepository

interface UserSessionRepository : JpaRepository<UserSession, String> {
    fun findByToken(token: String): UserSession?
}
