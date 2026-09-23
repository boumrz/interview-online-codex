package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_audit_events")
class TeamAuditEvent(
    @Id
    var id: String = "",

    @Column(name = "team_id", nullable = false)
    var teamId: String = "",

    @Column(name = "origin_team_id", nullable = false)
    var originTeamId: String = "",

    @Column(name = "actor_user_id", nullable = false)
    var actorUserId: String = "",

    @Column(name = "target_user_id")
    var targetUserId: String? = null,

    @Column(nullable = false, length = 64)
    var action: String = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(nullable = false, length = 32)
    var outcome: String = "SUCCESS",

    @Column(name = "opaque_entity_id")
    var opaqueEntityId: String? = null,
)
