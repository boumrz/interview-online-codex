package com.interviewonline.repository

import com.interviewonline.model.RoomParticipant
import org.springframework.data.jpa.repository.JpaRepository

interface RoomParticipantRepository : JpaRepository<RoomParticipant, String> {
    fun findAllByUserId(userId: String): List<RoomParticipant>
    fun findAllByRoomIdOrderByCreatedAtAsc(roomId: String): List<RoomParticipant>
    fun findByRoomIdAndUserId(roomId: String, userId: String): RoomParticipant?
    fun deleteByRoomIdAndUserId(roomId: String, userId: String)
    fun deleteAllByUserId(userId: String): Long
    fun deleteAllByRoomId(roomId: String): Long
}
