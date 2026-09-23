package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.zaxxer.hikari.HikariDataSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.annotation.DirtiesContext
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

@SpringBootTest(properties = ["spring.task.scheduling.enabled=false"])
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class RoomStreamAdmissionSendBoundaryIntegrationTest(
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val dataSource: DataSource,
    @Autowired private val roomRealtimeSendBoundaryProbe: RoomRealtimeSendBoundaryProbe,
) {
    @Test
    fun `room admission releases transaction and Hikari lease before direct state sync send`() {
        val (room, owner) = createRoomWithOwner()
        val preAdmissionActive = hikariActiveConnections()
        val gate = roomRealtimeSendBoundaryProbe.armForTest()
        val executor = Executors.newSingleThreadExecutor()
        val admission = executor.submit<SseEmitter> {
            collaborationService.joinRoomSse(
                inviteCode = room.inviteCode,
                sessionId = "send-boundary-${UUID.randomUUID()}",
                participantId = "participant",
                displayName = "Send boundary participant",
                ownerToken = null,
                interviewerToken = null,
                user = owner,
            )
        }

        try {
            assertTrue(gate.awaitEntered(5, TimeUnit.SECONDS), "SEND_BOUNDARY_GATE_NOT_REACHED")
            val observation = gate.observation()
            assertFalse(
                observation.transactionActive,
                "SEND_BOUNDARY_TRANSACTION_ACTIVE active=${observation.hikariActive} idle=${observation.hikariIdle} baseline=$preAdmissionActive",
            )
            assertEquals(
                preAdmissionActive,
                observation.hikariActive,
                "SEND_BOUNDARY_HIKARI_ACTIVE_CHANGED transactionActive=${observation.transactionActive}",
            )
        } finally {
            gate.release()
            runCatching { admission.get(5, TimeUnit.SECONDS) }.getOrNull()?.complete()
            executor.shutdownNow()
        }
    }

    private fun createRoomWithOwner(): Pair<Room, User> {
        val suffix = UUID.randomUUID().toString()
        val owner = userRepository.save(
            User(
                nickname = "send-boundary-owner-$suffix",
                passwordHash = "send-boundary-password",
            ),
        )
        val room = roomRepository.save(
            Room(
                title = "Send boundary room",
                inviteCode = "send-boundary-$suffix",
                ownerSessionToken = "owner-$suffix",
                interviewerSessionToken = "interviewer-$suffix",
                ownerUser = owner,
            ),
        )
        return room to owner
    }

    private fun hikariActiveConnections(): Int {
        val hikari = runCatching { dataSource.unwrap(HikariDataSource::class.java) }.getOrNull()
            ?: dataSource as? HikariDataSource
            ?: error("Hikari datasource is required for the exact send-boundary test")
        return hikari.hikariPoolMXBean.activeConnections
    }
}
