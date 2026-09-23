package com.interviewonline.service

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

@Component
class InvitationTransactionGuard(private val jdbcTemplate: JdbcTemplate) {
    fun applyLockTimeout() {
        jdbcTemplate.execute("SET LOCAL lock_timeout = '5s'")
    }
}
