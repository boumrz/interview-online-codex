package com.interviewonline.service

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Component
import java.sql.Timestamp
import java.time.Instant
import com.interviewonline.model.CommandReceiptId

@Component
class DatabaseTimeSource(private val jdbcTemplate: JdbcTemplate) {
    fun now(): Instant = runCatching {
        requireNotNull(jdbcTemplate.queryForObject("SELECT clock_timestamp()", Timestamp::class.java)).toInstant()
    }.recoverCatching { failure ->
        if (failure !is DataAccessException) throw failure
        requireNotNull(jdbcTemplate.queryForObject("SELECT CURRENT_TIMESTAMP", Timestamp::class.java)).toInstant()
    }.getOrThrow()

    fun isReceiptActive(id: CommandReceiptId): Boolean = jdbcTemplate.queryForObject(
        """
        SELECT EXISTS (
            SELECT 1 FROM command_receipts
            WHERE actor_user_id=? AND scope_kind=? AND scope_id=? AND operation=? AND idempotency_key=?
              AND expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
        )
        """.trimIndent(),
        Boolean::class.java,
        id.actorUserId,
        id.scopeKind,
        id.scopeId,
        id.operation,
        id.idempotencyKey,
    ) ?: false
}
