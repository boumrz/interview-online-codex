package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.Instant

@Entity
@Table(
    name = "room_participants",
    uniqueConstraints = [UniqueConstraint(name = "uk_room_participants_room_user", columnNames = ["room_id", "user_id"])],
)
class RoomParticipant(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(optional = false)
    @JoinColumn(name = "room_id")
    var room: Room? = null,

    @ManyToOne(optional = false)
    @JoinColumn(name = "user_id")
    var user: User? = null,

    @Column(nullable = false)
    var role: String = "interviewer",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
