package com.interviewonline.repository

import com.interviewonline.model.RoomTask
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

data class HrTaskRow(
    val roomId: String,
    val taskId: String,
    val stepIndex: Int,
    val title: String,
    val score: Int?,
)

interface RoomTaskRepository : JpaRepository<RoomTask, String> {
    fun findAllByRoomIdInOrderByRoomIdAscStepIndexAsc(roomIds: Collection<String>): List<RoomTask>

    @Query(
        """
        select new com.interviewonline.repository.HrTaskRow(room.id, task.id, task.stepIndex, task.title, task.score)
        from RoomTask task join task.room room
        where room.id in :roomIds
        order by room.id asc, task.stepIndex asc, task.id asc
        """,
    )
    fun findHrTaskRows(@Param("roomIds") roomIds: Collection<String>): List<HrTaskRow>

    @Query("select count(task) from RoomTask task where task.room.id in :roomIds")
    fun countByRoomIds(@Param("roomIds") roomIds: Collection<String>): Long
}
