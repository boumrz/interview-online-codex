package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get

@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class E2eFixtureIsolationIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("fixture_isolation_e2e")
        private val runId = "a".repeat(32)
        @JvmStatic @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            postgres.register(registry)
            registry.add("app.e2e-isolation.run-id") { runId }
            registry.add("app.e2e-isolation.schema") { postgres.schema }
        }
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `read-only proof reports the actual isolated PostgreSQL identity`() {
        val before = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java)
        val result = mvc.get("/api/test-fixtures/e2e-isolation") {
            header("X-Interhub-E2E-Run", runId)
        }.andReturn()
        assertEquals(200, result.response.status)
        val proof = mapper.readTree(result.response.contentAsString)
        assertEquals(runId, proof.path("runId").asText())
        assertEquals(postgres.schema, proof.path("schema").asText())
        assertEquals(jdbc.queryForObject("SELECT current_database()", String::class.java), proof.path("database").asText())
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java))
        assertEquals("no-store", result.response.getHeader("Cache-Control"))
    }

    @Test
    fun `missing or incorrect run identity cannot obtain proof or mutate fixture data`() {
        val before = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java)
        assertEquals(404, mvc.get("/api/test-fixtures/e2e-isolation").andReturn().response.status)
        assertEquals(404, mvc.get("/api/test-fixtures/e2e-isolation") {
            header("X-Interhub-E2E-Run", "b".repeat(32))
        }.andReturn().response.status)
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java))
    }
}
