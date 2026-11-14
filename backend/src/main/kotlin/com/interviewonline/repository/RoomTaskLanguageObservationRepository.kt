package com.interviewonline.repository

import com.interviewonline.model.RoomTaskLanguageObservation
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RoomTaskLanguageObservationRepository : JpaRepository<RoomTaskLanguageObservation, String> {
    fun existsByRoomIdAndLanguageAndTaskId(roomId: String, language: String, taskId: String): Boolean

    @Query("select distinct o.language from RoomTaskLanguageObservation o where o.room.id = :roomId")
    fun observedLanguages(@Param("roomId") roomId: String): Set<String>
}
