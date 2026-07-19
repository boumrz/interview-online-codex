package com.interviewonline.controller

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
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlin.reflect.full.memberProperties

@SpringBootTest
@AutoConfigureMockMvc
class ProductMetricsControllerTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val userSessionRepository: UserSessionRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val roomParticipantRepository: RoomParticipantRepository,
    @Autowired private val roomProductMetricRepository: RoomProductMetricRepository,
    @Autowired private val projector: RoomProductMetricsProjector,
) {
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
