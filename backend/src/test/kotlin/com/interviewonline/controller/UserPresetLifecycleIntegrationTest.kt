package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.nio.charset.StandardCharsets

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class UserPresetLifecycleIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("user_preset_lifecycle")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `personal task sets support copy revision updates and removed archive endpoints without losing order`() {
        postgres.verifyPostgres16()
        val owner = account("preset-owner")
        val foreign = account("preset-foreign")
        val firstTaskId = createPersonalTask(owner, "Graph warmup", "kotlin").path("id").asText()
        val secondTaskId = createPersonalTask(owner, "Queue warmup", "nodejs").path("id").asText()

        val created = createPreset(owner, "Backend set", listOf(firstTaskId, secondTaskId))
        assertEquals(201, created.response.status, "owner creates a personal task set")
        val preset = body(created)
        val presetId = preset.path("id").asText()
        assertEquals("Backend set", preset.path("name").asText())
        assertEquals("ACTIVE", preset.path("status").asText())
        assertEquals(0, preset.path("revision").asLong())
        assertEquals(listOf(firstTaskId, secondTaskId), preset.path("items").map { it.path("taskTemplateId").asText() })
        assertEquals(listOf(0, 1), preset.path("items").map { it.path("position").asInt() })

        val copied = copyPreset(owner, presetId)
        assertEquals(201, copied.response.status, "owner copies a personal task set")
        val copy = body(copied)
        val copyId = copy.path("id").asText()
        assertNotEquals(presetId, copyId, "copy must allocate a new preset")
        assertEquals("Backend set (копия)", copy.path("name").asText())
        assertEquals("ACTIVE", copy.path("status").asText())
        assertEquals(0, copy.path("revision").asLong())
        assertEquals(listOf(firstTaskId, secondTaskId), copy.path("items").map { it.path("taskTemplateId").asText() })

        val foreignCopy = copyPreset(foreign, presetId)
        assertStatusAndCode(foreignCopy, 404, "PRESET_NOT_FOUND")

        assertEquals(404, archivePreset(owner, presetId).response.status, "archive endpoint removed")
        assertEquals(404, restorePreset(owner, presetId).response.status, "restore endpoint removed")
        assertEquals(setOf(copyId, presetId), body(listPresets(owner)).map { it.path("id").asText() }.toSet())
        assertEquals(setOf(copyId, presetId), body(listPresets(owner, "archived")).map { it.path("id").asText() }.toSet())
        assertEquals(200, updatePreset(owner, presetId, "Backend intermediate", listOf(firstTaskId, secondTaskId), revision = 0).response.status)

        val stale = updatePreset(owner, presetId, "Backend stale", listOf(secondTaskId), revision = 0)
        assertStatusAndCode(stale, 409, "PRESET_REVISION_CONFLICT")
        assertEquals(1, body(stale).path("currentRevision").asLong())

        val reordered = updatePreset(owner, presetId, "Backend interview set", listOf(secondTaskId, firstTaskId), revision = 1)
        assertEquals(200, reordered.response.status, "owner updates with current revision")
        val reorderedBody = body(reordered)
        assertEquals(2, reorderedBody.path("revision").asLong())
        assertEquals("Backend interview set", reorderedBody.path("name").asText())
        assertEquals(listOf(secondTaskId, firstTaskId), reorderedBody.path("items").map { it.path("taskTemplateId").asText() })
        assertEquals(listOf(0, 1), reorderedBody.path("items").map { it.path("position").asInt() })
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun createPersonalTask(actor: HrTestAccount, title: String, language: String): JsonNode {
        val result = mockMvc.post("/api/me/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to "Preset fixture",
                    "starterCode" to "// preset",
                    "language" to language,
                ),
            )
        }.andReturn()
        assertEquals(200, result.response.status, "personal task fixture must exist")
        return body(result)
    }

    private fun listPresets(actor: HrTestAccount, status: String? = null): MvcResult =
        mockMvc.get("/api/me/presets") {
            authorize(actor)
            status?.let { param("status", it) }
        }.andReturn()

    private fun createPreset(actor: HrTestAccount, name: String, taskIds: List<String>): MvcResult =
        mockMvc.post("/api/me/presets") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskTemplateIds" to taskIds))
        }.andReturn()

    private fun updatePreset(actor: HrTestAccount, presetId: String, name: String, taskIds: List<String>, revision: Long): MvcResult =
        mockMvc.put("/api/me/presets/$presetId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskTemplateIds" to taskIds, "revision" to revision))
        }.andReturn()

    private fun copyPreset(actor: HrTestAccount, presetId: String): MvcResult =
        mockMvc.post("/api/me/presets/$presetId/copy") { authorize(actor) }.andReturn()

    private fun archivePreset(actor: HrTestAccount, presetId: String): MvcResult =
        mockMvc.post("/api/me/presets/$presetId/archive") { authorize(actor) }.andReturn()

    private fun restorePreset(actor: HrTestAccount, presetId: String): MvcResult =
        mockMvc.post("/api/me/presets/$presetId/restore") { authorize(actor) }.andReturn()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.getContentAsString(StandardCharsets.UTF_8))

    private fun assertStatusAndCode(result: MvcResult, expectedStatus: Int, code: String) {
        assertEquals(expectedStatus, result.response.status, "unexpected preset status")
        assertEquals(code, body(result).path("code").asText(), "unexpected preset error code")
    }
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
