package com.interviewonline.repository

import com.interviewonline.model.RoomKeystrokeEvent
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RoomKeystrokeEventRepository : JpaRepository<RoomKeystrokeEvent, String> {

    fun findByRoomIdOrderByTimestampEpochMsAsc(roomId: String): List<RoomKeystrokeEvent>

    @Modifying
    @Query("DELETE FROM RoomKeystrokeEvent r WHERE r.roomId = :roomId")
    fun deleteByRoomId(@Param("roomId") roomId: String): Int
}
