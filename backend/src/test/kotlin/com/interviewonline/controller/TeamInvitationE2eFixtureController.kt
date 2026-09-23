package com.interviewonline.controller

import com.interviewonline.service.AuthService
import org.springframework.context.annotation.Profile
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Primary
import org.springframework.http.HttpStatus
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.server.ResponseStatusException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.Timestamp
import java.time.Instant
import java.time.Clock
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID

/**
 * Test-runtime-only browser fixture. It is compiled from src/test, additionally
 * profile-gated, and returns the secret exactly once as a fragment URL.
 */
@RestController
@Profile("test")
@RequestMapping("/api/test-fixtures/team-invitations")
class TeamInvitationE2eFixtureController(
    private val authService: AuthService,
    private val jdbcTemplate: JdbcTemplate,
    private val clock: Clock,
) {
    @PostMapping("/management")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    fun management(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: ManagementInvitationFixtureRequest,
    ): ManagementInvitationFixtureResponse {
        val owner = authService.requireUserByToken(authorization?.removePrefix("Bearer "))
        val ownerId = requireNotNull(owner.id)
        if (setOf(ownerId, request.adminUserId, request.memberUserId).size != 3) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Fixture actors must be distinct")
        }
        val persistedOwner = jdbcTemplate.query(
            "SELECT owner_user_id FROM teams WHERE id = ?",
            { resultSet, _ -> resultSet.getString(1) },
            request.teamId,
        ).singleOrNull()
        if (persistedOwner != ownerId) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "Fixture team unavailable")
        }
        val actorCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM users WHERE id IN (?, ?)",
            Long::class.java,
            request.adminUserId,
            request.memberUserId,
        ) ?: 0
        if (actorCount != 2L) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Fixture users unavailable")
        }

        val now = Timestamp.from(clock.instant())
        addMembership(request.teamId, request.adminUserId, "ADMIN", now)
        addMembership(request.teamId, request.memberUserId, "MEMBER", now)
        jdbcTemplate.update(
            "UPDATE teams SET security_revision = security_revision + 1, merge_revision = merge_revision + 1, updated_at = ? WHERE id = ?",
            now,
            request.teamId,
        )
        return ManagementInvitationFixtureResponse(
            teamId = request.teamId,
            owner = FixtureActor(ownerId, "OWNER"),
            admin = FixtureActor(request.adminUserId, "ADMIN"),
            member = FixtureActor(request.memberUserId, "MEMBER"),
        )
    }

    @PostMapping("/expired")
    @ResponseStatus(HttpStatus.CREATED)
    fun expired(
        @RequestHeader("Authorization", required = false) authorization: String?,
        @RequestBody request: ExpiredInvitationFixtureRequest,
    ): Map<String, String> {
        val creator = authService.requireUserByToken(authorization?.removePrefix("Bearer "))
        val teamId = request.teamId
        val secret = ByteArray(32).also(SecureRandom()::nextBytes)
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret)
        jdbcTemplate.update(
            """
            INSERT INTO team_invitations (id, team_id, token_hash, creator_user_id, role, expires_at, state, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'MEMBER', ?, 'PENDING', 0, ?, ?)
            """.trimIndent(),
            UUID.randomUUID().toString(),
            teamId,
            sha256(token),
            creator.id,
            Timestamp.from(clock.instant()),
            Timestamp.from(clock.instant()),
            Timestamp.from(clock.instant()),
        )
        return mapOf("url" to "/join/team#token=$token")
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun addMembership(teamId: String, userId: String, role: String, now: Timestamp) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, ?, ?)
            """.trimIndent(),
            UUID.randomUUID().toString(),
            teamId,
            userId,
            role,
            now,
            now,
        )
    }
}

data class ExpiredInvitationFixtureRequest(val teamId: String)

data class ManagementInvitationFixtureRequest(
    val teamId: String,
    val adminUserId: String,
    val memberUserId: String,
)

data class FixtureActor(val userId: String, val role: String)

data class ManagementInvitationFixtureResponse(
    val teamId: String,
    val owner: FixtureActor,
    val admin: FixtureActor,
    val member: FixtureActor,
)

@Configuration(proxyBeanMethods = false)
@Profile("test")
class TeamInvitationE2eFixtureClockConfig {
    @Bean
    @Primary
    fun e2eInvitationClock(): Clock = Clock.fixed(Instant.parse("2026-09-12T12:00:00Z"), ZoneOffset.UTC)
}
