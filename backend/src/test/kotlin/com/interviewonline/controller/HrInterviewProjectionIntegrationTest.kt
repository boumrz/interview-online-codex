package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.put
import org.springframework.test.web.servlet.post
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.assertEquals

@SpringBootTest
@AutoConfigureMockMvc
class HrInterviewProjectionIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
) {
    @Test
    fun `metadata revision protects concurrent saves and remains absent from shared room payload`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "projection-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "projection-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Backend Kotlin interview")
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)

        mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"candidateName":"  Анна  ","position":" Kotlin developer ","scheduledAt":"2026-09-05T09:30:00+03:00","revision":0}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.candidateName") { value("Анна") }
            jsonPath("$.position") { value("Kotlin developer") }
            jsonPath("$.scheduledAt") { value("2026-09-05T06:30:00Z") }
            jsonPath("$.revision") { value(1) }
        }

        mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
            header("Authorization", "Bearer ${hr.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"candidateName":"Потерянная запись","position":null,"scheduledAt":null,"revision":0}"""
        }.andExpect {
            status { isConflict() }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.candidateName") { doesNotExist() }
            jsonPath("$.scheduledAt") { doesNotExist() }
            jsonPath("$.interviewMetadataRevision") { doesNotExist() }
        }
    }

    @Test
    fun `personal list is scoped ordered paginated and detail is isolated from another HR`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "list-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "list-hr")
        val (otherHr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "other-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "Cabinet row")
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)

        mockMvc.get("/api/me/hr/rooms?page=0&size=20") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            header { string("Cache-Control", "no-store") }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].roomId") { value(room.id) }
            jsonPath("$.items[0].interviewState") { value("active") }
            jsonPath("$.timezone") { value("Europe/Moscow") }
            jsonPath("$.page") { value(0) }
            jsonPath("$.size") { value(20) }
        }

        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${otherHr.token}")
        }.andExpect {
            status { isNotFound() }
        }

        mockMvc.get("/api/me/hr/rooms?from=2026-09-05") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isBadRequest() }
        }
    }

    @Test
    fun `metadata requires complete correctly typed values and strict offset timestamps`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "meta-valid-owner")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val invalidBodies = listOf(
            """{"candidateName":"A","position":null,"scheduledAt":null}""",
            """{"candidateName":42,"position":null,"scheduledAt":null,"revision":0}""",
            """{"candidateName":"A","position":null,"scheduledAt":null,"revision":0.5}""",
            """{"candidateName":"A","position":null,"scheduledAt":null,"revision":-1}""",
            """{"candidateName":"A","position":null,"scheduledAt":"2026-09-05T09:30:00","revision":0}""",
            objectMapper.writeValueAsString(mapOf("candidateName" to "😀".repeat(201), "position" to null, "scheduledAt" to null, "revision" to 0)),
        )
        invalidBodies.forEach { body ->
            mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
                header("Authorization", "Bearer ${owner.token}")
                contentType = MediaType.APPLICATION_JSON
                content = body
            }.andExpect { status { isBadRequest() } }
        }
    }

    @Test
    fun `concurrent metadata saves accept exactly one revision`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "metadata-race-owner")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        val ready = CountDownLatch(6)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(6)
        try {
            val responses = (1..6).map { index ->
                executor.submit<Int> {
                    ready.countDown()
                    start.await(5, TimeUnit.SECONDS)
                    mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
                        header("Authorization", "Bearer ${owner.token}")
                        contentType = MediaType.APPLICATION_JSON
                        content = """{"candidateName":"Candidate $index","position":null,"scheduledAt":null,"revision":0}"""
                    }.andReturn().response.status
                }
            }
            check(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val statuses = responses.map { it.get(10, TimeUnit.SECONDS) }
            assertEquals(1, statuses.count { it == 200 })
            assertEquals(5, statuses.count { it == 409 })
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `first completion timestamp remains stable when verdict is corrected`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "finished-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "finished-hr")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)

        mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE","verdictComment":"first"}"""
        }.andExpect { status { isOk() } }
        val first = objectMapper.readTree(
            mockMvc.get("/api/me/hr/rooms/${room.id}") {
                header("Authorization", "Bearer ${hr.token}")
            }.andReturn().response.contentAsString,
        ).path("finishedAt").asText()
        Thread.sleep(5)
        mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"NO_HIRE","verdictComment":"corrected"}"""
        }.andExpect { status { isOk() } }
        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.finishedAt") { value(first) }
            jsonPath("$.verdict") { value("NO_HIRE") }
            jsonPath("$.verdictComment") { value("corrected") }
        }
    }

    @Test
    fun `Moscow date boundaries use scheduled then finished then created fallback`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "date-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "date-hr")
        val inRange = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "midnight Moscow")
        val before = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner, "before Moscow")
        require(HrHttpFixtures.inviteHr(mockMvc, owner, inRange, hr).response.status == 200)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, before, hr).response.status == 200)
        listOf(inRange to "2026-09-04T21:00:00Z", before to "2026-09-04T20:59:59.999Z").forEach { (room, timestamp) ->
            mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
                header("Authorization", "Bearer ${owner.token}")
                contentType = MediaType.APPLICATION_JSON
                content = """{"candidateName":null,"position":null,"scheduledAt":"$timestamp","revision":0}"""
            }.andExpect { status { isOk() } }
        }
        mockMvc.get("/api/me/hr/rooms?from=2026-09-05&to=2026-09-05&page=0&size=20") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.items.length()") { value(1) }
            jsonPath("$.items[0].roomId") { value(inRange.id) }
            jsonPath("$.items[0].dateSource") { value("scheduled") }
        }

        listOf("+10000-01-01" to "+10000-01-02", "2026-09-05" to "+999999999-12-31").forEach { (from, to) ->
            mockMvc.get("/api/me/hr/rooms?from=$from&to=$to") {
                header("Authorization", "Bearer ${hr.token}")
            }.andExpect { status { isBadRequest() } }
        }
    }
}
