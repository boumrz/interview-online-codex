package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.post
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
}
