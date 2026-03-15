package com.interviewonline.service

import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.WorkflowState
import org.springframework.stereotype.Component
import java.util.UUID

@Component
class TemporalWorkflowProvider : WorkflowProvider {
    override val providerName: String = "temporal"

    override fun start(run: AgentTaskRun): WorkflowProviderResult {
        return WorkflowProviderResult(
            accepted = true,
            externalRunId = "temporal-${UUID.randomUUID()}",
            metadata = mapOf(
                "queue" to "agent-workflows",
                "timeoutSeconds" to run.timeoutSeconds,
            ),
        )
    }

    override fun transition(run: AgentTaskRun, from: WorkflowState, to: WorkflowState): WorkflowProviderResult {
        return WorkflowProviderResult(
            accepted = true,
            externalRunId = "temporal-${run.id}",
            metadata = mapOf(
                "from" to from.name,
                "to" to to.name,
                "retryCount" to run.retryCount,
            ),
        )
    }
}
