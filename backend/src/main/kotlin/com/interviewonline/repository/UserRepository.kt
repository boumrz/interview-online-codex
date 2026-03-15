package com.interviewonline.repository

import com.interviewonline.model.User
import org.springframework.data.jpa.repository.JpaRepository

interface UserRepository : JpaRepository<User, String> {
    fun findByNickname(nickname: String): User?
}
