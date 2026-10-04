package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
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
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(properties = ["app.team-invitation-link-encryption.active-key-id=integration-v1", "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"])
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LibraryRemovalSnapshotIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("library_remove")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test
    fun `personal task used in preset and finished room can be deleted without changing snapshot`() {
        val owner = account("remove-personal")
        val first = task(owner, null, "Original task")
        val second = task(owner, null, "Remaining task")
        val preset = body(post(owner, "/api/me/presets", mapOf("name" to "Used preset", "taskTemplateIds" to listOf(first, second)))).path("id").asText()
        val room = body(post(owner, "/api/rooms", mapOf("title" to "Independent snapshot", "taskIds" to listOf(first, second))))
        val roomId = room.path("id").asText()
        seedResult(roomId)
        val before = snapshots(roomId)
        val roomReadBefore = readSnapshot(owner, room.path("inviteCode").asText())
        val realtimeBefore = readRealtimeSnapshot(owner, room.path("inviteCode").asText())
        assertEquals(200, remove(owner, "/api/me/tasks/$first").response.status)
        assertEquals(0, count("user_task_templates", first))
        assertEquals(before, snapshots(roomId))
        val currentPreset = body(get(owner, "/api/me/presets/$preset"))
        assertEquals(listOf(second), currentPreset.path("items").map { it.path("taskTemplateId").asText() })
        assertEquals(0, currentPreset.path("items")[0].path("position").asInt())
        assertEquals(1, currentPreset.path("revision").asLong())
        assertEquals(roomReadBefore, readSnapshot(owner, room.path("inviteCode").asText()))
        assertEquals(realtimeBefore, readRealtimeSnapshot(owner, room.path("inviteCode").asText()))
        assertEquals(200, remove(owner, "/api/me/presets/$preset").response.status)
        assertEquals(before, snapshots(roomId))
        assertEquals(1, count("user_task_templates", second))
    }

    @Test
    fun `used team task removes live set and programme references but preserves every room snapshot field`() {
        val owner = account("remove-team")
        val team = team(owner)
        val first = task(owner, team, "Mandatory task")
        val second = task(owner, team, "Remaining task")
        val third = task(owner, team, "Third task")
        val set = set(owner, team, listOf(first, second, third))
        val trackResponse = post(owner, "/api/teams/$team/tracks", mapOf("name" to "Standard"))
        assertEquals(201, trackResponse.response.status, trackResponse.response.contentAsString)
        val track = body(trackResponse).path("track").path("id").asText()
        val programme = UUID.randomUUID().toString()
        jdbc.update("INSERT INTO team_interview_programmes(id,team_id,target_type,target_id,status,version,revision,created_by_user_id,created_at,updated_at) VALUES (?,?,'TRACK',?,'PUBLISHED',1,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", programme, team, track, owner.id)
        listOf(first, second, third).forEachIndexed { position, task -> jdbc.update("INSERT INTO team_interview_programme_items(id,programme_id,task_template_id,position,mandatory) VALUES (?,?,?,?,true)", UUID.randomUUID().toString(), programme, task, position) }
        val room = body(createTeamRoom(owner, team, listOf(first, second, third), set, track, programme, 1)).path("interview")
        val roomId = room.path("id").asText()
        seedResult(roomId)
        val before = snapshots(roomId)
        val roomReadBefore = readSnapshot(owner, room.path("inviteCode").asText())
        val realtimeBefore = readRealtimeSnapshot(owner, room.path("inviteCode").asText())
        assertEquals(204, remove(owner, "/api/teams/$team/tasks/$first").response.status)
        assertEquals(0, count("team_task_templates", first))
        assertEquals(before, snapshots(roomId))
        val currentSet = body(get(owner, "/api/teams/$team/task-sets")).path("items").single()
        assertEquals(listOf(second, third), currentSet.path("items").map { it.path("taskId").asText() })
        assertEquals(listOf(0, 1), currentSet.path("items").map { it.path("position").asInt() })
        assertEquals(1, currentSet.path("revision").asLong())
        assertEquals(1, jdbc.queryForObject("SELECT revision FROM team_interview_programmes WHERE id=?", Long::class.java, programme))
        assertEquals(2, jdbc.queryForObject("SELECT version FROM team_interview_programmes WHERE id=?", Long::class.java, programme))
        assertEquals(listOf(0, 1), jdbc.queryForList("SELECT position FROM team_interview_programme_items WHERE programme_id=? ORDER BY position", Int::class.java, programme))
        assertEquals(204, remove(owner, "/api/teams/$team/tasks/$second").response.status)
        assertEquals("PUBLISHED", jdbc.queryForObject("SELECT status FROM team_interview_programmes WHERE id=?", String::class.java, programme))
        assertEquals(204, remove(owner, "/api/teams/$team/tasks/$third").response.status)
        assertEquals("DRAFT", jdbc.queryForObject("SELECT status FROM team_interview_programmes WHERE id=?", String::class.java, programme))
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM team_tracks WHERE id=?", String::class.java, track))
        assertEquals(before, snapshots(roomId))
        assertEquals(roomReadBefore, readSnapshot(owner, room.path("inviteCode").asText()))
        assertEquals(realtimeBefore, readRealtimeSnapshot(owner, room.path("inviteCode").asText()))
    }

    @Test
    fun `team set used by interview is deletable while tasks and room snapshot survive`() {
        val owner = account("remove-set")
        val team = team(owner)
        val task = task(owner, team, "Snapshot task")
        val set = set(owner, team, listOf(task))
        val room = body(createTeamRoom(owner, team, emptyList(), set)).path("interview")
        val roomId = room.path("id").asText()
        val before = snapshots(roomId)
        val roomReadBefore = readSnapshot(owner, room.path("inviteCode").asText())
        val realtimeBefore = readRealtimeSnapshot(owner, room.path("inviteCode").asText())
        assertEquals(204, remove(owner, "/api/teams/$team/task-sets/$set").response.status)
        assertEquals(0, count("team_task_sets", set))
        assertEquals(1, count("team_task_templates", task))
        assertNull(jdbc.queryForObject("SELECT team_task_set_id FROM rooms WHERE id=?", String::class.java, roomId))
        assertEquals(0, jdbc.queryForObject("SELECT team_task_set_revision FROM rooms WHERE id=?", Long::class.java, roomId))
        assertEquals(true, jdbc.queryForObject("SELECT team_interview_created FROM rooms WHERE id=?", Boolean::class.java, roomId))
        assertEquals(before, snapshots(roomId))
        assertEquals(roomReadBefore, readSnapshot(owner, room.path("inviteCode").asText()))
        assertEquals(realtimeBefore, readRealtimeSnapshot(owner, room.path("inviteCode").asText()))
    }

    @Test
    fun `archive and restore endpoints are removed without altering catalogue rows`() {
        val owner = account("no-archive")
        val team = team(owner)
        val personal = task(owner, null, "Personal")
        val preset = body(post(owner, "/api/me/presets", mapOf("name" to "Personal set", "taskTemplateIds" to listOf(personal)))).path("id").asText()
        val task = task(owner, team, "Team")
        val set = set(owner, team, listOf(task))
        listOf("/api/me/presets/$preset", "/api/teams/$team/tasks/$task", "/api/teams/$team/task-sets/$set").forEach { base ->
            listOf("archive", "restore").forEach { action -> assertEquals(404, post(owner, "$base/$action", emptyMap<String, String>()).response.status) }
        }
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM task_presets WHERE id=?", String::class.java, preset))
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM team_task_templates WHERE id=?", String::class.java, task))
        assertEquals("ACTIVE", jdbc.queryForObject("SELECT status FROM team_task_sets WHERE id=?", String::class.java, set))
        assertEquals(listOf(preset), body(get(owner, "/api/me/presets?status=archived")).map { it.path("id").asText() })
        assertEquals(1, body(get(owner, "/api/teams/$team/tasks?status=archived")).path("items").size())
        assertEquals(1, body(get(owner, "/api/teams/$team/task-sets?status=archived")).path("items").size())
    }

    @Test
    fun `delete preserves author owner admin boundaries and foreign or removed member cannot mutate`() {
        val owner = account("delete-owner")
        val author = account("delete-author")
        val peer = account("delete-peer")
        val foreign = account("delete-foreign")
        val admin = account("delete-admin")
        val team = team(owner)
        listOf(author, peer, admin).forEach { join(team, it, if (it == admin) "ADMIN" else "MEMBER") }
        val task = task(author, team, "Author task")
        val set = set(author, team, listOf(task))
        listOf("tasks/$task", "task-sets/$set").forEach { suffix ->
            assertEquals(403, remove(peer, "/api/teams/$team/$suffix").response.status)
            assertEquals(404, remove(foreign, "/api/teams/$team/$suffix").response.status)
        }
        jdbc.update("UPDATE team_memberships SET state='REMOVED' WHERE team_id=? AND user_id=?", team, author.id)
        assertEquals(404, remove(author, "/api/teams/$team/tasks/$task").response.status)
        assertEquals(1, count("team_task_templates", task))
        assertEquals(204, remove(admin, "/api/teams/$team/task-sets/$set").response.status)
        assertEquals(204, remove(owner, "/api/teams/$team/tasks/$task").response.status)
        val personal = task(owner, null, "Private")
        assertEquals(404, remove(peer, "/api/me/tasks/$personal").response.status)
        assertEquals(1, count("user_task_templates", personal))
    }

    @Test
    fun `concurrent interview creation then deletion serializes and preserves committed snapshot`() {
        val owner = account("delete-concur")
        val team = team(owner)
        val task = task(owner, team, "Concurrent snapshot")
        val executor = Executors.newFixedThreadPool(2)
        try {
            postgres.connection().use { connection ->
                connection.autoCommit = false
                val blocker = connection.createStatement().use { it.executeQuery("SELECT pg_backend_pid()").use { row -> row.next(); row.getInt(1) } }
                connection.prepareStatement("SELECT id FROM teams WHERE id=? FOR UPDATE").use { it.setString(1, team); it.executeQuery().close() }
                val creation = executor.submit<MvcResult> { createTeamRoom(owner, team, listOf(task)) }
                awaitBlocked(blocker, 1)
                val deletion = executor.submit<MvcResult> { remove(owner, "/api/teams/$team/tasks/$task") }
                awaitBlocked(blocker, 2)
                connection.commit()
                val created = creation.get(15, TimeUnit.SECONDS)
                assertEquals(201, created.response.status)
                assertEquals(204, deletion.get(15, TimeUnit.SECONDS).response.status)
                val roomId = body(created).path("interview").path("id").asText()
                assertEquals(listOf("Concurrent snapshot"), snapshots(roomId).map { it["title"] })
                assertEquals(0, count("team_task_templates", task))
            }
        } finally { executor.shutdownNow() }
    }

    private fun awaitBlocked(pid: Int, expected: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (System.nanoTime() < deadline) {
            val count = jdbc.queryForObject("WITH RECURSIVE waiting AS (SELECT pid FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)) UNION SELECT activity.pid FROM pg_stat_activity activity JOIN waiting parent ON parent.pid = ANY(pg_blocking_pids(activity.pid))) SELECT COUNT(DISTINCT pid) FROM waiting", Int::class.java, pid)!!
            if (count >= expected) return
            Thread.sleep(10)
        }
        fail<Unit>("Expected $expected commands to wait for TEAM lock")
    }
    private val snapshotFields = listOf("code", "language", "currentStep", "briefingMarkdown", "status", "verdict", "tasks")
    private fun readSnapshot(actor: HrTestAccount, inviteCode: String): Map<String, JsonNode> {
        val response = get(actor, "/api/rooms/$inviteCode")
        assertEquals(200, response.response.status)
        val room = body(response)
        return snapshotFields.associateWith { room.path(it) }
    }
    private fun readRealtimeSnapshot(actor: HrTestAccount, inviteCode: String): Map<String, JsonNode> {
        val stream = mvc.get("/api/realtime/rooms/$inviteCode/stream") {
            header("Authorization", "Bearer ${actor.token}")
            param("sessionId", "delete-check-${UUID.randomUUID()}")
            param("displayName", "Snapshot verifier")
        }.andReturn()
        assertEquals(200, stream.response.status)
        val payload = stream.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }.path("payload")
        return listOf("code", "language", "currentStep", "briefingMarkdown", "tasks").associateWith { payload.path(it) }
    }
    private fun seedResult(roomId: String) { jdbc.update("UPDATE rooms SET status='finished',finished_at=CURRENT_TIMESTAMP,verdict='HIRE' WHERE id=?", roomId); jdbc.update("UPDATE room_tasks SET score=5, solution_code='persisted solution', private_notes_json='[]' WHERE room_id=?", roomId) }
    private fun snapshots(roomId: String) = jdbc.queryForList("SELECT id,step_index,title,description,starter_code,language,mandatory,score,solution_code,private_notes_json,source_task_template_id FROM room_tasks WHERE room_id=? ORDER BY step_index", roomId)
    private fun count(table: String, id: String) = jdbc.queryForObject("SELECT COUNT(*) FROM $table WHERE id=?", Int::class.java, id)
    private fun account(prefix: String) = HrHttpFixtures.register(mvc, mapper, false, prefix).first
    private fun team(owner: HrTestAccount): String {
        val id = UUID.randomUUID().toString()
        jdbc.update("INSERT INTO teams(id,name,normalized_name,owner_user_id,state,created_at,updated_at) VALUES (?,? ,? ,? ,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", id, "Team $id", "team $id", owner.id)
        join(id, owner, "ADMIN")
        return id
    }
    private fun join(team: String, actor: HrTestAccount, role: String) = jdbc.update("INSERT INTO team_memberships(id,team_id,user_id,role,state,created_at,updated_at) VALUES (?,?,?,?,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), team, actor.id, role)
    private fun task(actor: HrTestAccount, team: String?, title: String): String {
        val result = post(actor, if (team == null) "/api/me/tasks" else "/api/teams/$team/tasks", mapOf("title" to title, "description" to "Original condition", "starterCode" to "original code", "language" to "kotlin"))
        assertEquals(if (team == null) 200 else 201, result.response.status)
        return (if (team == null) body(result) else body(result).path("task")).path("id").asText()
    }
    private fun set(actor: HrTestAccount, team: String, tasks: List<String>) = body(post(actor, "/api/teams/$team/task-sets", mapOf("name" to "Set ${UUID.randomUUID()}", "taskIds" to tasks))).path("taskSet").path("id").asText()
    private fun createTeamRoom(actor: HrTestAccount, team: String, tasks: List<String>, set: String? = null, track: String? = null, programme: String? = null, version: Long? = null) = post(actor, "/api/teams/$team/interviews", mapOf("title" to "Snapshot room", "taskIds" to tasks.takeIf { it.isNotEmpty() }, "taskSetId" to set, "trackId" to track, "programmeId" to programme, "programmeVersion" to version).filterValues { it != null }).also { assertEquals(201, it.response.status, it.response.contentAsString) }
    private fun post(actor: HrTestAccount, path: String, content: Any) = mvc.post(path) { header("Authorization", "Bearer ${actor.token}"); header("Idempotency-Key", UUID.randomUUID().toString()); contentType = MediaType.APPLICATION_JSON; this.content = mapper.writeValueAsString(content) }.andReturn()
    private fun remove(actor: HrTestAccount, path: String) = mvc.delete(path) { header("Authorization", "Bearer ${actor.token}") }.andReturn()
    private fun get(actor: HrTestAccount, path: String) = mvc.get(path) { header("Authorization", "Bearer ${actor.token}") }.andReturn()
    private fun body(result: MvcResult): JsonNode = mapper.readTree(result.response.contentAsString)
}
