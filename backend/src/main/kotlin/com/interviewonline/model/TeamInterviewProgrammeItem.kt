package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table

@Entity
@Table(name = "team_interview_programme_items")
class TeamInterviewProgrammeItem(
    @Id
    var id: String = "",

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "programme_id", nullable = false)
    var programme: TeamInterviewProgramme? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_template_id", nullable = false)
    var taskTemplate: TeamTaskTemplate? = null,

    @Column(nullable = false)
    var position: Int = 0,

    @Column(nullable = false)
    var mandatory: Boolean = true,
)
