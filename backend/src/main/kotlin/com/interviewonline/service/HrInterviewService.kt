package com.interviewonline.service

import com.interviewonline.dto.HrInterviewDto
import com.interviewonline.dto.HrInterviewPageDto
import com.interviewonline.dto.HrTaskScoreDto
import com.interviewonline.model.User
import com.interviewonline.repository.HrInterviewQueryRepository
import com.interviewonline.repository.HrRoomRow
import com.interviewonline.repository.RoomTaskRepository
import com.interviewonline.repository.UserRepository
import org.springframework.data.domain.Page
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.regex.Pattern

@Service
class HrInterviewService(
    private val userRepository: UserRepository,
    private val queryRepository: HrInterviewQueryRepository,
    private val taskRepository: RoomTaskRepository,
) {
    data class DateRange(
        val from: LocalDate?,
        val to: LocalDate?,
        val startInclusive: Instant?,
        val endExclusive: Instant?,
    )

    data class ExportSnapshot(
        val interviews: List<HrInterviewDto>,
        val range: DateRange,
        val overflow: Boolean,
        val taskCount: Long,
    )

    companion object {
        val REPORTING_ZONE: ZoneId = ZoneId.of("Europe/Moscow")
        private val STRICT_DATE: Pattern = Pattern.compile("\\d{4}-\\d{2}-\\d{2}")
        const val MAX_EXPORT_INTERVIEWS = 10_000
        const val MAX_EXPORT_TASKS = 100_000
    }

    @Transactional(readOnly = true)
    fun page(user: User, page: Int, size: Int, from: String?, to: String?): HrInterviewPageDto {
        if (page < 0 || size !in 1..100) {
            throw ApiException(HttpStatus.BAD_REQUEST, "page должен быть >= 0, size — от 1 до 100")
        }
        val stored = requireHr(user)
        val range = parseRange(from, to)
        val rows = queryPage(requireNotNull(stored.id), range, PageRequest.of(page, size))
        return HrInterviewPageDto(
            items = mapRows(rows.content),
            page = page,
            size = size,
            totalElements = rows.totalElements,
            totalPages = rows.totalPages,
            from = range.from?.toString(),
            to = range.to?.toString(),
        )
    }

    @Transactional(readOnly = true)
    fun detail(user: User, roomId: String): HrInterviewDto {
        val stored = requireHr(user)
        val row = queryRepository.findAuthorizedDetail(requireNotNull(stored.id), roomId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Интервью не найдено")
        return mapRows(listOf(row)).single()
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 30)
    fun exportSnapshot(user: User, from: String?, to: String?): ExportSnapshot {
        val stored = requireHr(user)
        val range = parseRange(from, to)
        val rows = queryPage(
            requireNotNull(stored.id),
            range,
            PageRequest.of(0, MAX_EXPORT_INTERVIEWS + 1),
        ).content
        if (rows.size > MAX_EXPORT_INTERVIEWS) {
            return ExportSnapshot(emptyList(), range, overflow = true, taskCount = 0)
        }
        val roomIds = rows.map { it.roomId }
        val taskCount = if (roomIds.isEmpty()) 0 else taskRepository.countByRoomIds(roomIds)
        if (taskCount > MAX_EXPORT_TASKS) {
            return ExportSnapshot(emptyList(), range, overflow = true, taskCount = taskCount)
        }
        return ExportSnapshot(mapRows(rows), range, overflow = false, taskCount = taskCount)
    }

    fun parseRange(fromRaw: String?, toRaw: String?): DateRange {
        val from = fromRaw?.trim()?.takeIf(String::isNotEmpty)
        val to = toRaw?.trim()?.takeIf(String::isNotEmpty)
        if ((from == null) != (to == null)) throw ApiException(HttpStatus.BAD_REQUEST, "Укажите обе даты: from и to")
        if (from == null) return DateRange(null, null, null, null)
        if (!STRICT_DATE.matcher(from).matches() || !STRICT_DATE.matcher(requireNotNull(to)).matches()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Даты должны быть в формате YYYY-MM-DD")
        }
        try {
            val fromDate = LocalDate.parse(from)
            val toDate = LocalDate.parse(to)
            if (fromDate > toDate) throw ApiException(HttpStatus.BAD_REQUEST, "Дата from не может быть позже to")
            return DateRange(
                fromDate,
                toDate,
                fromDate.atStartOfDay(REPORTING_ZONE).toInstant(),
                toDate.plusDays(1).atStartOfDay(REPORTING_ZONE).toInstant(),
            )
        } catch (ex: ApiException) {
            throw ex
        } catch (_: DateTimeException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Даты должны быть в формате YYYY-MM-DD")
        }
    }

    private fun queryPage(userId: String, range: DateRange, pageRequest: PageRequest): Page<HrRoomRow> =
        if (range.startInclusive == null) {
            queryRepository.findAuthorized(userId, pageRequest)
        } else {
            queryRepository.findAuthorizedInRange(
                userId,
                requireNotNull(range.startInclusive),
                requireNotNull(range.endExclusive),
                pageRequest,
            )
        }

    private fun mapRows(rows: List<HrRoomRow>): List<HrInterviewDto> {
        if (rows.isEmpty()) return emptyList()
        val tasksByRoom = taskRepository.findHrTaskRows(rows.map { it.roomId }).groupBy { it.roomId }
        return rows.map { row ->
            val (effectiveAt, dateSource) = effective(row)
            HrInterviewDto(
                roomId = row.roomId,
                title = row.title,
                inviteCode = row.inviteCode,
                candidateName = row.candidateName,
                position = row.position,
                scheduledAt = row.scheduledAt?.toString(),
                createdAt = row.createdAt.toString(),
                finishedAt = row.finishedAt?.toString(),
                archivedAt = row.archivedAt?.toString(),
                status = if (row.status == "finished") "finished" else "active",
                interviewState = when {
                    row.status == "finished" -> "finished"
                    row.scheduledAt != null -> "scheduled"
                    else -> "active"
                },
                verdict = row.verdict,
                verdictComment = row.verdictComment,
                effectiveAt = effectiveAt.toString(),
                dateSource = dateSource,
                taskScores = tasksByRoom[row.roomId].orEmpty().map { task ->
                    HrTaskScoreDto(task.taskId, task.stepIndex, task.title, task.score)
                },
            )
        }
    }

    private fun requireHr(user: User): User {
        val stored = userRepository.findById(requireNotNull(user.id)).orElseThrow {
            ApiException(HttpStatus.UNAUTHORIZED, "Пользователь не найден")
        }
        if (!stored.isHr) throw ApiException(HttpStatus.FORBIDDEN, "Требуется профиль нанимающего")
        return stored
    }

    private fun effective(row: HrRoomRow): Pair<Instant, String> = when {
        row.scheduledAt != null -> row.scheduledAt to "scheduled"
        row.finishedAt != null -> row.finishedAt to "finished"
        else -> row.createdAt to "created"
    }

}
