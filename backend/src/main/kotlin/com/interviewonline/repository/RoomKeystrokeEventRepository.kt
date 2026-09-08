package com.interviewonline.repository

import com.interviewonline.model.RoomKeystrokeEvent
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RoomKeystrokeEventRepository : JpaRepository<RoomKeystrokeEvent, String> {

    fun findByRoomIdAndSourceEventId(roomId: String, sourceEventId: String): RoomKeystrokeEvent?

    fun findFirstByRoomIdAndAcceptedSequenceIsNotNullOrderByAcceptedSequenceDesc(roomId: String): RoomKeystrokeEvent?

    fun findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(roomId: String): List<RoomKeystrokeEvent>

    @Query("""
        SELECT event FROM RoomKeystrokeEvent event
        WHERE event.roomId = :roomId AND event.acceptedSequence <= :throughSequence
          AND (:beforeSequence IS NULL OR event.acceptedSequence < :beforeSequence)
        ORDER BY event.acceptedSequence DESC
    """)
    fun findActivityBefore(
        @Param("roomId") roomId: String,
        @Param("beforeSequence") beforeSequence: Long?,
        @Param("throughSequence") throughSequence: Long,
        pageable: Pageable,
    ): List<RoomKeystrokeEvent>

    @Query("""
        SELECT event FROM RoomKeystrokeEvent event
        WHERE event.roomId = :roomId AND event.acceptedSequence > :afterSequence
          AND event.acceptedSequence <= :throughSequence
        ORDER BY event.acceptedSequence ASC
    """)
    fun findActivityAfter(
        @Param("roomId") roomId: String,
        @Param("afterSequence") afterSequence: Long,
        @Param("throughSequence") throughSequence: Long,
        pageable: Pageable,
    ): List<RoomKeystrokeEvent>

    @Modifying
    @Query("DELETE FROM RoomKeystrokeEvent r WHERE r.roomId = :roomId")
    fun deleteByRoomId(@Param("roomId") roomId: String): Int
}
