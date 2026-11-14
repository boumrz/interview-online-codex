package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomProductMetric
import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomProductMetricRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.service.RoomAccessService
import com.interviewonline.service.RoomProductMetricsProjector
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.reflect.full.memberProperties

@SpringBootTest
@AutoConfigureMockMvc
open class ProductMetricsControllerTest {
    @Autowired private lateinit var mockMvc: MockMvc
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var userRepository: UserRepository
    @Autowired private lateinit var userSessionRepository: UserSessionRepository
    @Autowired private lateinit var roomRepository: RoomRepository
    @Autowired private lateinit var roomParticipantRepository: RoomParticipantRepository
    @Autowired private lateinit var roomProductMetricRepository: RoomProductMetricRepository
    @Autowired private lateinit var projector: RoomProductMetricsProjector
    private val moscow = ZoneId.of("Europe/Moscow")

    @AfterEach
    fun cleanup() {
        roomProductMetricRepository.deleteAll()
        roomParticipantRepository.deleteAll()
        roomRepository.deleteAll()
        userSessionRepository.deleteAll()
        userRepository.deleteAll()
    }

    @Test
    fun `projection preserves first facts and only stores safe aggregate fields`() {
        val owner = createUser("owner", "user")
        val room = createRoom(owner, yesterdayAt(9))
        projector.recordRoomCreated(room, RoomProductMetricsProjector.SOURCE_DASHBOARD)

        val firstJoin = yesterdayAt(10)
        val laterJoin = yesterdayAt(11)
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.CANDIDATE, firstJoin)
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.CANDIDATE, laterJoin)
        projector.recordMeaningfulCandidateActivity(room.id!!, yesterdayAt(10).plusSeconds(60))
        projector.recordMeaningfulCandidateActivity(room.id!!, yesterdayAt(10).plusSeconds(120))
        projector.recordVerdictSaved(room.id!!, yesterdayAt(10).plusSeconds(300))
        projector.recordVerdictSaved(room.id!!, yesterdayAt(10).plusSeconds(360))

        val metric = roomProductMetricRepository.findById(room.id!!).orElseThrow()
        assertNotNull(metric.firstCandidateJoinedAt)
        assertNotNull(metric.firstMeaningfulCandidateActivityAt)
        assertNotNull(metric.firstVerdictSavedAt)
        assertFalse(metric.latestVerdictSavedAt == metric.firstVerdictSavedAt)
        assertEquals(2, metric.realtimeConnectionCount)

        val storedPropertyNames = RoomProductMetric::class.memberProperties.map { it.name }.toSet()
        assertFalse(storedPropertyNames.any { it.contains("invite", ignoreCase = true) })
        assertFalse(storedPropertyNames.any { it.contains("user", ignoreCase = true) })
        assertFalse(storedPropertyNames.any { it.contains("session", ignoreCase = true) })
        assertFalse(storedPropertyNames.any { it.contains("code", ignoreCase = true) })
        assertFalse(storedPropertyNames.any { it.contains("note", ignoreCase = true) })
    }

    @Test
    fun `administrator receives aggregate-only decision ready metrics`() {
        val admin = createUser("admin", "admin")
        val token = createSession(admin)
        val owner = createUser("interviewer", "user")
        val room = createRoom(owner, yesterdayAt(9))
        projector.recordRoomCreated(room, RoomProductMetricsProjector.SOURCE_DASHBOARD)
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.OWNER, yesterdayAt(9).plusSeconds(60))
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.CANDIDATE, yesterdayAt(10))
        projector.recordMeaningfulCandidateActivity(room.id!!, yesterdayAt(10).plusSeconds(60))
        projector.recordVerdictSaved(room.id!!, yesterdayAt(10).plusSeconds(600))

        val storedMetric = roomProductMetricRepository.findById(room.id!!).orElseThrow()
        val canonicalBase = LocalDate.now(moscow).minusDays(1).atTime(12, 0).atZone(moscow).toInstant()
        storedMetric.createdAt = canonicalBase
        storedMetric.firstInterviewerJoinedAt = canonicalBase.plusSeconds(60)
        storedMetric.firstCandidateJoinedAt = canonicalBase.plusSeconds(120)
        storedMetric.firstMeaningfulCandidateActivityAt = canonicalBase.plusSeconds(180)
        storedMetric.firstVerdictSavedAt = canonicalBase.plusSeconds(600)
        storedMetric.latestVerdictSavedAt = canonicalBase.plusSeconds(600)
        roomProductMetricRepository.save(storedMetric)
        val day = roomProductMetricRepository.findById(room.id!!).orElseThrow()
            .createdAt
            .atZone(moscow)
            .toLocalDate()
            .toString()
        val response = mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $token")
            param("start", day)
            param("end", day)
            accept = MediaType.APPLICATION_JSON
        }
            .andExpect {
                status { isOk() }
                jsonPath("$.source") { value("server_authoritative") }
                jsonPath("$.availability") { value("available") }
                jsonPath("$.funnel.roomsCreated") { value(1) }
                jsonPath("$.funnel.decisionReadyTechnicalInterviews") { value(1) }
                jsonPath("$.daily[0].decisionReadyTechnicalInterviews") { value(1) }
            }
            .andReturn()
            .response
            .contentAsString

        assertFalse(response.contains(room.id!!))
        assertFalse(response.contains(room.inviteCode))
        assertFalse(response.contains(owner.id!!))
    }

    @Test
    fun `average weights each eligible room once by the first completion date`() {
        val admin = createUser("duration-admin", "admin")
        val token = createSession(admin)
        val noon = yesterdayAt(12)
        fun completed(candidate: Instant?, manager: Instant?, finish: Instant?) {
            val room = createRoom(admin, noon.minusSeconds(2 * 86400))
            room.finishedAt = finish
            room.status = if (finish == null) "active" else "finished"
            roomRepository.save(room)
            roomProductMetricRepository.save(RoomProductMetric(roomId = room.id!!, createdAt = room.createdAt,
                firstCandidateJoinedAt = candidate, firstInterviewerJoinedAt = manager))
        }
        completed(noon.minusSeconds(750), noon.minusSeconds(1200), noon)
        completed(noon.minusSeconds(3000), noon.minusSeconds(1650), noon)
        completed(null, noon.minusSeconds(60), noon)
        completed(noon.plusSeconds(1), noon.minusSeconds(60), noon)
        completed(noon, noon, null)
        completed(noon.minusSeconds(90000), noon.minusSeconds(87000), noon.minusSeconds(86400))
        val day = noon.atZone(moscow).toLocalDate()
        fun read(date: LocalDate) = mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $token")
            param("start", date.toString())
            param("end", date.toString())
        }
        read(day).andExpect {
            status { isOk() }
            jsonPath("$.completedInterviewDuration.measuredInterviews") { value(2) }
            jsonPath("$.completedInterviewDuration.averageMinutes") { value(20.0) }
        }
        read(day.minusDays(2)).andExpect {
            status { isOk() }
            jsonPath("$.completedInterviewDuration.measuredInterviews") { value(0) }
            jsonPath("$.completedInterviewDuration.averageMinutes") { doesNotExist() }
        }
    }

    @Test
    fun `only the first successful finish returns the interview duration`() {
        val owner = createUser("duration-owner", "user")
        val token = createSession(owner)
        val room = createRoom(owner, yesterdayAt(9))
        projector.recordRoomCreated(room, RoomProductMetricsProjector.SOURCE_DASHBOARD)
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.OWNER, yesterdayAt(10))
        projector.recordParticipantJoin(room.id!!, RoomAccessService.RoomRole.CANDIDATE, yesterdayAt(11))
        fun finish() = mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer $token")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE"}"""
        }
        val pool = Executors.newFixedThreadPool(2)
        try {
            val start = CyclicBarrier(2)
            val requests = List(2) {
                Callable {
                    start.await(10, TimeUnit.SECONDS)
                    val response = finish().andExpect { status { isOk() } }.andReturn().response
                    mapper.readTree(response.contentAsByteArray)
                }
            }
            val replies = pool.invokeAll(requests, 20, TimeUnit.SECONDS).map { it.get() }
            assertEquals(1, replies.count { it.path("completedInterviewDurationMinutes").isNumber })
            assertEquals(1, replies.count { !it.has("completedInterviewDurationMinutes") })
        } finally {
            pool.shutdownNow()
        }
        finish().andExpect {
            status { isOk() }
            jsonPath("$.completedInterviewDurationMinutes") { doesNotExist() }
        }
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer $token")
        }.andExpect {
            status { isOk() }
            jsonPath("$.completedInterviewDurationMinutes") { doesNotExist() }
        }
    }

    @Test
    fun `product metrics endpoint rejects missing privileges and invalid ranges`() {
        val admin = createUser("admin-check", "admin")
        val adminToken = createSession(admin)
        val regularUser = createUser("regular-check", "user")
        val regularToken = createSession(regularUser)
        val day = LocalDate.now(moscow).minusDays(1).toString()

        mockMvc.get("/api/admin/product-metrics") {
            param("start", day)
            param("end", day)
        }.andExpect { status { isUnauthorized() } }

        mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $regularToken")
            param("start", day)
            param("end", day)
        }.andExpect { status { isForbidden() } }

        mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $adminToken")
            param("start", day, day)
            param("end", day)
        }.andExpect { status { isBadRequest() } }

        mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $adminToken")
            param("start", day)
            param("end", LocalDate.now(moscow).toString())
        }.andExpect { status { isBadRequest() } }

        mockMvc.get("/api/admin/product-metrics") {
            header("Authorization", "Bearer $adminToken")
            param("start", day)
            param("end", day)
            param("unexpected", "value")
        }.andExpect { status { isBadRequest() } }
    }

    private fun createUser(nickname: String, role: String): User = userRepository.save(
        User(
            nickname = "${nickname}_${UUID.randomUUID().toString().take(8)}",
            displayName = nickname,
            passwordHash = "test-only",
            role = role,
        ),
    )

    private fun createSession(user: User): String {
        val token = "test_${UUID.randomUUID()}"
        userSessionRepository.save(UserSession(user = user, token = token))
        return token
    }

    private fun createRoom(owner: User, createdAt: Instant): Room = roomRepository.save(
        Room(
            title = "Safe metrics room",
            inviteCode = "private-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = owner,
            createdAt = createdAt,
        ),
    )

    private fun yesterdayAt(hour: Int): Instant = LocalDate.now(moscow)
        .minusDays(1)
        .atTime(hour, 0)
        .atZone(moscow)
        .toInstant()
}

@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ProductMetricsPostgresTest : ProductMetricsControllerTest() {
    companion object {
        private val postgres = Postgres16TestSupport.create("product_metrics")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanupSchema() = postgres.close()
    }
}
