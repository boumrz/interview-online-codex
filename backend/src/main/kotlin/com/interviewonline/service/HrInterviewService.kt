package com.interviewonline.service

import com.interviewonline.dto.HrInterviewDto
import com.interviewonline.dto.HrInterviewPageDto
import com.interviewonline.dto.HrTaskScoreDto
import com.interviewonline.model.User
import com.interviewonline.repository.HrInterviewQueryRepository
import com.interviewonline.repository.HrRoomRow
import com.interviewonline.repository.RoomTaskRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamTrackRepository
import com.interviewonline.repository.TeamVacancyRepository
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
import java.util.UUID
import java.util.regex.Pattern

@Service
class HrInterviewService(
    private val userRepository: UserRepository,
    private val queryRepository: HrInterviewQueryRepository,
    private val taskRepository: RoomTaskRepository,
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val trackRepository: TeamTrackRepository,
    private val vacancyRepository: TeamVacancyRepository,
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
        private const val EXPORT_AUTH_CHUNK_SIZE = 500
        const val MAX_EXPORT_INTERVIEWS = 10_000
        const val MAX_EXPORT_TASKS = 100_000
    }

    @Transactional(readOnly = true)
    fun page(user: User, page: Int, size: Int, from: String?, to: String?, teamId: String? = null, trackId: String? = null, vacancyId: String? = null): HrInterviewPageDto {
        if (page < 0 || size !in 1..100) {
            throw ApiException(HttpStatus.BAD_REQUEST, "page должен быть >= 0, size — от 1 до 100")
        }
        val stored = requireStoredUser(user)
        val range = parseRange(from, to)
        val scope = requireTeamScope(stored, teamId)
        requireCandidateCabinet(stored, scope)
        val rows = queryPage(requireNotNull(stored.id), range, PageRequest.of(page, size), scope, filterId(trackId), filterId(vacancyId))
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
        val stored = requireStoredUser(user)
        val row = queryRepository.findAuthorizedDetail(requireNotNull(stored.id), roomId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Интервью не найдено")
        return mapRows(listOf(row)).single()
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 30)
    @JvmOverloads
    fun exportSnapshot(user: User, from: String?, to: String?, teamId: String? = null, trackId: String? = null, vacancyId: String? = null): ExportSnapshot {
        val stored = requireStoredUser(user)
        val range = parseRange(from, to)
        val scope = requireTeamScope(stored, teamId)
        requireCandidateCabinet(stored, scope)
        val rows = queryPage(
            requireNotNull(stored.id),
            range,
            PageRequest.of(0, MAX_EXPORT_INTERVIEWS + 1),
            scope,
            filterId(trackId),
            filterId(vacancyId),
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

    @Transactional(readOnly = true)
    fun requireExportAccess(user: User, roomIds: Collection<String>, teamId: String? = null) {
        val (stored, scope) = try {
            val current = requireStoredUser(user)
            val scope = requireTeamScope(current, teamId)
            requireCandidateCabinet(current, scope)
            current to scope
        } catch (_: ApiException) {
            throw exportAccessChanged()
        }
        val userId = requireNotNull(stored.id)
        roomIds.toSet().chunked(EXPORT_AUTH_CHUNK_SIZE).forEach { chunk ->
            val expected = chunk.toSet()
            val authorized = queryRepository.findAuthorizedRoomIds(userId, chunk, scope).toSet()
            if (authorized != expected) {
                throw exportAccessChanged()
            }
        }
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

    private fun queryPage(userId: String, range: DateRange, pageRequest: PageRequest, teamId: String?, trackId: String?, vacancyId: String?): Page<HrRoomRow> =
        if (range.startInclusive == null) {
            queryRepository.findAuthorized(userId, pageRequest, teamId, trackId, vacancyId)
        } else {
            queryRepository.findAuthorizedInRange(
                userId,
                requireNotNull(range.startInclusive),
                requireNotNull(range.endExclusive),
                pageRequest,
                teamId,
                trackId,
                vacancyId,
            )
        }

    private fun mapRows(rows: List<HrRoomRow>): List<HrInterviewDto> {
        if (rows.isEmpty()) return emptyList()
        val tasksByRoom = taskRepository.findHrTaskRows(rows.map { it.roomId }).groupBy { it.roomId }
        val tracksById = trackRepository.findAllById(rows.mapNotNull { it.trackId }.toSet()).associateBy { it.id }
        val vacanciesById = vacancyRepository.findAllById(rows.mapNotNull { it.vacancyId }.toSet()).associateBy { it.id }
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
                trackId = row.trackId,
                trackName = tracksById[row.trackId]?.name,
                vacancyId = row.vacancyId,
                vacancyTitle = vacanciesById[row.vacancyId]?.title,
            )
        }
    }

    private fun requireTeamScope(user: User, rawTeamId: String?): String? {
        if (rawTeamId == null) return null
        val teamId = runCatching { UUID.fromString(rawTeamId).toString() }.getOrNull()
            ?.takeIf { it == rawTeamId.lowercase() }
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Команда не найдена")
        if (teamRepository.findById(teamId).orElse(null)?.state != "ACTIVE" ||
            !membershipRepository.existsByTeamIdAndUserIdAndState(teamId, requireNotNull(user.id), "ACTIVE")
        ) {
            throw ApiException(HttpStatus.NOT_FOUND, "Команда не найдена")
        }
        return teamId
    }

    private fun exportAccessChanged() = ApiException(
        HttpStatus.CONFLICT,
        "Доступ к выгрузке изменился. Повторите экспорт",
        code = "HR_EXPORT_ACCESS_CHANGED",
    )

    private fun requireStoredUser(user: User): User =
        userRepository.findById(requireNotNull(user.id)).orElseThrow {
            ApiException(HttpStatus.UNAUTHORIZED, "Пользователь не найден")
        }

    private fun requireCandidateCabinet(user: User, teamId: String?) {
        if (teamId != null || user.isHr) return
        val hasActiveTeam = membershipRepository.findActiveForUser(requireNotNull(user.id)).any { membership ->
            teamRepository.findById(membership.teamId).orElse(null)?.state == "ACTIVE"
        }
        if (!hasActiveTeam) throw ApiException(HttpStatus.FORBIDDEN, "Требуется команда или профиль нанимающего")
    }

    private fun filterId(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }

    private fun effective(row: HrRoomRow): Pair<Instant, String> = when {
        row.scheduledAt != null -> row.scheduledAt to "scheduled"
        row.finishedAt != null -> row.finishedAt to "finished"
        else -> row.createdAt to "created"
    }

}
