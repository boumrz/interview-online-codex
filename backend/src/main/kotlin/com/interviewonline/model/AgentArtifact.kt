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
import java.time.Instant

@Entity
@Table(name = "agent_artifacts")
class AgentArtifact(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "run_id")
    var run: AgentTaskRun? = null,

    @Column(name = "linear_issue_id", nullable = false)
    var linearIssueId: String = "",

    @Column(name = "artifact_type", nullable = false)
    var artifactType: String = "task_envelope",

    @Column(name = "artifact_key")
    var artifactKey: String? = null,

    @Column(name = "schema_version", nullable = false)
    var schemaVersion: String = "v1",

    @Column(name = "payload", nullable = false, columnDefinition = "jsonb")
    var payload: String = "{}",

    @Column(name = "created_by", nullable = false)
    var createdBy: String = "system",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)
