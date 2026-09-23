package com.interviewonline.support

import org.junit.jupiter.api.Assertions.assertTrue
import org.springframework.test.context.DynamicPropertyRegistry
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID

class Postgres16TestSupport private constructor(
    private val database: String,
    val schema: String,
    private val username: String,
    private val password: String,
) : AutoCloseable {
    private val jdbcUrl = "jdbc:postgresql://127.0.0.1:5432/$database?currentSchema=$schema"

    fun register(registry: DynamicPropertyRegistry) {
        applicationProperties().forEach { (name, value) -> registry.add(name) { value } }
    }

    fun applicationProperties(): Map<String, Any> = mapOf(
        "spring.datasource.url" to jdbcUrl,
        "spring.datasource.username" to username,
        "spring.datasource.password" to password,
        "spring.datasource.driver-class-name" to "org.postgresql.Driver",
        "spring.datasource.hikari.schema" to schema,
        "spring.flyway.enabled" to true,
        "spring.flyway.schemas" to schema,
        "spring.flyway.default-schema" to schema,
        "spring.jpa.hibernate.ddl-auto" to "validate",
        "spring.jpa.properties.hibernate.default_schema" to schema,
    )

    fun verifyPostgres16() {
        connection().use { connection ->
            val version = connection.createStatement().use { statement ->
                statement.executeQuery("SHOW server_version_num").use { result -> result.next(); result.getInt(1) }
            }
            assertTrue(version in 160000..169999, "Expected PostgreSQL 16, got $version")
        }
    }

    override fun close() {
        adminConnection(database, username, password).use { connection ->
            connection.createStatement().use { it.execute("DROP SCHEMA $schema CASCADE") }
        }
    }

    fun connection(): Connection = DriverManager.getConnection(jdbcUrl, username, password)

    companion object {
        fun create(prefix: String): Postgres16TestSupport {
            val username = System.getenv("TEAM_TEST_PG_USER") ?: "interview"
            val password = System.getenv("TEAM_TEST_PG_PASSWORD") ?: "interview"
            val database = System.getenv("TEAM_TEST_PG_DATABASE") ?: resolveScratchDatabase(username, password)
            require(database != "interview_online") { "Tests must never mutate the development interview_online database" }
            val safePrefix = prefix.lowercase().replace(Regex("[^a-z0-9_]"), "_")
            val schema = "${safePrefix}_${UUID.randomUUID().toString().replace("-", "")}".take(63)
            adminConnection(database, username, password).use { connection ->
                connection.createStatement().use { it.execute("CREATE SCHEMA $schema") }
            }
            return Postgres16TestSupport(database, schema, username, password)
        }

        private fun resolveScratchDatabase(username: String, password: String): String =
            DriverManager.getConnection("jdbc:postgresql://127.0.0.1:5432/postgres", username, password).use { connection ->
                connection.prepareStatement(
                    """
                    SELECT datname FROM pg_database
                    WHERE datallowconn AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                      AND datname <> 'interview_online' AND datname LIKE 'interview_%'
                    ORDER BY datname LIMIT 1
                    """.trimIndent(),
                ).use { statement ->
                    statement.executeQuery().use { result ->
                        require(result.next()) { "Set TEAM_TEST_PG_DATABASE to an owned PostgreSQL scratch database" }
                        result.getString(1)
                    }
                }
            }

        private fun adminConnection(database: String, username: String, password: String): Connection =
            DriverManager.getConnection("jdbc:postgresql://127.0.0.1:5432/$database", username, password)
    }
}
