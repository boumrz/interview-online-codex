package com.interviewonline.service

import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service

@Service
class ArtifactRegistryInitializerService(
    private val jdbcTemplate: JdbcTemplate,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @EventListener(ApplicationReadyEvent::class)
    fun ensureRegistryIndexes() {
        executeSafe("""
            CREATE INDEX IF NOT EXISTS idx_agent_task_runs_issue_state
            ON agent_task_runs(linear_issue_id, current_state)
        """)
        executeSafe("""
            CREATE INDEX IF NOT EXISTS idx_agent_task_runs_provider
            ON agent_task_runs(workflow_provider)
        """)
        executeSafe("""
            CREATE INDEX IF NOT EXISTS idx_agent_artifacts_issue_type
            ON agent_artifacts(linear_issue_id, artifact_type)
        """)
        executeSafe("""
            CREATE INDEX IF NOT EXISTS idx_agent_review_verdicts_issue_type
            ON agent_review_verdicts(linear_issue_id, reviewer_type)
        """)
        executeSafe("""
            CREATE INDEX IF NOT EXISTS idx_agent_trace_events_trace
            ON agent_trace_events(trace_id, event_type)
        """)

        if (isPgVectorAvailable()) {
            executeSafe("CREATE EXTENSION IF NOT EXISTS vector")
            executeSafe("ALTER TABLE agent_artifacts ADD COLUMN IF NOT EXISTS embedding vector(1536)")
            executeSafe("""
                CREATE INDEX IF NOT EXISTS idx_agent_artifacts_embedding_ivfflat
                ON agent_artifacts USING ivfflat (embedding vector_cosine_ops)
            """)
        } else {
            logger.info("pgvector extension not available in current PostgreSQL instance; running in JSONB-only mode")
        }
    }

    private fun isPgVectorAvailable(): Boolean {
        return runCatching {
            jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')",
                Boolean::class.java,
            ) ?: false
        }.getOrDefault(false)
    }

    private fun executeSafe(sql: String) {
        runCatching {
            jdbcTemplate.execute(sql.trimIndent())
        }.onFailure { ex ->
            logger.warn("Failed to execute registry init SQL", ex)
        }
    }
}
