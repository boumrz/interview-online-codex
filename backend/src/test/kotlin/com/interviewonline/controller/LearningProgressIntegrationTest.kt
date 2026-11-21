package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.jdbc.core.JdbcTemplate
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LearningProgressIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("learning")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @BeforeAll fun verifyDatabase() = postgres.verifyPostgres16()
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    private data class Proof(val sessionId: String, val eventToken: String)
    private fun connect(room: HrTestRoom, user: HrTestAccount): Proof {
        val sessionId = UUID.randomUUID().toString()
        val response = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", sessionId)
            header("Authorization", "Bearer ${user.token}")
        }.andExpect { status { isOk() } }.andReturn().response.contentAsString
        val state = response.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }.last { it.path("type").asText() == "state_sync" }
        return Proof(sessionId, state.path("payload").path("eventToken").asText())
    }

    @Test
    fun `progress is account scoped persistent and optimistic transitions are idempotent`() {
        val (user, _) = HrHttpFixtures.register(mvc, mapper, false, "learn")
        val path = "/api/me/learning/personal_interviews"
        mvc.get(path) { header("Authorization", "Bearer ${user.token}") }.andExpect {
            status { isOk() }; jsonPath("$.offerSeen") { value(false) }
        }
        var revision = 0L
        fun command(action: String, step: Int? = null, id: String = UUID.randomUUID().toString()): String {
            val result = mvc.post(path) {
                header("Authorization", "Bearer ${user.token}")
                contentType = MediaType.APPLICATION_JSON
                content = mapper.writeValueAsString(mapOf("commandId" to id, "expectedVersion" to 2, "expectedRevision" to revision,
                    "action" to action, "source" to "help", "step" to step))
            }.andExpect { status { isOk() } }.andReturn().response.contentAsString
            revision = mapper.readTree(result).path("state").path("revision").asLong()
            return result
        }
        command("offer_seen")
        command("offer_skip")
        command("manual_open")
        val commandId = UUID.randomUUID().toString()
        val started = mapper.readTree(command("start", id = commandId))
        assertEquals("first_start", started.path("events")[0].asText())
        assertEquals(true, started.path("state").path("skipped").asBoolean())
        val repeated = mapper.readTree(command("start", id = commandId))
        assertEquals(0, repeated.path("events").size())
        command("step", 1)
        mvc.get(path) { header("Authorization", "Bearer ${user.token}") }.andExpect {
            jsonPath("$.completedSteps") { value(1) }; jsonPath("$.status") { value("in_progress") }
        }
        command("step", 2)
        command("step", 3)
        command("step", 4)
        assertEquals("first_done", mapper.readTree(command("finish")).path("events")[0].asText())
        assertEquals("replay_start", mapper.readTree(command("start")).path("events")[0].asText())
        command("cancel")
        val (other, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-other")
        mvc.get(path) { header("Authorization", "Bearer ${other.token}") }.andExpect {
            jsonPath("$.offerSeen") { value(false) }; jsonPath("$.completions") { value(0) }
        }
        mvc.post(path) {
            header("Authorization", "Bearer ${user.token}"); contentType = MediaType.APPLICATION_JSON
            content = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"start","source":"help"}"""
        }.andExpect { status { isConflict() } }
    }

    @Test
    fun `guest and candidate cannot read or mutate room learning`() {
        val (owner, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-owner")
        val (candidate, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-candidate")
        val room = HrHttpFixtures.createRoom(mvc, mapper, owner)
        val path = "/api/me/learning/room?inviteCode=${room.inviteCode}"
        mvc.get(path).andExpect { status { isUnauthorized() } }
        mvc.get(path) { header("Authorization", "Bearer ${candidate.token}") }.andExpect { status { isForbidden() } }
        mvc.post(path) {
            header("Authorization", "Bearer ${candidate.token}"); contentType = MediaType.APPLICATION_JSON
            content = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"start","source":"help"}"""
        }.andExpect { status { isForbidden() } }
        mvc.get(path) { header("Authorization", "Bearer ${owner.token}") }.andExpect { status { isForbidden() } }
        val proof = connect(room, owner)
        mvc.get(path) { header("Authorization", "Bearer ${owner.token}"); param("sessionId", proof.sessionId); header("X-Room-Event-Token", proof.eventToken) }.andExpect { status { isOk() } }
        mvc.get(path) { header("Authorization", "Bearer ${candidate.token}"); param("sessionId", proof.sessionId); header("X-Room-Event-Token", proof.eventToken) }.andExpect { status { isForbidden() } }
        mvc.get("/api/me/learning/candidates") { header("Authorization", "Bearer ${owner.token}") }.andExpect { status { isForbidden() } }
    }

    @Test
    fun `concurrent starts create one attempt and deletion cascades all learning data`() {
        val (user, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-race")
        val calls = (1..2).map {
            CompletableFuture.supplyAsync {
                mvc.post("/api/me/learning/library") {
                    header("Authorization", "Bearer ${user.token}")
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"start","source":"help"}"""
                }.andReturn().response.status
            }
        }
        assertEquals(listOf(200, 409), calls.map { it.join() }.sorted())
        mvc.get("/api/me/learning/library") { header("Authorization", "Bearer ${user.token}") }.andExpect {
            jsonPath("$.attempt") { value(1) }; jsonPath("$.offerSeen") { value(true) }
        }
        jdbc.update("DELETE FROM user_sessions WHERE user_id = ?", user.id)
        jdbc.update("DELETE FROM users WHERE id = ?", user.id)
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM learning_progress_versions WHERE user_id = ?", Int::class.java, user.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM learning_command_versions WHERE user_id = ?", Int::class.java, user.id))
    }

    @Test
    fun `skip during automatic tour preserves progress and is recorded only once`() {
        val (user, _) = HrHttpFixtures.register(mvc, mapper, false, "skip-active")
        val path = "/api/me/learning/personal_interviews"
        fun send(action: String, revision: Int, step: Int? = null, id: UUID = UUID.randomUUID()) = mvc.post(path) {
            header("Authorization", "Bearer ${user.token}")
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("commandId" to id, "expectedVersion" to 2, "expectedRevision" to revision,
                "action" to action, "source" to "offer", "step" to step))
        }.andExpect { status { isOk() } }
        send("offer_seen", 0)
        send("start", 1)
        send("step", 2, step = 1)
        val id = UUID.randomUUID()
        send("offer_skip", 3, id = id).andExpect {
            jsonPath("$.state.skipped") { value(true) }
            jsonPath("$.state.status") { value("in_progress") }
            jsonPath("$.state.completedSteps") { value(1) }
            jsonPath("$.events[0]") { value("offer_skip") }
        }
        send("offer_skip", 3, id = id).andExpect { jsonPath("$.events") { isEmpty() } }
    }

    @Test
    fun `room learning can retry an update after a concurrent room write finishes`() {
        val (owner, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-room-busy")
        val room = HrHttpFixtures.createRoom(mvc, mapper, owner)
        val proof = connect(room, owner)
        val body = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"start","source":"help"}"""
        fun start() = mvc.post("/api/me/learning/room") {
            header("Authorization", "Bearer ${owner.token}")
            header("X-Room-Event-Token", proof.eventToken)
            param("inviteCode", room.inviteCode)
            param("sessionId", proof.sessionId)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }
        postgres.connection().use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("SELECT id FROM rooms WHERE id = ? FOR UPDATE").use { statement ->
                statement.setString(1, room.id)
                statement.executeQuery().use { it.next() }
            }
            val response = CompletableFuture.supplyAsync { start().andReturn().response.status }
            try {
                assertEquals(503, response.get(5, TimeUnit.SECONDS))
            } finally {
                connection.rollback()
                response.get(5, TimeUnit.SECONDS)
            }
        }
        start().andExpect {
            status { isOk() }
            jsonPath("$.state.attempt") { value(1) }
            jsonPath("$.events[0]") { value("first_start") }
        }
    }

    @Test
    fun `room progress survives another room and does not grant a former interviewer access`() {
        val (owner, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-room-owner")
        val (interviewer, _) = HrHttpFixtures.register(mvc, mapper, false, "learn-room-manager")
        val first = HrHttpFixtures.createRoom(mvc, mapper, owner)
        val second = HrHttpFixtures.createRoom(mvc, mapper, owner)
        val path = "/api/me/learning/room?inviteCode=${first.inviteCode}"
        val firstProof = connect(first, owner)
        val secondProof = connect(second, owner)
        mvc.post(path) {
            header("Authorization", "Bearer ${owner.token}"); contentType = MediaType.APPLICATION_JSON
            param("sessionId", firstProof.sessionId); header("X-Room-Event-Token", firstProof.eventToken)
            content = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"offer_skip","source":"offer"}"""
        }.andExpect { status { isOk() } }
        mvc.get("/api/me/learning/room?inviteCode=${second.inviteCode}") {
            header("Authorization", "Bearer ${owner.token}")
            param("sessionId", secondProof.sessionId); header("X-Room-Event-Token", secondProof.eventToken)
        }.andExpect { jsonPath("$.skipped") { value(true) }; jsonPath("$.offerSeen") { value(true) } }
        jdbc.update("INSERT INTO room_participants(id, room_id, user_id, role, created_at) VALUES (?, ?, ?, 'interviewer', CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), first.id, interviewer.id)
        val interviewerProof = connect(first, interviewer)
        mvc.get(path) { header("Authorization", "Bearer ${interviewer.token}"); param("sessionId", interviewerProof.sessionId); header("X-Room-Event-Token", interviewerProof.eventToken) }.andExpect { status { isOk() } }
        val body = """{"commandId":"${UUID.randomUUID()}","expectedVersion":2,"expectedRevision":0,"action":"start","source":"help"}"""
        fun startAsInterviewer() = mvc.post(path) {
            header("Authorization", "Bearer ${interviewer.token}")
            header("X-Room-Event-Token", interviewerProof.eventToken)
            param("sessionId", interviewerProof.sessionId)
            contentType = MediaType.APPLICATION_JSON
            content = body
        }
        startAsInterviewer().andExpect { status { isOk() } }
        jdbc.update("UPDATE room_participants SET role = 'candidate' WHERE room_id = ? AND user_id = ?", first.id, interviewer.id)
        mvc.get(path) { header("Authorization", "Bearer ${interviewer.token}"); param("sessionId", interviewerProof.sessionId); header("X-Room-Event-Token", interviewerProof.eventToken) }.andExpect { status { isForbidden() } }
        startAsInterviewer().andExpect { status { isForbidden() } }
    }

    @Test
    fun `onboarding retains one checkpoint and requires interviewer proof to reach the finish`() {
        val (owner, _) = HrHttpFixtures.register(mvc, mapper, false, "onb-owner")
        val (candidate, _) = HrHttpFixtures.register(mvc, mapper, false, "onb-guest")
        val room = HrHttpFixtures.createRoom(mvc, mapper, owner)
        val ownerProof = connect(room, owner)
        val candidateProof = connect(room, candidate)
        val path = "/api/me/learning/onboarding"

        fun command(action: String, revision: Int, step: Int? = null, proof: Proof? = null, actor: HrTestAccount = owner) = mvc.post(path) {
            header("Authorization", "Bearer ${actor.token}")
            proof?.let {
                param("inviteCode", room.inviteCode)
                param("sessionId", it.sessionId)
                header("X-Room-Event-Token", it.eventToken)
            }
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("commandId" to UUID.randomUUID(), "expectedVersion" to 2,
                "expectedRevision" to revision, "action" to action, "source" to "help", "step" to step))
        }

        mvc.get(path).andExpect { status { isUnauthorized() } }
        command("start", 0).andExpect { status { isOk() }; jsonPath("$.state.version") { value(2) } }
        (1..6).forEach { step -> command("step", step, step).andExpect { status { isOk() } } }
        mvc.get(path) { header("Authorization", "Bearer ${owner.token}") }.andExpect {
            status { isOk() }; jsonPath("$.completedSteps") { value(6) }; jsonPath("$.revision") { value(7) }
        }
        command("step", 7, 7).andExpect { status { isForbidden() } }
        command("step", 7, 7, candidateProof).andExpect { status { isForbidden() } }
        command("offer_skip", 0, proof = candidateProof, actor = candidate).andExpect { status { isForbidden() } }
        mvc.get(path) {
            header("Authorization", "Bearer ${candidate.token}")
            param("inviteCode", room.inviteCode)
            param("sessionId", candidateProof.sessionId)
            header("X-Room-Event-Token", candidateProof.eventToken)
        }.andExpect { status { isForbidden() } }

        jdbc.update("UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", room.id)
        try {
            command("step", 7, 7, ownerProof).andExpect { status { isNotFound() } }
        } finally {
            jdbc.update("UPDATE rooms SET archived_at = NULL WHERE id = ?", room.id)
        }

        (7..14).forEach { step -> command("step", step, step, ownerProof).andExpect { status { isOk() } } }
        command("finish", 15).andExpect { status { isForbidden() } }
        command("finish", 15, proof = ownerProof).andExpect {
            status { isOk() }; jsonPath("$.state.status") { value("completed") }; jsonPath("$.state.completedSteps") { value(14) }
        }
        mvc.get(path) { header("Authorization", "Bearer ${candidate.token}") }.andExpect {
            status { isOk() }; jsonPath("$.completedSteps") { value(0) }
        }
    }

    @Test
    fun `onboarding skip ends each active attempt even when previously skipped`() {
        val (user, _) = HrHttpFixtures.register(mvc, mapper, false, "onb-repeat")
        val path = "/api/me/learning/onboarding"

        fun command(action: String, revision: Int, step: Int? = null) = mvc.post(path) {
            header("Authorization", "Bearer ${user.token}")
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("commandId" to UUID.randomUUID(), "expectedVersion" to 2,
                "expectedRevision" to revision, "action" to action, "source" to "help", "step" to step))
        }.andExpect { status { isOk() } }

        command("offer_skip", 0).andExpect {
            jsonPath("$.state.status") { value("new") }; jsonPath("$.state.skipped") { value(true) }
        }
        command("start", 1).andExpect {
            jsonPath("$.state.status") { value("in_progress") }; jsonPath("$.state.skipped") { value(true) }
        }
        command("step", 2, 1)
        command("offer_skip", 3).andExpect {
            jsonPath("$.state.status") { value("cancelled") }; jsonPath("$.state.completedSteps") { value(1) }
            jsonPath("$.events[0]") { value("offer_skip") }
        }
        command("start", 4).andExpect {
            jsonPath("$.state.status") { value("in_progress") }; jsonPath("$.state.completedSteps") { value(0) }
            jsonPath("$.state.skipped") { value(true) }; jsonPath("$.events[0]") { value("retry_start") }
        }
        command("resume", 5).andExpect { jsonPath("$.events[0]") { value("resume") } }
        command("offer_skip", 6).andExpect {
            jsonPath("$.state.status") { value("cancelled") }; jsonPath("$.state.skipped") { value(true) }
            jsonPath("$.events[0]") { value("offer_skip") }
        }
    }
}
