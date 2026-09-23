package com.interviewonline.repository

import com.interviewonline.model.TeamInvitation
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface TeamInvitationRepository : JpaRepository<TeamInvitation, String> {
    fun findByTokenHash(tokenHash: String): TeamInvitation?
    fun findByTeamIdOrderByCreatedAtDescIdDesc(teamId: String): List<TeamInvitation>
    fun existsByIdAndTeamId(id: String, teamId: String): Boolean

    @Query(value = "SELECT team_id FROM team_invitations WHERE token_hash = :tokenHash", nativeQuery = true)
    fun findTeamIdByTokenHash(@Param("tokenHash") tokenHash: String): String?

    @Query(value = "SELECT team_id FROM team_invitations WHERE id = :invitationId", nativeQuery = true)
    fun findTeamIdById(@Param("invitationId") invitationId: String): String?

    @Query(value = "SELECT * FROM team_invitations WHERE token_hash = :tokenHash FOR UPDATE", nativeQuery = true)
    fun lockByTokenHash(@Param("tokenHash") tokenHash: String): TeamInvitation?

    @Query(
        value = "SELECT * FROM team_invitations WHERE id = :invitationId AND team_id = :teamId FOR UPDATE",
        nativeQuery = true,
    )
    fun lockByIdAndTeamId(
        @Param("invitationId") invitationId: String,
        @Param("teamId") teamId: String,
    ): TeamInvitation?

    @Query(
        value = "SELECT * FROM team_invitations WHERE id = :invitationId AND team_id = :teamId FOR UPDATE SKIP LOCKED",
        nativeQuery = true,
    )
    fun lockByIdAndTeamIdSkipLocked(
        @Param("invitationId") invitationId: String,
        @Param("teamId") teamId: String,
    ): TeamInvitation?

    @Query(
        value = """
            SELECT id FROM team_invitations
            WHERE state = 'PENDING'
              AND expires_at <= CURRENT_TIMESTAMP
              AND recoverable_token_envelope IS NOT NULL
              AND recovery_key_version IS NOT NULL
            ORDER BY expires_at ASC, id ASC
            LIMIT :limit
        """,
        nativeQuery = true,
    )
    fun findExpiredCandidateIds(@Param("limit") limit: Int): List<String>
}
