package com.interviewonline.controller

import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.sql.Connection

class RoomCanvasTaskMigrationTest {
    @Test
    fun `V38 and V39 preserve existing scenes and receipts on one task or on a taskless room`() {
        Postgres16TestSupport.create("room_canvas_upgrade").use { db ->
            val props = db.applicationProperties()
            fun migrate(version: String) = Flyway.configure()
                .dataSource(props.getValue("spring.datasource.url").toString(), props.getValue("spring.datasource.username").toString(),
                    props.getValue("spring.datasource.password").toString())
                .schemas(db.schema).defaultSchema(db.schema).locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version)).load().migrate()
            migrate("37")
            db.connection().use { connection ->
                connection.createStatement().use { sql ->
                    sql.executeUpdate("""
                        INSERT INTO rooms(id,title,invite_code,owner_session_token,interviewer_session_token,language,current_step,code,created_at)
                        SELECT id,'Interview',id,'owner','interviewer','nodejs',step,'',now()
                        FROM (VALUES ('active',1),('missing-index',9),('empty',0)) AS rooms(id,step)
                    """)
                    sql.executeUpdate("""
                        INSERT INTO room_tasks(id,room_id,step_index,title,description,starter_code,language)
                        VALUES ('first','active',0,'A','','','nodejs'), ('published','active',1,'B','','','nodejs'),
                               ('remaining','missing-index',0,'C','','','nodejs')
                    """)
                    sql.executeUpdate("INSERT INTO room_diagrams(room_id,id,sequence,xml) SELECT id,'diagram-' || id,7,'<xml>' || id || '</xml>' FROM rooms")
                    sql.executeUpdate("""
                        INSERT INTO room_diagram_operations(room_id,operation_id,sequence,session_id,fingerprint,xml,patch)
                        SELECT room_id,'diagram-op',7,'session','diagram-hash',xml,'[]' FROM room_diagrams
                    """)
                    sql.executeUpdate("""INSERT INTO room_whiteboards(room_id,id,sequence,elements)
                        SELECT id,'board-' || id,4,jsonb_build_array(jsonb_build_object('id',id))::text FROM rooms""")
                    sql.executeUpdate("""
                        INSERT INTO room_whiteboard_operations(room_id,operation_id,sequence,fingerprint)
                        SELECT b.room_id,op,4,'board-hash-' || op
                        FROM room_whiteboards b CROSS JOIN (VALUES ('edit'),('noop')) AS receipts(op)
                    """)
                }
                val diagramBefore = connection.rows("SELECT room_id,id,sequence,xml FROM room_diagrams ORDER BY room_id")
                val boardBefore = connection.rows("SELECT room_id,id,sequence,elements FROM room_whiteboards ORDER BY room_id")
                val diagramReceipts = connection.rows("""SELECT room_id,id,operation_id,o.sequence,session_id,fingerprint,o.xml,patch
                    FROM room_diagram_operations o JOIN room_diagrams d USING (room_id) ORDER BY room_id""")
                val boardReceipts = connection.rows("""SELECT room_id,id,operation_id,o.sequence,fingerprint
                    FROM room_whiteboard_operations o JOIN room_whiteboards b USING (room_id) ORDER BY room_id,operation_id""")
                assertEquals(2, migrate("39").migrationsExecuted)
                assertEquals(diagramBefore, connection.rows("SELECT room_id,id,sequence,xml FROM room_diagrams ORDER BY room_id"))
                assertEquals(boardBefore, connection.rows("SELECT room_id,id,sequence,elements FROM room_whiteboards ORDER BY room_id"))
                assertEquals(diagramReceipts, connection.rows("""SELECT room_id,diagram_id,operation_id,sequence,session_id,fingerprint,xml,patch
                    FROM room_diagram_operations ORDER BY room_id"""))
                assertEquals(boardReceipts, connection.rows("""SELECT room_id,board_id,operation_id,sequence,fingerprint
                    FROM room_whiteboard_operations ORDER BY room_id,operation_id"""))
                val scopes = listOf(listOf("active", "published"), listOf("empty", null), listOf("missing-index", "remaining"))
                for (table in listOf("room_diagrams", "room_whiteboards")) {
                    assertEquals(scopes, connection.rows("SELECT room_id,task_id FROM $table ORDER BY room_id"))
                }
                connection.createStatement().use { it.executeUpdate("DELETE FROM room_tasks WHERE id='published'") }
                for (table in listOf("room_diagrams", "room_whiteboards", "room_diagram_operations", "room_whiteboard_operations")) {
                    assertEquals(listOf(listOf("empty"), listOf("missing-index")), connection.rows("SELECT DISTINCT room_id FROM $table ORDER BY room_id"))
                }
            }
        }
    }

    private fun Connection.rows(query: String): List<List<String?>> = createStatement().use { statement ->
        statement.executeQuery(query).use { rows ->
            buildList {
                while (rows.next()) add((1..rows.metaData.columnCount).map(rows::getString))
            }
        }
    }
}
