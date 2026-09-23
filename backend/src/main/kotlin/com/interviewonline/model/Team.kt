package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "teams")
class Team(
    @Id
    var id: String = "",

    @Column(nullable = false)
    var name: String = "",

    @Column(name = "normalized_name", nullable = false)
    var normalizedName: String = "",

    @Column(name = "owner_user_id", nullable = false)
    var ownerUserId: String = "",

    @Column(nullable = false, length = 32)
    var state: String = "ACTIVE",

    @Column(name = "merged_into_team_id")
    var mergedIntoTeamId: String? = null,

    @Column(name = "merged_at")
    var mergedAt: Instant? = null,

    @Column(nullable = false)
    var revision: Long = 0,

    @Column(name = "security_revision", nullable = false)
    var securityRevision: Long = 0,

    @Column(name = "merge_revision", nullable = false)
    var mergeRevision: Long = 0,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
