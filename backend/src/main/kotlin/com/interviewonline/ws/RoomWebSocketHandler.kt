package com.interviewonline.ws

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.service.ApiException
import com.interviewonline.service.CollaborationService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.util.UriComponentsBuilder
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.UUID

@Component
class RoomWebSocketHandler(
    private val collaborationService: CollaborationService,
    private val objectMapper: ObjectMapper,
) : TextWebSocketHandler() {
    private val logger = LoggerFactory.getLogger(javaClass)

    override fun afterConnectionEstablished(session: WebSocketSession) {
        val uri = session.uri ?: return
        val inviteCode = uri.path.substringAfterLast("/")
        val query = UriComponentsBuilder.fromUri(uri).build().queryParams
        val sessionId = query.getFirst("sessionId") ?: "s-${UUID.randomUUID()}"
        val displayName = decodeDisplayName(
            encoded = query.getFirst("displayNameEncoded"),
            fallback = query.getFirst("displayName"),
        )
        val ownerToken = query.getFirst("ownerToken")
        val interviewerToken = query.getFirst("interviewerToken")
        collaborationService.joinRoom(inviteCode, session, sessionId, displayName, ownerToken, interviewerToken)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        try {
            val payload = objectMapper.readTree(message.payload)
            val type = payload.path("type").asText("")
            when (type) {
                "code_update" -> collaborationService.updateCode(session, payload.readText("code"))
                "language_update" -> collaborationService.updateLanguage(session, payload.readText("language"))
                "next_step" -> collaborationService.nextStep(session)
                "set_step" -> collaborationService.setStep(session, payload.readInt("stepIndex"))
                "notes_update" -> collaborationService.updateNotes(session, payload.readText("notes"))
                "presence_update" -> collaborationService.updatePresence(session, payload.readText("presenceStatus"))
                else -> throw ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "Неизвестный тип сообщения: $type")
            }
        } catch (ex: ApiException) {
            sendError(session, ex.message)
        } catch (ex: JsonProcessingException) {
            logger.warn("Invalid websocket json payload: {}", message.payload)
            sendError(session, "Некорректный формат WebSocket сообщения")
        } catch (ex: Exception) {
            logger.warn("WebSocket message handling error", ex)
            sendError(session, "Ошибка обработки WebSocket сообщения")
        }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        collaborationService.leaveRoom(session)
    }

    private fun sendError(session: WebSocketSession, message: String) {
        if (session.isOpen) {
            val payload = objectMapper.writeValueAsString(WsOutgoingMessage("error", mapOf("message" to message)))
            synchronized(session) {
                if (session.isOpen) {
                    session.sendMessage(TextMessage(payload))
                }
            }
        }
    }

    private fun JsonNode.readText(field: String): String {
        return path(field).asText("")
    }

    private fun JsonNode.readInt(field: String): Int {
        return path(field).asInt(-1)
    }

    private fun decodeDisplayName(encoded: String?, fallback: String?): String {
        val rawInput = when {
            !encoded.isNullOrBlank() -> runCatching {
                URLDecoder.decode(encoded, StandardCharsets.UTF_8)
            }.getOrNull()
            !fallback.isNullOrBlank() -> fallback
            else -> null
        } ?: "Participant"

        val decoded = runCatching { URLDecoder.decode(rawInput, StandardCharsets.UTF_8) }
            .getOrDefault(rawInput)

        return decoded.trim().ifBlank { "Participant" }.take(64)
    }
}
