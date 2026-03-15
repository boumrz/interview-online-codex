package com.interviewonline.model

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "agent_task_runs")
class AgentTaskRun(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(name = "linear_issue_id", nullable = false)
    var linearIssueId: String = "",

    @Column(name = "workflow_provider", nullable = false)
    var workflowProvider: String = "temporal",

    @Column(name = "workflow_name", nullable = false)
    var workflowName: String = "task_orchestration",

    @Enumerated(EnumType.STRING)
    @Column(name = "current_state", nullable = false)
    var currentState: WorkflowState = WorkflowState.READY,

    @Column(name = "requires_human_approval", nullable = false)
    var requiresHumanApproval: Boolean = false,

    @Column(name = "human_approved", nullable = false)
    var humanApproved: Boolean = false,

    @Column(name = "retry_count", nullable = false)
    var retryCount: Int = 0,

    @Column(name = "max_retries", nullable = false)
    var maxRetries: Int = 2,

    @Column(name = "timeout_seconds", nullable = false)
    var timeoutSeconds: Int = 1200,

    @Column(name = "assigned_role")
    var assignedRole: String? = null,

    @Column(name = "trace_id", nullable = false)
    var traceId: String = "",

    @Column(name = "acceptance_criteria", nullable = false, columnDefinition = "jsonb")
    var acceptanceCriteria: String = "[]",

    @Column(name = "context_payload", nullable = false, columnDefinition = "jsonb")
    var contextPayload: String = "{}",

    @Column(name = "last_handoff_reason", columnDefinition = "TEXT")
    var lastHandoffReason: String? = null,

    @Column(name = "last_error", columnDefinition = "TEXT")
    var lastError: String? = null,

    @Column(name = "created_by", nullable = false)
    var createdBy: String = "system",

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
