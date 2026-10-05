package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.post
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

internal data class HrTestAccount(
    val id: String,
    val token: String,
)

internal data class HrTestRoom(
    val id: String,
    val inviteCode: String,
)

internal object HrHttpFixtures {
    fun register(
        mockMvc: MockMvc,
        objectMapper: ObjectMapper,
        isHr: Boolean,
        prefix: String = "hr-test",
    ): Pair<HrTestAccount, JsonNode> {
        val suffix = UUID.randomUUID().toString().replace("-", "").take(12)
        val result = mockMvc.post("/api/auth/register") {
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "nickname" to "$prefix-$suffix",
                    "displayName" to "$prefix $suffix",
                    "password" to "secret-$suffix",
                    "isHr" to isHr,
                ),
            )
        }.andReturn()
        require(result.response.status == 200) {
            "registration failed: ${result.response.status} ${result.response.contentAsString}"
        }
        val body = objectMapper.readTree(result.response.contentAsString)
        return HrTestAccount(
            id = body.path("user").path("id").asText(),
            token = body.path("token").asText(),
        ) to body
    }

    fun createRoom(
        mockMvc: MockMvc,
        objectMapper: ObjectMapper,
        owner: HrTestAccount,
        title: String = "HR acceptance room",
    ): HrTestRoom {
        val result = mockMvc.post("/api/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf("title" to title, "language" to "kotlin", "taskIds" to emptyList<String>()),
            )
        }.andReturn()
        require(result.response.status == 200) {
            "room creation failed: ${result.response.status} ${result.response.contentAsString}"
        }
        val body = objectMapper.readTree(result.response.contentAsString)
        return HrTestRoom(body.path("id").asText(), body.path("inviteCode").asText())
    }

    fun inviteHr(mockMvc: MockMvc, owner: HrTestAccount, room: HrTestRoom, hr: HrTestAccount): MvcResult =
        org.springframework.test.web.servlet.request.MockMvcRequestBuilders
            .put("/api/rooms/${room.inviteCode}/hr-managers/${hr.id}")
            .header("Authorization", "Bearer ${owner.token}")
            .let(mockMvc::perform)
            .andReturn()

    fun createTeam(mockMvc: MockMvc, objectMapper: ObjectMapper, owner: HrTestAccount, name: String = "HR test team"): String {
        val result = mockMvc.post("/api/teams") {
            header("Authorization", "Bearer ${owner.token}"); header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to "$name ${UUID.randomUUID()}"))
        }.andReturn()
        require(result.response.status == 201) { "team fixture creation failed: ${result.response.status}" }
        return objectMapper.readTree(result.response.contentAsString).path("team").path("id").asText()
    }

    fun createTeamRoom(mockMvc: MockMvc, objectMapper: ObjectMapper, owner: HrTestAccount, title: String = "TEAM HR acceptance room"): HrTestRoom {
        val teamId = createTeam(mockMvc, objectMapper, owner)
        val result = mockMvc.post("/api/teams/$teamId/interviews") {
            header("Authorization", "Bearer ${owner.token}"); header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON; content = objectMapper.writeValueAsString(mapOf("title" to title))
        }.andReturn()
        require(result.response.status == 201) { "team interview fixture creation failed: ${result.response.status}" }
        val body = objectMapper.readTree(result.response.contentAsString).path("interview")
        return HrTestRoom(body.path("id").asText(), body.path("inviteCode").asText())
    }

    /** Historical PERSONAL data only; new external hiring must use a real TEAM REST grant. */
    fun seedLegacyPersonalHiringAssignment(jdbc: JdbcTemplate, room: HrTestRoom, hr: HrTestAccount) {
        require(jdbc.queryForObject("SELECT team_id FROM rooms WHERE id=?", String::class.java, room.id) == null) {
            "Legacy PERSONAL fixture cannot seed a TEAM room"
        }
        jdbc.update("INSERT INTO room_hr_assignments(id,room_id,user_id,created_at) SELECT ?,?,?,CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM room_hr_assignments WHERE room_id=? AND user_id=?)",
            UUID.randomUUID().toString(), room.id, hr.id, room.id, hr.id)
        val ownerId = jdbc.queryForObject("SELECT owner_user_id FROM rooms WHERE id=?", String::class.java, room.id)
        if (ownerId != hr.id) jdbc.update("INSERT INTO room_participants(id,room_id,user_id,role,created_at) SELECT ?,?,?,'interviewer',CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM room_participants WHERE room_id=? AND user_id=?)",
            UUID.randomUUID().toString(), room.id, hr.id, room.id, hr.id)
    }

    fun seedLegacyPersonalTracking(jdbc: JdbcTemplate, room: HrTestRoom, owner: HrTestAccount) =
        seedLegacyPersonalHiringAssignment(jdbc, room, owner)
}
