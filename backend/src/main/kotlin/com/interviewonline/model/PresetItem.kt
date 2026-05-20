package com.interviewonline.model

import jakarta.persistence.*

@Entity
@Table(name = "preset_items")
class PresetItem(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "preset_id", nullable = false)
    var preset: TaskPreset? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_template_id", nullable = false)
    var taskTemplate: UserTaskTemplate? = null,

    @Column(nullable = false)
    var position: Int = 0,
)
