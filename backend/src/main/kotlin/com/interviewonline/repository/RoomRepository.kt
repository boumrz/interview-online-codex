package com.interviewonline.repository

import com.interviewonline.model.Room
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.EntityGraph
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

data class PersonalRoomManagerNameRow(val roomId: String, val userId: String, val displayName: String?)

interface RoomRepository : JpaRepository<Room, String> {
    @Query("""
        select new com.interviewonline.repository.PersonalRoomManagerNameRow(room.id, owner.id, owner.displayName)
        from Room room join room.ownerUser owner
        where room.id in :roomIds
        order by room.id asc
    """)
    fun findPersonalSummaryOwnerNames(@Param("roomIds") roomIds: Collection<String>): List<PersonalRoomManagerNameRow>

    fun findByInviteCode(inviteCode: String): Room?
    // Task publication and canvas writes lock this row for update. A shared
    // lock lets readers run together, after any pending publication commits,
    // and keeps the selected task and its contents consistent through this read.
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select r from Room r where r.inviteCode = :inviteCode")
    fun lockForSharedReadByInviteCode(@Param("inviteCode") inviteCode: String): Room?

    @Query(value = "SELECT * FROM rooms WHERE invite_code = :inviteCode FOR SHARE NOWAIT", nativeQuery = true)
    fun lockForImmediateSharedReadByInviteCode(@Param("inviteCode") inviteCode: String): Room?

    @EntityGraph(attributePaths = ["tasks"])
    fun findWithTasksByInviteCode(inviteCode: String): Room?
    @EntityGraph(attributePaths = ["tasks"])
    fun findWithTasksById(id: String): Room?
    @EntityGraph(attributePaths = ["tasks"])
    fun findAllByTeamIdAndArchivedAtIsNullOrderByCreatedAtDescIdAsc(teamId: String): List<Room>
    fun findByOwnerUserId(ownerUserId: String): List<Room>
    fun findByIdAndOwnerUserId(id: String, ownerUserId: String): Room?
    fun deleteByIdAndOwnerUserId(id: String, ownerUserId: String): Long

    @Query(value = "SELECT team_id FROM rooms WHERE id = :roomId", nativeQuery = true)
    fun findStoredTeamId(@Param("roomId") roomId: String): String?

    @Query(value = "SELECT id FROM rooms WHERE id = :roomId FOR UPDATE", nativeQuery = true)
    fun lockIdById(@Param("roomId") roomId: String): String?

    @Query(value = "SELECT id FROM rooms WHERE invite_code = :inviteCode FOR UPDATE", nativeQuery = true)
    fun lockIdByInviteCode(@Param("inviteCode") inviteCode: String): String?

    @Query(value = "SELECT id FROM rooms WHERE invite_code = :inviteCode FOR UPDATE SKIP LOCKED", nativeQuery = true)
    fun tryLockIdByInviteCode(@Param("inviteCode") inviteCode: String): String?

}

fun RoomRepository.lockById(roomId: String): Room? = lockIdById(roomId)?.let { findById(it).orElse(null) }
fun RoomRepository.lockByInviteCode(inviteCode: String): Room? =
    lockIdByInviteCode(inviteCode)?.let { findById(it).orElse(null) }
