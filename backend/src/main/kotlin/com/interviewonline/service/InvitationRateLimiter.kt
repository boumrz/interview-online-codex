package com.interviewonline.service

import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.dao.DataAccessException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionException
import org.springframework.transaction.support.TransactionTemplate
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit

@Component
class InvitationRateLimiter(
    private val jdbcTemplate: JdbcTemplate,
    transactionManager: PlatformTransactionManager,
) {
    private val requiresNew = TransactionTemplate(transactionManager).apply {
        propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
    }

    fun consumePreview(clientIp: String, actorUserId: String? = null) = consumeDurably(
        buildList {
            add(Dimension.PREVIEW_IP to clientIp)
            actorUserId?.let { add(Dimension.PREVIEW_ACCOUNT to it) }
        },
        PREVIEW_LIMIT,
    )

    fun consumeAccept(clientIp: String, actorUserId: String) = consumeDurably(
        listOf(Dimension.ACCEPT_IP to clientIp, Dimension.ACCEPT_ACCOUNT to actorUserId),
        ACCEPT_LIMIT,
    )

    fun consumeIssueInCurrentTransaction(teamId: String) {
        try {
            consumeInCurrentTransaction(listOf(Dimension.ISSUE_TEAM to teamId), ISSUE_LIMIT)
        } catch (ex: DataAccessException) {
            throw rateLimitUnavailable()
        }
    }

    private fun consumeDurably(subjects: List<Pair<Dimension, String>>, limit: Int) {
        try {
            requiresNew.executeWithoutResult {
                consumeInCurrentTransaction(subjects, limit)
            }
        } catch (ex: DataAccessException) {
            throw rateLimitUnavailable()
        } catch (ex: TransactionException) {
            throw rateLimitUnavailable()
        }
    }

    private fun consumeInCurrentTransaction(subjects: List<Pair<Dimension, String>>, limit: Int) {
        jdbcTemplate.execute("SET LOCAL lock_timeout = '5s'")
        val databaseNow = requireNotNull(jdbcTemplate.queryForObject("SELECT CURRENT_TIMESTAMP", Timestamp::class.java)).toInstant()
        val windowStart = databaseNow.truncatedTo(ChronoUnit.MINUTES)
        subjects.map { (dimension, subject) -> dimension to sha256(subject) }
            .sortedWith(compareBy({ it.first.name }, { it.second }))
            .forEach { (dimension, subjectHash) ->
                val updated = jdbcTemplate.query(
                            """
                            INSERT INTO invitation_rate_limit_buckets
                                (dimension, subject_hash, window_started_at, request_count, updated_at)
                            VALUES (?, ?, ?, 1, ?)
                            ON CONFLICT (dimension, subject_hash)
                            DO UPDATE SET
                                window_started_at = EXCLUDED.window_started_at,
                                request_count = CASE
                                    WHEN invitation_rate_limit_buckets.window_started_at = EXCLUDED.window_started_at
                                    THEN invitation_rate_limit_buckets.request_count + 1
                                    ELSE 1
                                END,
                                updated_at = EXCLUDED.updated_at
                            WHERE invitation_rate_limit_buckets.window_started_at <> EXCLUDED.window_started_at
                               OR invitation_rate_limit_buckets.request_count < ?
                            RETURNING request_count
                            """.trimIndent(),
                            { result, _ -> result.getInt(1) },
                            dimension.name,
                            subjectHash,
                            Timestamp.from(windowStart),
                            Timestamp.from(databaseNow),
                            limit,
                ).firstOrNull()
                if (updated == null) throw rateLimited(databaseNow)
            }
    }

    private fun rateLimited(now: Instant): ApiException {
        val retryAfter = 60 - Math.floorMod(now.epochSecond, 60)
        val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, retryAfter.toString()) }
        return ApiException(
            status = HttpStatus.TOO_MANY_REQUESTS,
            message = "Слишком много запросов. Повторите позже",
            headers = headers,
            code = "RATE_LIMITED",
        )
    }

    private fun rateLimitUnavailable(): ApiException {
        val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, "5") }
        return ApiException(
            status = HttpStatus.SERVICE_UNAVAILABLE,
            message = "Проверка ограничения запросов временно недоступна",
            headers = headers,
            code = "RATE_LIMIT_UNAVAILABLE",
        )
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }

    private enum class Dimension {
        PREVIEW_IP,
        PREVIEW_ACCOUNT,
        ACCEPT_IP,
        ACCEPT_ACCOUNT,
        ISSUE_TEAM,
    }

    companion object {
        private const val PREVIEW_LIMIT = 30
        private const val ACCEPT_LIMIT = 30
        private const val ISSUE_LIMIT = 20
    }
}
