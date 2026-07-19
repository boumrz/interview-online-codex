package com.interviewonline.config

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest(properties = ["app.cors.allowed-origins=http://localhost:5173"])
@AutoConfigureMockMvc
class WebConfigCorsTest(
    @Autowired private val mockMvc: MockMvc,
) {
    @Test
    fun `loopback frontend may preflight registration when configured origins are narrowed`() {
        val loopbackOrigin = "http://127.0.0.1:5173"

        mockMvc.perform(
            options("/api/auth/register")
                .header(HttpHeaders.ORIGIN, loopbackOrigin)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type"),
        )
            .andExpect(status().isOk)
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, loopbackOrigin))
    }
}
