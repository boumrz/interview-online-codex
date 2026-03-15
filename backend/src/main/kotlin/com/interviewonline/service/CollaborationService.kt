package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomRepository
import com.interviewonline.ws.ParticipantPayload
import com.interviewonline.ws.RoomRealtimePayload
import com.interviewonline.ws.WsOutgoingMessage
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import java.util.concurrent.ConcurrentHashMap

@Service
class CollaborationService(
    private val roomRepository: RoomRepository,
    private val realtimeFaultInjectionService: RealtimeFaultInjectionService,
    private val objectMapper: ObjectMapper,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    private data class ParticipantMeta(
        val inviteCode: String,
        val sessionId: String,
        val displayName: String,
        val isOwner: Boolean,
    )

    private data class RealtimeState(
        var language: String,
        var code: String,
        var currentStep: Int,
    )

    private val roomSockets = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()
    private val participants = ConcurrentHashMap<String, ParticipantMeta>()
    private val roomState = ConcurrentHashMap<String, RealtimeState>()

    fun bootstrapRoom(room: Room) {
        roomState[room.inviteCode] = RealtimeState(
            language = room.language,
            code = room.code,
            currentStep = room.currentStep,
        )
    }

    fun syncFromRoom(room: Room) {
        roomState[room.inviteCode] = RealtimeState(room.language, room.code, room.currentStep)
        broadcastState(room.inviteCode)
    }

    fun joinRoom(
        inviteCode: String,
        socket: WebSocketSession,
        sessionId: String,
        displayName: String,
        ownerToken: String?,
    ) {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomState.computeIfAbsent(inviteCode) {
            RealtimeState(room.language, room.code, room.currentStep)
        }
        roomSockets.computeIfAbsent(inviteCode) { ConcurrentHashMap.newKeySet() }.add(socket)
        val isOwner = room.ownerSessionToken == ownerToken
        participants[socket.id] = ParticipantMeta(inviteCode, sessionId, displayName, isOwner)
        broadcastState(inviteCode)
    }

    fun leaveRoom(socket: WebSocketSession) {
        val participant = participants.remove(socket.id) ?: return
        roomSockets[participant.inviteCode]?.remove(socket)
        broadcastState(participant.inviteCode)
    }

    fun updateCode(socket: WebSocketSession, code: String) {
        val participant = participants[socket.id] ?: return
        roomState[participant.inviteCode]?.code = code
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.code = code
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    fun updateLanguage(socket: WebSocketSession, language: String) {
        val participant = participants[socket.id] ?: return
        if (!participant.isOwner) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только владелец может менять язык")
        }
        roomState[participant.inviteCode]?.language = language
        roomRepository.findByInviteCode(participant.inviteCode)?.let {
            it.language = language
            roomRepository.save(it)
        }
        broadcastState(participant.inviteCode)
    }

    @Transactional
    fun nextStep(socket: WebSocketSession) {
        val participant = participants[socket.id] ?: return
        if (!participant.isOwner) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только владелец может переключать шаги")
        }
        val room = roomRepository.findByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        val maxStep = room.tasks.size - 1
        setStepInternal(participant.inviteCode, room, (room.currentStep + 1).coerceAtMost(maxStep))
    }

    @Transactional
    fun setStep(socket: WebSocketSession, stepIndex: Int) {
        val participant = participants[socket.id] ?: return
        if (!participant.isOwner) {
            throw ApiException(HttpStatus.FORBIDDEN, "Только владелец может переключать шаги")
        }
        val room = roomRepository.findByInviteCode(participant.inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        if (room.tasks.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "В комнате нет задач для переключения")
        }
        if (stepIndex < 0 || stepIndex >= room.tasks.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Номер шага вне диапазона")
        }
        setStepInternal(participant.inviteCode, room, stepIndex)
    }

    fun closeRoom(inviteCode: String) {
        roomState.remove(inviteCode)
        roomSockets.remove(inviteCode)?.forEach { socket ->
            try {
                if (socket.isOpen) {
                    socket.close()
                }
            } catch (_: Exception) {
            }
        }
        participants.entries.removeIf { it.value.inviteCode == inviteCode }
    }

    private fun broadcastState(inviteCode: String) {
        val faultProfile = realtimeFaultInjectionService.profileFor(inviteCode)
        if (faultProfile != null && faultProfile.latencyMs > 0) {
            Thread.sleep(faultProfile.latencyMs.toLong())
        }
        if (realtimeFaultInjectionService.shouldDropMessage(inviteCode)) {
            logger.info("Fault injection dropped realtime broadcast for room {}", inviteCode)
            return
        }

        val state = roomState[inviteCode] ?: return
        val sockets = roomSockets[inviteCode]?.toList().orEmpty()
        if (sockets.isEmpty()) return
        val participantsPayload = participants.values
            .filter { it.inviteCode == inviteCode }
            .map { ParticipantPayload(it.sessionId, it.displayName) }
        sockets.filterNotNull().forEach { socket ->
            try {
                val participant = participants[socket.id]
                val payload = RoomRealtimePayload(
                    inviteCode = inviteCode,
                    language = state.language,
                    code = state.code,
                    currentStep = state.currentStep,
                    participants = participantsPayload,
                    isOwner = participant?.isOwner == true,
                )
                val message = WsOutgoingMessage(type = "state_sync", payload = payload)
                if (socket.isOpen) {
                    synchronized(socket) {
                        if (socket.isOpen) {
                            socket.sendMessage(TextMessage(objectMapper.writeValueAsString(message)))
                        }
                    }
                }
            } catch (ex: Exception) {
                logger.warn("Failed to broadcast room state", ex)
                roomSockets[inviteCode]?.remove(socket)
                participants.remove(socket.id)
            }
        }
    }

    private fun setStepInternal(inviteCode: String, room: Room, stepIndex: Int) {
        room.currentStep = stepIndex
        room.code = room.tasks[stepIndex].starterCode
        roomRepository.save(room)
        roomState[inviteCode] = RealtimeState(
            language = room.language,
            code = room.code,
            currentStep = room.currentStep,
        )
        broadcastState(inviteCode)
    }
}
