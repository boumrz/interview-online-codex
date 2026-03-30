package com.interviewonline.ws

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.service.ApiException
import com.interviewonline.service.AuthService
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
    private val authService: AuthService,
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
        val authToken = query.getFirst("authToken")
        val user = authService.resolveUserByToken(authToken)
        collaborationService.joinRoom(inviteCode, session, sessionId, displayName, ownerToken, interviewerToken, user)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        try {
            val payload = objectMapper.readTree(message.payload)
            val type = payload.path("type").asText("").trim()
            if (type.isBlank()) {
                logger.debug("Skipping websocket message without type: {}", message.payload)
                return
            }

            when (type) {
                "code_update" -> {
                    val code = payload.readTextOrNull("code") ?: run {
                        logger.debug("Skipping incomplete code_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updateCode(session, code)
                }
                "language_update" -> {
                    val language = payload.readTextOrNull("language")?.takeIf { it.isNotBlank() } ?: run {
                        logger.debug("Skipping incomplete language_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updateLanguage(session, language)
                }
                "next_step" -> collaborationService.nextStep(session)
                "set_step" -> {
                    val stepIndex = payload.readNullableInt("stepIndex") ?: run {
                        logger.debug("Skipping incomplete set_step websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.setStep(session, stepIndex)
                }
                "task_rating_update" -> {
                    if (!payload.has("stepIndex") && !payload.has("rating")) {
                        logger.debug("Skipping incomplete task_rating_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updateTaskRating(
                        socket = session,
                        stepIndex = payload.readNullableInt("stepIndex"),
                        rating = payload.readNullableInt("rating"),
                    )
                }
                "notes_update" -> {
                    val notes = payload.readTextOrNull("notes") ?: run {
                        logger.debug("Skipping incomplete notes_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updateNotes(session, notes)
                }
                "presence_update" -> {
                    val presenceStatus = payload.readTextOrNull("presenceStatus")?.takeIf { it.isNotBlank() } ?: run {
                        logger.debug("Skipping incomplete presence_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updatePresence(session, presenceStatus)
                }
                "cursor_update" -> {
                    val lineNumber = payload.readNullableInt("lineNumber") ?: run {
                        logger.debug("Skipping incomplete cursor_update websocket message: {}", message.payload)
                        return
                    }
                    val column = payload.readNullableInt("column") ?: run {
                        logger.debug("Skipping incomplete cursor_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.updateCursor(
                        socket = session,
                        lineNumber = lineNumber,
                        column = column,
                        selectionStartLineNumber = payload.readNullableInt("selectionStartLineNumber"),
                        selectionStartColumn = payload.readNullableInt("selectionStartColumn"),
                        selectionEndLineNumber = payload.readNullableInt("selectionEndLineNumber"),
                        selectionEndColumn = payload.readNullableInt("selectionEndColumn"),
                    )
                }
                "yjs_update" -> {
                    val yjsUpdate = payload.readTextOrNull("yjsUpdate")?.takeIf { it.isNotBlank() } ?: run {
                        logger.debug("Skipping incomplete yjs_update websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.relayYjsUpdate(
                        socket = session,
                        yjsUpdate = yjsUpdate,
                        syncKey = payload.readNullableText("syncKey"),
                    )
                }
                "key_press" -> {
                    val key = payload.readTextOrNull("key")
                    val keyCode = payload.readTextOrNull("keyCode")
                    if (key.isNullOrBlank() && keyCode.isNullOrBlank()) {
                        logger.debug("Skipping incomplete key_press websocket message: {}", message.payload)
                        return
                    }
                    collaborationService.trackKeyPress(
                        socket = session,
                        key = key,
                        keyCode = keyCode,
                        ctrlKey = payload.readBoolean("ctrlKey"),
                        altKey = payload.readBoolean("altKey"),
                        shiftKey = payload.readBoolean("shiftKey"),
                        metaKey = payload.readBoolean("metaKey"),
                    )
                }
                else -> {
                    logger.debug("Ignoring unsupported websocket message type: {}", type)
                    safeSendError(session, "Неизвестный тип сообщения: $type")
                }
            }
        } catch (ex: ApiException) {
            safeSendError(session, ex.message)
        } catch (ex: JsonProcessingException) {
            logger.warn("Invalid websocket json payload: {}", message.payload)
            safeSendError(session, "Некорректный формат WebSocket сообщения")
        } catch (ex: Exception) {
            logger.warn("WebSocket message handling error", ex)
            safeSendError(session, "Ошибка обработки WebSocket сообщения")
        }
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        collaborationService.leaveRoom(session)
    }

    private fun safeSendError(session: WebSocketSession, message: String?) {
        if (message.isNullOrBlank()) return
        runCatching {
            if (session.isOpen) {
                val payload = objectMapper.writeValueAsString(WsOutgoingMessage("error", mapOf("message" to message)))
                synchronized(session) {
                    if (session.isOpen) {
                        session.sendMessage(TextMessage(payload))
                    }
                }
            }
        }.onFailure { ex ->
            logger.debug("Skipping websocket error response because it could not be sent", ex)
        }
    }

    private fun JsonNode.readTextOrNull(field: String): String? {
        val node = path(field)
        if (node.isMissingNode || node.isNull) return null
        return node.asText()
    }

    private fun JsonNode.readNullableInt(field: String): Int? {
        val node = path(field)
        if (node.isMissingNode || node.isNull || !node.isNumber) return null
        return node.asInt()
    }

    private fun JsonNode.readBoolean(field: String): Boolean {
        return path(field).asBoolean(false)
    }

    private fun JsonNode.readNullableText(field: String): String? {
        val node = path(field)
        if (node.isMissingNode || node.isNull) return null
        val value = node.asText("").trim()
        return value.ifBlank { null }
    }

    private fun decodeDisplayName(encoded: String?, fallback: String?): String {
        val rawInput = when {
            !encoded.isNullOrBlank() -> runCatching {
                URLDecoder.decode(encoded, StandardCharsets.UTF_8)
            }.getOrNull()
            !fallback.isNullOrBlank() -> fallback
            else -> null
        } ?: "Участник"

        val decoded = runCatching { URLDecoder.decode(rawInput, StandardCharsets.UTF_8) }
            .getOrDefault(rawInput)

        return decoded.trim().ifBlank { "Участник" }.take(64)
    }
}
