package com.interviewonline.service

import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.WorkflowState

interface WorkflowProvider {
    val providerName: String

    fun start(run: AgentTaskRun): WorkflowProviderResult

    fun transition(run: AgentTaskRun, from: WorkflowState, to: WorkflowState): WorkflowProviderResult
}

data class WorkflowProviderResult(
    val accepted: Boolean,
    val externalRunId: String,
    val metadata: Map<String, Any?> = emptyMap(),
)
