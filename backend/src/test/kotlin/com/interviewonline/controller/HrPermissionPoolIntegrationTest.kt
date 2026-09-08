package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import org.springframework.test.util.AopTestUtils
import java.util.UUID
import javax.sql.DataSource

@SpringBootTest(properties = [
    "spring.datasource.hikari.maximum-pool-size=2",
    "spring.datasource.hikari.connection-timeout=1000",
    "spring.datasource.url=jdbc:h2:mem:hr_permission_pool;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
])
@AutoConfigureMockMvc
class HrPermissionPoolIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val dataSource: DataSource,
    @Autowired private val collaborationService: CollaborationService,
    @Autowired private val userRepository: UserRepository,
) {
    @ParameterizedTest
    @ValueSource(strings = ["invite", "track", "rest-role", "realtime-role"])
    fun `permission publication succeeds with only one pool connection available`(operation: String) {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "pool-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "pool-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        if (operation.endsWith("-role")) {
            require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        }
        val sessionId = "pool-${UUID.randomUUID()}"
        var eventToken = ""
        if (operation == "realtime-role") {
            collaborationService.joinRoomSse(room.inviteCode, sessionId, "owner", "Owner", null, null,
                userRepository.findById(owner.id).orElseThrow())
            val service = AopTestUtils.getTargetObject<CollaborationService>(collaborationService)
            val field = CollaborationService::class.java.getDeclaredField("participants").apply { isAccessible = true }
            val participants = field.get(service) as Map<*, *>
            val participant = participants.values.filterNotNull().single {
                it.javaClass.getDeclaredField("sessionId").apply { isAccessible = true }.get(it) == sessionId
            }
            eventToken = participant.javaClass.getDeclaredField("eventToken").apply { isAccessible = true }.get(participant) as String
        }
        // Another request owns the other connection. The request under test
        // must release its committed write connection before its fresh role read.
        dataSource.connection.use {
            when (operation) {
                "invite" -> mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hr.id}") {
                    header("Authorization", "Bearer ${owner.token}")
                }.andExpect { status { isOk() } }
                "track" -> mockMvc.post("/api/rooms/${room.inviteCode}/hr-tracking") {
                    header("Authorization", "Bearer ${owner.token}")
                }.andExpect { status { isOk() } }
                "rest-role" -> mockMvc.post("/api/rooms/${room.inviteCode}/participants/${hr.id}/role") {
                    header("Authorization", "Bearer ${owner.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"role":"candidate"}"""
                }.andExpect { status { isOk() } }
                "realtime-role" -> mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
                    contentType = MediaType.APPLICATION_JSON
                    content = objectMapper.writeValueAsString(mapOf(
                        "sessionId" to sessionId, "eventToken" to eventToken,
                        "type" to "revoke_interviewer_access", "targetUserId" to hr.id,
                    ))
                }.andExpect { status { isNoContent() } }
                else -> error("Unknown test operation")
            }
        }
    }
}
