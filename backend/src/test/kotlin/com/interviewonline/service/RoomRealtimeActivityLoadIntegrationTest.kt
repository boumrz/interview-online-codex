package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomRealtimeActivityLoadIntegrationTest(
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val leaseService: RoomRealtimeActivityLeaseService,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("room_activity_load")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `forty parallel streams publish one process lease and leave no live activity after close`() {
        postgres.verifyPostgres16()
        val suffix = UUID.randomUUID().toString()
        val owner = userRepository.save(User(nickname = "load-$suffix", passwordHash = "not-used"))
        val room = roomRepository.save(Room(
            title = "Concurrent stream load",
            inviteCode = "load-$suffix",
            ownerSessionToken = "owner-$suffix",
            interviewerSessionToken = "interviewer-$suffix",
            ownerUser = owner,
        ))
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(16)
        try {
            val admissions = (1..40).map { index ->
                pool.submit {
                    start.await()
                    collaborationService.joinRoomSse(
                        inviteCode = room.inviteCode,
                        sessionId = "load-$index-$suffix",
                        participantId = "participant-$index",
                        displayName = "Participant $index",
                        ownerToken = null,
                        interviewerToken = null,
                        user = owner,
                    )
                }
            }
            start.countDown()
            admissions.forEach { it.get(60, TimeUnit.SECONDS) }
            assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=? AND expires_at > CURRENT_TIMESTAMP",
                Int::class.java, room.inviteCode,
            ))
            collaborationService.closeRoom(room.inviteCode)
            assertEquals(0, jdbc.queryForObject(
                "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, room.inviteCode,
            ))
        } finally {
            pool.shutdownNow()
            collaborationService.closeRoom(room.inviteCode)
        }
    }

    @Test
    fun `expired lease from a crashed backend is removed during the next reconciliation`() {
        val roomCode = "crashed-${UUID.randomUUID()}"
        jdbc.update(
            "INSERT INTO room_realtime_activity (id, room_code, instance_id, expires_at) VALUES (?, ?, ?, ?)",
            UUID.randomUUID().toString(), roomCode, UUID.randomUUID().toString(),
            java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(2)),
        )
        leaseService.reconcile(emptySet())
        assertEquals(0, jdbc.queryForObject(
            "SELECT COUNT(*) FROM room_realtime_activity WHERE room_code=?", Int::class.java, roomCode,
        ))
    }
}
