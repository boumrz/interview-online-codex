package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import org.hibernate.annotations.OnDelete
import org.hibernate.annotations.OnDeleteAction
import java.time.Instant

@Entity
@Table(name = "room_task_language_observations", uniqueConstraints = [
    UniqueConstraint(name = "uq_room_task_language", columnNames = ["room_id", "language", "task_id"]),
])
class RoomTaskLanguageObservation(
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "room_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    var room: Room? = null,

    // Historical identity survives removing or reordering a published step.
    @Column(name = "task_id", nullable = false)
    var taskId: String = "",

    @Column(nullable = false, length = 16)
    var language: String = "",

    @Column(name = "observed_at", nullable = false)
    var observedAt: Instant = Instant.now(),
)
