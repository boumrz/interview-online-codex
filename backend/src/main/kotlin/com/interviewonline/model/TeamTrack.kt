package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_tracks")
class TeamTrack(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(nullable = false)
    var name: String = "",

    @Column(name = "normalized_name", nullable = false)
    var normalizedName: String = "",

    @Column(nullable = false, length = 32)
    var status: String = "ACTIVE",

    @Column(nullable = false)
    var revision: Long = 0,

    @Column(name = "created_by_user_id", nullable = false)
    var createdByUserId: String = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
