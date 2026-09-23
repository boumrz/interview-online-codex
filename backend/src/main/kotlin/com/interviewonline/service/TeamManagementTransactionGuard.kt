package com.interviewonline.service

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

/** Applies the bounded database wait shared by all P1 team-management commands. */
@Component
class TeamManagementTransactionGuard(private val jdbcTemplate: JdbcTemplate) {
    fun applyLockTimeout() {
        jdbcTemplate.execute("SET LOCAL lock_timeout = '5s'")
    }
}
