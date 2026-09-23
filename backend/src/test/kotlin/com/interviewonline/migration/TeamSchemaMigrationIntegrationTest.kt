package com.interviewonline.migration

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet
import java.sql.SQLException
import java.time.Instant
import java.util.UUID

class TeamSchemaMigrationIntegrationTest {
    @Test
    fun `synthetic immutable V10 upgrade preserves personal fixtures and installs team schema`() =
        isolatedSchema("team_upgrade").use { database ->
            database.migrate(target = "10")
            database.connection().use(::seedV10PersonalFixture)
            val before = database.connection().use(::legacyFixtureSnapshot)

            database.migrate()

            val after = database.connection().use(::legacyFixtureSnapshot)
            assertEquals(before, after, "additive team migration must preserve every representative V10 value")
            database.connection().use { connection ->
                assertPostgres16(connection)
                assertLatestMigrationAfterV10(connection, database.schema)
                assertPrimaryTeamSchema(connection, database.schema)
                assertPersonalRowsRemainUnscoped(connection)
            }
            database.migrate()
            database.connection().use { connection ->
                assertEquals(before, legacyFixtureSnapshot(connection), "personal V10 variants must survive restart migration replay")
                assertPersonalRowsRemainUnscoped(connection)
            }
        }

    @Test
    fun `fresh PostgreSQL install has primary keys foreign keys checks and required indexes`() =
        isolatedSchema("team_fresh").use { database ->
            database.migrate()
            database.connection().use { connection ->
                assertPostgres16(connection)
                assertLatestMigrationAfterV10(connection, database.schema)
                assertPrimaryTeamSchema(connection, database.schema)

                assertPrimaryKey(connection, database.schema, "teams", listOf("id"))
                assertPrimaryKey(connection, database.schema, "team_memberships", listOf("id"))
                assertForeignKey(connection, database.schema, "teams", "owner_user_id", "users")
                assertForeignKey(connection, database.schema, "team_memberships", "team_id", "teams")
                assertForeignKey(connection, database.schema, "team_memberships", "user_id", "users")
                assertForeignKey(connection, database.schema, "team_audit_events", "team_id", "teams")
                assertForeignKey(connection, database.schema, "command_receipts", "actor_user_id", "users")
                assertForeignKey(connection, database.schema, "rooms", "team_id", "teams")
                assertForeignKey(connection, database.schema, "rooms", "origin_team_id", "teams")

                assertUniqueColumns(connection, database.schema, "team_memberships", listOf("team_id", "user_id"))
                assertUniqueColumns(
                    connection,
                    database.schema,
                    "command_receipts",
                    listOf("actor_user_id", "scope_kind", "scope_id", "operation", "idempotency_key"),
                )
                assertCheckContains(connection, database.schema, "team_memberships", "ADMIN", "MEMBER")
                assertOwnerMembershipRoleRejected(connection)
                assertCheckContains(connection, database.schema, "team_memberships", "ACTIVE", "SUSPENDED", "LEFT", "REMOVED")
                assertCheckContains(connection, database.schema, "teams", "revision", ">= 0")
                assertCheckContains(connection, database.schema, "team_memberships", "epoch", ">= 0")
                assertCheckContains(connection, database.schema, "rooms", "team_id", "origin_team_id")
                assertIndexContains(connection, database.schema, "team_memberships", "user_id", "state", "team_id")
                assertIndexContains(connection, database.schema, "team_audit_events", "team_id", "created_at", "id")
                assertIndexContains(connection, database.schema, "command_receipts", "expires_at")
                assertIndexContains(connection, database.schema, "team_invitations", "team_id", "state", "expires_at")
                assertPrimaryKey(
                    connection,
                    database.schema,
                    "invitation_rate_limit_buckets",
                    listOf("dimension", "subject_hash"),
                )
                assertCheckContains(
                    connection,
                    database.schema,
                    "invitation_rate_limit_buckets",
                    "PREVIEW_IP",
                    "PREVIEW_ACCOUNT",
                    "ACCEPT_IP",
                    "ACCEPT_ACCOUNT",
                    "ISSUE_TEAM",
                )
                assertIndexContains(connection, database.schema, "invitation_rate_limit_buckets", "updated_at")
            }
        }

    @Test
    fun `V15 Flyway recovery migration has exact envelope guard state guard and cleanup index`() =
        isolatedSchema("invitation_recovery_v15").use { database ->
            database.migrate()
            database.connection().use { connection ->
                assertPostgres16(connection)
                assertMigrationInstalled(connection, database.schema, 15)
                assertV15RecoveryPersistence(connection, database.schema)
            }
        }

    @Test
    fun `terminal receipt survives closed connection and repeated Flyway startup`() =
        isolatedSchema("team_restart").use { database ->
            database.migrate()
            val actorId = UUID.randomUUID().toString()
            val teamId = UUID.randomUUID().toString()
            val membershipId = UUID.randomUUID().toString()
            val auditId = UUID.randomUUID().toString()
            val key = UUID.randomUUID().toString()
            database.connection().use { connection ->
                assertLatestMigrationAfterV10(connection, database.schema)
                insertRestartFixture(connection, actorId, teamId, membershipId, auditId, key)
            }

            database.migrate()

            database.connection().use { connection ->
                val persisted = connection.prepareStatement(
                    """
                    SELECT status, resource_id, scope_kind, scope_id, operation
                    FROM command_receipts
                    WHERE actor_user_id = ? AND idempotency_key = ?
                    """.trimIndent(),
                ).use { statement ->
                    statement.setString(1, actorId)
                    statement.setString(2, key)
                    statement.executeQuery().use { result ->
                        assertTrue(result.next(), "terminal receipt must survive application restart")
                        listOf(
                            result.getString("status"),
                            result.getString("resource_id"),
                            result.getString("scope_kind"),
                            result.getString("scope_id"),
                            result.getString("operation"),
                        )
                    }
                }
                assertEquals(listOf("201", teamId, "PERSONAL", actorId, "TEAM_CREATE"), persisted)
            }
        }

    private fun seedV10PersonalFixture(connection: Connection) {
        connection.createStatement().use { statement ->
            statement.executeUpdate(
                """
                INSERT INTO users (id,nickname,display_name,password_hash,role,is_hr,created_at)
                VALUES ('personal-user','personal-v10','Личный пользователь V10','hash-v10','user',TRUE,TIMESTAMP '2026-09-01 10:00:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO user_sessions (id,user_id,token,created_at)
                VALUES ('personal-session','personal-user','session-v10',TIMESTAMP '2026-09-01 10:01:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO users (id,nickname,display_name,password_hash,role,is_hr,created_at) VALUES
                    ('personal-candidate','candidate-v10','Кандидат участник V10','candidate-hash','user',FALSE,TIMESTAMP '2026-09-01 09:50:00'),
                    ('personal-hr-user','hr-v10','Дополнительный HR V10','hr-hash','user',TRUE,TIMESTAMP '2026-09-01 09:51:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO rooms
                    (id,title,invite_code,owner_session_token,interviewer_session_token,owner_user_id,language,current_step,
                     code,notes,interviewer_chat,briefing_markdown,candidate_key_history,private_notes_json,created_at,
                     verdict,verdict_comment,status,finished_at,candidate_name,position,scheduled_at,archived_at,interview_metadata_revision)
                VALUES
                    ('personal-room','Личная комната V10','personal-invite','owner-v10','interviewer-v10','personal-user','kotlin',1,
                     'fun main() = Unit','notes-v10','[]','# Briefing','[]','{}',TIMESTAMP '2026-09-01 10:02:00',
                     'hire','Сильный результат','finished',TIMESTAMP '2026-09-01 11:00:00','Кандидат V10','Kotlin инженер',
                     TIMESTAMP '2026-09-01 10:30:00',NULL,7)
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO rooms
                    (id,title,invite_code,owner_session_token,interviewer_session_token,owner_user_id,language,current_step,
                     code,notes,interviewer_chat,briefing_markdown,candidate_key_history,private_notes_json,created_at,
                     verdict,verdict_comment,status,finished_at,candidate_name,position,scheduled_at,archived_at,interview_metadata_revision)
                VALUES
                    ('personal-archived-room','Архив без metadata V10','archived-invite','archived-owner-v10','archived-interviewer-v10',
                     'personal-user','nodejs',0,'','','[]',NULL,'[]','{}',TIMESTAMP '2026-08-20 08:00:00',
                     'no_hire','Архивный результат','finished',TIMESTAMP '2026-08-20 09:00:00',NULL,NULL,NULL,
                     TIMESTAMP '2026-08-21 10:00:00',2)
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_participants (id,room_id,user_id,role,created_at) VALUES
                    ('personal-candidate-participant','personal-room','personal-candidate','candidate',TIMESTAMP '2026-09-01 10:02:30'),
                    ('archived-candidate-participant','personal-archived-room','personal-candidate','candidate',TIMESTAMP '2026-08-20 08:01:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO user_task_categories (id,owner_user_id,name,created_at)
                VALUES ('personal-category','personal-user','Личная категория',TIMESTAMP '2026-09-01 09:00:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO user_task_templates (id,owner_user_id,category_id,title,description,starter_code,language,created_at)
                VALUES ('personal-template','personal-user','personal-category','Личная задача','Условие V10','fun solve() = 42','kotlin',TIMESTAMP '2026-09-01 09:10:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_tasks
                    (id,room_id,step_index,title,description,starter_code,solution_code,interviewer_notes,private_notes_json,
                     briefing_markdown,solution_language,score,source_task_template_id,language,category_name,
                     workspace_yjs_document_base64,workspace_yjs_sequence,workspace_revision,workspace_focus_mode)
                VALUES
                    ('personal-room-task','personal-room',0,'Снимок задачи','Условие комнаты','fun solve() = 0','fun solve() = 42',
                     'manager notes','{}','# Task briefing','kotlin',5,'personal-template','kotlin','Личная категория','e30=',8,3,TRUE)
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO task_presets (id,owner_user_id,name,created_at)
                VALUES ('personal-preset','personal-user','Личный набор',TIMESTAMP '2026-09-01 09:20:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO preset_items (id,preset_id,task_template_id,position)
                VALUES ('personal-preset-item','personal-preset','personal-template',0)
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_hr_assignments (id,room_id,user_id,created_at)
                VALUES ('personal-hr','personal-room','personal-user',TIMESTAMP '2026-09-01 10:03:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_hr_assignments (id,room_id,user_id,created_at) VALUES
                    ('personal-hr-extra','personal-room','personal-hr-user',TIMESTAMP '2026-09-01 10:04:00'),
                    ('archived-hr','personal-archived-room','personal-hr-user',TIMESTAMP '2026-08-20 08:02:00')
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_keystroke_events
                    (id,room_id,session_id,display_name,key_value,key_code,ctrl_key,alt_key,shift_key,meta_key,event_kind,
                     paste_length,paste_preview,timestamp_epoch_ms,source_event_id,accepted_sequence)
                VALUES
                    ('personal-event','personal-room','candidate-session','Кандидат V10','a','KeyA',FALSE,FALSE,FALSE,FALSE,
                     'keydown',NULL,NULL,1788257040000,'personal-source-event',1)
                """.trimIndent(),
            )
            statement.executeUpdate(
                """
                INSERT INTO room_keystroke_events
                    (id,room_id,session_id,display_name,key_value,key_code,ctrl_key,alt_key,shift_key,meta_key,event_kind,
                     paste_length,paste_preview,timestamp_epoch_ms,source_event_id,accepted_sequence)
                VALUES
                    ('archived-event','personal-archived-room','archived-session','Архивный кандидат',NULL,NULL,FALSE,FALSE,FALSE,FALSE,
                     'window_blur',NULL,NULL,1787216460000,'archived-source-event',1)
                """.trimIndent(),
            )
        }
    }

    private fun legacyFixtureSnapshot(connection: Connection): Map<String, List<List<String?>>> =
        linkedMapOf(
            "users" to rows(connection, "SELECT id,nickname,display_name,password_hash,role,is_hr,created_at FROM users WHERE id IN ('personal-user','personal-candidate','personal-hr-user') ORDER BY id"),
            "sessions" to rows(connection, "SELECT id,user_id,token,created_at FROM user_sessions WHERE id='personal-session'"),
            "rooms" to rows(connection, "SELECT id,title,invite_code,owner_user_id,language,current_step,code,notes,candidate_name,position,status,verdict,archived_at,interview_metadata_revision FROM rooms WHERE id IN ('personal-room','personal-archived-room') ORDER BY id"),
            "participants" to rows(connection, "SELECT id,room_id,user_id,role,created_at FROM room_participants WHERE id IN ('personal-candidate-participant','archived-candidate-participant') ORDER BY id"),
            "roomTasks" to rows(connection, "SELECT id,room_id,step_index,title,description,starter_code,solution_code,source_task_template_id,workspace_yjs_sequence,workspace_revision,workspace_focus_mode FROM room_tasks WHERE id='personal-room-task'"),
            "categories" to rows(connection, "SELECT id,owner_user_id,name,created_at FROM user_task_categories WHERE id='personal-category'"),
            "templates" to rows(connection, "SELECT id,owner_user_id,category_id,title,description,starter_code,language FROM user_task_templates WHERE id='personal-template'"),
            "presets" to rows(connection, "SELECT id,owner_user_id,name FROM task_presets WHERE id='personal-preset'"),
            "presetItems" to rows(connection, "SELECT id,preset_id,task_template_id,position FROM preset_items WHERE id='personal-preset-item'"),
            "hr" to rows(connection, "SELECT id,room_id,user_id,created_at FROM room_hr_assignments WHERE id IN ('personal-hr','personal-hr-extra','archived-hr') ORDER BY id"),
            "history" to rows(connection, "SELECT id,room_id,source_event_id,accepted_sequence,key_value,event_kind FROM room_keystroke_events WHERE id IN ('personal-event','archived-event') ORDER BY id"),
        )

    private fun rows(connection: Connection, sql: String): List<List<String?>> =
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { result ->
                buildList {
                    val columns = result.metaData.columnCount
                    while (result.next()) add((1..columns).map { result.getString(it) })
                }
            }
        }

    private fun assertPersonalRowsRemainUnscoped(connection: Connection) {
        connection.createStatement().use { statement ->
            statement.executeQuery("SELECT id,team_id,origin_team_id FROM rooms WHERE id IN ('personal-room','personal-archived-room') ORDER BY id").use { result ->
                var count = 0
                while (result.next()) {
                    count += 1
                    assertEquals(null, result.getString("team_id"), "${result.getString("id")} must remain PERSONAL")
                    assertEquals(null, result.getString("origin_team_id"), "${result.getString("id")} must not acquire team origin")
                }
                assertEquals(2, count)
            }
        }
    }

    private fun assertPostgres16(connection: Connection) {
        val version = connection.createStatement().use { statement ->
            statement.executeQuery("SHOW server_version_num").use { result -> result.next(); result.getInt(1) }
        }
        assertTrue(version in 160000..169999, "INT-07 must execute on PostgreSQL 16, got $version")
    }

    private fun assertLatestMigrationAfterV10(connection: Connection, schema: String) {
        val versions = connection.prepareStatement(
            "SELECT version FROM $schema.flyway_schema_history WHERE success ORDER BY installed_rank",
        ).use { statement -> statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1).toInt()) } } }
        assertEquals((1..10).toList(), versions.take(10), "synthetic upgrade baseline must remain exactly V1..V10")
        assertTrue(versions.last() > 10, "team schema requires an additive migration after V10; found $versions")
    }

    private fun assertMigrationInstalled(connection: Connection, schema: String, version: Int) {
        val versions = connection.prepareStatement(
            "SELECT version FROM $schema.flyway_schema_history WHERE success ORDER BY installed_rank",
        ).use { statement ->
            statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1).toInt()) } }
        }
        assertTrue(versions.contains(version), "Flyway V$version must be installed; found $versions")
    }

    private fun assertPrimaryTeamSchema(connection: Connection, schema: String) {
        val required = listOf("teams", "team_memberships", "team_audit_events", "command_receipts")
        val installed = required.associateWith { table -> tableExists(connection, schema, table) }
        assertEquals(required.associateWith { true }, installed)
        assertColumn(connection, schema, "rooms", "team_id", nullable = true)
        assertColumn(connection, schema, "rooms", "origin_team_id", nullable = true)
        assertColumn(connection, schema, "teams", "normalized_name", nullable = false)
        assertColumn(connection, schema, "team_memberships", "epoch", nullable = false)
        assertColumn(connection, schema, "command_receipts", "request_hash", nullable = false)
        assertColumn(connection, schema, "command_receipts", "expires_at", nullable = false)
    }

    private fun assertV15RecoveryPersistence(connection: Connection, schema: String) {
        assertVarcharColumn(connection, schema, "team_invitations", "recoverable_token_envelope", length = 512, nullable = true)
        assertVarcharColumn(connection, schema, "team_invitations", "recovery_key_version", length = 64, nullable = true)
        assertRecoveryAllOrNoneConstraint(connection, schema)
        assertPersistedInvitationStateConstraint(connection, schema)
        assertExactIndexColumns(connection, schema, "team_invitations", listOf("state", "expires_at", "id"))
        assertRecoveryConstraintsRejectPartialRowsAndPersistedExpiredState(connection)
    }

    private fun assertRecoveryAllOrNoneConstraint(connection: Connection, schema: String) {
        val definition = checkDefinitions(connection, schema, "team_invitations").singleOrNull { check ->
            check.contains("recoverable_token_envelope", ignoreCase = true) &&
                check.contains("recovery_key_version", ignoreCase = true)
        }
        assertTrue(definition != null, "V15 must install one all-or-none recovery envelope/key constraint")
        assertTrue(definition!!.contains("IS NULL", ignoreCase = true), "recovery pair constraint must permit nullable legacy rows")
        assertTrue(definition.contains("IS NOT NULL", ignoreCase = true), "recovery pair constraint must require both fields for new rows")
    }

    private fun assertPersistedInvitationStateConstraint(connection: Connection, schema: String) {
        val definition = checkDefinitions(connection, schema, "team_invitations").singleOrNull { check ->
            check.contains("state", ignoreCase = true) && check.contains("PENDING", ignoreCase = true)
        }
        assertTrue(definition != null, "team invitations must retain the persisted lifecycle state constraint")
        val states = Regex("'([A-Z_]+)'").findAll(requireNotNull(definition)).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf("PENDING", "ACCEPTED", "REVOKED"),
            states,
            "V15 must not persist an EXPIRED state or expand the three-state database guard",
        )
    }

    private fun assertRecoveryConstraintsRejectPartialRowsAndPersistedExpiredState(connection: Connection) {
        val actorId = UUID.randomUUID().toString()
        val teamId = UUID.randomUUID().toString()
        connection.createStatement().use { statement ->
            statement.executeUpdate(
                "INSERT INTO users(id,nickname,display_name,password_hash,role,is_hr,created_at) " +
                    "VALUES ('$actorId','v15-owner','V15 owner','hash','user',TRUE,CURRENT_TIMESTAMP)",
            )
            statement.executeUpdate(
                "INSERT INTO teams(id,name,normalized_name,owner_user_id,state,revision,security_revision,merge_revision,created_at,updated_at) " +
                    "VALUES ('$teamId','V15 recovery','v15 recovery','$actorId','ACTIVE',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
            )
        }
        val validLegacyId = UUID.randomUUID().toString()
        insertRecoveryInvitation(connection, validLegacyId, teamId, actorId, envelope = null, keyVersion = null)
        listOf(
            "envelope-only" to Pair("v1:opaque", null),
            "key-only" to Pair(null, "integration-v1"),
        ).forEach { (kind, pair) ->
            val failure = assertThrows(SQLException::class.java) {
                insertRecoveryInvitation(connection, UUID.randomUUID().toString(), teamId, actorId, pair.first, pair.second)
            }
            assertEquals("23514", failure.sqlState, "$kind must fail the V15 recovery-pair CHECK")
        }
        insertRecoveryInvitation(connection, UUID.randomUUID().toString(), teamId, actorId, envelope = "v1:opaque", keyVersion = "integration-v1")
        val expiredFailure = assertThrows(SQLException::class.java) {
            insertRecoveryInvitation(connection, UUID.randomUUID().toString(), teamId, actorId, envelope = null, keyVersion = null, state = "EXPIRED")
        }
        assertEquals("23514", expiredFailure.sqlState, "EXPIRED must remain an effective projection, not a persisted state")
        assertEquals(1, rows(connection, "SELECT id FROM team_invitations WHERE id='$validLegacyId'").size, "all-null legacy recovery pair remains valid")
    }

    private fun insertRecoveryInvitation(
        connection: Connection,
        invitationId: String,
        teamId: String,
        creatorId: String,
        envelope: String?,
        keyVersion: String?,
        state: String = "PENDING",
    ) {
        connection.prepareStatement(
            """
            INSERT INTO team_invitations(
                id,team_id,token_hash,creator_user_id,role,expires_at,state,revision,created_at,updated_at,
                recoverable_token_envelope,recovery_key_version
            ) VALUES (?, ?, ?, ?, 'MEMBER', CURRENT_TIMESTAMP + INTERVAL '1 hour', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, invitationId)
            statement.setString(2, teamId)
            statement.setString(3, invitationId.replace("-", "").padEnd(64, '0'))
            statement.setString(4, creatorId)
            statement.setString(5, state)
            statement.setString(6, envelope)
            statement.setString(7, keyVersion)
            statement.executeUpdate()
        }
    }

    private fun assertOwnerMembershipRoleRejected(connection: Connection) {
        val actorId = UUID.randomUUID().toString()
        val teamId = UUID.randomUUID().toString()
        val membershipId = UUID.randomUUID().toString()
        connection.createStatement().use { statement ->
            statement.executeUpdate(
                "INSERT INTO users(id,nickname,display_name,password_hash,role,is_hr,created_at) " +
                    "VALUES ('$actorId','owner-role-check','Owner role check','hash','user',FALSE,CURRENT_TIMESTAMP)",
            )
            statement.executeUpdate(
                "INSERT INTO teams(id,name,normalized_name,owner_user_id,state,revision,security_revision,merge_revision,created_at,updated_at) " +
                    "VALUES ('$teamId','Role check','role check','$actorId','ACTIVE',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
            )
        }
        connection.autoCommit = false
        try {
            val insertFailure = assertThrows(SQLException::class.java) {
                connection.createStatement().use { statement ->
                    statement.executeUpdate(
                        "INSERT INTO team_memberships(id,team_id,user_id,role,state,epoch,revision,created_at,updated_at) " +
                            "VALUES ('$membershipId','$teamId','$actorId','OWNER','ACTIVE',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                    )
                }
            }
            assertEquals("23514", insertFailure.sqlState, "OWNER insert must fail the PostgreSQL role CHECK")
            connection.rollback()
            assertEquals(0, rows(connection, "SELECT id FROM team_memberships WHERE id='$membershipId'").size)

            connection.createStatement().use { statement ->
                statement.executeUpdate(
                    "INSERT INTO team_memberships(id,team_id,user_id,role,state,epoch,revision,created_at,updated_at) " +
                        "VALUES ('$membershipId','$teamId','$actorId','ADMIN','ACTIVE',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                )
            }
            connection.commit()
            val updateFailure = assertThrows(SQLException::class.java) {
                connection.createStatement().use { statement ->
                    statement.executeUpdate("UPDATE team_memberships SET role='OWNER' WHERE id='$membershipId'")
                }
            }
            assertEquals("23514", updateFailure.sqlState, "OWNER update must fail the PostgreSQL role CHECK")
            connection.rollback()
            assertEquals(listOf(listOf("ADMIN")), rows(connection, "SELECT role FROM team_memberships WHERE id='$membershipId'"))
        } finally {
            connection.rollback()
            connection.autoCommit = true
        }
    }

    private fun assertColumn(connection: Connection, schema: String, table: String, column: String, nullable: Boolean) {
        connection.prepareStatement(
            "SELECT is_nullable FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?",
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table); statement.setString(3, column)
            statement.executeQuery().use { result ->
                assertTrue(result.next(), "$table.$column must exist")
                assertEquals(if (nullable) "YES" else "NO", result.getString(1), "$table.$column nullability")
            }
        }
    }

    private fun assertVarcharColumn(
        connection: Connection,
        schema: String,
        table: String,
        column: String,
        length: Int,
        nullable: Boolean,
    ) {
        connection.prepareStatement(
            """
            SELECT is_nullable, data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema=? AND table_name=? AND column_name=?
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table); statement.setString(3, column)
            statement.executeQuery().use { result ->
                assertTrue(result.next(), "$table.$column must exist")
                assertEquals(if (nullable) "YES" else "NO", result.getString("is_nullable"), "$table.$column nullability")
                assertEquals("character varying", result.getString("data_type"), "$table.$column must be VARCHAR")
                assertEquals(length, result.getInt("character_maximum_length"), "$table.$column length")
            }
        }
    }

    private fun assertPrimaryKey(connection: Connection, schema: String, table: String, columns: List<String>) =
        assertConstraintColumns(connection, schema, table, "PRIMARY KEY", columns)

    private fun assertUniqueColumns(connection: Connection, schema: String, table: String, columns: List<String>) =
        assertConstraintColumns(connection, schema, table, "UNIQUE", columns)

    private fun assertConstraintColumns(connection: Connection, schema: String, table: String, type: String, columns: List<String>) {
        val definitions = connection.prepareStatement(
            """
            SELECT array_agg(k.column_name ORDER BY k.ordinal_position)::text
            FROM information_schema.table_constraints c
            JOIN information_schema.key_column_usage k
              ON k.constraint_schema=c.constraint_schema AND k.constraint_name=c.constraint_name
            WHERE c.table_schema=? AND c.table_name=? AND c.constraint_type=?
            GROUP BY c.constraint_name
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table); statement.setString(3, type)
            statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1)) } }
        }
        val expected = "{${columns.joinToString(",")}}"
        assertTrue(definitions.contains(expected), "$table needs $type $expected; found $definitions")
    }

    private fun assertForeignKey(connection: Connection, schema: String, table: String, column: String, target: String) {
        val exists = connection.prepareStatement(
            """
            SELECT EXISTS (
              SELECT 1 FROM information_schema.table_constraints c
              JOIN information_schema.key_column_usage k ON k.constraint_schema=c.constraint_schema AND k.constraint_name=c.constraint_name
              JOIN information_schema.constraint_column_usage u ON u.constraint_schema=c.constraint_schema AND u.constraint_name=c.constraint_name
              WHERE c.table_schema=? AND c.table_name=? AND c.constraint_type='FOREIGN KEY'
                AND k.column_name=? AND u.table_name=?
            )
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table); statement.setString(3, column); statement.setString(4, target)
            statement.executeQuery().use { result -> result.next(); result.getBoolean(1) }
        }
        assertTrue(exists, "$table.$column must reference $target")
    }

    private fun assertCheckContains(connection: Connection, schema: String, table: String, vararg fragments: String) {
        val definitions = checkDefinitions(connection, schema, table).joinToString(" ")
        fragments.forEach { assertTrue(definitions.contains(it, ignoreCase = true), "$table checks must contain $it: $definitions") }
    }

    private fun checkDefinitions(connection: Connection, schema: String, table: String): List<String> =
        connection.prepareStatement(
            """
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=? AND t.relname=? AND c.contype='c'
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table)
            statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1)) } }
        }

    private fun assertIndexContains(connection: Connection, schema: String, table: String, vararg orderedColumns: String) {
        val definitions = connection.prepareStatement(
            "SELECT indexdef FROM pg_indexes WHERE schemaname=? AND tablename=?",
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table)
            statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1)) } }
        }
        val expected = "(${orderedColumns.joinToString(", ")})"
        assertTrue(definitions.any { it.contains(expected, ignoreCase = true) }, "$table needs index $expected; found $definitions")
    }

    private fun assertExactIndexColumns(connection: Connection, schema: String, table: String, columns: List<String>) {
        val definitions = connection.prepareStatement(
            """
            SELECT array_agg(attribute.attname ORDER BY key.ordinality)::text
            FROM pg_index index_definition
            JOIN pg_class table_class ON table_class.oid=index_definition.indrelid
            JOIN pg_namespace namespace ON namespace.oid=table_class.relnamespace
            CROSS JOIN LATERAL unnest(index_definition.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinality)
            JOIN pg_attribute attribute ON attribute.attrelid=table_class.oid AND attribute.attnum=key.attnum
            WHERE namespace.nspname=? AND table_class.relname=?
            GROUP BY index_definition.indexrelid
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table)
            statement.executeQuery().use { result -> buildList { while (result.next()) add(result.getString(1)) } }
        }
        val expected = "{${columns.joinToString(",")}}"
        assertTrue(definitions.contains(expected), "$table needs cleanup index exactly $expected; found $definitions")
    }

    private fun insertRestartFixture(
        connection: Connection,
        actorId: String,
        teamId: String,
        membershipId: String,
        auditId: String,
        key: String,
    ) {
        val now = Instant.parse("2026-09-12T10:00:00Z")
        connection.createStatement().use { statement ->
            statement.executeUpdate("INSERT INTO users(id,nickname,display_name,password_hash,role,is_hr,created_at) VALUES ('$actorId','restart-user','Restart user','hash','user',FALSE,TIMESTAMP '$now')")
            statement.executeUpdate("INSERT INTO teams(id,name,normalized_name,owner_user_id,state,revision,security_revision,merge_revision,created_at,updated_at) VALUES ('$teamId','Atlas','atlas','$actorId','ACTIVE',0,0,0,TIMESTAMP '$now',TIMESTAMP '$now')")
            statement.executeUpdate("INSERT INTO team_memberships(id,team_id,user_id,role,state,epoch,revision,created_at,updated_at) VALUES ('$membershipId','$teamId','$actorId','ADMIN','ACTIVE',0,0,TIMESTAMP '$now',TIMESTAMP '$now')")
            statement.executeUpdate("INSERT INTO team_audit_events(id,team_id,origin_team_id,actor_user_id,action,created_at,outcome,opaque_entity_id) VALUES ('$auditId','$teamId','$teamId','$actorId','TEAM_CREATE',TIMESTAMP '$now','SUCCESS','$teamId')")
            statement.executeUpdate("INSERT INTO command_receipts(actor_user_id,scope_kind,scope_id,operation,idempotency_key,request_hash,outcome,status,resource_id,created_at,expires_at) VALUES ('$actorId','PERSONAL','$actorId','TEAM_CREATE','$key','v1:${"a".repeat(64)}','CREATED',201,'$teamId',TIMESTAMP '$now',TIMESTAMP '2026-09-13 10:00:00')")
        }
    }

    private fun tableExists(connection: Connection, schema: String, table: String): Boolean =
        connection.prepareStatement(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=? AND table_name=?)",
        ).use { statement ->
            statement.setString(1, schema); statement.setString(2, table)
            statement.executeQuery().use { result -> result.next(); result.getBoolean(1) }
        }

    private fun isolatedSchema(prefix: String): PgSchema = PgSchema.create(prefix)
}

private class PgSchema private constructor(
    val database: String,
    val schema: String,
    private val username: String,
    private val password: String,
) : AutoCloseable {
    private val jdbcUrl = "jdbc:postgresql://127.0.0.1:5432/$database?currentSchema=$schema"

    fun connection(): Connection = DriverManager.getConnection(jdbcUrl, username, password)

    fun migrate(target: String? = null) {
        val configuration = Flyway.configure().dataSource(jdbcUrl, username, password).schemas(schema).defaultSchema(schema)
        target?.let(configuration::target)
        configuration.load().migrate()
    }

    override fun close() {
        adminConnection(database, username, password).use { connection ->
            connection.createStatement().use { it.execute("DROP SCHEMA $schema CASCADE") }
        }
    }

    companion object {
        fun create(prefix: String): PgSchema {
            val username = System.getenv("TEAM_TEST_PG_USER") ?: "interview"
            val password = System.getenv("TEAM_TEST_PG_PASSWORD") ?: "interview"
            val database = System.getenv("TEAM_TEST_PG_DATABASE") ?: resolveScratchDatabase(username, password)
            require(database != "interview_online") { "Tests must never mutate the development interview_online database" }
            val schema = "${prefix}_${UUID.randomUUID().toString().replace("-", "")}".lowercase()
            adminConnection(database, username, password).use { connection ->
                connection.createStatement().use { it.execute("CREATE SCHEMA $schema") }
            }
            return PgSchema(database, schema, username, password)
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
