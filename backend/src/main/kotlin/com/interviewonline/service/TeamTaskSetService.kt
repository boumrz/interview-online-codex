package com.interviewonline.service

import com.interviewonline.dto.CreateTeamTaskSetRequest
import com.interviewonline.dto.TeamTaskSetCountsDto
import com.interviewonline.dto.TeamTaskSetDto
import com.interviewonline.dto.TeamTaskSetItemDto
import com.interviewonline.dto.TeamTaskSetLibraryDto
import com.interviewonline.dto.TeamTaskSetResponse
import com.interviewonline.dto.UpdateTeamTaskSetRequest
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.TeamTaskSet
import com.interviewonline.model.TeamTaskSetItem
import com.interviewonline.model.TeamTaskTemplate
import com.interviewonline.model.User
import com.interviewonline.model.UserTaskTemplate
import com.interviewonline.repository.TaskPresetRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTaskSetRepository
import com.interviewonline.repository.TeamTaskTemplateRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronizationManager
import jakarta.persistence.EntityManager
import java.text.Normalizer
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

@Service
class TeamTaskSetService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val taskRepository: TeamTaskTemplateRepository,
    private val taskSetRepository: TeamTaskSetRepository,
    private val personalPresetRepository: TaskPresetRepository,
    private val entityManager: EntityManager,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String): TeamTaskSetLibraryDto {
        val access = requireActiveMember(actor, teamId)
        return TeamTaskSetLibraryDto(
            items = taskSetRepository.findAllByTeamIdWithItems(access.team.id).map(::taskSetDto),
            counts = counts(access.team.id),
        )
    }

    @Transactional
    fun create(actor: User, teamId: String, request: CreateTeamTaskSetRequest): TeamTaskSetResponse {
        val access = requireActiveMember(actor, teamId)
        val taskSet = saveNewTaskSet(access, request.name, request.taskIds)
        return TeamTaskSetResponse(taskSetDto(taskSet))
    }

    @Transactional
    fun importPersonalPreset(actor: User, teamId: String, sourcePresetId: String): TeamTaskSetResponse {
        val access = requireActiveMember(actor, teamId)
        val source = personalPresetRepository.findByIdWithItems(sourcePresetId.trim(), access.actorId)
            ?.takeIf { it.status == ACTIVE }
            ?: throw personalPresetNotFound()
        val copiedTasks = source.items
            .sortedBy { it.position }
            .map { item -> copyPersonalTaskToTeam(access, requireNotNull(item.taskTemplate)) }
        val taskSet = saveNewTaskSet(
            access = access,
            rawName = uniqueActiveName(access.team.id, source.name),
            taskIds = copiedTasks.map { it.id },
        )
        return TeamTaskSetResponse(taskSetDto(taskSet))
    }

    @Transactional
    fun update(actor: User, teamId: String, setId: String, request: UpdateTeamTaskSetRequest): TeamTaskSetResponse {
        val access = requireActiveMember(actor, teamId)
        val taskSet = requireTaskSet(access.team.id, setId)
        requireTaskSetManager(access, taskSet)
        if (taskSet.revision != request.revision) throw taskSetRevisionConflict(taskSet.revision)
        val name = canonicalName(request.name)
        val normalizedName = normalized(name)
        if (taskSet.status == ACTIVE &&
            taskSetRepository.existsByTeamIdAndStatusAndNormalizedNameAndIdNot(access.team.id, ACTIVE, normalizedName, taskSet.id)
        ) {
            throw duplicateTaskSetName()
        }
        val tasks = requireOrderedActiveTasks(access.team.id, request.taskIds)
        taskSet.name = name
        taskSet.normalizedName = normalizedName
        taskSet.items.clear()
        taskSetRepository.flush()
        attachItems(taskSet, tasks)
        bump(taskSet)
        taskSetRepository.saveAndFlush(taskSet)
        return TeamTaskSetResponse(taskSetDto(requireTaskSet(access.team.id, setId)))
    }

    @Transactional
    fun copy(actor: User, teamId: String, setId: String): TeamTaskSetResponse {
        val access = requireActiveMember(actor, teamId)
        val source = requireTaskSet(access.team.id, setId)
        val sourceTaskIds = source.items.map { requireNotNull(it.taskTemplate).id }
        val taskSet = saveNewTaskSet(access, copyName(access.team.id, source.name), sourceTaskIds)
        return TeamTaskSetResponse(taskSetDto(taskSet))
    }

    @Transactional
    fun delete(actor: User, teamId: String, setId: String) {
        val access = requireActiveMember(actor, teamId)
        val taskSet = requireTaskSet(access.team.id, setId)
        requireTaskSetManager(access, taskSet)
        taskSetRepository.delete(taskSet)
        taskSetRepository.flush()
    }

    private fun saveNewTaskSet(access: TeamAccess, rawName: String, taskIds: List<String>): TeamTaskSet {
        val name = canonicalName(rawName)
        val normalizedName = normalized(name)
        if (taskSetRepository.existsByTeamIdAndStatusAndNormalizedName(access.team.id, ACTIVE, normalizedName)) {
            throw duplicateTaskSetName()
        }
        val tasks = requireOrderedActiveTasks(access.team.id, taskIds)
        val now = now()
        val taskSet = TeamTaskSet(
            id = UUID.randomUUID().toString(),
            teamId = access.team.id,
            name = name,
            normalizedName = normalizedName,
            status = ACTIVE,
            revision = 0,
            createdByUserId = access.actorId,
            createdAt = now,
            updatedAt = now,
        )
        attachItems(taskSet, tasks)
        val saved = taskSetRepository.saveAndFlush(taskSet)
        return requireTaskSet(access.team.id, saved.id)
    }

    private fun copyPersonalTaskToTeam(access: TeamAccess, source: UserTaskTemplate): TeamTaskTemplate {
        val title = canonicalTaskTitle(source.title)
        val createdAt = now()
        return taskRepository.saveAndFlush(
            TeamTaskTemplate(
                id = UUID.randomUUID().toString(),
                teamId = access.team.id,
                title = title,
                normalizedTitle = normalized(title),
                description = source.description.trim(),
                starterCode = source.starterCode.trim(),
                language = normalizeLanguage(source.language),
                status = ACTIVE,
                revision = 0,
                createdByUserId = access.actorId,
                createdAt = createdAt,
                updatedAt = createdAt,
            ),
        )
    }

    private fun attachItems(taskSet: TeamTaskSet, tasks: List<TeamTaskTemplate>) {
        tasks.forEachIndexed { index, task ->
            taskSet.items.add(
                TeamTaskSetItem(
                    id = UUID.randomUUID().toString(),
                    taskSet = taskSet,
                    taskTemplate = task,
                    position = index,
                ),
            )
        }
    }

    private fun requireOrderedActiveTasks(teamId: String, taskIds: List<String>): List<TeamTaskTemplate> {
        if (taskIds.isEmpty()) {
            throw secure(HttpStatus.BAD_REQUEST, "TEAM_TASK_SET_EMPTY", "Набор должен содержать хотя бы одну задачу")
        }
        if (taskIds.size != taskIds.distinct().size) {
            throw secure(HttpStatus.BAD_REQUEST, "TEAM_TASK_SET_DUPLICATE_TASK", "Список задач содержит дубликаты")
        }
        return taskIds.map { taskId ->
            val task = taskRepository.findByIdAndTeamId(taskId, teamId) ?: throw taskNotFound()
            if (task.status != ACTIVE) throw taskNotFound()
            task
        }
    }

    private fun requireActiveMember(actor: User, teamId: String): TeamAccess {
        val actorId = requireNotNull(actor.id)
        val team = if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            teamRepository.findById(teamId).orElse(null)
        } else {
            teamRepository.lockById(teamId)?.also(entityManager::refresh)
        }
        if (team == null || team.state != ACTIVE) throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        return TeamAccess(
            actorId = actorId,
            team = team,
            membership = membership,
            role = if (team.ownerUserId == membership.userId) OWNER else membership.role,
        )
    }

    private fun requireTaskSet(teamId: String, setId: String): TeamTaskSet =
        taskSetRepository.findByIdAndTeamIdWithItems(setId, teamId) ?: throw taskSetNotFound()

    private fun requireTaskSetManager(access: TeamAccess, taskSet: TeamTaskSet) {
        if (access.role == OWNER || access.role == ADMIN || taskSet.createdByUserId == access.actorId) return
        throw secure(HttpStatus.FORBIDDEN, "INSUFFICIENT_TEAM_TASK_SET_ROLE", "Недостаточно прав для изменения набора")
    }

    private fun counts(teamId: String): TeamTaskSetCountsDto = TeamTaskSetCountsDto(
        activeSets = taskSetRepository.countByTeamId(teamId),
        archivedSets = 0,
    )

    private fun taskSetDto(taskSet: TeamTaskSet): TeamTaskSetDto = TeamTaskSetDto(
        id = taskSet.id,
        name = taskSet.name,
        items = taskSet.items.sortedBy { it.position }.map { item ->
            val task = requireNotNull(item.taskTemplate)
            TeamTaskSetItemDto(
                taskId = task.id,
                title = task.title,
                language = normalizeLanguage(task.language),
                position = item.position,
            )
        },
        status = taskSet.status,
        revision = taskSet.revision,
        createdByUserId = taskSet.createdByUserId,
    )

    private fun canonicalName(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..MAX_NAME_CODE_POINTS) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_TASK_SET_NAME", "Название набора должно содержать от 1 до $MAX_NAME_CODE_POINTS символов")
        }
        return value
    }

    private fun canonicalTaskTitle(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..MAX_TASK_TITLE_CODE_POINTS) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_TASK_TITLE", "Название задачи должно содержать от 1 до $MAX_TASK_TITLE_CODE_POINTS символов")
        }
        return value
    }

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim { it.isWhitespace() }
        .lowercase(Locale.ROOT)

    private fun copyName(teamId: String, sourceName: String): String = uniqueActiveName(teamId, "$sourceName (копия)")

    private fun uniqueActiveName(teamId: String, preferredName: String): String {
        val preferred = canonicalName(preferredName)
        if (!taskSetRepository.existsByTeamIdAndStatusAndNormalizedName(teamId, ACTIVE, normalized(preferred))) return preferred
        var attempt = 2
        while (true) {
            val suffix = " ($attempt)"
            val base = if (preferred.codePointCount(0, preferred.length) + suffix.codePointCount(0, suffix.length) <= MAX_NAME_CODE_POINTS) {
                preferred
            } else {
                preferred.substring(0, preferred.offsetByCodePoints(0, MAX_NAME_CODE_POINTS - suffix.codePointCount(0, suffix.length))).trimEnd()
            }
            val candidate = canonicalName("$base$suffix")
            if (!taskSetRepository.existsByTeamIdAndStatusAndNormalizedName(teamId, ACTIVE, normalized(candidate))) return candidate
            attempt += 1
        }
    }

    private fun bump(taskSet: TeamTaskSet) {
        taskSet.revision += 1
        taskSet.updatedAt = now()
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun taskNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_NOT_FOUND", "Задача не найдена")
    private fun taskSetNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_SET_NOT_FOUND", "Набор задач не найден")
    private fun personalPresetNotFound() = secure(HttpStatus.NOT_FOUND, "PERSONAL_PRESET_NOT_FOUND", "Личный набор не найден")
    private fun duplicateTaskSetName() = secure(HttpStatus.CONFLICT, "TEAM_TASK_SET_NAME_CONFLICT", "Набор с таким названием уже существует")
    private fun taskSetRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Набор задач уже изменился",
        code = "TEAM_TASK_SET_REVISION_CONFLICT",
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
        const val OWNER = "OWNER"
        const val ADMIN = "ADMIN"
        const val MAX_NAME_CODE_POINTS = 180
        const val MAX_TASK_TITLE_CODE_POINTS = 180
    }
}
