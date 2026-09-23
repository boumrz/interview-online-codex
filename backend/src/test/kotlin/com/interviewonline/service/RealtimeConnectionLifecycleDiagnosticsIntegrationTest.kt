package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.context.annotation.Import
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.util.AopTestUtils
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(properties = ["spring.task.scheduling.enabled=false"])
@Import(RealtimeConnectionLifecycleDiagnosticsTestConfiguration::class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class RealtimeConnectionLifecycleDiagnosticsIntegrationTest(
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val diagnosticLines: CopyOnWriteArrayList<String>,
) {
    @Test
    fun `replacement logs once and stale completion logs nothing`() {
        val (room, owner) = createRoomWithOwner()
        val sessionId = "diagnostic-replacement-${UUID.randomUUID()}"
        val target = targetService()

        collaborationService.joinRoomSse(
            room.inviteCode,
            sessionId,
            "participant",
            "Participant",
            null,
            null,
            owner,
        )
        val firstConnectionId = connectionId(target, room.inviteCode, sessionId)
        collaborationService.joinRoomSse(
            room.inviteCode,
            sessionId,
            "participant",
            "Participant",
            null,
            null,
            owner,
        )

        assertEquals(1, diagnosticLines.count { it.contains("reason=replacement") })
        val recordsBeforeStaleCompletion = diagnosticLines.toList()

        collaborationService.leaveRoomConnection(firstConnectionId)

        assertEquals(recordsBeforeStaleCompletion, diagnosticLines.toList())
    }

    @Test
    fun `aggregate observation does not publish a hybrid registry membership`() {
        val (room, owner) = createRoomWithOwner()
        val sessionId = "diagnostic-coherence-${UUID.randomUUID()}"
        val target = targetService()
        collaborationService.joinRoomSse(
            room.inviteCode,
            sessionId,
            "participant",
            "Participant",
            null,
            null,
            owner,
        )
        val connectionId = connectionId(target, room.inviteCode, sessionId)
        val detachedAfterParticipantRemoval = CountDownLatch(1)
        val allowDetachToContinue = CountDownLatch(1)
        replaceParticipantsMap(
            target = target,
            blockedConnectionId = connectionId,
            detachedAfterParticipantRemoval = detachedAfterParticipantRemoval,
            allowDetachToContinue = allowDetachToContinue,
        )
        val executor = Executors.newFixedThreadPool(2)

        try {
            val detach = executor.submit { collaborationService.leaveRoomConnection(connectionId) }
            assertTrue(detachedAfterParticipantRemoval.await(5, TimeUnit.SECONDS))
            val observe = executor.submit {
                invokeDiagnosticObservation(target, RoomRealtimeLifecycleDiagnosticReason.ROUTE_UNMOUNT)
            }

            allowDetachToContinue.countDown()
            detach.get(5, TimeUnit.SECONDS)
            observe.get(5, TimeUnit.SECONDS)
        } finally {
            allowDetachToContinue.countDown()
            executor.shutdownNow()
        }

        val observed = diagnosticLines.single { it.contains("reason=route-unmount") }
        val counts = Regex(
            "registryConnections=(\\d+) registryParticipants=(\\d+) registryRoomMemberships=(\\d+)",
        ).find(observed)?.groupValues?.drop(1)?.map(String::toInt)
            ?: error("Diagnostic record did not include aggregate registry counts: $observed")
        assertEquals(listOf(counts.first(), counts.first()), counts.drop(1))
    }

    private fun createRoomWithOwner(): Pair<Room, User> {
        val suffix = UUID.randomUUID().toString()
        val owner = userRepository.save(
            User(
                nickname = "diagnostic-owner-$suffix",
                passwordHash = "diagnostic-password",
            ),
        )
        val room = roomRepository.save(
            Room(
                title = "Diagnostic room",
                inviteCode = "diagnostic-$suffix",
                ownerSessionToken = "owner-$suffix",
                interviewerSessionToken = "interviewer-$suffix",
                ownerUser = owner,
            ),
        )
        return room to owner
    }

    private fun targetService(): CollaborationService =
        AopTestUtils.getTargetObject(collaborationService)

    @Suppress("UNCHECKED_CAST")
    private fun connectionId(service: CollaborationService, inviteCode: String, sessionId: String): String {
        val connections = field(service, "connectionByRoomSession").get(service) as ConcurrentHashMap<String, String>
        return requireNotNull(connections["$inviteCode::$sessionId"])
    }

    @Suppress("UNCHECKED_CAST")
    private fun replaceParticipantsMap(
        target: CollaborationService,
        blockedConnectionId: String,
        detachedAfterParticipantRemoval: CountDownLatch,
        allowDetachToContinue: CountDownLatch,
    ) {
        val original = field(target, "participants").get(target) as ConcurrentHashMap<String, Any>
        val replacement = BlockingParticipantsMap(
            blockedConnectionId = blockedConnectionId,
            detachedAfterParticipantRemoval = detachedAfterParticipantRemoval,
            allowDetachToContinue = allowDetachToContinue,
        )
        replacement.putAll(original)
        field(target, "participants").set(target, replacement)
    }

    private fun invokeDiagnosticObservation(
        target: CollaborationService,
        reason: RoomRealtimeLifecycleDiagnosticReason,
    ) {
        target.javaClass.getDeclaredMethod(
            "recordRoomRealtimeLifecycleDiagnostic",
            RoomRealtimeLifecycleDiagnosticReason::class.java,
        ).apply { isAccessible = true }.invoke(target, reason)
    }

    private fun field(target: CollaborationService, name: String) =
        target.javaClass.getDeclaredField(name).apply { isAccessible = true }

    private class BlockingParticipantsMap(
        private val blockedConnectionId: String,
        private val detachedAfterParticipantRemoval: CountDownLatch,
        private val allowDetachToContinue: CountDownLatch,
    ) : ConcurrentHashMap<String, Any>() {
        override fun remove(key: String): Any? {
            val removed = super.remove(key)
            if (key == blockedConnectionId && removed != null) {
                detachedAfterParticipantRemoval.countDown()
                check(allowDetachToContinue.await(5, TimeUnit.SECONDS))
            }
            return removed
        }
    }
}

@TestConfiguration(proxyBeanMethods = false)
private class RealtimeConnectionLifecycleDiagnosticsTestConfiguration {
    @Bean
    fun lifecycleDiagnosticLines(): CopyOnWriteArrayList<String> = CopyOnWriteArrayList()

    @Bean
    @Primary
    fun lifecycleDiagnostics(
        lifecycleDiagnosticLines: CopyOnWriteArrayList<String>,
    ): RoomRealtimeLifecycleDiagnostics = RoomRealtimeLifecycleDiagnostics(
        enabled = true,
        hikariCounts = { RoomRealtimeLifecycleHikariCounts(active = 5, idle = 6) },
        appendLine = lifecycleDiagnosticLines::add,
    )
}
