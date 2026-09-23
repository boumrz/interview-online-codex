package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "room_realtime_activity")
class RoomRealtimeActivity(
    @Id var id: String = "",
    @Column(name = "room_code", nullable = false) var roomCode: String = "",
    @Column(name = "instance_id", nullable = false) var instanceId: String = "",
    @Column(name = "expires_at", nullable = false) var expiresAt: Instant = Instant.now(),
)
