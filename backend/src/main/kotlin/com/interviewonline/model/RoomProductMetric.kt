package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.time.Instant

/**
 * One privacy-safe lifecycle projection per room.
 *
 * This entity must remain free of invite codes, people/session identifiers and
 * all interview content. It is an aggregate read model, not an event log.
 */
@Entity
@Table(
    name = "room_product_metrics",
    indexes = [
        Index(name = "idx_rpm_created_at", columnList = "created_at"),
        Index(name = "idx_rpm_candidate_joined_at", columnList = "first_candidate_joined_at"),
        Index(name = "idx_rpm_activity_at", columnList = "first_meaningful_candidate_activity_at"),
        Index(name = "idx_rpm_first_verdict_at", columnList = "first_verdict_saved_at"),
    ],
)
class RoomProductMetric(
    @Id
    @Column(name = "room_id", nullable = false, updatable = false, length = 255)
    var roomId: String = "",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "creation_source", nullable = false, length = 32)
    var creationSource: String = "guest",

    @Column(name = "initial_task_count", nullable = false)
    var initialTaskCount: Int = 0,

    @Column(name = "prepared_at")
    var preparedAt: Instant? = null,

    @Column(name = "first_interviewer_joined_at")
    var firstInterviewerJoinedAt: Instant? = null,

    @Column(name = "first_candidate_joined_at")
    var firstCandidateJoinedAt: Instant? = null,

    @Column(name = "first_meaningful_candidate_activity_at")
    var firstMeaningfulCandidateActivityAt: Instant? = null,

    @Column(name = "first_verdict_saved_at")
    var firstVerdictSavedAt: Instant? = null,

    @Column(name = "latest_verdict_saved_at")
    var latestVerdictSavedAt: Instant? = null,

    @Column(name = "realtime_connection_count", nullable = false)
    var realtimeConnectionCount: Int = 0,
)
