package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.ResolveHiringManagerPreviewRequest
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomProductMetricRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.RoomTaskRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.service.HiringManagerPreviewService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.mock.mockito.SpyBean
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.mockito.Mockito.doThrow

@SpringBootTest
@AutoConfigureMockMvc
class HiringManagerPreviewIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val sessionRepository: UserSessionRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val roomTaskRepository: RoomTaskRepository,
    @Autowired private val participantRepository: RoomParticipantRepository,
    @Autowired private val assignmentRepository: RoomHrAssignmentRepository,
    @Autowired private val metricRepository: RoomProductMetricRepository,
) {
    @SpyBean
    private lateinit var hiringManagerPreviewService: HiringManagerPreviewService

    @Test
    fun `any authenticated creator receives only a minimal eligible preview and it writes nothing`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-creator")
        val (target, targetRegistration) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-eligible")
        val targetName = targetRegistration.path("user").path("displayName").asText()
        val before = persistenceCounts()

        val result = postPreview(creator.token, mapOf("invitationId" to target.id.uppercase()))

        assertEquals(200, result.response.status)
        assertPrivacyHeaders(result)
        val body = objectMapper.readTree(result.response.contentAsString)
        assertEquals(setOf("normalizedId", "displayName"), body.fieldNames().asSequence().toSet())
        assertEquals(target.id, body.path("normalizedId").asText())
        assertEquals(targetName, body.path("displayName").asText())
        assertFalse(body.has("nickname"))
        assertFalse(body.has("email"))
        assertFalse(body.has("role"))
        assertFalse(body.has("isHr"))
        assertFalse(body.has("token"))
        assertEquals(before, persistenceCounts(), "Preview must not create room, task, membership, assignment, session, profile, or metric state")
    }

    @Test
    fun `preview rejects malformed and forged body fields without target data`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-malformed")
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-mal-target")
        val before = persistenceCounts()
        val bodies = listOf(
            emptyMap<String, Any?>(),
            mapOf("invitationId" to ""),
            mapOf("invitationId" to "not-a-uuid"),
            mapOf("invitationId" to 7),
            mapOf("invitationId" to target.id, "displayName" to "Подмена"),
            mapOf("invitationId" to target.id, "role" to "admin"),
            mapOf("invitationId" to target.id, "isHr" to true),
            mapOf("invitationId" to target.id, "requesterId" to target.id),
        )

        for (body in bodies) {
            val result = postPreview(creator.token, body)
            assertEquals(400, result.response.status)
            assertPrivacyHeaders(result)
            assertErrorOnly(result)
        }
        assertEquals(before, persistenceCounts())
    }

    @Test
    fun `preview rejects duplicate raw invitation ID members without target data or writes`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-duplicate")
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-dup-target")
        val before = persistenceCounts()

        val result = postPreviewRaw(
            creator.token,
            """{"invitationId":"${target.id}","invitationId":"${target.id}"}""",
        )

        assertEquals(400, result.response.status)
        assertPrivacyHeaders(result)
        assertErrorOnly(result)
        assertEquals(before, persistenceCounts())
    }

    @Test
    fun `preview masks data access failures with a private retryable response and no writes`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-data-access")
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-data-target")
        val before = persistenceCounts()
        val request = ResolveHiringManagerPreviewRequest(target.id)
        doThrow(DataAccessResourceFailureException("connection details must not escape"))
            .`when`(hiringManagerPreviewService)
            .resolve(request)

        val result = postPreview(creator.token, mapOf("invitationId" to target.id))

        assertEquals(503, result.response.status)
        assertPrivacyHeaders(result)
        assertErrorOnly(result)
        assertEquals("Временная ошибка сервиса", objectMapper
            .readTree(result.response.contentAsString).path("error").asText())
        assertEquals(before, persistenceCounts())
    }

    @Test
    fun `preview masks unexpected failures with a private error response and no writes`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-unexpected")
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-unexp-tgt")
        val before = persistenceCounts()
        val request = ResolveHiringManagerPreviewRequest(target.id)
        doThrow(IllegalStateException("internal target detail must not escape"))
            .`when`(hiringManagerPreviewService)
            .resolve(request)

        val result = postPreview(creator.token, mapOf("invitationId" to target.id))

        assertEquals(500, result.response.status)
        assertPrivacyHeaders(result)
        assertErrorOnly(result)
        assertEquals("Внутренняя ошибка сервиса", objectMapper
            .readTree(result.response.contentAsString).path("error").asText())
        assertEquals(before, persistenceCounts())
    }

    @Test
    fun `unknown ordinary and opted-out targets share one opaque unavailable response`() {
        val (creator, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-unavailable")
        val (ordinary, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "preview-ordinary")
        val (optedOut, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-opted-out")
        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer ${optedOut.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Уже отключён","isHr":false}"""
        }.andExpect { status { isOk() } }
        val before = persistenceCounts()
        val results = listOf(
            postPreview(creator.token, mapOf("invitationId" to "00000000-0000-0000-0000-000000000000")),
            postPreview(creator.token, mapOf("invitationId" to ordinary.id)),
            postPreview(creator.token, mapOf("invitationId" to optedOut.id)),
        )

        for (result in results) {
            assertEquals(404, result.response.status)
            assertPrivacyHeaders(result)
            assertEquals("Нанимающий не найден или недоступен", objectMapper
                .readTree(result.response.contentAsString).path("error").asText())
            assertErrorOnly(result)
        }
        assertEquals(results[0].response.contentAsString, results[1].response.contentAsString)
        assertEquals(results[1].response.contentAsString, results[2].response.contentAsString)
        assertEquals(before, persistenceCounts())
    }

    @Test
    fun `preview has no get or public route and denies missing or forged sessions`() {
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "preview-auth-target")
        val before = persistenceCounts()
        for (token in listOf<String?>(null, "forged-session-token")) {
            val result = postPreview(token, mapOf("invitationId" to target.id))
            assertEquals(401, result.response.status)
            assertPrivacyHeaders(result)
            assertErrorOnly(result)
        }
        mockMvc.get("/api/me/hiring-manager-preview") {
            header("Authorization", "Bearer ${target.token}")
        }.andExpect { status { isMethodNotAllowed() } }
        mockMvc.post("/api/public/hiring-manager-preview") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("invitationId" to target.id))
        }.andExpect { status { isNotFound() } }
        assertEquals(before, persistenceCounts())
    }

    private fun postPreview(token: String?, body: Any): org.springframework.test.web.servlet.MvcResult =
        mockMvc.post("/api/me/hiring-manager-preview") {
            token?.let { header("Authorization", "Bearer $it") }
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(body)
        }.andReturn()

    private fun postPreviewRaw(token: String?, body: String): org.springframework.test.web.servlet.MvcResult =
        mockMvc.post("/api/me/hiring-manager-preview") {
            token?.let { header("Authorization", "Bearer $it") }
            contentType = MediaType.APPLICATION_JSON
            content = body
        }.andReturn()

    private fun assertPrivacyHeaders(result: org.springframework.test.web.servlet.MvcResult) {
        assertEquals("no-store", result.response.getHeader("Cache-Control"))
        assertEquals("no-referrer", result.response.getHeader("Referrer-Policy"))
    }

    private fun assertErrorOnly(result: org.springframework.test.web.servlet.MvcResult) {
        val body = objectMapper.readTree(result.response.contentAsString)
        assertEquals(setOf("error"), body.fieldNames().asSequence().toSet())
        assertTrue(body.path("error").asText().isNotBlank())
    }

    private fun persistenceCounts() = PreviewPersistenceCounts(
        users = userRepository.count(),
        sessions = sessionRepository.count(),
        rooms = roomRepository.count(),
        roomTasks = roomTaskRepository.count(),
        participants = participantRepository.count(),
        assignments = assignmentRepository.count(),
        metrics = metricRepository.count(),
    )

    private data class PreviewPersistenceCounts(
        val users: Long,
        val sessions: Long,
        val rooms: Long,
        val roomTasks: Long,
        val participants: Long,
        val assignments: Long,
        val metrics: Long,
    )
}
