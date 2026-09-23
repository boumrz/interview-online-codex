package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_memberships")
class TeamMembership(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(name = "user_id", nullable = false)
    var userId: String = "",

    @Column(nullable = false, length = 32)
    var role: String = "MEMBER",

    @Column(nullable = false, length = 32)
    var state: String = "ACTIVE",

    @Column(nullable = false)
    var epoch: Long = 0,

    @Column(nullable = false)
    var revision: Long = 0,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
