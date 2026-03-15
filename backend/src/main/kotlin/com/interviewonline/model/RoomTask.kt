package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table

@Entity
@Table(name = "room_tasks")
class RoomTask(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(optional = false)
    @JoinColumn(name = "room_id")
    var room: Room? = null,

    @Column(name = "step_index", nullable = false)
    var stepIndex: Int = 0,

    @Column(nullable = false)
    var title: String = "",

    @Column(nullable = false, columnDefinition = "TEXT")
    var description: String = "",

    @Column(name = "starter_code", nullable = false, columnDefinition = "TEXT")
    var starterCode: String = "",

    @Column(nullable = false)
    var language: String = "javascript",

    @Column(name = "category_name")
    var categoryName: String? = null,
)
