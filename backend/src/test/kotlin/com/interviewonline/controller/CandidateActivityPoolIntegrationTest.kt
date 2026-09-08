package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomProductMetricRepository
import com.interviewonline.service.CollaborationService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.web.servlet.MockMvc
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/** Real HTTP requests expose connection starvation hidden by service-only tests. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "spring.datasource.hikari.maximum-pool-size=1", "spring.datasource.hikari.minimum-idle=1",
    "spring.datasource.hikari.connection-timeout=1000", "spring.jpa.open-in-view=false",
    "spring.datasource.url=jdbc:h2:mem:activity_pool_test;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
])
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CandidateActivityPoolIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val events: RoomKeystrokeEventRepository,
    @Autowired private val metrics: RoomProductMetricRepository,
    @Autowired private val collaboration: CollaborationService,
    @LocalServerPort private val port: Int,
) {
    @Test fun `one connection accepts and retries activity once before broadcasting and keeps snapshots functional`() {
        val f = ActivityHttpFixture(mvc, mapper)
        try {
            val manager = f.join(f.owner.token)
            val candidate = f.join()
            val source = UUID.randomUUID().toString()
            val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()
            fun post(token: String): HttpResponse<String> {
                val request = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/realtime/rooms/${f.room.inviteCode}/events"))
                    .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(mapOf("sessionId" to candidate.session, "eventToken" to token, "type" to "key_press", "key" to "a", "keyCode" to "KeyA", "sourceEventId" to source))))
                    .build()
                return client.send(request, HttpResponse.BodyHandlers.ofString())
            }
            fun responseDiagnostic(response: HttpResponse<String>): String {
                val diagnostic = "status=${response.statusCode()}, HTTP=${response.version()}, " +
                    "Content-Type=${response.headers().firstValue("content-type").orElse("<absent>")}, " +
                    "body=${response.body()}"
                return listOf(candidate.token, manager.token, f.owner.token)
                    .fold(diagnostic) { text, token -> text.replace(token, "[REDACTED]") }
                    .replace(Regex("secret-[0-9a-f]{12}"), "[REDACTED]")
            }
            val rejectedResponse = post("invalid-event-token")
            assertEquals(403, rejectedResponse.statusCode()) { responseDiagnostic(rejectedResponse) }
            assertTrue(events.findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(f.room.id).isEmpty())
            repeat(2) {
                val response = post(candidate.token)
                assertEquals(204, response.statusCode()) { responseDiagnostic(response) }
            }
            val raw = events.findByRoomIdOrderByTimestampEpochMsAscAcceptedSequenceAsc(f.room.id)
            assertEquals(1, raw.size)
            assertEquals(source, raw.single().sourceEventId)
            assertEquals(1L, raw.single().acceptedSequence)
            assertNotNull(metrics.findById(f.room.id).orElseThrow().firstMeaningfulCandidateActivityAt)
            val broadcasts = f.messages(manager).filter { it.path("type").asText() == "candidate_key" }
            assertEquals(1, broadcasts.size)
            assertEquals(source, broadcasts.single().path("payload").path("sourceEventId").asText())
            assertEquals(204, f.post(manager, "request_state_sync").response.status)
            assertEquals(source, f.messages(manager).last { it.path("type").asText() == "state_sync" }.path("payload").path("candidateKeyHistory").single().path("sourceEventId").asText())
        } finally { collaboration.closeRoom(f.room.inviteCode) }
    }
}
