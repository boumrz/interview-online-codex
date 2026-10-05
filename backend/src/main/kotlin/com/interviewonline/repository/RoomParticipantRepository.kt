package com.interviewonline.repository

import com.interviewonline.model.RoomParticipant
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RoomParticipantRepository : JpaRepository<RoomParticipant, String> {
    @Query("""
        select new com.interviewonline.repository.PersonalRoomManagerNameRow(room.id, manager.id, manager.displayName)
        from RoomParticipant participant join participant.room room join participant.user manager
        where room.id in :roomIds and lower(trim(participant.role)) in ('owner', 'interviewer')
        order by room.id asc, participant.createdAt asc, participant.id asc
    """)
    fun findPersonalSummaryInterviewerNames(@Param("roomIds") roomIds: Collection<String>): List<PersonalRoomManagerNameRow>

    fun findAllByUserId(userId: String): List<RoomParticipant>
    fun findAllByRoomIdOrderByCreatedAtAsc(roomId: String): List<RoomParticipant>
    fun findAllByRoomIdIn(roomIds: Collection<String>): List<RoomParticipant>
    fun findByRoomIdAndUserId(roomId: String, userId: String): RoomParticipant?
    fun deleteByRoomIdAndUserId(roomId: String, userId: String)
    fun deleteAllByUserId(userId: String): Long
    fun deleteAllByRoomId(roomId: String): Long

    @Modifying
    @Query(
        value = """
        DELETE FROM room_participants participant
        USING rooms room
        WHERE participant.room_id = room.id
          AND room.team_id = :teamId
          AND participant.user_id = :userId
        """,
        nativeQuery = true,
    )
    fun deleteAllByTeamIdAndUserId(@Param("teamId") teamId: String, @Param("userId") userId: String): Int
}
