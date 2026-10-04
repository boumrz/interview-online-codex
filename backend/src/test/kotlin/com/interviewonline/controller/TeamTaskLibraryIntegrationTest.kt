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
class TeamTaskLibraryIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    @Test
    fun `team task can be deleted by creator even when referenced by a set`() {
        val owner = account("delete-task-owner")
        val team = team(owner, "Delete task team")
        val first = body(createTeamTask(owner, team.id, "Free", "", "", "kotlin")).path("task").path("id").asText()
        val second = body(createTeamTask(owner, team.id, "Used", "", "", "kotlin")).path("task").path("id").asText()
        val base = "/api/teams/${team.id}/tasks"
        assertStatus(mockMvc.delete("$base/$first") { header("Authorization", "Bearer ${owner.token}") }.andReturn(), 204, "unused task deleted")
        assertStatus(mockMvc.post("/api/teams/${team.id}/task-sets") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to "Set", "taskIds" to listOf(second)))
        }.andReturn(), 201, "referencing set created")
        assertStatus(mockMvc.delete("$base/$second") { header("Authorization", "Bearer ${owner.token}") }.andReturn(), 204, "used task deleted")
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM team_task_set_items WHERE task_template_id=?", Int::class.java, second))
    }
    companion object {
        private val postgres = Postgres16TestSupport.create("team_tasks")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `team task library is isolated from personal tasks and writable by active team members`() {
        postgres.verifyPostgres16()
        val owner = account("team-task-owner")
        val member = account("team-task-member")
        val peer = account("team-task-peer")
        val foreign = account("team-task-foreign")
        val team = team(owner, "Team task library")
        seedMembership(team.id, member.id, role = "MEMBER")
        seedMembership(team.id, peer.id, role = "MEMBER")

        val personalTask = createPersonalTask(owner, "Personal-only task")
        assertStatus(personalTask, 200, "personal fixture must exist")
        val personalTaskId = body(personalTask).path("id").asText()
        val initial = teamTasks(owner, team.id)
        assertStatus(initial, 200, "owner reads empty team library")
        assertProtectedNoStore(initial)
        assertEquals(setOf("items", "counts"), body(initial).fieldNames().asSequence().toSet())
        assertEquals(0, body(initial).path("items").size())
        assertEquals(0, body(initial).path("counts").path("activeTasks").asInt())

        val created = createTeamTask(
            member,
            team.id,
            title = " Binary tree traversal ",
            description = "Check recursion and queues",
            starterCode = "fun main() = Unit",
            language = " Kotlin ",
        )
        assertStatus(created, 201, "active member creates a team task")
        assertProtectedNoStore(created)
        val task = body(created).path("task")
        assertEquals(
            setOf("id", "title", "description", "starterCode", "language", "status", "revision", "createdByUserId"),
            task.fieldNames().asSequence().toSet(),
        )
        assertEquals("Binary tree traversal", task.path("title").asText())
        assertEquals("kotlin", task.path("language").asText())
        assertEquals("ACTIVE", task.path("status").asText())
        assertEquals(0, task.path("revision").asLong())
        assertEquals(member.id, task.path("createdByUserId").asText())
        assertEquals("/api/teams/${team.id}/tasks/${task.path("id").asText()}", created.response.getHeader("Location"))

        val ownerList = teamTasks(owner, team.id)
        assertStatus(ownerList, 200, "owner sees member-created team task")
        assertEquals(1, body(ownerList).path("items").size())
        assertEquals("Binary tree traversal", body(ownerList).path("items")[0].path("title").asText())
        assertEquals(1, body(ownerList).path("counts").path("activeTasks").asInt())
        assertEquals(0, body(ownerList).path("counts").path("archivedTasks").asInt())
        assertFalse(
            body(ownerList).path("items").any { it.path("title").asText() == "Personal-only task" },
            "team library must not leak personal task templates",
        )

        val searchByDescription = teamTasks(owner, team.id, language = "kotlin", query = "queues")
        assertStatus(searchByDescription, 200, "team task search works inside visible team data")
        assertEquals(1, body(searchByDescription).path("items").size())
        assertEquals(1, body(searchByDescription).path("counts").path("activeTasks").asInt(), "counts are not reduced by search")
        assertEquals(0, body(teamTasks(owner, team.id, language = "python")).path("items").size())

        val taskId = task.path("id").asText()
        val peerUpdate = updateTeamTask(peer, team.id, taskId, "Peer edit", "Peer", "// peer", "kotlin", 0)
        assertStatusAndCode(peerUpdate, 403, "INSUFFICIENT_TEAM_TASK_ROLE")

        val ownerUpdate = updateTeamTask(owner, team.id, taskId, " Graph traversal ", "Owner polished", "fun solve() = Unit", "kotlin", 0)
        assertStatus(ownerUpdate, 200, "owner can edit a member-created team task")
        val updatedTask = body(ownerUpdate).path("task")
        assertEquals("Graph traversal", updatedTask.path("title").asText())
        assertEquals("Owner polished", updatedTask.path("description").asText())
        assertEquals(1, updatedTask.path("revision").asLong())

        val stale = updateTeamTask(owner, team.id, taskId, "Stale edit", "", "", "kotlin", 0)
        assertStatusAndCode(stale, 409, "TEAM_TASK_REVISION_CONFLICT")
        assertEquals(1, body(stale).path("currentRevision").asLong())

        assertStatus(archiveTeamTask(owner, team.id, taskId), 404, "archive endpoint removed")
        assertStatus(restoreTeamTask(owner, team.id, taskId), 404, "restore endpoint removed")
        assertEquals(1, body(teamTasks(owner, team.id)).path("items").size(), "task remains in common list")
        assertEquals(1, body(teamTasks(owner, team.id, status = "archived")).path("items").size(), "legacy status parameter does not hide library rows")

        val peerPersonalImport = importPersonalTask(peer, team.id, personalTaskId)
        assertStatusAndCode(peerPersonalImport, 404, "PERSONAL_TASK_NOT_FOUND")

        val importedPersonal = importPersonalTask(owner, team.id, personalTaskId)
        assertStatus(importedPersonal, 201, "owner imports own personal task into the team")
        assertProtectedNoStore(importedPersonal)
        val imported = body(importedPersonal).path("task")
        assertEquals("Personal-only task", imported.path("title").asText())
        assertEquals("Personal description", imported.path("description").asText())
        assertEquals("// personal", imported.path("starterCode").asText())
        assertEquals("nodejs", imported.path("language").asText())
        assertEquals("ACTIVE", imported.path("status").asText())
        assertEquals(0, imported.path("revision").asLong())
        assertEquals(owner.id, imported.path("createdByUserId").asText())
        assertEquals("/api/teams/${team.id}/tasks/${imported.path("id").asText()}", importedPersonal.response.getHeader("Location"))
        assertEquals(2, body(teamTasks(owner, team.id)).path("items").size(), "personal import creates a separate team task")

        val teamCopy = copyTeamTask(peer, team.id, taskId)
        assertStatus(teamCopy, 201, "any active member can copy a visible team task without editing the original")
        assertProtectedNoStore(teamCopy)
        val copied = body(teamCopy).path("task")
        assertEquals("Graph traversal (копия)", copied.path("title").asText())
        assertEquals("Owner polished", copied.path("description").asText())
        assertEquals("fun solve() = Unit", copied.path("starterCode").asText())
        assertEquals("kotlin", copied.path("language").asText())
        assertEquals(peer.id, copied.path("createdByUserId").asText())
        assertEquals(0, copied.path("revision").asLong())
        assertFalse(copied.path("id").asText() == taskId, "copy must allocate a new team task")
        val afterCopy = body(teamTasks(owner, team.id)).path("items")
        assertEquals(3, afterCopy.size(), "team copy adds a third active task")
        assertEquals("Graph traversal", afterCopy.first { it.path("id").asText() == taskId }.path("title").asText(), "copy must not rename the original")

        val foreignRead = teamTasks(foreign, team.id)
        assertStatusAndCode(foreignRead, 404, "TEAM_NOT_FOUND")
        assertProtectedNoStore(foreignRead)
        assertFalse(body(foreignRead).has("items"), "foreign read must not leak team task data")

        val foreignCreate = createTeamTask(foreign, team.id, "Leaked task", "", "", "nodejs")
        assertStatusAndCode(foreignCreate, 404, "TEAM_NOT_FOUND")
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

    private fun teamTasks(
        actor: HrTestAccount,
        teamId: String,
        language: String? = null,
        query: String? = null,
        status: String? = null,
    ): MvcResult =
        mockMvc.get("/api/teams/$teamId/tasks") {
            authorize(actor)
            language?.let { param("language", it) }
            query?.let { param("q", it) }
            status?.let { param("status", it) }
        }.andReturn()

    private fun createTeamTask(
        actor: HrTestAccount,
        teamId: String,
        title: String,
        description: String,
        starterCode: String,
        language: String,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to description,
                    "starterCode" to starterCode,
                    "language" to language,
                ),
            )
        }.andReturn()

    private fun updateTeamTask(
        actor: HrTestAccount,
        teamId: String,
        taskId: String,
        title: String,
        description: String,
        starterCode: String,
        language: String,
        revision: Long,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tasks/$taskId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to description,
                    "starterCode" to starterCode,
                    "language" to language,
                    "revision" to revision,
                ),
            )
        }.andReturn()

    private fun archiveTeamTask(actor: HrTestAccount, teamId: String, taskId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks/$taskId/archive") { authorize(actor) }.andReturn()

    private fun restoreTeamTask(actor: HrTestAccount, teamId: String, taskId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks/$taskId/restore") { authorize(actor) }.andReturn()

    private fun importPersonalTask(actor: HrTestAccount, teamId: String, sourceTaskId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks/import-personal") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("sourceTaskId" to sourceTaskId))
        }.andReturn()

    private fun copyTeamTask(actor: HrTestAccount, teamId: String, taskId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks/$taskId/copy") { authorize(actor) }.andReturn()

    private fun createPersonalTask(actor: HrTestAccount, title: String): MvcResult =
        mockMvc.post("/api/me/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to "Personal description",
                    "starterCode" to "// personal",
                    "language" to "nodejs",
                ),
            )
        }.andReturn()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertEquals(expected, result.response.status, "unexpected team-task status")
        assertEquals(code, body(result).path("code").asText(), "unexpected team-task error code")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "team task response must be private and non-cacheable")
    }

    private data class TeamFixture(val id: String)
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
