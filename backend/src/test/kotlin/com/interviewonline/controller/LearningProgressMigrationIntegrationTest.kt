package com.interviewonline.controller

import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LearningProgressMigrationIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val jdbc: JdbcTemplate,
) {
    private data class LegacyAccount(
        val state: String,
        val id: String = UUID.randomUUID().toString(),
        val token: String = "usr_${UUID.randomUUID()}",
        val commandId: UUID = UUID.randomUUID(),
    )

    companion object {
        private val postgres = Postgres16TestSupport.create("learning_upgrade")
        private val legacyAccounts = listOf(
            LegacyAccount("""{"module":"personal_interviews","version":1,"revision":10,"offerSeen":true,"status":"completed","attempt":1,"completedSteps":4,"completions":1}"""),
            LegacyAccount("""{"module":"personal_interviews","version":1,"revision":5,"offerSeen":true,"skipped":true,"status":"in_progress","attempt":1,"completedSteps":2}"""),
        )

        init {
            val properties = postgres.applicationProperties()
            Flyway.configure().dataSource(
                properties.getValue("spring.datasource.url").toString(),
                properties.getValue("spring.datasource.username").toString(),
                properties.getValue("spring.datasource.password").toString(),
            ).schemas(postgres.schema).defaultSchema(postgres.schema).locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("45")).load().migrate()
            postgres.connection().use { connection ->
                legacyAccounts.forEach { account ->
                    connection.prepareStatement("""
                        INSERT INTO users(id,nickname,display_name,role,is_hr,created_at)
                        VALUES (?,?,'Участник v1','user',false,CURRENT_TIMESTAMP)
                    """.trimIndent()).use {
                        it.setString(1, account.id); it.setString(2, "legacy_${account.id.take(8)}"); it.executeUpdate()
                    }
                    connection.prepareStatement("INSERT INTO user_sessions(id,user_id,token,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)").use {
                        it.setString(1, UUID.randomUUID().toString()); it.setString(2, account.id); it.setString(3, account.token); it.executeUpdate()
                    }
                    connection.prepareStatement("INSERT INTO learning_progress(user_id,module,state_json) VALUES (?,'personal_interviews',?)").use {
                        it.setString(1, account.id); it.setString(2, account.state); it.executeUpdate()
                    }
                    connection.prepareStatement("INSERT INTO learning_commands(user_id,module,command_id) VALUES (?,'personal_interviews',?)").use {
                        it.setString(1, account.id); it.setObject(2, account.commandId); it.executeUpdate()
                    }
                }
            }
        }

        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `V46 starts clean v2 learning for previously completed and skipped accounts and preserves v1 history`() {
        postgres.verifyPostgres16()
        val path = "/api/me/learning/personal_interviews"
        legacyAccounts.forEach { account ->
            fun command(version: Int?) = mvc.post(path) {
                header("Authorization", "Bearer ${account.token}")
                contentType = MediaType.APPLICATION_JSON
                val versionField = version?.let { ",\"expectedVersion\":$it" }.orEmpty()
                content = """{"commandId":"${account.commandId}","expectedRevision":0,"action":"start","source":"help"$versionField}"""
            }

            mvc.get(path) { header("Authorization", "Bearer ${account.token}") }.andExpect {
                status { isOk() }
                jsonPath("$.version") { value(2) }; jsonPath("$.revision") { value(0) }; jsonPath("$.status") { value("new") }
                jsonPath("$.offerSeen") { value(false) }; jsonPath("$.skipped") { value(false) }
                jsonPath("$.completedSteps") { value(0) }; jsonPath("$.completions") { value(0) }; jsonPath("$.attempt") { value(0) }
            }
            for (version in listOf(null, 1)) {
                command(version).andExpect { status { isConflict() }; jsonPath("$.code") { value("LEARNING_VERSION_CHANGED") } }
            }
            command(2).andExpect {
                status { isOk() }; jsonPath("$.state.version") { value(2) }; jsonPath("$.state.attempt") { value(1) }
                jsonPath("$.events[0]") { value("first_start") }
            }
            command(2).andExpect { status { isOk() }; jsonPath("$.events") { isEmpty() } }
            assertEquals(account.state, jdbc.queryForObject("SELECT state_json FROM learning_progress WHERE user_id = ?", String::class.java, account.id))
            assertEquals(account.commandId, jdbc.queryForObject("SELECT command_id FROM learning_commands WHERE user_id = ?", UUID::class.java, account.id))
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success=true AND version='46'", Int::class.java))
    }
}
