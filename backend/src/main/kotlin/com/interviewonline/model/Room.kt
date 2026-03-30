package com.interviewonline.model

import jakarta.persistence.CascadeType
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.FetchType
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.JoinColumn
import jakarta.persistence.ManyToOne
import jakarta.persistence.OneToMany
import jakarta.persistence.OrderBy
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "rooms")
class Room(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(nullable = false)
    var title: String = "Interview Room",

    @Column(name = "invite_code", unique = true, nullable = false)
    var inviteCode: String = "",

    @Column(name = "owner_session_token", nullable = false)
    var ownerSessionToken: String = "",

    @Column(name = "interviewer_session_token", nullable = false)
    var interviewerSessionToken: String = "",

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_user_id")
    var ownerUser: User? = null,

    @Column(nullable = false)
    var language: String = "nodejs",

    @Column(name = "current_step", nullable = false)
    var currentStep: Int = 0,

    @Column(nullable = false, columnDefinition = "TEXT")
    var code: String = "",

    @Column(columnDefinition = "TEXT")
    var notes: String? = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @OneToMany(mappedBy = "room", cascade = [CascadeType.ALL], orphanRemoval = true)
    @OrderBy("stepIndex ASC")
    var tasks: MutableList<RoomTask> = mutableListOf(),
)
