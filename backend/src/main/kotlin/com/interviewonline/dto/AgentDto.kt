package com.interviewonline.dto

import jakarta.validation.constraints.NotBlank

data class StartAgentRunRequest(
    @field:NotBlank val linearIssueId: String,
    val workflowProvider: String? = null,
    val workflowName: String? = null,
    val requiresHumanApproval: Boolean = false,
    val acceptanceCriteria: List<String> = emptyList(),
    val context: Map<String, Any?> = emptyMap(),
    val assignedRole: String? = null,
    val maxRetries: Int = 2,
    val timeoutSeconds: Int = 1200,
)

data class AgentRunTransitionRequest(
    @field:NotBlank val targetState: String,
    val handoffReason: String? = null,
    val errorMessage: String? = null,
    val actorRole: String? = null,
    val humanApproved: Boolean = false,
)

data class SubmitReviewVerdictRequest(
    @field:NotBlank val reviewerType: String,
    @field:NotBlank val decision: String,
    @field:NotBlank val summary: String,
    val isBlocking: Boolean? = null,
    val findings: List<String> = emptyList(),
    val metadata: Map<String, Any?> = emptyMap(),
)

data class SaveAgentArtifactRequest(
    @field:NotBlank val type: String,
    val key: String? = null,
    val schemaVersion: String = "v1",
    val payload: Map<String, Any?> = emptyMap(),
)

data class RealtimeFaultProfileRequest(
    val latencyMs: Int = 0,
    val dropEveryNthMessage: Int = 0,
)

data class AgentRunResponse(
    val id: String,
    val linearIssueId: String,
    val workflowProvider: String,
    val workflowName: String,
    val currentState: String,
    val allowedTransitions: List<String>,
    val traceId: String,
    val requiresHumanApproval: Boolean,
    val humanApproved: Boolean,
    val retryCount: Int,
    val maxRetries: Int,
    val timeoutSeconds: Int,
    val assignedRole: String?,
    val lastHandoffReason: String?,
    val lastError: String?,
    val createdBy: String,
    val createdAt: String,
    val updatedAt: String,
    val acceptanceCriteria: List<String>,
    val artifacts: List<AgentArtifactDto>,
    val verdicts: List<AgentReviewVerdictDto>,
)

data class AgentArtifactDto(
    val id: String,
    val type: String,
    val key: String?,
    val schemaVersion: String,
    val payload: Map<String, Any?>,
    val createdBy: String,
    val createdAt: String,
)

data class AgentReviewVerdictDto(
    val id: String,
    val reviewerType: String,
    val decision: String,
    val isBlocking: Boolean,
    val summary: String,
    val payload: Map<String, Any?>,
    val createdBy: String,
    val createdAt: String,
)

data class AgentPolicyGateCheckDto(
    val id: String,
    val passed: Boolean,
    val message: String,
)

data class AgentPolicyGateResultDto(
    val passed: Boolean,
    val checks: List<AgentPolicyGateCheckDto>,
)

data class AgentTraceEventDto(
    val id: String,
    val eventType: String,
    val spanName: String,
    val traceId: String,
    val payload: Map<String, Any?>,
    val createdAt: String,
)

data class EnvironmentDoctorCheckDto(
    val key: String,
    val status: String,
    val message: String,
    val details: Map<String, String> = emptyMap(),
)

data class EnvironmentDoctorReportDto(
    val status: String,
    val generatedAt: String,
    val checks: List<EnvironmentDoctorCheckDto>,
)
