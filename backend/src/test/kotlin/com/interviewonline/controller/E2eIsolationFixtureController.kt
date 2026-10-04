package com.interviewonline.controller

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Profile
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException

/** Read-only proof compiled only into the selected E2E test fixture classpath. */
@RestController
@Profile("test")
class E2eIsolationFixtureController(
    private val jdbc: JdbcTemplate,
    @Value("\${app.e2e-isolation.run-id:}") private val runId: String,
    @Value("\${app.e2e-isolation.schema:}") private val expectedSchema: String,
) {
    @GetMapping("/api/test-fixtures/e2e-isolation")
    fun identity(@RequestHeader("X-Interhub-E2E-Run", required = false) requestedRun: String?): ResponseEntity<E2eIsolationProof> {
        if (!runId.matches(Regex("[a-f0-9]{32}")) || requestedRun != runId
            || !expectedSchema.matches(Regex("[a-z_]+_e2e_[a-f0-9]{32}"))) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND)
        }
        val identity = jdbc.query("SELECT current_database(), current_schema()", { result, _ ->
            E2eIsolationProof(runId, result.getString(1), result.getString(2))
        }).single()
        if (identity.database == "interview_online" || identity.schema != expectedSchema) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND)
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity)
    }
}

data class E2eIsolationProof(val runId: String, val database: String, val schema: String)
