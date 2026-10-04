package com.interviewonline.controller

import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

class LibraryArchiveRetirementMigrationTest {
    @Test
    fun `populated migration restores all archived library records resolves name collisions and preserves snapshots`() {
        Postgres16TestSupport.create("library_archive_upgrade").use { postgres ->
            postgres.verifyPostgres16()
            val props = postgres.applicationProperties()
            fun flyway(target: String? = null): Flyway {
                val config = Flyway.configure().dataSource(props.getValue("spring.datasource.url").toString(), props.getValue("spring.datasource.username").toString(), props.getValue("spring.datasource.password").toString()).schemas(postgres.schema).defaultSchema(postgres.schema).locations("classpath:db/migration")
                if (target != null) config.target(MigrationVersion.fromVersion(target))
                return config.load()
            }
            flyway("31").migrate()
            val owner = UUID.randomUUID().toString()
            val team = UUID.randomUUID().toString()
            val task = UUID.randomUUID().toString()
            val preset = UUID.randomUUID().toString()
            val active = UUID.randomUUID().toString()
            val archived = listOf(UUID.randomUUID().toString(), UUID.randomUUID().toString())
            val room = UUID.randomUUID().toString()
            val snapshot = UUID.randomUUID().toString()
            postgres.connection().use { connection -> connection.createStatement().use { sql ->
                sql.executeUpdate("INSERT INTO users(id,nickname,password_hash,role,created_at) VALUES ('$owner','upgrade_user','test','user',CURRENT_TIMESTAMP)")
                sql.executeUpdate("INSERT INTO teams(id,name,normalized_name,owner_user_id,created_at,updated_at) VALUES ('$team','Existing','existing','$owner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                sql.executeUpdate("INSERT INTO task_presets(id,owner_user_id,name,status,revision,created_at,updated_at) VALUES ('$preset','$owner','Preserved personal','ARCHIVED',4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                sql.executeUpdate("INSERT INTO team_task_templates(id,team_id,title,normalized_title,description,starter_code,language,status,revision,created_by_user_id,created_at,updated_at) VALUES ('$task','$team','Preserved task','preserved task','Condition','Code','kotlin','ARCHIVED',3,'$owner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                (listOf(active) + archived).forEach { id ->
                    sql.executeUpdate("INSERT INTO team_task_sets(id,team_id,name,normalized_name,status,revision,created_by_user_id,created_at,updated_at) VALUES ('$id','$team','Same name','same name','${if (id == active) "ACTIVE" else "ARCHIVED"}',7,'$owner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
                    sql.executeUpdate("INSERT INTO team_task_set_items(id,task_set_id,task_template_id,position) VALUES ('${UUID.randomUUID()}','$id','$task',0)")
                }
                sql.executeUpdate("INSERT INTO rooms(id,title,invite_code,owner_session_token,interviewer_session_token,owner_user_id,language,current_step,code,created_at,team_id,origin_team_id,team_task_set_id,team_task_set_revision,team_interview_created) VALUES ('$room','Preserved interview','r-$room','owner-test','interviewer-test','$owner','kotlin',0,'Shared code',CURRENT_TIMESTAMP,'$team','$team','${archived.first()}',7,true)")
                sql.executeUpdate("INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,solution_code,score,source_task_template_id,language,mandatory) VALUES ('$snapshot','$room',0,'Snapshot','Original condition','Original code','Original solution',5,'$task','kotlin',true)")
            } }
            flyway().migrate()
            postgres.connection().use { connection -> connection.createStatement().use { sql ->
                listOf("task_presets" to preset, "team_task_templates" to task).forEach { (table, id) -> sql.executeQuery("SELECT status,revision FROM $table WHERE id='$id'").use { row -> assertTrue(row.next()); assertEquals("ACTIVE", row.getString(1)); assertEquals(if (id == preset) 5L else 4L, row.getLong(2)) } }
                sql.executeQuery("SELECT COUNT(*),COUNT(DISTINCT normalized_name),COUNT(*) FILTER(WHERE status='ACTIVE') FROM team_task_sets WHERE team_id='$team'").use { row -> row.next(); assertEquals(3, row.getInt(1)); assertEquals(3, row.getInt(2)); assertEquals(3, row.getInt(3)) }
                sql.executeQuery("SELECT name,revision FROM team_task_sets WHERE id='$active'").use { row -> row.next(); assertEquals("Same name", row.getString(1)); assertEquals(7, row.getLong(2)) }
                archived.forEach { id -> sql.executeQuery("SELECT name,revision FROM team_task_sets WHERE id='$id'").use { row -> row.next(); assertTrue(row.getString(1).startsWith("Same name")); assertEquals(8, row.getLong(2)) } }
                sql.executeQuery("SELECT COUNT(*) FROM team_task_set_items WHERE task_template_id='$task'").use { row -> row.next(); assertEquals(3, row.getInt(1)) }
                sql.executeUpdate("DELETE FROM team_task_sets WHERE id='${archived.first()}'")
                sql.executeQuery("SELECT team_task_set_id,team_task_set_revision,team_interview_created,code FROM rooms WHERE id='$room'").use { row -> row.next(); assertNull(row.getString(1)); assertEquals(7, row.getLong(2)); assertTrue(row.getBoolean(3)); assertEquals("Shared code", row.getString(4)) }
                sql.executeQuery("SELECT title,description,starter_code,solution_code,score,mandatory,source_task_template_id FROM room_tasks WHERE id='$snapshot'").use { row -> row.next(); assertEquals("Snapshot", row.getString(1)); assertEquals("Original condition", row.getString(2)); assertEquals("Original code", row.getString(3)); assertEquals("Original solution", row.getString(4)); assertEquals(5, row.getInt(5)); assertTrue(row.getBoolean(6)); assertEquals(task, row.getString(7)) }
            } }
            assertEquals(0, flyway().migrate().migrationsExecuted)
        }
    }
}
