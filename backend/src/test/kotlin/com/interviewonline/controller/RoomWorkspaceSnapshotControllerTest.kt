package com.interviewonline.controller

import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.User
import com.interviewonline.model.UserSession
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.put
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc
class RoomWorkspaceSnapshotControllerTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val roomParticipantRepository: RoomParticipantRepository,
    @Autowired private val userSessionRepository: UserSessionRepository,
    @Autowired private val userRepository: UserRepository,
) {
    @AfterEach
    fun cleanup() {
        roomParticipantRepository.deleteAll()
        roomRepository.deleteAll()
        userSessionRepository.deleteAll()
        userRepository.deleteAll()
    }

    @Test
    fun `owner and interviewer receive saved workspace values and safe fallbacks`() {
        val owner = createUser("workspace-owner")
        val interviewer = createUser("workspace-interviewer")
        val ownerToken = createSession(owner)
        val interviewerToken = createSession(interviewer)
        val room = createRoom(owner)
        roomParticipantRepository.save(
            RoomParticipant(
                room = room,
                user = interviewer,
                role = "interviewer",
            ),
        )

        mockMvc.get("/api/rooms/${room.inviteCode}/tasks/0/workspace") {
            header("Authorization", "Bearer $ownerToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.stepIndex") { value(0) }
            jsonPath("$.title") { value("Сохранённая задача") }
            jsonPath("$.language") { value("kotlin") }
            jsonPath("$.code") { value("fun saved() = 42") }
            jsonPath("$.briefingMarkdown") { value("## Сохранённый брифинг") }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}/tasks/1/workspace") {
            header("Authorization", "Bearer $interviewerToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.stepIndex") { value(1) }
            jsonPath("$.title") { value("Шаблонная задача") }
            jsonPath("$.language") { value("nodejs") }
            jsonPath("$.code") { value("console.log('starter')") }
            jsonPath("$.briefingMarkdown") { value("Описание из шаблона") }
        }
    }

    @Test
    fun `candidate is forbidden and invalid step is not found`() {
        val owner = createUser("workspace-owner-access")
        val candidate = createUser("workspace-candidate")
        val ownerToken = createSession(owner)
        val candidateToken = createSession(candidate)
        val room = createRoom(owner)
        roomParticipantRepository.save(
            RoomParticipant(
                room = room,
                user = candidate,
                role = "candidate",
            ),
        )

        mockMvc.get("/api/rooms/${room.inviteCode}/tasks/0/workspace") {
            header("Authorization", "Bearer $candidateToken")
        }.andExpect {
            status { isForbidden() }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}/tasks/99/workspace") {
            header("Authorization", "Bearer $ownerToken")
        }.andExpect {
            status { isNotFound() }
        }
    }

    @Test
    fun `manager can persist an unpublished workspace without changing the published room`() {
        val owner = createUser("workspace-write-owner")
        val interviewer = createUser("workspace-write-interviewer")
        val candidate = createUser("workspace-write-candidate")
        val ownerToken = createSession(owner)
        val interviewerToken = createSession(interviewer)
        val candidateToken = createSession(candidate)
        val room = createRoom(owner)
        roomParticipantRepository.saveAll(
            listOf(
                RoomParticipant(room = room, user = interviewer, role = "interviewer"),
                RoomParticipant(room = room, user = candidate, role = "candidate"),
            ),
        )

        val privateCode = "fun preparedOnlyForManagers() = 42"
        val privateBriefing = "## MANAGER_ONLY_BRIEFING"

        mockMvc.put("/api/rooms/${room.inviteCode}/tasks/1/workspace") {
            header("Authorization", "Bearer $ownerToken")
            contentType = MediaType.APPLICATION_JSON
            content = """
                {
                  "code": "$privateCode",
                  "language": "python",
                  "briefingMarkdown": "$privateBriefing",
                  "revision": 0
                }
            """.trimIndent()
        }.andExpect {
            status { isOk() }
            jsonPath("$.stepIndex") { value(1) }
            jsonPath("$.code") { value(privateCode) }
            jsonPath("$.briefingMarkdown") { value(privateBriefing) }
            jsonPath("$.language") { value("python") }
            jsonPath("$.revision") { value(1) }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}/tasks/1/workspace") {
            header("Authorization", "Bearer $interviewerToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.code") { value(privateCode) }
            jsonPath("$.briefingMarkdown") { value(privateBriefing) }
            jsonPath("$.language") { value("python") }
            jsonPath("$.revision") { value(1) }
        }

        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer $ownerToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.currentStep") { value(0) }
            jsonPath("$.code") { value("fun saved() = 42") }
            jsonPath("$.briefingMarkdown") { value("## Сохранённый брифинг") }
            jsonPath("$.language") { value("kotlin") }
        }

        mockMvc.put("/api/rooms/${room.inviteCode}/tasks/1/workspace") {
            header("Authorization", "Bearer $candidateToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"code":"candidate must not edit","revision":1}"""
        }.andExpect {
            status { isForbidden() }
        }

        mockMvc.put("/api/rooms/${room.inviteCode}/tasks/1/workspace") {
            header("Authorization", "Bearer $ownerToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"briefingMarkdown":"stale write","revision":0}"""
        }.andExpect {
            status { isConflict() }
        }

        mockMvc.put("/api/rooms/${room.inviteCode}/tasks/0/workspace") {
            header("Authorization", "Bearer $ownerToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"briefingMarkdown":"published write","revision":0}"""
        }.andExpect {
            status { isBadRequest() }
        }
    }

    private fun createRoom(owner: User): Room {
        val room = Room(
            title = "Workspace snapshot room",
            inviteCode = "workspace-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = owner,
            language = "python",
        )
        room.tasks = mutableListOf(
            RoomTask(
                room = room,
                stepIndex = 0,
                title = "Сохранённая задача",
                description = "Описание не должно попадать вместо сохранённого брифинга",
                starterCode = "fun starter() = 0",
                solutionCode = "fun saved() = 42",
                briefingMarkdown = "## Сохранённый брифинг",
                solutionLanguage = " kotlin ",
                language = "java",
            ),
            RoomTask(
                room = room,
                stepIndex = 1,
                title = "Шаблонная задача",
                description = "Описание из шаблона",
                starterCode = "console.log('starter')",
                solutionCode = null,
                briefingMarkdown = "",
                solutionLanguage = null,
                language = "javascript",
            ),
        )
        return roomRepository.saveAndFlush(room)
    }

    private fun createUser(prefix: String): User = userRepository.save(
        User(
            nickname = "${prefix}_${UUID.randomUUID().toString().take(8)}",
            displayName = prefix,
            passwordHash = "test-only",
            role = "user",
        ),
    )

    private fun createSession(user: User): String {
        val token = "workspace_${UUID.randomUUID()}"
        userSessionRepository.save(UserSession(user = user, token = token))
        return token
    }
}
