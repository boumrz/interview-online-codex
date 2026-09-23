package com.interviewonline.service

import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

@Configuration(proxyBeanMethods = false)
@EnableScheduling
class InvitationRateLimitSchedulingConfiguration

@Component
class InvitationRateLimitBucketCleanup(private val jdbcTemplate: JdbcTemplate) {
    @Scheduled(fixedDelay = 60_000)
    @Transactional
    fun cleanupExpiredBuckets() {
        jdbcTemplate.update(
            """
            DELETE FROM invitation_rate_limit_buckets bucket
            USING (
                SELECT dimension, subject_hash, window_started_at
                FROM invitation_rate_limit_buckets
                WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'
                ORDER BY updated_at
                LIMIT 10000
                FOR UPDATE SKIP LOCKED
            ) stale
            WHERE bucket.dimension=stale.dimension
              AND bucket.subject_hash=stale.subject_hash
              AND bucket.window_started_at=stale.window_started_at
            """.trimIndent(),
        )
    }
}
