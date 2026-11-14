package com.interviewonline.repository

import com.interviewonline.model.CompletedInterviewAttendance
import com.interviewonline.model.RoomProductMetric
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant

interface RoomProductMetricRepository : JpaRepository<RoomProductMetric, String> {
    @Query(value = "select * from room_product_metrics where room_id = :roomId for update", nativeQuery = true)
    fun lockForUpdate(@Param("roomId") roomId: String): RoomProductMetric?

    @Query("""
        select new com.interviewonline.model.CompletedInterviewAttendance(
            metric.firstCandidateJoinedAt, metric.firstInterviewerJoinedAt, room.finishedAt)
        from RoomProductMetric metric join Room room on room.id = metric.roomId
        where room.status = 'finished' and room.finishedAt >= :startAt and room.finishedAt < :endExclusive
    """)
    fun findCompletedAttendanceInRange(
        @Param("startAt") startAt: Instant,
        @Param("endExclusive") endExclusive: Instant,
    ): List<CompletedInterviewAttendance>

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
