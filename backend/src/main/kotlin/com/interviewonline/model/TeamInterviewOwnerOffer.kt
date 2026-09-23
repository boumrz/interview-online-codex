package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_interview_owner_offers")
class TeamInterviewOwnerOffer(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(name = "room_id", nullable = false)
    var roomId: String = "",

    @Column(name = "from_user_id", nullable = false)
    var fromUserId: String = "",

    @Column(name = "to_user_id", nullable = false)
    var toUserId: String = "",

    @Column(nullable = false, length = 32)
    var status: String = "PENDING",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "expires_at", nullable = false)
    var expiresAt: Instant = Instant.now(),

    @Column(name = "responded_at")
    var respondedAt: Instant? = null,
)
