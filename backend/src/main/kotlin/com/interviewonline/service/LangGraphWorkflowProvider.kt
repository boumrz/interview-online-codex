package com.interviewonline.service

import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.WorkflowState
import org.springframework.stereotype.Component
import java.util.UUID

@Component
class LangGraphWorkflowProvider : WorkflowProvider {
    override val providerName: String = "langgraph"

    override fun start(run: AgentTaskRun): WorkflowProviderResult {
        return WorkflowProviderResult(
            accepted = true,
            externalRunId = "langgraph-${UUID.randomUUID()}",
            metadata = mapOf(
                "graph" to "fast-prototype",
                "timeoutSeconds" to run.timeoutSeconds,
            ),
        )
    }

    override fun transition(run: AgentTaskRun, from: WorkflowState, to: WorkflowState): WorkflowProviderResult {
        return WorkflowProviderResult(
            accepted = true,
            externalRunId = "langgraph-${run.id}",
            metadata = mapOf(
                "from" to from.name,
                "to" to to.name,
                "retryCount" to run.retryCount,
            ),
        )
    }
}
