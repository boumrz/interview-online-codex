package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_task_templates")
class TeamTaskTemplate(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(nullable = false)
    var title: String = "",

    @Column(name = "normalized_title", nullable = false)
    var normalizedTitle: String = "",

    @Column(nullable = false, columnDefinition = "TEXT")
    var description: String = "",

    @Column(name = "starter_code", nullable = false, columnDefinition = "TEXT")
    var starterCode: String = "",

    @Column(nullable = false)
    var language: String = "nodejs",

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
