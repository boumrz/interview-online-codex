package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "team_merge_plans")
class TeamMergePlan(
    @Id var id: String = "",
    @Column(name = "source_team_id", nullable = false) var sourceTeamId: String = "",
    @Column(name = "target_team_id", nullable = false) var targetTeamId: String = "",
    @Column(name = "destination_team_id", nullable = false) var destinationTeamId: String = "",
    @Column(name = "destination_name", nullable = false) var destinationName: String = "",
    @Column(name = "source_merge_revision", nullable = false) var sourceMergeRevision: Long = 0,
    @Column(name = "target_merge_revision", nullable = false) var targetMergeRevision: Long = 0,
    @Column(name = "source_snapshot_hash", nullable = false) var sourceSnapshotHash: String = "",
    @Column(name = "target_snapshot_hash", nullable = false) var targetSnapshotHash: String = "",
    @Column(name = "track_renames_json", nullable = false) var trackRenamesJson: String = "{}",
    @Column(name = "set_renames_json", nullable = false) var setRenamesJson: String = "{}",
    @Column(name = "admin_promotions_json", nullable = false) var adminPromotionsJson: String = "[]",
    @Column(nullable = false) var state: String = "PENDING_REVIEW",
    @Column(name = "reviewed_at") var reviewedAt: Instant? = null,
    @Column(name = "source_approved_at") var sourceApprovedAt: Instant? = null,
    @Column(name = "target_approved_at") var targetApprovedAt: Instant? = null,
    @Column(name = "committed_at") var committedAt: Instant? = null,
    @Column(name = "commit_key") var commitKey: String? = null,
    @Column(name = "commit_actor_user_id") var commitActorUserId: String? = null,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at", nullable = false) var updatedAt: Instant = Instant.now(),
)
