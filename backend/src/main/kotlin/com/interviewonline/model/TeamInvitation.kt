package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_invitations")
class TeamInvitation(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    var tokenHash: String = "",

    @Column(name = "creator_user_id", nullable = false)
    var creatorUserId: String = "",

    @Column(nullable = false, length = 32)
    var role: String = "MEMBER",

    @Column(name = "expires_at", nullable = false)
    var expiresAt: Instant = Instant.now(),

    @Column(nullable = false, length = 32)
    var state: String = "PENDING",

    @Column(name = "accepted_by")
    var acceptedBy: String? = null,

    @Column(name = "accepted_at")
    var acceptedAt: Instant? = null,

    @Column(nullable = false)
    var revision: Long = 0,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),

    @Column(name = "recoverable_token_envelope", length = 512)
    var recoverableTokenEnvelope: String? = null,

    @Column(name = "recovery_key_version", length = 64)
    var recoveryKeyVersion: String? = null,
)
