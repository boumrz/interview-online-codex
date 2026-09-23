package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.nio.charset.StandardCharsets
import java.util.UUID

@SpringBootTest(
    properties = [
        "app.features.team-workspaces-enabled=true",
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamTaskSetIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    @Test
    fun `author can delete an unused task set without deleting its tasks`() {
        val owner = account("delete-set-owner")
        val team = team(owner, "Delete set")
        val taskId = body(createTeamTask(owner, team.id, "Graph", "kotlin")).path("task").path("id").asText()
        val setId = body(createTaskSet(owner, team.id, "Graph set", listOf(taskId))).path("taskSet").path("id").asText()
        val result = mockMvc.delete("/api/teams/${team.id}/task-sets/$setId") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn()
        assertStatus(result, 204, "unused set deleted")
        assertEquals(0, body(teamTaskSets(owner, team.id)).path("counts").path("activeSets").asInt())
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_task_templates WHERE id = ?", Int::class.java, taskId))

        val usedSetId = body(createTaskSet(owner, team.id, "Used set", listOf(taskId))).path("taskSet").path("id").asText()
        assertStatus(mockMvc.post("/api/teams/${team.id}/interviews") {
            header("Authorization", "Bearer ${owner.token}")
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Using set", "taskSetId" to usedSetId))
        }.andReturn(), 201, "interview references set")
        assertStatusAndCode(mockMvc.delete("/api/teams/${team.id}/task-sets/$usedSetId") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn(), 409, "TEAM_TASK_SET_IN_USE")
    }
    companion object {
        private val postgres = Postgres16TestSupport.create("team_task_sets")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `team task sets preserve task order support copy archive restore and enforce manager edits`() {
        postgres.verifyPostgres16()
        val owner = account("team-set-owner")
        val member = account("team-set-member")
        val peer = account("team-set-peer")
        val foreign = account("team-set-foreign")
        val team = team(owner, "Team task sets")
        seedMembership(team.id, member.id, role = "MEMBER")
        seedMembership(team.id, peer.id, role = "MEMBER")

        val firstTask = createTeamTask(member, team.id, "Graph warmup", "kotlin")
        val secondTask = createTeamTask(member, team.id, "Queue warmup", "nodejs")
        val firstTaskId = body(firstTask).path("task").path("id").asText()
        val secondTaskId = body(secondTask).path("task").path("id").asText()

        val initial = teamTaskSets(owner, team.id)
        assertStatus(initial, 200, "owner reads empty team task sets")
        assertProtectedNoStore(initial)
        assertEquals(0, body(initial).path("items").size())
        assertEquals(0, body(initial).path("counts").path("activeSets").asInt())

        val created = createTaskSet(member, team.id, " Backend pack ", listOf(secondTaskId, firstTaskId))
        assertStatus(created, 201, "active member creates a team task set")
        assertProtectedNoStore(created)
        val taskSet = body(created).path("taskSet")
        val taskSetId = taskSet.path("id").asText()
        assertEquals(
            setOf("id", "name", "items", "status", "revision", "createdByUserId"),
            taskSet.fieldNames().asSequence().toSet(),
        )
        assertEquals("Backend pack", taskSet.path("name").asText())
        assertEquals("ACTIVE", taskSet.path("status").asText())
        assertEquals(0, taskSet.path("revision").asLong())
        assertEquals(member.id, taskSet.path("createdByUserId").asText())
        assertEquals(listOf(secondTaskId, firstTaskId), taskSet.path("items").map { it.path("taskId").asText() })
        assertEquals(listOf("Queue warmup", "Graph warmup"), taskSet.path("items").map { it.path("title").asText() })
        assertEquals(listOf(0, 1), taskSet.path("items").map { it.path("position").asInt() })
        assertEquals("/api/teams/${team.id}/task-sets/$taskSetId", created.response.getHeader("Location"))

        val ownerList = teamTaskSets(owner, team.id)
        assertStatus(ownerList, 200, "owner sees member-created team task set")
        assertEquals(1, body(ownerList).path("items").size())
        assertEquals(1, body(ownerList).path("counts").path("activeSets").asInt())
        assertEquals(0, body(ownerList).path("counts").path("archivedSets").asInt())

        val peerUpdate = updateTaskSet(peer, team.id, taskSetId, "Peer edit", listOf(firstTaskId), 0)
        assertStatusAndCode(peerUpdate, 403, "INSUFFICIENT_TEAM_TASK_SET_ROLE")

        val ownerUpdate = updateTaskSet(owner, team.id, taskSetId, " Backend interview pack ", listOf(firstTaskId, secondTaskId), 0)
        assertStatus(ownerUpdate, 200, "owner edits a member-created team task set")
        val updated = body(ownerUpdate).path("taskSet")
        assertEquals("Backend interview pack", updated.path("name").asText())
        assertEquals(1, updated.path("revision").asLong())
        assertEquals(listOf(firstTaskId, secondTaskId), updated.path("items").map { it.path("taskId").asText() })

        val stale = updateTaskSet(owner, team.id, taskSetId, "Stale pack", listOf(secondTaskId), 0)
        assertStatusAndCode(stale, 409, "TEAM_TASK_SET_REVISION_CONFLICT")
        assertEquals(1, body(stale).path("currentRevision").asLong())

        val copy = copyTaskSet(peer, team.id, taskSetId)
        assertStatus(copy, 201, "active member copies a visible team task set without editing the original")
        assertProtectedNoStore(copy)
        val copied = body(copy).path("taskSet")
        assertEquals("Backend interview pack (копия)", copied.path("name").asText())
        assertEquals(peer.id, copied.path("createdByUserId").asText())
        assertEquals(0, copied.path("revision").asLong())
        assertEquals(listOf(firstTaskId, secondTaskId), copied.path("items").map { it.path("taskId").asText() })
        assertFalse(copied.path("id").asText() == taskSetId, "copy must allocate a new team task set")

        val archived = archiveTaskSet(owner, team.id, taskSetId)
        assertStatus(archived, 200, "owner archives team task set")
        assertEquals("ARCHIVED", body(archived).path("taskSet").path("status").asText())
        assertEquals(2, body(archived).path("taskSet").path("revision").asLong())
        assertEquals(1, body(teamTaskSets(owner, team.id)).path("items").size(), "copy remains active after original archive")
        assertEquals(1, body(teamTaskSets(owner, team.id, "archived")).path("items").size(), "archive filter exposes archived set")

        val restored = restoreTaskSet(owner, team.id, taskSetId)
        assertStatus(restored, 200, "owner restores team task set")
        assertEquals("ACTIVE", body(restored).path("taskSet").path("status").asText())
        assertEquals(3, body(restored).path("taskSet").path("revision").asLong())
        assertEquals(2, body(teamTaskSets(owner, team.id)).path("items").size())

        val foreignRead = teamTaskSets(foreign, team.id)
        assertStatusAndCode(foreignRead, 404, "TEAM_NOT_FOUND")
        assertProtectedNoStore(foreignRead)
        assertFalse(body(foreignRead).has("items"), "foreign read must not leak team task set data")

        val foreignCreate = createTaskSet(foreign, team.id, "Foreign pack", listOf(firstTaskId))
        assertStatusAndCode(foreignCreate, 404, "TEAM_NOT_FOUND")
    }

    @Test
    fun `active member imports an own personal preset into team tasks and a team task set`() {
        postgres.verifyPostgres16()
        val owner = account("setimp-owner")
        val member = account("setimp-member")
        val foreign = account("setimp-foreign")
        val team = team(owner, "Team task set imports")
        seedMembership(team.id, member.id, role = "MEMBER")

        val firstPersonalTask = createPersonalTask(member, "Graph warmup", "kotlin")
        val secondPersonalTask = createPersonalTask(member, "Queue warmup", "nodejs")
        val firstPersonalTaskId = firstPersonalTask.path("id").asText()
        val secondPersonalTaskId = secondPersonalTask.path("id").asText()
        val sourcePreset = createPersonalPreset(
            member,
            "Personal backend pack",
            listOf(secondPersonalTaskId, firstPersonalTaskId),
        )
        assertStatus(sourcePreset, 201, "personal preset fixture must exist")
        val sourcePresetId = body(sourcePreset).path("id").asText()

        val imported = importPersonalPreset(member, team.id, sourcePresetId)
        assertStatus(imported, 201, "active member imports own personal preset into team")
        assertProtectedNoStore(imported)
        val importedSet = body(imported).path("taskSet")
        assertEquals("Personal backend pack", importedSet.path("name").asText())
        assertEquals("ACTIVE", importedSet.path("status").asText())
        assertEquals(member.id, importedSet.path("createdByUserId").asText())
        assertEquals(0, importedSet.path("revision").asLong())
        assertEquals(listOf("Queue warmup", "Graph warmup"), importedSet.path("items").map { it.path("title").asText() })
        assertEquals(listOf("nodejs", "kotlin"), importedSet.path("items").map { it.path("language").asText() })
        assertEquals(listOf(0, 1), importedSet.path("items").map { it.path("position").asInt() })
        val importedTaskIds = importedSet.path("items").map { it.path("taskId").asText() }
        assertEquals(2, importedTaskIds.distinct().size)
        assertFalse(importedTaskIds.contains(secondPersonalTaskId), "team task set must reference team task copies, not personal task IDs")
        assertFalse(importedTaskIds.contains(firstPersonalTaskId), "team task set must reference team task copies, not personal task IDs")
        assertEquals("/api/teams/${team.id}/task-sets/${importedSet.path("id").asText()}", imported.response.getHeader("Location"))

        val teamTasks = teamTasks(member, team.id)
        assertStatus(teamTasks, 200, "imported personal preset creates team task snapshots")
        assertEquals(2, body(teamTasks).path("items").size())
        assertEquals(setOf("Queue warmup", "Graph warmup"), body(teamTasks).path("items").map { it.path("title").asText() }.toSet())
        assertEquals(importedTaskIds.toSet(), body(teamTasks).path("items").map { it.path("id").asText() }.toSet())

        val duplicateImport = importPersonalPreset(member, team.id, sourcePresetId)
        assertStatus(duplicateImport, 201, "second import chooses a unique active team set name")
        assertEquals("Personal backend pack (2)", body(duplicateImport).path("taskSet").path("name").asText())

        val foreignPreset = createPersonalPreset(
            foreign,
            "Foreign backend pack",
            listOf(createPersonalTask(foreign, "Foreign task", "nodejs").path("id").asText()),
        )
        assertStatus(foreignPreset, 201, "foreign personal preset fixture must exist")
        val hidden = importPersonalPreset(member, team.id, body(foreignPreset).path("id").asText())
        assertStatusAndCode(hidden, 404, "PERSONAL_PRESET_NOT_FOUND")

        archivePersonalPreset(member, sourcePresetId)
        val archived = importPersonalPreset(member, team.id, sourcePresetId)
        assertStatusAndCode(archived, 404, "PERSONAL_PRESET_NOT_FOUND")
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorize(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "team fixture must exist")
        return TeamFixture(body(result).path("team").path("id").asText())
    }

    private fun seedMembership(teamId: String, userId: String, role: String) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role,
        )
    }

    private fun createTeamTask(actor: HrTestAccount, teamId: String, title: String, language: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to "Team set fixture",
                    "starterCode" to "// set",
                    "language" to language,
                ),
            )
        }.andReturn()

    private fun createPersonalTask(actor: HrTestAccount, title: String, language: String): JsonNode {
        val result = mockMvc.post("/api/me/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to "Imported preset fixture",
                    "starterCode" to "// imported preset",
                    "language" to language,
                ),
            )
        }.andReturn()
        assertStatus(result, 200, "personal task fixture must exist")
        return body(result)
    }

    private fun createPersonalPreset(actor: HrTestAccount, name: String, taskIds: List<String>): MvcResult =
        mockMvc.post("/api/me/presets") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskTemplateIds" to taskIds))
        }.andReturn()

    private fun archivePersonalPreset(actor: HrTestAccount, presetId: String): MvcResult =
        mockMvc.post("/api/me/presets/$presetId/archive") { authorize(actor) }.andReturn()

    private fun teamTasks(actor: HrTestAccount, teamId: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/tasks") { authorize(actor) }.andReturn()

    private fun teamTaskSets(actor: HrTestAccount, teamId: String, status: String? = null): MvcResult =
        mockMvc.get("/api/teams/$teamId/task-sets") {
            authorize(actor)
            status?.let { param("status", it) }
        }.andReturn()

    private fun createTaskSet(actor: HrTestAccount, teamId: String, name: String, taskIds: List<String>): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskIds" to taskIds))
        }.andReturn()

    private fun importPersonalPreset(actor: HrTestAccount, teamId: String, sourcePresetId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets/import-personal") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("sourcePresetId" to sourcePresetId))
        }.andReturn()

    private fun updateTaskSet(
        actor: HrTestAccount,
        teamId: String,
        setId: String,
        name: String,
        taskIds: List<String>,
        revision: Long,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/task-sets/$setId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "taskIds" to taskIds, "revision" to revision))
        }.andReturn()

    private fun copyTaskSet(actor: HrTestAccount, teamId: String, setId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets/$setId/copy") { authorize(actor) }.andReturn()

    private fun archiveTaskSet(actor: HrTestAccount, teamId: String, setId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets/$setId/archive") { authorize(actor) }.andReturn()

    private fun restoreTaskSet(actor: HrTestAccount, teamId: String, setId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/task-sets/$setId/restore") { authorize(actor) }.andReturn()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.getContentAsString(StandardCharsets.UTF_8))

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertEquals(expected, result.response.status, "unexpected team-task-set status")
        assertEquals(code, body(result).path("code").asText(), "unexpected team-task-set error code")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "team task set response must be private and non-cacheable")
    }

    private data class TeamFixture(val id: String)
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
