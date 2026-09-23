package com.interviewonline.repository

import com.interviewonline.model.RoomHrAssignment
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.EntityGraph
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

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

    @Modifying
    @Query(
        value = """
        DELETE FROM room_hr_assignments assignment
        USING rooms room
        WHERE assignment.room_id = room.id
          AND room.team_id = :teamId
          AND assignment.user_id = :userId
        """,
        nativeQuery = true,
    )
    fun deleteAllByTeamIdAndUserId(@Param("teamId") teamId: String, @Param("userId") userId: String): Int
}
