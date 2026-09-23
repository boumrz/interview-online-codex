package com.interviewonline.service

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Shared admission fence for streams hosted by different backend processes. */
@Service
class RoomRealtimeActivityLeaseService(private val jdbc: JdbcTemplate) {
    private val instanceId = UUID.randomUUID().toString()
    private val registeredRooms = ConcurrentHashMap.newKeySet<String>()

    /** Called while the room row is locked by stream admission. */
    fun register(roomCode: String) {
        val expiresAt = Timestamp.from(databaseNow().plusSeconds(LEASE_SECONDS))
        val updated = jdbc.update(
            "UPDATE room_realtime_activity SET expires_at=? WHERE room_code=? AND instance_id=?",
            expiresAt, roomCode, instanceId,
        )
        if (updated == 0) {
            jdbc.update(
                "INSERT INTO room_realtime_activity (id, room_code, instance_id, expires_at) VALUES (?, ?, ?, ?)",
                UUID.randomUUID().toString(), roomCode, instanceId, expiresAt,
            )
        }
        registeredRooms.add(roomCode)
    }

    /** Returns rooms whose lease was lost, so the caller can close their streams. */
    fun reconcile(activeRooms: Set<String>): Set<String> {
        jdbc.update("DELETE FROM room_realtime_activity WHERE expires_at <= CURRENT_TIMESTAMP")
        val inactive = registeredRooms.filterNot { it in activeRooms }
        inactive.forEach { roomCode ->
            jdbc.update("DELETE FROM room_realtime_activity WHERE room_code=? AND instance_id=?", roomCode, instanceId)
            registeredRooms.remove(roomCode)
        }
        val expected = registeredRooms.toSet()
        if (expected.isEmpty()) return emptySet()

        val expiresAt = Timestamp.from(databaseNow().plusSeconds(LEASE_SECONDS))
        jdbc.update(
            "UPDATE room_realtime_activity SET expires_at=? WHERE instance_id=? AND expires_at > CURRENT_TIMESTAMP",
            expiresAt, instanceId,
        )
        val present = jdbc.queryForList(
            "SELECT room_code FROM room_realtime_activity WHERE instance_id=? AND expires_at > CURRENT_TIMESTAMP",
            String::class.java, instanceId,
        ).toSet()
        val lost = expected - present
        registeredRooms.removeAll(lost)
        return lost
    }

    fun release(roomCode: String) {
        if (roomCode !in registeredRooms) return
        jdbc.update("DELETE FROM room_realtime_activity WHERE room_code=? AND instance_id=?", roomCode, instanceId)
        registeredRooms.remove(roomCode)
    }

    private fun databaseNow(): Instant = jdbc.queryForObject(
        "SELECT CURRENT_TIMESTAMP", Timestamp::class.java,
    )!!.toInstant()

    private companion object {
        const val LEASE_SECONDS = 60L
    }
}
