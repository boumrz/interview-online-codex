package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.AdminUserService
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
class HrAccountProfileIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val userRepository: UserRepository,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val assignmentRepository: RoomHrAssignmentRepository,
    @Autowired private val participantRepository: RoomParticipantRepository,
    @Autowired private val adminUserService: AdminUserService,
) {
    @Test
    fun `registration profile and login expose the independent HR flag with a stable UUID`() {
        val (ordinary, ordinaryBody) = HrHttpFixtures.register(mockMvc, objectMapper, isHr = false, prefix = "ordinary")
        assertEquals(false, ordinaryBody.path("user").path("isHr").booleanValue())

        val (hr, hrBody) = HrHttpFixtures.register(mockMvc, objectMapper, isHr = true, prefix = "enabled")
        assertEquals(true, hrBody.path("user").path("isHr").booleanValue())

        mockMvc.get("/api/me/profile") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(hr.id) }
            jsonPath("$.isHr") { value(true) }
            jsonPath("$.role") { value("user") }
        }

        mockMvc.get("/api/me/hr/rooms") {
            header("Authorization", "Bearer ${ordinary.token}")
        }.andExpect {
            status { isForbidden() }
        }
    }

    @Test
    fun `profile self-disable is self-only persists after login and preserves room authority history`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, isHr = false, prefix = "profile-owner")
        val (account, registration) = HrHttpFixtures.register(mockMvc, objectMapper, isHr = true, prefix = "profile-disable")
        val (unrelatedManager, _) = HrHttpFixtures.register(mockMvc, objectMapper, isHr = true, prefix = "profile-unrelated")
        val room = HrHttpFixtures.createRoom(mockMvc, objectMapper, owner)
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, account).response.status == 200)

        val nickname = registration.path("user").path("nickname").asText()
        val password = "secret-${nickname.removePrefix("profile-disable-")}"

        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer ${account.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Отключённый профиль","isHr":false,"id":"${unrelatedManager.id}","role":"admin"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.id") { value(account.id) }
            jsonPath("$.role") { value("user") }
            jsonPath("$.isHr") { value(false) }
        }

        assertTrue(userRepository.findById(unrelatedManager.id).orElseThrow().isHr,
            "forged identity data must not disable another account")
        assertEquals("user", userRepository.findById(unrelatedManager.id).orElseThrow().role)

        mockMvc.get("/api/me/profile") {
            header("Authorization", "Bearer ${account.token}")
        }.andExpect {
            status { isOk() }
            jsonPath("$.isHr") { value(false) }
        }

        val refreshedLogin = mockMvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"nickname":"$nickname","password":"$password"}"""
        }.andExpect {
            status { isOk() }
            jsonPath("$.user.id") { value(account.id) }
            jsonPath("$.user.isHr") { value(false) }
        }.andReturn()
        val refreshedToken = objectMapper.readTree(refreshedLogin.response.contentAsString).path("token").asText()

        mockMvc.get("/api/me/hr/rooms") {
            header("Authorization", "Bearer $refreshedToken")
        }.andExpect { status { isForbidden() } }
        mockMvc.get("/api/me/hr/rooms/${room.id}") {
            header("Authorization", "Bearer $refreshedToken")
        }.andExpect { status { isForbidden() } }
        mockMvc.get("/api/me/hr/rooms/export") {
            header("Authorization", "Bearer $refreshedToken")
        }.andExpect { status { isForbidden() } }

        assertTrue(assignmentRepository.existsByRoomIdAndUserId(room.id, account.id),
            "capability opt-out must not erase durable interview history")
        assertEquals("interviewer", participantRepository.findByRoomIdAndUserId(room.id, account.id)?.role)
        mockMvc.get("/api/rooms/${room.inviteCode}") {
            header("Authorization", "Bearer $refreshedToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("interviewer") }
        }

        mockMvc.patch("/api/me/profile") {
            header("Authorization", "Bearer $refreshedToken")
            contentType = MediaType.APPLICATION_JSON
            content = """{"displayName":"Отключённый профиль","isHr":true}"""
        }.andExpect {
            jsonPath("$.id") { value(account.id) }
            status { isOk() }
            jsonPath("$.isHr") { value(true) }
        }
        assertEquals(account.id, userRepository.findById(account.id).orElseThrow().id,
            "Re-enabling must retain the stable UUID used for room invitations")
        mockMvc.get("/api/me/hr/rooms") {
            header("Authorization", "Bearer $refreshedToken")
        }.andExpect {
            status { isOk() }
            jsonPath("$.totalElements") { value(1) }
        }
    }

    @Test
    fun `account deletion removes owned rooms and HR assignment foreign keys`() {
        val (adminAccount, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "admin-delete")
        val admin = userRepository.findById(adminAccount.id).orElseThrow().also { it.role = "admin" }
        userRepository.saveAndFlush(admin)
        val (target, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "delete-target")
        val (otherOwner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "other-owner")
        val targetOwnedRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, target)
        val otherRoom = HrHttpFixtures.createRoom(mockMvc, objectMapper, otherOwner)
        require(HrHttpFixtures.inviteHr(mockMvc, otherOwner, otherRoom, target).response.status == 200)
        mockMvc.post("/api/rooms/${targetOwnedRoom.inviteCode}/hr-tracking") {
            header("Authorization", "Bearer ${target.token}")
        }.andExpect { status { isOk() } }

        adminUserService.deleteUser(admin, target.id)

        assertFalse(userRepository.existsById(target.id))
        assertFalse(roomRepository.existsById(targetOwnedRoom.id))
        assertTrue(roomRepository.existsById(otherRoom.id))
        assertFalse(assignmentRepository.findAll().any { it.user?.id == target.id })
    }
}
