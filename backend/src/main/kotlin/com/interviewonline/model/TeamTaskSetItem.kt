package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table

@Entity
@Table(name = "team_task_set_items")
class TeamTaskSetItem(
    @Id
    var id: String = "",

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_set_id", nullable = false)
    var taskSet: TeamTaskSet? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_template_id", nullable = false)
    var taskTemplate: TeamTaskTemplate? = null,

    @Column(nullable = false)
    var position: Int = 0,
)
