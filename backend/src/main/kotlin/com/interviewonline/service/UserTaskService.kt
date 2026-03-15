package com.interviewonline.service

import com.interviewonline.dto.CreateTaskTemplateRequest
import com.interviewonline.dto.TaskLanguageGroupDto
import com.interviewonline.dto.TaskTemplateDto
import com.interviewonline.dto.UpdateTaskTemplateRequest
import com.interviewonline.model.User
import com.interviewonline.model.UserTaskCategory
import com.interviewonline.model.UserTaskTemplate
import com.interviewonline.repository.UserTaskCategoryRepository
import com.interviewonline.repository.UserTaskTemplateRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class UserTaskService(
    private val categoryRepository: UserTaskCategoryRepository,
    private val taskRepository: UserTaskTemplateRepository,
    private val taskTemplateService: TaskTemplateService,
) {
    @Transactional
    fun createTask(user: User, request: CreateTaskTemplateRequest): TaskTemplateDto {
        val language = normalizeLanguage(request.language)
        val title = request.title.trim()
        val description = request.description.trim()
        if (title.isEmpty() || description.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название и описание задачи обязательны")
        }
        val category = ensureLanguageCategory(user, language)
        val template = taskRepository.save(
            UserTaskTemplate(
                ownerUser = user,
                category = category,
                title = title,
                description = description,
                starterCode = request.starterCode,
                language = language,
            ),
        )
        return template.toDto()
    }

    @Transactional
    fun updateTask(user: User, taskId: String, request: UpdateTaskTemplateRequest): TaskTemplateDto {
        ensurePresetTasks(user)
        val task = taskRepository.findByIdAndOwnerUserId(taskId, user.id!!)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")
        val language = normalizeLanguage(request.language)
        val title = request.title.trim()
        val description = request.description.trim()
        if (title.isEmpty() || description.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название и описание задачи обязательны")
        }
        task.title = title
        task.description = description
        task.starterCode = request.starterCode
        task.language = language
        task.category = ensureLanguageCategory(user, language)
        return taskRepository.save(task).toDto()
    }

    @Transactional
    fun deleteTask(user: User, taskId: String) {
        ensurePresetTasks(user)
        val deleted = taskRepository.deleteByIdAndOwnerUserId(taskId, user.id!!)
        if (deleted == 0L) {
            throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")
        }
    }

    @Transactional
    fun listTasksGrouped(user: User): List<TaskLanguageGroupDto> {
        ensurePresetTasks(user)
        val tasks = taskRepository.findAllByOwnerUserIdOrderByCreatedAtDesc(user.id!!)
        val tasksByLanguage = tasks.groupBy { it.language }
        val languageOrder = listOf("javascript", "typescript", "python", "kotlin")
        return languageOrder.map { language ->
            TaskLanguageGroupDto(
                language = language,
                tasks = (tasksByLanguage[language] ?: emptyList()).map { it.toDto() },
            )
        }
    }

    @Transactional
    fun resolveTasksForRoom(user: User, taskIds: List<String>, language: String): List<UserTaskTemplate> {
        ensurePresetTasks(user)
        val normalizedLanguage = normalizeLanguage(language)
        val normalized = taskIds.distinct()
        if (normalized.isEmpty()) return emptyList()
        val tasks = taskRepository.findAllByIdInAndOwnerUserId(normalized, user.id!!)
        if (tasks.size != normalized.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некоторые задачи не найдены или не принадлежат пользователю")
        }
        if (tasks.any { it.language != normalizedLanguage }) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "Выбранные задачи должны соответствовать языку комнаты: $normalizedLanguage",
            )
        }
        val tasksById = tasks.associateBy { it.id }
        return normalized.mapNotNull { tasksById[it] }
    }

    private fun ensurePresetTasks(user: User) {
        if (taskRepository.existsByOwnerUserId(user.id!!)) return

        val entities = mutableListOf<UserTaskTemplate>()
        taskTemplateService.catalogByLanguage().forEach { (language, seeds) ->
            val category = ensureLanguageCategory(user, language)
            seeds.forEach { seed ->
                entities += UserTaskTemplate(
                    ownerUser = user,
                    category = category,
                    title = seed.title,
                    description = seed.description,
                    starterCode = seed.starterCode,
                    language = language,
                )
            }
        }
        taskRepository.saveAll(entities)
    }

    private fun ensureLanguageCategory(user: User, language: String): UserTaskCategory {
        return categoryRepository.findByOwnerUserIdAndNameIgnoreCase(user.id!!, language)
            ?: categoryRepository.save(UserTaskCategory(ownerUser = user, name = language))
    }

    private fun normalizeLanguage(language: String): String {
        return when (language.lowercase()) {
            "python" -> "python"
            "kotlin" -> "kotlin"
            "typescript" -> "typescript"
            else -> "javascript"
        }
    }

    private fun UserTaskTemplate.toDto(): TaskTemplateDto {
        return TaskTemplateDto(
            id = id!!,
            title = title,
            description = description,
            starterCode = starterCode,
            language = language,
        )
    }
}
