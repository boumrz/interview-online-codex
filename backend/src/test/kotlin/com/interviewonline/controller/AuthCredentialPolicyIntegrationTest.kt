package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.User
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.UserSessionRepository
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AuthCredentialPolicyIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val users: UserRepository,
    @Autowired private val sessions: UserSessionRepository,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("auth_credential_policy")
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `registration rejects non Latin nickname and password without writing user or session`() {
        postgres.verifyPostgres16()
        val beforeUsers = users.count()
        val beforeSessions = sessions.count()
        for ((nickname, password, message) in listOf(
            Triple("новый${suffix()}", "secret123", "Ник может содержать только латинские буквы, цифры и символы"),
            Triple("new${suffix()}", "пароль123", "Пароль может содержать только латинские буквы, цифры и символы"),
            Triple("caf\u00e9${suffix()}", "secret123", "Ник может содержать только латинские буквы, цифры и символы"),
            Triple("new${suffix()}", "secret\u0001123", "Пароль может содержать только латинские буквы, цифры и символы"),
        )) {
            mvc.post("/api/auth/register") {
                contentType = MediaType.APPLICATION_JSON
                content = mapper.writeValueAsString(mapOf("nickname" to nickname, "displayName" to "Иван", "password" to password))
            }.andExpect {
                status { isBadRequest() }
                jsonPath("$.error") { value(message) }
            }
        }
        assertEquals(beforeUsers, users.count())
        assertEquals(beforeSessions, sessions.count())
    }

    @Test fun `registration permits ASCII punctuation digits Unicode name and exact password spaces`() {
        val nickname = "Latin._-${suffix()}"
        val password = " Pa55-word! "
        val result = mvc.post("/api/auth/register") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname, "displayName" to "Иван", "password" to password))
        }.andExpect {
            status { isOk() }
            jsonPath("$.user.displayName") { value("Иван") }
            jsonPath("$.user.nickname") { value(nickname) }
        }.andReturn()
        val id = mapper.readTree(result.response.contentAsString).path("user").path("id").asText()

        mvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname, "password" to password))
        }.andExpect { status { isOk() }; jsonPath("$.user.id") { value(id) } }
        mvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname, "password" to password.trim()))
        }.andExpect { status { isUnauthorized() } }
    }

    @Test fun `existing account retains exact Cyrillic credentials and invalid password cannot create a session`() {
        val nickname = "старый${suffix()}"
        val password = "старый пароль123"
        val user = users.saveAndFlush(User(nickname = nickname, displayName = "Старый профиль", passwordHash = BCryptPasswordEncoder().encode(password)))
        val beforeSessions = sessions.count()
        mvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname, "password" to "$password!"))
        }.andExpect { status { isUnauthorized() }; jsonPath("$.error") { value("Неверный ник или пароль") } }
        assertEquals(beforeSessions, sessions.count())
        mvc.post("/api/auth/login") {
            contentType = MediaType.APPLICATION_JSON
            content = mapper.writeValueAsString(mapOf("nickname" to nickname, "password" to password))
        }.andExpect { status { isOk() }; jsonPath("$.user.id") { value(user.id) } }
    }

    private fun suffix() = UUID.randomUUID().toString().take(8)
}
