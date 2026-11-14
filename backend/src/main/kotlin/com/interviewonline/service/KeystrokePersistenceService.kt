package com.interviewonline.service

import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockById
import com.interviewonline.model.Room
import com.interviewonline.model.RoomStatus
import com.interviewonline.ws.CandidateKeyPayload
import org.springframework.stereotype.Service
import org.springframework.http.HttpStatus
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
    fun accept(roomId: String, payload: CandidateKeyPayload, verifySender: (Room) -> Unit = {}): Acceptance {
        val sourceEventId = requireNotNull(payload.sourceEventId) { "sourceEventId must be assigned before persistence" }

        val room = requireNotNull(roomRepository.lockById(roomId)) { "Room $roomId was not found while accepting activity" }
        verifySender(room)
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        if (room.status == RoomStatus.FINISHED.wireValue) {
            throw ApiException(HttpStatus.FORBIDDEN, "Интервью доступно только для просмотра", code = "ROOM_READ_ONLY")
        }
        if (room.status == RoomStatus.FROZEN.wireValue) {
            throw ApiException(HttpStatus.CONFLICT, "Комната недоступна для изменений")
        }
        roomKeystrokeEventRepository.findByRoomIdAndSourceEventId(roomId, sourceEventId)?.let { existing ->
            val stored = existing.toPayload()
            val expected = if (existing.rawFieldsPreserved) payload else CandidateKeyHistoryHelpers.legacyStoredFields(payload)
            // A reconnect may change the display name. The original attribution and acceptance metadata stay immutable.
            val retry = expected.copy(
                displayName = stored.displayName,
                timestampEpochMs = stored.timestampEpochMs,
                acceptedSequence = stored.acceptedSequence,
            )
            if (stored != retry) {
                throw ApiException(HttpStatus.CONFLICT, "sourceEventId уже использован для другого действия", code = "ACTIVITY_ID_CONFLICT")
            }
            return Acceptance(stored, created = false)
        }

        return Acceptance(appendUnderRoomLock(roomId, payload), created = true)
    }

    /** Caller owns the locked Room row. The scene, its receipt and this row commit together. */
    @Transactional(propagation = Propagation.MANDATORY)
    fun appendUnderRoomLock(roomId: String, payload: CandidateKeyPayload): CandidateKeyPayload {
        val nextSequence = (roomKeystrokeEventRepository
            .findFirstByRoomIdAndAcceptedSequenceIsNotNullOrderByAcceptedSequenceDesc(roomId)
            ?.acceptedSequence ?: 0L) + 1L
        val accepted = payload.copy(
            timestampEpochMs = Instant.now().toEpochMilli(),
            acceptedSequence = nextSequence,
        )
        val saved = roomKeystrokeEventRepository.saveAndFlush(accepted.toEntity(roomId))
        return saved.toPayload()
    }
}
