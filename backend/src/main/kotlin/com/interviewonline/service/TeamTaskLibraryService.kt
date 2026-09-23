package com.interviewonline.service

import com.interviewonline.dto.CreateTaskTemplateRequest
import com.interviewonline.dto.TeamTaskLibraryCountsDto
import com.interviewonline.dto.TeamTaskLibraryDto
import com.interviewonline.dto.TeamTaskTemplateDto
import com.interviewonline.dto.TeamTaskTemplateResponse
import com.interviewonline.dto.UpdateTeamTaskTemplateRequest
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.TeamTaskTemplate
import com.interviewonline.model.User
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTaskTemplateRepository
import com.interviewonline.repository.UserTaskTemplateRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.text.Normalizer
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

@Service
class TeamTaskLibraryService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val taskRepository: TeamTaskTemplateRepository,
    private val personalTaskRepository: UserTaskTemplateRepository,
    private val featureGate: TeamWorkspaceFeatureGate,
    private val jdbcTemplate: JdbcTemplate,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String, rawStatus: String?, rawLanguage: String?, rawQuery: String?): TeamTaskLibraryDto {
        val access = requireActiveMember(actor, teamId)
        val status = parseStatus(rawStatus)
        val language = rawLanguage?.takeIf { it.isNotBlank() }?.let(::normalizeLanguage)
        val query = normalizedQuery(rawQuery)
        val allTasks = if (language == null) {
            taskRepository.findByTeamIdAndStatusOrderByCreatedAtDescIdAsc(access.team.id, status)
        } else {
            taskRepository.findByTeamIdAndStatusAndLanguageOrderByCreatedAtDescIdAsc(access.team.id, status, language)
        }
        val filtered = filterTasks(allTasks, query)
        return TeamTaskLibraryDto(
            items = filtered.map(::taskDto),
            counts = counts(access.team.id),
        )
    }

    @Transactional
    fun create(actor: User, teamId: String, request: CreateTaskTemplateRequest): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        return TeamTaskTemplateResponse(
            taskDto(
                saveNewTask(
                    access = access,
                    title = request.title,
                    description = request.description,
                    starterCode = request.starterCode,
                    language = request.language,
                ),
            ),
        )
    }

    @Transactional
    fun importPersonal(actor: User, teamId: String, sourceTaskId: String): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        val source = personalTaskRepository.findByIdAndOwnerUserId(sourceTaskId.trim(), access.actorId)
            ?: throw personalTaskNotFound()
        return TeamTaskTemplateResponse(
            taskDto(
                saveNewTask(
                    access = access,
                    title = source.title,
                    description = source.description,
                    starterCode = source.starterCode,
                    language = source.language,
                ),
            ),
        )
    }

    @Transactional
    fun copyTeamTask(actor: User, teamId: String, taskId: String): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        val source = requireTask(access.team.id, taskId)
        return TeamTaskTemplateResponse(
            taskDto(
                saveNewTask(
                    access = access,
                    title = copyTitle(source.title),
                    description = source.description,
                    starterCode = source.starterCode,
                    language = source.language,
                ),
            ),
        )
    }

    @Transactional
    fun update(actor: User, teamId: String, taskId: String, request: UpdateTeamTaskTemplateRequest): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        val task = requireTask(access.team.id, taskId)
        requireTaskManager(access, task)
        if (task.revision != request.revision) throw taskRevisionConflict(task.revision)
        task.title = canonicalTitle(request.title)
        task.normalizedTitle = normalized(task.title)
        task.description = request.description.trim()
        task.starterCode = request.starterCode.trim()
        task.language = normalizeLanguage(request.language)
        bump(task)
        return TeamTaskTemplateResponse(taskDto(task))
    }

    @Transactional
    fun archive(actor: User, teamId: String, taskId: String): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        val task = requireTask(access.team.id, taskId)
        requireTaskManager(access, task)
        if (task.status != ARCHIVED) {
            task.status = ARCHIVED
            bump(task)
        }
        return TeamTaskTemplateResponse(taskDto(task))
    }

    @Transactional
    fun restore(actor: User, teamId: String, taskId: String): TeamTaskTemplateResponse {
        val access = requireActiveMember(actor, teamId)
        val task = requireTask(access.team.id, taskId)
        requireTaskManager(access, task)
        if (task.status != ACTIVE) {
            task.status = ACTIVE
            bump(task)
        }
        return TeamTaskTemplateResponse(taskDto(task))
    }

    @Transactional
    fun delete(actor: User, teamId: String, taskId: String) {
        val access = requireActiveMember(actor, teamId)
        val task = requireTask(access.team.id, taskId)
        requireTaskManager(access, task)
        val referenced = jdbcTemplate.queryForObject(
            """SELECT (SELECT COUNT(*) FROM team_task_set_items WHERE task_template_id = ?) +
                      (SELECT COUNT(*) FROM team_interview_programme_items WHERE task_template_id = ?)""",
            Long::class.java, task.id, task.id,
        )!! > 0
        if (referenced) throw secure(HttpStatus.CONFLICT, "TEAM_TASK_IN_USE", "Задача используется в наборе или задачах интервью")
        taskRepository.delete(task)
        taskRepository.flush()
    }

    private fun requireActiveMember(actor: User, teamId: String): TeamAccess {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(teamId).orElse(null)?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        return TeamAccess(
            actorId = actorId,
            team = team,
            membership = membership,
            role = if (team.ownerUserId == membership.userId) "OWNER" else membership.role,
        )
    }

    private fun canonicalTitle(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..MAX_TITLE_CODE_POINTS) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_TASK_TITLE", "Название задачи должно содержать от 1 до $MAX_TITLE_CODE_POINTS символов")
        }
        return value
    }

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim { it.isWhitespace() }
        .lowercase(Locale.ROOT)

    private fun parseStatus(rawStatus: String?): String = when (rawStatus?.trim()?.lowercase(Locale.ROOT)) {
        null, "", "active" -> ACTIVE
        "archived" -> ARCHIVED
        else -> throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_TASK_FILTER", "Фильтр задач должен быть active или archived")
    }

    private fun normalizedQuery(value: String?): String? = value
        ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() } }
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)

    private fun filterTasks(tasks: List<TeamTaskTemplate>, query: String?): List<TeamTaskTemplate> {
        if (query == null) return tasks
        return tasks.filter { task ->
            task.normalizedTitle.contains(query) ||
                normalized(task.description).contains(query)
        }
    }

    private fun saveNewTask(
        access: TeamAccess,
        title: String,
        description: String,
        starterCode: String,
        language: String,
    ): TeamTaskTemplate {
        val canonicalTitle = canonicalTitle(title)
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        return taskRepository.saveAndFlush(
            TeamTaskTemplate(
                id = UUID.randomUUID().toString(),
                teamId = access.team.id,
                title = canonicalTitle,
                normalizedTitle = normalized(canonicalTitle),
                description = description.trim(),
                starterCode = starterCode.trim(),
                language = normalizeLanguage(language),
                status = ACTIVE,
                revision = 0,
                createdByUserId = access.actorId,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    private fun copyTitle(sourceTitle: String): String {
        val suffix = " (копия)"
        val source = canonicalTitle(sourceTitle)
        val suffixLength = suffix.codePointCount(0, suffix.length)
        val maxSourceLength = MAX_TITLE_CODE_POINTS - suffixLength
        val sourceLength = source.codePointCount(0, source.length)
        val safeSource = if (sourceLength <= maxSourceLength) {
            source
        } else {
            source.substring(0, source.offsetByCodePoints(0, maxSourceLength)).trimEnd()
        }
        return canonicalTitle("$safeSource$suffix")
    }

    private fun counts(teamId: String): TeamTaskLibraryCountsDto = TeamTaskLibraryCountsDto(
        activeTasks = taskRepository.countByTeamIdAndStatus(teamId, ACTIVE),
        archivedTasks = taskRepository.countByTeamIdAndStatus(teamId, ARCHIVED),
    )

    private fun requireTask(teamId: String, taskId: String): TeamTaskTemplate =
        taskRepository.findByIdAndTeamId(taskId, teamId) ?: throw taskNotFound()

    private fun requireTaskManager(access: TeamAccess, task: TeamTaskTemplate) {
        if (access.role == "OWNER" || access.role == "ADMIN" || task.createdByUserId == access.actorId) return
        throw secure(HttpStatus.FORBIDDEN, "INSUFFICIENT_TEAM_TASK_ROLE", "Недостаточно прав для изменения задачи")
    }

    private fun bump(task: TeamTaskTemplate) {
        task.revision += 1
        task.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        taskRepository.saveAndFlush(task)
    }

    private fun taskDto(task: TeamTaskTemplate): TeamTaskTemplateDto = TeamTaskTemplateDto(
        id = task.id,
        title = task.title,
        description = task.description,
        starterCode = task.starterCode,
        language = normalizeLanguage(task.language),
        status = task.status,
        revision = task.revision,
        createdByUserId = task.createdByUserId,
    )

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun taskNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_NOT_FOUND", "Задача не найдена")
    private fun personalTaskNotFound() = secure(HttpStatus.NOT_FOUND, "PERSONAL_TASK_NOT_FOUND", "Личная задача не найдена")
    private fun taskRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Задача уже изменилась",
        code = "TEAM_TASK_REVISION_CONFLICT",
        currentRevision = current,
    )

    private data class TeamAccess(
        val actorId: String,
        val team: Team,
        val membership: TeamMembership,
        val role: String,
    )

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val ARCHIVED = "ARCHIVED"
        const val MAX_TITLE_CODE_POINTS = 180
    }
}
