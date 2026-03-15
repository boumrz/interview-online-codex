package com.interviewonline.config

import com.interviewonline.ws.RoomWebSocketHandler
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry

@Configuration
@EnableWebSocket
class WebSocketConfig(
    @Value("\${app.cors.allowed-origins}") private val allowedOrigins: String,
    private val roomWebSocketHandler: RoomWebSocketHandler,
) : WebSocketConfigurer {
    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        val origins = allowedOrigins.split(",").map { it.trim() }.toTypedArray()
        registry.addHandler(roomWebSocketHandler, "/ws/rooms/{inviteCode}")
            .setAllowedOrigins(*origins)
    }
}
