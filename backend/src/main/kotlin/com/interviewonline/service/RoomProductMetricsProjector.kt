package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.model.RoomProductMetric
import com.interviewonline.repository.RoomProductMetricRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

/**
 * Projects server-confirmed lifecycle facts into a one-row-per-room aggregate.
 * All methods are idempotent: first-fact timestamps are written at most once.
 */
@Service
class RoomProductMetricsProjector(
    private val roomProductMetricRepository: RoomProductMetricRepository,
) {
    companion object {
        const val SOURCE_GUEST = "guest"
        const val SOURCE_DASHBOARD = "dashboard"
        private const val MAX_REALTIME_CONNECTIONS = 100_000
    }

    @Transactional
    fun recordRoomCreated(room: Room, creationSource: String) {
        val roomId = room.id ?: return
        if (roomProductMetricRepository.existsById(roomId)) return

        val initialTaskCount = room.tasks.size.coerceIn(0, 100)
        roomProductMetricRepository.save(
            RoomProductMetric(
                roomId = roomId,
                createdAt = room.createdAt,
                creationSource = creationSource,
                initialTaskCount = initialTaskCount,
                preparedAt = room.createdAt.takeIf { initialTaskCount > 0 },
            ),
        )
    }

    @Transactional
    fun recordPreparation(roomId: String, occurredAt: Instant = Instant.now()) {
        update(roomId) { metric ->
            if (metric.preparedAt == null) {
                metric.preparedAt = occurredAt
            }
        }
    }

    @Transactional
    fun recordParticipantJoin(
        roomId: String,
        role: RoomAccessService.RoomRole,
        occurredAt: Instant = Instant.now(),
    ) {
        update(roomId) { metric ->
            metric.realtimeConnectionCount = (metric.realtimeConnectionCount + 1)
                .coerceAtMost(MAX_REALTIME_CONNECTIONS)
            when (role) {
                RoomAccessService.RoomRole.CANDIDATE -> {
                    if (metric.firstCandidateJoinedAt == null) {
                        metric.firstCandidateJoinedAt = occurredAt
                    }
                }
                RoomAccessService.RoomRole.OWNER,
                RoomAccessService.RoomRole.INTERVIEWER,
                -> {
                    if (metric.firstInterviewerJoinedAt == null) {
                        metric.firstInterviewerJoinedAt = occurredAt
                    }
                }
            }
        }
    }

    @Transactional
    fun recordMeaningfulCandidateActivity(roomId: String, occurredAt: Instant = Instant.now()) {
        update(roomId) { metric ->
            if (metric.firstMeaningfulCandidateActivityAt == null) {
                metric.firstMeaningfulCandidateActivityAt = occurredAt
            }
        }
    }

    @Transactional
    fun recordVerdictSaved(roomId: String, occurredAt: Instant = Instant.now()) {
        update(roomId) { metric ->
            if (metric.firstVerdictSavedAt == null) {
                metric.firstVerdictSavedAt = occurredAt
            }
            metric.latestVerdictSavedAt = occurredAt
        }
    }

    @Transactional
    fun deleteProjection(roomId: String) {
        roomProductMetricRepository.deleteById(roomId)
    }

    private fun update(roomId: String, mutation: (RoomProductMetric) -> Unit) {
        val metric = roomProductMetricRepository.findById(roomId).orElse(null) ?: return
        mutation(metric)
        roomProductMetricRepository.save(metric)
    }
}
