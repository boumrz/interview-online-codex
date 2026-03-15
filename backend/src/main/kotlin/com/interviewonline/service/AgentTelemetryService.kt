package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.config.AgentProperties
import com.interviewonline.model.AgentTaskRun
import com.interviewonline.model.AgentTraceEvent
import com.interviewonline.repository.AgentTraceEventRepository
import io.opentelemetry.api.GlobalOpenTelemetry
import io.opentelemetry.api.trace.SpanKind
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

@Service
class AgentTelemetryService(
    private val traceEventRepository: AgentTraceEventRepository,
    private val agentProperties: AgentProperties,
    private val langfuseBridgeService: LangfuseBridgeService,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val tracer = GlobalOpenTelemetry.getTracer(agentProperties.observability.serviceName)
    private val gitCommit = System.getenv("GIT_COMMIT").orEmpty()

    fun record(run: AgentTaskRun, eventType: String, spanName: String, payload: Map<String, Any?> = emptyMap()) {
        val span = tracer.spanBuilder(spanName)
            .setSpanKind(SpanKind.INTERNAL)
            .startSpan()
        span.setAttribute("agent.issue_id", run.linearIssueId)
        span.setAttribute("agent.run_id", run.id ?: "unknown")
        span.setAttribute("agent.trace_id", run.traceId)
        span.setAttribute("agent.event_type", eventType)
        span.setAttribute("agent.state", run.currentState.name)
        if (gitCommit.isNotBlank()) {
            span.setAttribute("agent.git_commit", gitCommit)
        }
        payload.forEach { (key, value) ->
            when (value) {
                is String -> span.setAttribute("agent.payload.$key", value.take(256))
                is Number -> span.setAttribute("agent.payload.$key", value.toDouble())
                is Boolean -> span.setAttribute("agent.payload.$key", value)
                else -> {}
            }
        }
        span.end()

        traceEventRepository.save(
            AgentTraceEvent(
                run = run,
                linearIssueId = run.linearIssueId,
                traceId = run.traceId,
                spanName = spanName,
                eventType = eventType,
                payload = objectMapper.writeValueAsString(payload),
            ),
        )

        logger.info(
            "agent_trace traceId={} issue={} run={} eventType={} span={} payload={}",
            run.traceId,
            run.linearIssueId,
            run.id,
            eventType,
            spanName,
            payload,
        )

        langfuseBridgeService.emitTraceEvent(
            traceId = run.traceId,
            issueId = run.linearIssueId,
            runId = run.id ?: "unknown",
            eventType = eventType,
            payload = payload + mapOf("state" to run.currentState.name),
        )
    }
}
