package com.interviewonline.repository

import com.interviewonline.model.Room
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.EntityGraph
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface RoomRepository : JpaRepository<Room, String> {
    fun findByInviteCode(inviteCode: String): Room?
    @EntityGraph(attributePaths = ["tasks"])
    fun findWithTasksByInviteCode(inviteCode: String): Room?
    fun findByOwnerUserId(ownerUserId: String): List<Room>
    fun findByIdAndOwnerUserId(id: String, ownerUserId: String): Room?
    fun deleteByIdAndOwnerUserId(id: String, ownerUserId: String): Long

    @Query(value = "SELECT * FROM rooms WHERE id = :roomId FOR UPDATE", nativeQuery = true)
    fun lockById(@Param("roomId") roomId: String): Room?
}
