package com.interviewonline.service

import com.interviewonline.config.AgentProperties
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient

@Service
class LangfuseBridgeService(
    private val agentProperties: AgentProperties,
    private val restClientBuilder: RestClient.Builder,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun emitTraceEvent(
        traceId: String,
        issueId: String,
        runId: String,
        eventType: String,
        payload: Map<String, Any?>,
    ) {
        val observability = agentProperties.observability
        if (!observability.langfuseEnabled || observability.langfuseUrl.isBlank()) {
            return
        }

        runCatching {
            restClientBuilder.build()
                .post()
                .uri(observability.langfuseUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .headers { headers ->
                    if (observability.langfuseApiKey.isNotBlank()) {
                        headers.set("Authorization", "Bearer ${observability.langfuseApiKey}")
                    }
                }
                .body(
                    mapOf(
                        "traceId" to traceId,
                        "issueId" to issueId,
                        "runId" to runId,
                        "eventType" to eventType,
                        "payload" to payload,
                    ),
                )
                .retrieve()
                .toBodilessEntity()
        }.onFailure { ex ->
            logger.warn("Failed to emit Langfuse trace event", ex)
        }
    }
}
