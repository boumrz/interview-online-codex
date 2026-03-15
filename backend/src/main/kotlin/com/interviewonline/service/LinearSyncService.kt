package com.interviewonline.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.config.LinearSyncProperties
import com.interviewonline.model.ReviewDecision
import com.interviewonline.model.ReviewerType
import com.interviewonline.model.WorkflowState
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient

@Service
class LinearSyncService(
    private val properties: LinearSyncProperties,
    private val objectMapper: ObjectMapper,
    private val restClientBuilder: RestClient.Builder,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun syncState(issueIdentifier: String, state: WorkflowState, traceId: String, reason: String? = null) {
        if (!isEnabled()) return

        runCatching {
            val issue = resolveIssue(issueIdentifier) ?: return
            val stateName = properties.statusMap[state.name] ?: return
            val stateId = issue.availableStates[stateName.lowercase()] ?: return
            graphql(
                query = """
                    mutation UpdateIssueState(${'$'}id: String!, ${'$'}stateId: String!) {
                      issueUpdate(id: ${'$'}id, input: { stateId: ${'$'}stateId }) {
                        success
                      }
                    }
                """.trimIndent(),
                variables = mapOf("id" to issue.id, "stateId" to stateId),
            )

            val reasonSuffix = reason?.takeIf { it.isNotBlank() }?.let { "\nReason: $it" }.orEmpty()
            createComment(
                issueId = issue.id,
                body = "Workflow state synced to `${state.name}` (trace `${traceId}`).$reasonSuffix",
            )
        }.onFailure { ex ->
            logger.warn("Failed to sync Linear issue state {} -> {}", issueIdentifier, state.name, ex)
        }
    }

    fun publishVerdict(
        issueIdentifier: String,
        reviewerType: ReviewerType,
        decision: ReviewDecision,
        summary: String,
        traceId: String,
    ) {
        if (!isEnabled()) return

        runCatching {
            val issue = resolveIssue(issueIdentifier) ?: return
            createComment(
                issueId = issue.id,
                body = "Reviewer `${reviewerType.name}` verdict: `${decision.name}`\n\n$summary\n\nTrace: `${traceId}`",
            )
        }.onFailure { ex ->
            logger.warn("Failed to publish review verdict for Linear issue {}", issueIdentifier, ex)
        }
    }

    private fun resolveIssue(issueIdentifier: String): ResolvedIssue? {
        val data = graphql(
            query = """
                query IssueByIdentifier(${'$'}identifier: String!) {
                  issue(identifier: ${'$'}identifier) {
                    id
                    identifier
                    state {
                      id
                      name
                    }
                    team {
                      states {
                        nodes {
                          id
                          name
                        }
                      }
                    }
                  }
                }
            """.trimIndent(),
            variables = mapOf("identifier" to issueIdentifier),
        )

        val issueNode = data.path("issue")
        if (issueNode.isMissingNode || issueNode.isNull) {
            logger.warn("Linear issue {} was not found", issueIdentifier)
            return null
        }

        val states = issueNode.path("team").path("states").path("nodes")
        val stateMap = mutableMapOf<String, String>()
        if (states.isArray) {
            states.forEach { stateNode ->
                val name = stateNode.path("name").asText("")
                val id = stateNode.path("id").asText("")
                if (name.isNotBlank() && id.isNotBlank()) {
                    stateMap[name.lowercase()] = id
                }
            }
        }

        return ResolvedIssue(
            id = issueNode.path("id").asText(),
            identifier = issueNode.path("identifier").asText(),
            availableStates = stateMap,
        )
    }

    private fun createComment(issueId: String, body: String) {
        graphql(
            query = """
                mutation AddComment(${'$'}issueId: String!, ${'$'}body: String!) {
                  commentCreate(input: { issueId: ${'$'}issueId, body: ${'$'}body }) {
                    success
                  }
                }
            """.trimIndent(),
            variables = mapOf("issueId" to issueId, "body" to body),
        )
    }

    private fun graphql(query: String, variables: Map<String, Any?>): JsonNode {
        val payload = mapOf(
            "query" to query,
            "variables" to variables,
        )
        val rawResponse = restClientBuilder
            .build()
            .post()
            .uri(properties.apiUrl)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", properties.apiKey)
            .body(payload)
            .retrieve()
            .body(String::class.java)
            ?: error("Empty response from Linear GraphQL")

        val json = objectMapper.readTree(rawResponse)
        if (json.has("errors")) {
            error("Linear GraphQL error: ${json.path("errors")}")
        }
        return json.path("data")
    }

    private fun isEnabled(): Boolean {
        return properties.enabled && properties.apiKey.isNotBlank()
    }

    private data class ResolvedIssue(
        val id: String,
        val identifier: String,
        val availableStates: Map<String, String>,
    )
}
