package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.repository.RoomRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
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
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
abstract class InterviewLanguageObservationScenarios {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var rooms: RoomRepository
    @Autowired lateinit var jdbc: JdbcTemplate

    @Test
    fun `public step and room languages are unique across candidates and published language switches`() {
        val room = Room(inviteCode = UUID.randomUUID().toString(), ownerSessionToken = UUID.randomUUID().toString(), language = "python")
        room.tasks.add(RoomTask(room = room, stepIndex = 0, language = "python", solutionLanguage = "python"))
        room.tasks.add(RoomTask(room = room, stepIndex = 1, language = "python", solutionLanguage = "python"))
        rooms.saveAndFlush(room)
        val firstTask = requireNotNull(room.tasks[0].id)
        val secondTask = requireNotNull(room.tasks[1].id)
        val first = connect(room)
        val second = connect(room)
        val owner = connect(room, owner = true)

        observe(room, owner, firstTask, "python", 204)
        observe(room, first, secondTask, "python", 204)
        observe(room, first.copy(eventToken = "invalid"), firstTask, "python", 403)
        val pool = Executors.newFixedThreadPool(2)
        val initial = try {
            pool.invokeAll(listOf(first, second).map { client -> Callable {
                observe(room, client, firstTask, "python", 200)
            } }).map { it.get() }
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, initial.count { it.path("firstForRoom").asBoolean() && it.path("firstForStep").asBoolean() })
        assertEquals(1, initial.count { it == flags("python", false, false) })
        event(room, owner, "set_step", mapOf("stepIndex" to 1))
        observe(room, first, firstTask, "python", 204)
        assertEquals(flags("python", false, true), observe(room, first, secondTask, "python", 200))
        event(room, owner, "language_update", mapOf("language" to "plaintext"))
        assertEquals(flags("plaintext", true, true), observe(room, first, secondTask, "plaintext", 200))
        event(room, owner, "language_update", mapOf("language" to "sql"))
        observe(room, second, secondTask, "plaintext", 204)
        assertEquals(flags("sql", true, true, true), observe(room, second, secondTask, "sql", 200))
        assertEquals(flags("sql", false, false), observe(room, connect(room), secondTask, "sql", 200))
        event(room, owner, "language_update", mapOf("language" to "kotlin"))
        assertEquals(flags("kotlin", true, true), observe(room, first, secondTask, "kotlin", 200))
        mvc.delete("/api/rooms/${room.inviteCode}/tasks/0") {
            header("X-Room-Owner-Token", room.ownerSessionToken)
        }.andExpect { status { isOk() } }
        assertEquals(flags("kotlin", false, false), observe(room, first, secondTask, "kotlin", 200))
        observe(room, first, firstTask, "python", 204)
        jdbc.update("UPDATE rooms SET status='finished' WHERE id=?", room.id)
        observe(room, first, secondTask, "kotlin", 204)
        assertEquals(5, observationCount(room))
        rooms.deleteById(requireNotNull(room.id))
        assertEquals(0, observationCount(room))
    }

    private data class Client(val sessionId: String, val eventToken: String)

    private fun connect(room: Room, owner: Boolean = false): Client {
        val session = UUID.randomUUID().toString()
        val result = mvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session)
            if (owner) param("ownerToken", room.ownerSessionToken)
        }.andReturn()
        assertEquals(200, result.response.status)
        val state = result.response.contentAsString.lineSequence().filter { it.startsWith("data:") }
            .map { mapper.readTree(it.removePrefix("data:")) }
            .last { it.path("type").asText() == "state_sync" }.path("payload")
        return Client(session, state.path("eventToken").asText())
    }

    private fun event(room: Room, client: Client, type: String, fields: Map<String, Any>) {
        val result = mvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to client.sessionId, "eventToken" to client.eventToken, "type" to type) + fields)
        }.andReturn()
        assertEquals(204, result.response.status)
    }

    private fun observe(room: Room, client: Client, taskId: String, language: String, status: Int): JsonNode {
        val result = mvc.post("/api/realtime/rooms/${room.inviteCode}/language-observations") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("sessionId" to client.sessionId, "eventToken" to client.eventToken, "taskId" to taskId, "language" to language))
        }.andReturn()
        assertEquals(status, result.response.status)
        return if (status == 200) mapper.readTree(result.response.contentAsString) else mapper.nullNode()
    }

    private fun flags(language: String, room: Boolean, step: Boolean, multi: Boolean = false): JsonNode =
        mapper.valueToTree(mapOf("language" to language, "firstForRoom" to room, "firstForStep" to step, "firstMultilanguageRoom" to multi))

    private fun observationCount(room: Room): Int? =
        jdbc.queryForObject("SELECT count(*) FROM room_task_language_observations WHERE room_id=?", Int::class.java, room.id)
}

class InterviewLanguageObservationIntegrationTest : InterviewLanguageObservationScenarios()

@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class InterviewLanguageObservationPostgresTest : InterviewLanguageObservationScenarios() {
    companion object {
        private val postgres = Postgres16TestSupport.create("interview_languages")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }
}
