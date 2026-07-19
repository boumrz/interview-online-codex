package com.interviewonline.service

import com.interviewonline.dto.ProductMetricsDailyDto
import com.interviewonline.dto.ProductMetricsFunnelDto
import com.interviewonline.dto.ProductMetricsInterviewersDto
import com.interviewonline.dto.ProductMetricsMetadataDto
import com.interviewonline.dto.ProductMetricsRangeDto
import com.interviewonline.dto.ProductMetricsReliabilityDto
import com.interviewonline.dto.ProductMetricsResponse
import com.interviewonline.model.Room
import com.interviewonline.model.RoomProductMetric
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomProductMetricRepository
import com.interviewonline.repository.RoomRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Aggregate-only administrative read model. No room/person identifiers or
 * interview content may be added to its DTOs.
 */
@Service
class ProductMetricsService(
    private val roomProductMetricRepository: RoomProductMetricRepository,
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
) {
    companion object {
        private const val ROLE_ADMIN = "admin"
        private const val ROLE_INTERVIEWER = "interviewer"
        private const val MAX_RANGE_DAYS = 365L
        private val MOSCOW_ZONE: ZoneId = ZoneId.of("Europe/Moscow")
    }

    @Transactional(readOnly = true)
    fun getAggregateMetrics(
        currentUser: User,
        rawParameters: Map<String, Array<String>>,
    ): ProductMetricsResponse {
        requireAdmin(currentUser)
        val range = validateRange(rawParameters)
        val earliest = roomProductMetricRepository.findTopByOrderByCreatedAtAsc()
        val freshThrough = LocalDate.now(MOSCOW_ZONE).minusDays(1)
        val rangeDto = ProductMetricsRangeDto(
            start = range.start.toString(),
            end = range.end.toString(),
            timezone = MOSCOW_ZONE.id,
        )

        if (earliest == null) {
            return unavailable(rangeDto, freshThrough, null, "collection_not_started")
        }

        val earliestDay = earliest.createdAt.atZone(MOSCOW_ZONE).toLocalDate()
        if (range.end.isBefore(earliestDay)) {
            return unavailable(rangeDto, freshThrough, earliest.createdAt, "collection_started_after_range")
        }

        val metrics = roomProductMetricRepository.findWithLifecycleFactInRange(
            startAt = range.start.atStartOfDay(MOSCOW_ZONE).toInstant(),
            endExclusive = range.end.plusDays(1).atStartOfDay(MOSCOW_ZONE).toInstant(),
        )
        val metricByRoomId = metrics.associateBy { it.roomId }
        val roomsById = roomRepository.findAllById(metricByRoomId.keys).associateBy { it.id!! }
        val createdMetrics = metrics.filter { it.createdAt.isInRange(range) }

        val funnel = buildFunnel(createdMetrics)
        val interviewerMetrics = buildInterviewerMetrics(
            createdMetrics = createdMetrics,
            roomsById = roomsById,
            metricsTouchedInRange = metrics,
        )
        val reliability = ProductMetricsReliabilityDto(
            roomsWithRealtimeConnections = createdMetrics.count { it.realtimeConnectionCount > 0 },
            totalRealtimeConnections = createdMetrics.sumOf { it.realtimeConnectionCount },
            additionalConnectionsAfterFirst = createdMetrics.sumOf { (it.realtimeConnectionCount - 1).coerceAtLeast(0) },
            roomsWithCandidateAttendance = createdMetrics.count { it.firstCandidateJoinedAt != null },
        )

        return ProductMetricsResponse(
            source = "server_authoritative",
            availability = "available",
            range = rangeDto,
            metadata = ProductMetricsMetadataDto(
                collectionStartedAt = earliest.createdAt.toString(),
                freshThrough = freshThrough.toString(),
            ),
            funnel = funnel,
            interviewers = interviewerMetrics,
            reliability = reliability,
            daily = buildDaily(range, metrics),
        )
    }

    private fun buildFunnel(createdMetrics: List<RoomProductMetric>): ProductMetricsFunnelDto {
        val prepared = createdMetrics.count { it.preparedAt != null }
        val candidateAttendance = createdMetrics.count { it.firstCandidateJoinedAt != null }
        val interviewsStarted = createdMetrics.count {
            it.firstInterviewerJoinedAt != null && it.firstCandidateJoinedAt != null
        }
        val meaningfulActivity = createdMetrics.count { it.firstMeaningfulCandidateActivityAt != null }
        val firstVerdicts = createdMetrics.count { it.firstVerdictSavedAt != null }
        val decisionReady = createdMetrics.count(::isDecisionReady)

        val candidateJoinDurations = createdMetrics.mapNotNull { metric ->
            metric.firstCandidateJoinedAt?.let { joinedAt ->
                Duration.between(metric.createdAt, joinedAt).toMinutes().coerceAtLeast(0)
            }
        }
        val decisionDurations = createdMetrics.mapNotNull { metric ->
            metric.firstVerdictSavedAt?.let { verdictAt ->
                Duration.between(metric.createdAt, verdictAt).toMinutes().coerceAtLeast(0)
            }
        }

        return ProductMetricsFunnelDto(
            roomsCreated = createdMetrics.size,
            preparedRooms = prepared,
            candidateAttendance = candidateAttendance,
            interviewsStarted = interviewsStarted,
            meaningfulCandidateActivity = meaningfulActivity,
            firstVerdictsSaved = firstVerdicts,
            decisionReadyTechnicalInterviews = decisionReady,
            candidateAttendanceRate = percentage(candidateAttendance, createdMetrics.size),
            meaningfulActivityRate = percentage(meaningfulActivity, candidateAttendance),
            verdictCompletionRate = percentage(firstVerdicts, meaningfulActivity),
            decisionReadyRate = percentage(decisionReady, createdMetrics.size),
            medianMinutesToCandidateJoin = median(candidateJoinDurations),
            medianMinutesToDecision = median(decisionDurations),
        )
    }

    private fun buildInterviewerMetrics(
        createdMetrics: List<RoomProductMetric>,
        roomsById: Map<String, Room>,
        metricsTouchedInRange: List<RoomProductMetric>,
    ): ProductMetricsInterviewersDto {
        val createdOwnerIds = createdMetrics.mapNotNull { roomsById[it.roomId]?.ownerUser?.id }.toSet()
        val activeRoomIds = metricsTouchedInRange.map { it.roomId }.toSet()
        val activeRooms = roomRepository.findAllById(activeRoomIds)
        val activeOwners = activeRooms.mapNotNull { it.ownerUser?.id }.toMutableSet()
        val activeParticipants = roomParticipantRepository.findAllByRoomIdIn(activeRoomIds)
            .asSequence()
            .filter { it.role.equals(ROLE_INTERVIEWER, ignoreCase = true) }
            .mapNotNull { it.user?.id }
            .toSet()
        activeOwners += activeParticipants

        val activatedOwnerIds = createdMetrics
            .filter(::isDecisionReady)
            .mapNotNull { roomsById[it.roomId]?.ownerUser?.id }
            .toSet()
        val repeatOwnerIds = activatedOwnerIds.filter { ownerId ->
            val ownerRoomIds = roomRepository.findByOwnerUserId(ownerId).mapNotNull { it.id }
            val ownerMetrics = roomProductMetricRepository.findAllByRoomIdIn(ownerRoomIds)
            ownerMetrics.count(::isDecisionReady) >= 2
        }.toSet()

        return ProductMetricsInterviewersDto(
            activeAuthenticatedInterviewers = activeOwners.size,
            newlyActivatedInterviewers = activatedOwnerIds.size,
            repeatUseInterviewers = repeatOwnerIds.size,
            activationRate = percentage(activatedOwnerIds.size, createdOwnerIds.size),
            repeatUseRate = percentage(repeatOwnerIds.size, activatedOwnerIds.size),
        )
    }

    private fun buildDaily(range: ValidatedRange, metrics: List<RoomProductMetric>): List<ProductMetricsDailyDto> {
        return generateSequence(range.start) { date -> date.plusDays(1).takeIf { !it.isAfter(range.end) } }
            .map { date ->
                ProductMetricsDailyDto(
                    date = date.toString(),
                    roomsCreated = metrics.count { it.createdAt.isOn(date) },
                    candidateAttendance = metrics.count { it.firstCandidateJoinedAt?.isOn(date) == true },
                    meaningfulCandidateActivity = metrics.count {
                        it.firstMeaningfulCandidateActivityAt?.isOn(date) == true
                    },
                    firstVerdictsSaved = metrics.count { it.firstVerdictSavedAt?.isOn(date) == true },
                    decisionReadyTechnicalInterviews = metrics.count {
                        isDecisionReady(it) && it.firstVerdictSavedAt?.isOn(date) == true
                    },
                )
            }
            .toList()
    }

    private fun unavailable(
        range: ProductMetricsRangeDto,
        freshThrough: LocalDate,
        collectionStartedAt: Instant?,
        reason: String,
    ): ProductMetricsResponse = ProductMetricsResponse(
        source = "server_authoritative",
        availability = "unavailable",
        range = range,
        metadata = ProductMetricsMetadataDto(
            collectionStartedAt = collectionStartedAt?.toString(),
            freshThrough = freshThrough.toString(),
            reason = reason,
        ),
        funnel = null,
        interviewers = null,
        reliability = null,
        daily = emptyList(),
    )

    private fun validateRange(rawParameters: Map<String, Array<String>>): ValidatedRange {
        val allowed = setOf("start", "end")
        if (rawParameters.keys != allowed || rawParameters.any { (_, values) -> values.size != 1 }) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Нужны только одиночные параметры start и end")
        }
        val start = parseDate(rawParameters.getValue("start").single(), "start")
        val end = parseDate(rawParameters.getValue("end").single(), "end")
        val today = LocalDate.now(MOSCOW_ZONE)
        if (end.isBefore(start)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Дата end не может быть раньше start")
        }
        if (!end.isBefore(today)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Допустимы только завершённые московские дни")
        }
        val days = Duration.between(start.atStartOfDay(MOSCOW_ZONE), end.plusDays(1).atStartOfDay(MOSCOW_ZONE)).toDays()
        if (days !in 1..MAX_RANGE_DAYS) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Диапазон должен содержать от 1 до 365 дней")
        }
        return ValidatedRange(start, end)
    }

    private fun parseDate(raw: String, name: String): LocalDate = try {
        LocalDate.parse(raw)
    } catch (_: Exception) {
        throw ApiException(HttpStatus.BAD_REQUEST, "Параметр $name должен иметь формат YYYY-MM-DD")
    }

    private fun requireAdmin(user: User) {
        if (!user.role.equals(ROLE_ADMIN, ignoreCase = true)) {
            throw ApiException(HttpStatus.FORBIDDEN, "Требуются права администратора")
        }
    }

    private fun isDecisionReady(metric: RoomProductMetric): Boolean =
        metric.firstCandidateJoinedAt != null &&
            metric.firstMeaningfulCandidateActivityAt != null &&
            metric.firstVerdictSavedAt != null

    private fun percentage(numerator: Int, denominator: Int): Double? {
        if (denominator == 0) return null
        return numerator.toDouble() / denominator
    }

    private fun median(values: List<Long>): Long? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val middle = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[middle] else (sorted[middle - 1] + sorted[middle]) / 2
    }

    private fun Instant.isOn(date: LocalDate): Boolean = atZone(MOSCOW_ZONE).toLocalDate() == date

    private fun Instant.isInRange(range: ValidatedRange): Boolean {
        val localDate = atZone(MOSCOW_ZONE).toLocalDate()
        return !localDate.isBefore(range.start) && !localDate.isAfter(range.end)
    }

    private data class ValidatedRange(
        val start: LocalDate,
        val end: LocalDate,
    )
}
