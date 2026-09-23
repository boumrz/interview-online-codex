package com.interviewonline.model

import jakarta.persistence.CascadeType
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.Id
import jakarta.persistence.OneToMany
import jakarta.persistence.OrderBy
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_interview_programmes")
class TeamInterviewProgramme(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(name = "target_type", nullable = false, length = 32)
    var targetType: String = "",

    @Column(name = "target_id", nullable = false)
    var targetId: String = "",

    @Column(nullable = false, length = 32)
    var status: String = "DRAFT",

    @Column(nullable = false)
    var version: Long = 0,

    @Column(nullable = false)
    var revision: Long = 0,

    @Column(name = "created_by_user_id", nullable = false)
    var createdByUserId: String = "",

    @OneToMany(
        mappedBy = "programme",
        cascade = [CascadeType.ALL],
        orphanRemoval = true,
        fetch = FetchType.LAZY,
    )
    @OrderBy("position ASC")
    var items: MutableList<TeamInterviewProgrammeItem> = mutableListOf(),

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
