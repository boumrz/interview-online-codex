package com.interviewonline.service

import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.ws.CandidateKeyPayload
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

@Service
class KeystrokePersistenceService(
    private val roomKeystrokeEventRepository: RoomKeystrokeEventRepository,
    private val roomRepository: RoomRepository,
) {
    data class Acceptance(
        val payload: CandidateKeyPayload,
        val created: Boolean,
    )

    /**
     * Creates a raw event exactly once. Locking the room row serializes the
     * per-room sequence across application instances; [saveAndFlush] makes the
     * durable insert part of the relay's acceptance boundary.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun accept(roomId: String, payload: CandidateKeyPayload): Acceptance {
        val sourceEventId = requireNotNull(payload.sourceEventId) { "sourceEventId must be assigned before persistence" }

        roomKeystrokeEventRepository.findByRoomIdAndSourceEventId(roomId, sourceEventId)?.let { existing ->
            return Acceptance(existing.toPayload(), created = false)
        }

        requireNotNull(roomRepository.lockById(roomId)) { "Room $roomId was not found while accepting activity" }
        roomKeystrokeEventRepository.findByRoomIdAndSourceEventId(roomId, sourceEventId)?.let { existing ->
            return Acceptance(existing.toPayload(), created = false)
        }

        val nextSequence = (roomKeystrokeEventRepository
            .findFirstByRoomIdAndAcceptedSequenceIsNotNullOrderByAcceptedSequenceDesc(roomId)
            ?.acceptedSequence ?: 0L) + 1L
        val accepted = payload.copy(
            timestampEpochMs = Instant.now().toEpochMilli(),
            acceptedSequence = nextSequence,
        )
        val saved = roomKeystrokeEventRepository.saveAndFlush(accepted.toEntity(roomId))
        return Acceptance(saved.toPayload(), created = true)
    }
}
