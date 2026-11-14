package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.service.CollaborationService
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CandidateActivityPostgresIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val collaboration: CollaborationService,
    @Autowired private val events: RoomKeystrokeEventRepository,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("candidate_raw_activity")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `concurrent duplicated writes retain one row per action and every committed page can be recovered`() {
        postgres.verifyPostgres16()
        val f = ActivityHttpFixture(mvc, mapper)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val candidates = listOf(f.join(), f.join())
            val actions = (0 until 220).associate { index ->
                UUID.randomUUID().toString() to (candidates[index % candidates.size] to "строка $index\u0000\uD83D")
            }
            val posts = actions.flatMap { (id, entry) ->
                List(2) {
                    pool.submit<Int> {
                        f.post(entry.first, "key_press", mapOf("sourceEventId" to id, "eventKind" to "paste",
                            "pastePreview" to entry.second, "pasteLength" to entry.second.length)).response.status
                    }
                }
            }
            posts.forEach { assertEquals(204, it.get(60, TimeUnit.SECONDS)) }
            assertEquals(actions.size, events.findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(f.room.id).size)
            collaboration.closeRoom(f.room.inviteCode)
            val manager = f.join(f.owner.token)
            val snapshot = f.messages(manager).last { it.path("type").asText() == "state_sync" }.path("payload")
            assertEquals(50, snapshot.path("candidateKeyHistory").size())
            fun page(query: String = "") = f.getHistory(query).response.let { response ->
                assertEquals(200, response.status)
                mapper.readTree(response.contentAsByteArray)
            }
            val latest = page()
            val older = page("beforeSequence=${latest.path("nextBeforeSequence").asLong()}&throughSequence=${latest.path("throughSequence").asLong()}")
            val recovered = latest.path("events").toList() + older.path("events").toList()
            assertEquals(actions.size, recovered.size)
            assertEquals((1..actions.size).toSet(), recovered.map { it.path("acceptedSequence").asInt() }.toSet())
            assertEquals(actions.keys, recovered.map { it.path("sourceEventId").asText() }.toSet())
            recovered.forEach { action ->
                val (sender, preview) = actions.getValue(action.path("sourceEventId").asText())
                assertEquals(sender.session, action.path("sessionId").asText())
                assertEquals(preview, action.path("pastePreview").asText())
            }
        } finally {
            pool.shutdownNow()
            collaboration.closeRoom(f.room.inviteCode)
        }
    }
}
