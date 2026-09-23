package com.interviewonline.config

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

private const val CONFIGURED_FRONTEND_ORIGIN = "https://interview-ui.example.test"

@WebMvcTest(
    controllers = [CorsProbeController::class],
    properties = ["app.cors.allowed-origins=$CONFIGURED_FRONTEND_ORIGIN"],
)
@AutoConfigureMockMvc
@Import(WebConfig::class)
class WebConfigCorsTest(
    @Autowired private val mockMvc: MockMvc,
) {
    @Test
    fun `exact configured frontend origin receives credentialed CORS and origin-specific caching`() {
        mockMvc.perform(
            options("/api/realtime/rooms/cors-contract/events")
                .header(HttpHeaders.ORIGIN, CONFIGURED_FRONTEND_ORIGIN)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type"),
        )
            .andExpect(status().isOk)
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, CONFIGURED_FRONTEND_ORIGIN))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"))
            .andExpect(header().stringValues(HttpHeaders.VARY, "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, org.hamcrest.Matchers.not("*")))
    }

    @Test
    fun `unconfigured frontend origin is denied without credential headers`() {
        mockMvc.perform(
            options("/api/realtime/rooms/cors-contract/events")
                .header(HttpHeaders.ORIGIN, "https://attacker.example.test")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type"),
        )
            .andExpect(status().isForbidden)
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN))
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS))
    }

    @ParameterizedTest(name = "explicit production origin does not retain local origin {0}")
    @ValueSource(strings = ["http://localhost:5173", "http://127.0.0.1:5173"])
    fun `explicit production configuration denies local frontend origins without credential headers`(origin: String) {
        mockMvc.perform(
            options("/api/realtime/rooms/cors-contract/events")
                .header(HttpHeaders.ORIGIN, origin)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type"),
        )
            .andExpect(status().isForbidden)
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN))
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS))
    }
}

@RestController
class CorsProbeController {
    @PostMapping("/api/realtime/rooms/cors-contract/events")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun acceptRealtimeEvent() = Unit
}
