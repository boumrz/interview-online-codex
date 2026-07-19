package com.interviewonline.repository

import com.interviewonline.model.RoomProductMetric
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant

interface RoomProductMetricRepository : JpaRepository<RoomProductMetric, String> {
    fun findTopByOrderByCreatedAtAsc(): RoomProductMetric?

    fun findAllByRoomIdIn(roomIds: Collection<String>): List<RoomProductMetric>

    @Query(
        """
        select metric from RoomProductMetric metric
        where (metric.createdAt >= :startAt and metric.createdAt < :endExclusive)
           or (metric.firstCandidateJoinedAt >= :startAt and metric.firstCandidateJoinedAt < :endExclusive)
           or (metric.firstMeaningfulCandidateActivityAt >= :startAt and metric.firstMeaningfulCandidateActivityAt < :endExclusive)
           or (metric.firstVerdictSavedAt >= :startAt and metric.firstVerdictSavedAt < :endExclusive)
        """,
    )
    fun findWithLifecycleFactInRange(
        @Param("startAt") startAt: Instant,
        @Param("endExclusive") endExclusive: Instant,
    ): List<RoomProductMetric>
}
