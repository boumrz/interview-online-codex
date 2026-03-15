package com.interviewonline.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "app.agent")
class AgentProperties {
    var defaultProvider: String = "temporal"
    var defaultWorkflowName: String = "task_orchestration"
    var observability: ObservabilityProperties = ObservabilityProperties()
}

class ObservabilityProperties {
    var serviceName: String = "interview-online-agent"
    var langfuseEnabled: Boolean = false
    var langfuseUrl: String = ""
    var langfuseApiKey: String = ""
}

@Component
@ConfigurationProperties(prefix = "app.agent.linear")
class LinearSyncProperties {
    var enabled: Boolean = false
    var apiUrl: String = "https://api.linear.app/graphql"
    var apiKey: String = ""
    var statusMap: MutableMap<String, String> = mutableMapOf(
        "BACKLOG" to "Backlog",
        "REFINEMENT" to "Backlog",
        "READY" to "Взято в разработку",
        "IN_PROGRESS" to "В работе (Back)",
        "IN_REVIEW" to "In Review",
        "QA" to "Передано на Front",
        "DONE" to "Выполнено",
        "BLOCKED" to "Backlog",
    )
}

@Component
@ConfigurationProperties(prefix = "app.execution")
class ExecutionProperties {
    var mode: String = "local"
    var localEnabled: Boolean = true
    var isolatedUrl: String = "http://localhost:7070/api/execute"
    var fallbackToLocal: Boolean = false
    var killSwitch: Boolean = false
}
