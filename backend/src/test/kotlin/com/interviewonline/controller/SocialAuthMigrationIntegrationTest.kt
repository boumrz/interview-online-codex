package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
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
class SocialAuthMigrationIntegrationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("social_auth_upgrade")
        private val userId = UUID.randomUUID().toString()
        private val roomId = UUID.randomUUID().toString()
        private val nickname = "прежний_${userId.take(8)}"
        private const val password = " Старый пароль123 "
        private val passwordHash = BCryptPasswordEncoder().encode(password)
        init {
            val properties = postgres.applicationProperties()
            Flyway.configure()
                .dataSource(properties.getValue("spring.datasource.url").toString(), properties.getValue("spring.datasource.username").toString(), properties.getValue("spring.datasource.password").toString())
                .schemas(postgres.schema).defaultSchema(postgres.schema).locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("33")).load().migrate()
            postgres.connection().use { connection ->
                connection.prepareStatement("INSERT INTO users(id,nickname,display_name,password_hash,role,is_hr,created_at) VALUES (?,?,'Старое имя',?,'user',true,CURRENT_TIMESTAMP)").use {
                    it.setString(1,userId); it.setString(2,nickname); it.setString(3,passwordHash); it.executeUpdate()
                }
                connection.prepareStatement("INSERT INTO rooms(id,title,invite_code,owner_session_token,interviewer_session_token,owner_user_id,language,current_step,code,created_at) VALUES (?,'Existing interview',?,?,?,?,'nodejs',0,'Preserved code',CURRENT_TIMESTAMP)").use {
                    it.setString(1,roomId); it.setString(2,"invite-$roomId"); it.setString(3,"owner-$roomId"); it.setString(4,"interviewer-$roomId"); it.setString(5,userId); it.executeUpdate()
                }
            }
        }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll fun cleanup() = postgres.close()
    }

    @Test fun `V34 preserves pre-existing local credentials account profile and owned interview`() {
        postgres.verifyPostgres16()
        assertEquals("34",jdbc.queryForObject("SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank DESC LIMIT 1",String::class.java))
        assertEquals(passwordHash,jdbc.queryForObject("SELECT password_hash FROM users WHERE id=?",String::class.java,userId))
        assertEquals("Preserved code",jdbc.queryForObject("SELECT code FROM rooms WHERE id=? AND owner_user_id=?",String::class.java,roomId,userId))
        mvc.post("/api/auth/login") {
            contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password))
        }.andExpect {
            status { isOk() }; jsonPath("$.user.id") { value(userId) }; jsonPath("$.user.displayName") { value("Старое имя") }; jsonPath("$.user.isHr") { value(true) }
        }
        mvc.post("/api/auth/login") {
            contentType=MediaType.APPLICATION_JSON; content=mapper.writeValueAsString(mapOf("nickname" to nickname,"password" to password.trim()))
        }.andExpect { status { isUnauthorized() } }
        assertEquals("YES",jdbc.queryForObject("SELECT is_nullable FROM information_schema.columns WHERE table_schema=? AND table_name='users' AND column_name='password_hash'",String::class.java,postgres.schema))
    }
}
