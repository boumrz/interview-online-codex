package com.interviewonline.controller

import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.util.UUID

class TeamMergeMigrationTest {
    @Test
    fun `P6 upgrading a populated version 24 team schema preserves rows and installs merge storage`() {
        val postgres = Postgres16TestSupport.create("team_merge_upgrade")
        try {
            postgres.verifyPostgres16()
            val properties = postgres.applicationProperties()
            val jdbcUrl = properties.getValue("spring.datasource.url").toString()
            val username = properties.getValue("spring.datasource.username").toString()
            val password = properties.getValue("spring.datasource.password").toString()
            fun flyway(target: String? = null): Flyway {
                val config = Flyway.configure()
                    .dataSource(jdbcUrl, username, password)
                    .schemas(postgres.schema)
                    .defaultSchema(postgres.schema)
                    .locations("classpath:db/migration")
                if (target != null) config.target(MigrationVersion.fromVersion(target))
                return config.load()
            }
            flyway("24").migrate()
            val userId = UUID.randomUUID().toString()
            val teamId = UUID.randomUUID().toString()
            val membershipId = UUID.randomUUID().toString()
            postgres.connection().use { connection ->
                connection.createStatement().use { statement ->
                    statement.executeUpdate("INSERT INTO users (id, nickname, display_name, password_hash, role, created_at) VALUES ('$userId', 'upgrade_user', 'Upgrade User', 'test', 'user', CURRENT_TIMESTAMP)")
                    statement.executeUpdate("INSERT INTO teams (id, name, normalized_name, owner_user_id, state, created_at, updated_at) VALUES ('$teamId', 'Existing team', 'existing team', '$userId', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
                    statement.executeUpdate("INSERT INTO team_memberships (id, team_id, user_id, role, state, created_at, updated_at) VALUES ('$membershipId', '$teamId', '$userId', 'MEMBER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
                }
            }
            flyway().migrate()
            postgres.connection().use { connection ->
                connection.createStatement().use { statement ->
                    statement.executeQuery("SELECT name, state FROM teams WHERE id='$teamId'").use { row ->
                        assertEquals(true, row.next())
                        assertEquals("Existing team", row.getString("name"))
                        assertEquals("ACTIVE", row.getString("state"))
                    }
                    statement.executeQuery("SELECT state FROM team_memberships WHERE id='$membershipId'").use { row ->
                        assertEquals(true, row.next())
                        assertEquals("ACTIVE", row.getString("state"))
                    }
                    statement.executeUpdate("UPDATE team_memberships SET state='MERGED' WHERE id='$membershipId'")
                    statement.executeQuery("SELECT COUNT(*) FROM team_merge_plans").use { row ->
                        row.next()
                        assertEquals(0, row.getInt(1))
                    }
                    statement.executeQuery("SELECT COUNT(*) FROM room_realtime_activity").use { row ->
                        row.next()
                        assertEquals(0, row.getInt(1))
                    }
                    statement.executeQuery("SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank DESC LIMIT 1").use { row ->
                        row.next()
                        assertEquals("33", row.getString(1))
                    }
                }
            }
        } finally {
            postgres.close()
        }
    }
}
