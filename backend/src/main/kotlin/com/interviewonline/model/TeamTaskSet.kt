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
@Table(name = "team_task_sets")
class TeamTaskSet(
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

    @OneToMany(
        mappedBy = "taskSet",
        cascade = [CascadeType.ALL],
        orphanRemoval = true,
        fetch = FetchType.LAZY,
    )
    @OrderBy("position ASC")
    var items: MutableList<TeamTaskSetItem> = mutableListOf(),

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
