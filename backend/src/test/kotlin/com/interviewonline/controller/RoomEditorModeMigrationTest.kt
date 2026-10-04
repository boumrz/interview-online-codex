package com.interviewonline.controller

import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.sql.SQLException
import java.util.UUID

class RoomEditorModeMigrationTest {
    @Test
    fun `V33 preserves the published legacy mode documents and fresh code defaults`() {
        Postgres16TestSupport.create("room_mode_upgrade").use { postgres ->
            postgres.verifyPostgres16()
            val properties = postgres.applicationProperties()
            fun flyway(target: String): Flyway = Flyway.configure()
                .dataSource(properties.getValue("spring.datasource.url").toString(), properties.getValue("spring.datasource.username").toString(), properties.getValue("spring.datasource.password").toString())
                .schemas(postgres.schema).defaultSchema(postgres.schema).locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(target)).load()
            flyway("32").migrate()
            val markdownRoom = UUID.randomUUID().toString()
            val taskOnlyRoom = UUID.randomUUID().toString()
            val emptyRoom = UUID.randomUUID().toString()
            val freshRoom = UUID.randomUUID().toString()
            val taskId = UUID.randomUUID().toString()
            val publishedBriefing = "<!--briefing:focus=on-->\nPublished Markdown"
            val privateBriefing = "<!--briefing:focus=on-->\nPrivate prepared Markdown"
            val document = "AQHSCQAEAQlyb29tLWNvZGUXY29uc3QgYWNrbm93bGVkZ2VkID0gMTsA"
            fun insertRoom(id: String, briefing: String?) {
                postgres.connection().use { connection ->
                    connection.prepareStatement("INSERT INTO rooms(id,title,invite_code,owner_session_token,interviewer_session_token,language,current_step,code,briefing_markdown,created_at) VALUES (?,'Existing interview',?,?,?,'nodejs',0,'Preserved shared code',?,CURRENT_TIMESTAMP)").use { statement ->
                        statement.setString(1, id); statement.setString(2, "room-$id"); statement.setString(3, "owner-$id"); statement.setString(4, "interviewer-$id"); statement.setString(5, briefing)
                        statement.executeUpdate()
                    }
                }
            }
            insertRoom(markdownRoom, publishedBriefing)
            insertRoom(taskOnlyRoom, "Published code task")
            insertRoom(emptyRoom, null)
            postgres.connection().use { connection ->
                connection.prepareStatement("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,solution_code,language,briefing_markdown,workspace_yjs_document_base64,workspace_yjs_sequence,workspace_revision,workspace_focus_mode) VALUES (?,?,1,'Private task','Original condition','Original starter','Original solution','nodejs',?,?,3,7,true)").use { statement ->
                    statement.setString(1, taskId); statement.setString(2, taskOnlyRoom); statement.setString(3, privateBriefing); statement.setString(4, document); statement.executeUpdate()
                }
            }
            assertEquals(1, flyway("33").migrate().migrationsExecuted)
            insertRoom(freshRoom, publishedBriefing)
            postgres.connection().use { connection ->
                listOf(markdownRoom to "markdown", taskOnlyRoom to "code", emptyRoom to "code", freshRoom to "code").forEach { (id, mode) ->
                    connection.prepareStatement("SELECT room_editor_mode,room_editor_mode_revision,code,briefing_markdown FROM rooms WHERE id=?").use { statement ->
                        statement.setString(1, id)
                        statement.executeQuery().use { row ->
                            assertTrue(row.next()); assertEquals(mode, row.getString(1)); assertEquals(0L, row.getLong(2)); assertEquals("Preserved shared code", row.getString(3))
                            assertEquals(if (id == markdownRoom || id == freshRoom) publishedBriefing else if (id == taskOnlyRoom) "Published code task" else null, row.getString(4))
                        }
                    }
                }
                connection.prepareStatement("SELECT title,description,starter_code,solution_code,briefing_markdown,workspace_yjs_document_base64,workspace_yjs_sequence,workspace_revision,workspace_focus_mode FROM room_tasks WHERE id=?").use { statement ->
                    statement.setString(1, taskId)
                    statement.executeQuery().use { row ->
                        assertTrue(row.next()); assertEquals("Private task", row.getString(1)); assertEquals("Original condition", row.getString(2)); assertEquals("Original starter", row.getString(3)); assertEquals("Original solution", row.getString(4))
                        assertEquals(privateBriefing, row.getString(5)); assertEquals(document, row.getString(6)); assertEquals(3L, row.getLong(7)); assertEquals(7L, row.getLong(8)); assertTrue(row.getBoolean(9))
                    }
                }
                assertThrows(SQLException::class.java) { connection.createStatement().use { it.executeUpdate("UPDATE rooms SET room_editor_mode='invalid'") } }
                assertThrows(SQLException::class.java) { connection.createStatement().use { it.executeUpdate("UPDATE rooms SET room_editor_mode_revision=-1") } }
            }
            assertEquals(0, flyway("33").migrate().migrationsExecuted)
        }
    }
}
