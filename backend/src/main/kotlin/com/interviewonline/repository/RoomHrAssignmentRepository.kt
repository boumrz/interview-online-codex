package com.interviewonline.repository

import com.interviewonline.model.RoomHrAssignment
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.EntityGraph

interface RoomHrAssignmentRepository : JpaRepository<RoomHrAssignment, String> {
    fun existsByRoomIdAndUserId(roomId: String, userId: String): Boolean
    fun existsByRoomId(roomId: String): Boolean
    fun findByRoomIdAndUserId(roomId: String, userId: String): RoomHrAssignment?
    @EntityGraph(attributePaths = ["user", "room", "room.ownerUser"])
    fun findAllByRoomIdOrderByCreatedAtAscIdAsc(roomId: String): List<RoomHrAssignment>
    @EntityGraph(attributePaths = ["room", "room.ownerUser"])
    fun findAllByUserId(userId: String): List<RoomHrAssignment>
    fun deleteAllByUserId(userId: String): Long
    fun deleteAllByRoomId(roomId: String): Long
}
