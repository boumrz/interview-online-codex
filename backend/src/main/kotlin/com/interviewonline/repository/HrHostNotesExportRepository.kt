package com.interviewonline.repository

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional

data class HrHostNotesRoomRow(
    val roomId: String,
    val ownerUserId: String?,
    val privateNotesJson: String?,
    val notes: String?,
)

data class HrHostNotesTaskRow(
    val roomId: String,
    val stepIndex: Int,
    val privateNotesJson: String?,
    val interviewerNotes: String?,
)

data class HrHostNotesExportSnapshot(
    val rooms: Map<String, HrHostNotesRoomRow>,
    val tasks: Map<String, List<HrHostNotesTaskRow>>,
)

/** Reads durable note sources only for the already authorized export snapshot. */
@Repository
class HrHostNotesExportRepository(private val jdbc: NamedParameterJdbcTemplate) {
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 30)
    fun snapshot(roomIds: Collection<String>): HrHostNotesExportSnapshot {
        val roomRows = mutableListOf<HrHostNotesRoomRow>()
        val taskRows = mutableListOf<HrHostNotesTaskRow>()
        roomIds.distinct().chunked(500).forEach { chunk ->
            val params = mapOf("roomIds" to chunk)
            roomRows.addAll(jdbc.query(
                "SELECT id, owner_user_id, private_notes_json, notes FROM rooms WHERE id IN (:roomIds)",
                params,
            ) { row, _ ->
                HrHostNotesRoomRow(row.getString("id"), row.getString("owner_user_id"), row.getString("private_notes_json"), row.getString("notes"))
            })
            taskRows.addAll(jdbc.query(
                """
                SELECT room_id, step_index, private_notes_json, interviewer_notes
                FROM room_tasks WHERE room_id IN (:roomIds)
                  AND (private_notes_json IS NOT NULL OR interviewer_notes IS NOT NULL)
                ORDER BY room_id, step_index, id
                """.trimIndent(),
                params,
            ) { row, _ ->
                HrHostNotesTaskRow(row.getString("room_id"), row.getInt("step_index"), row.getString("private_notes_json"), row.getString("interviewer_notes"))
            })
        }
        return HrHostNotesExportSnapshot(roomRows.associateBy { it.roomId }, taskRows.groupBy { it.roomId })
    }
}
