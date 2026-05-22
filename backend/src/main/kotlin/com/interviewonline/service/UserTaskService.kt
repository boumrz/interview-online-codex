package com.interviewonline.service

import com.interviewonline.dto.CreateTaskTemplateRequest
import com.interviewonline.dto.TaskLanguageGroupDto
import com.interviewonline.dto.TaskTemplateDto
import com.interviewonline.dto.UpdateTaskTemplateRequest
import com.interviewonline.model.User
import com.interviewonline.model.UserTaskCategory
import com.interviewonline.model.UserTaskTemplate
import com.interviewonline.repository.PresetItemRepository
import com.interviewonline.repository.UserTaskCategoryRepository
import com.interviewonline.repository.UserTaskTemplateRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class UserTaskService(
    private val categoryRepository: UserTaskCategoryRepository,
    private val taskRepository: UserTaskTemplateRepository,
    private val taskTemplateService: TaskTemplateService,
    private val presetItemRepository: PresetItemRepository,
) {
    @Transactional
    fun initializeTaskBank(user: User) {
        clearTaskBank(user)
    }

    @Transactional
    fun clearTaskBank(user: User) {
        val userId = user.id ?: return
        taskRepository.deleteAllByOwnerUserId(userId)
        categoryRepository.deleteAllByOwnerUserId(userId)
    }

    @Transactional
    fun createTask(user: User, request: CreateTaskTemplateRequest): TaskTemplateDto {
        val language = normalizeLanguage(request.language)
        val title = request.title.trim()
        val description = request.description.trim()
        val starterCode = request.starterCode.trim()
        if (title.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название задачи обязательно")
        }
        val category = ensureLanguageCategory(user, language)
        val template = taskRepository.save(
            UserTaskTemplate(
                ownerUser = user,
                category = category,
                title = title,
                description = description,
                starterCode = starterCode,
                language = language,
            ),
        )
        return template.toDto()
    }

    @Transactional
    fun updateTask(user: User, taskId: String, request: UpdateTaskTemplateRequest): TaskTemplateDto {
        val task = taskRepository.findByIdAndOwnerUserId(taskId, user.id!!)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")
        val language = normalizeLanguage(request.language)
        val title = request.title.trim()
        val description = request.description.trim()
        val starterCode = request.starterCode.trim()
        if (title.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название задачи обязательно")
        }
        task.title = title
        task.description = description
        task.starterCode = starterCode
        task.language = language
        task.category = ensureLanguageCategory(user, language)
        return taskRepository.save(task).toDto()
    }

    @Transactional
    fun deleteTask(user: User, taskId: String) {
        // Verify ownership before any further checks.
        if (taskRepository.findByIdAndOwnerUserId(taskId, user.id!!) == null) {
            throw ApiException(HttpStatus.NOT_FOUND, "Задача не найдена")
        }

        // Block deletion when the task is referenced by one or more presets.
        val usedInItems = presetItemRepository.findByTaskTemplateIdWithPreset(taskId)
        if (usedInItems.isNotEmpty()) {
            val presetWord = if (usedInItems.size == 1) "пресете" else "пресетах"
            val presetNames = usedInItems
                .mapNotNull { it.preset?.name }
                .distinct()
                .joinToString(", ") { "«$it»" }
            throw ApiException(
                HttpStatus.CONFLICT,
                "Нельзя удалить задачу: она используется в $presetWord $presetNames. Сначала удалите её из пресета.",
            )
        }

        taskRepository.deleteByIdAndOwnerUserId(taskId, user.id!!)
    }

    @Transactional
    fun listTasksGrouped(user: User): List<TaskLanguageGroupDto> {
        cleanupLegacySeedTasks(user)
        val tasks = taskRepository.findAllByOwnerUserIdOrderByCreatedAtDesc(user.id!!)
        val tasksByLanguage = tasks.groupBy { normalizeLanguage(it.language) }
        // Keep UI language tabs deterministic and include `plaintext` so
        // "Plain text" tasks are available in room task selectors.
        val languageOrder = listOf("nodejs", "python", "kotlin", "java", "sql", "plaintext")
        return languageOrder.map { language ->
            TaskLanguageGroupDto(
                language = language,
                tasks = (tasksByLanguage[language] ?: emptyList()).map { it.toDto() },
            )
        }
    }

    @Transactional
    fun resolveTasksForRoom(user: User, taskIds: List<String>): List<UserTaskTemplate> {
        cleanupLegacySeedTasks(user)
        val normalized = taskIds.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (normalized.isEmpty()) {
            return emptyList()
        }
        val tasks = taskRepository.findAllByIdInAndOwnerUserId(normalized, user.id!!)
        if (tasks.size != normalized.size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Некоторые задачи не найдены или не принадлежат пользователю")
        }
        val tasksById = tasks.associateBy { it.id }
        return normalized.mapNotNull { tasksById[it] }
    }

    private fun cleanupLegacySeedTasks(user: User) {
        val userId = user.id ?: return
        val seedSignatures = taskTemplateService.catalogByLanguage()
            .flatMap { (language, seeds) ->
                seeds.map { seed ->
                    normalizeTaskSignature(seed.title, seed.description, seed.starterCode, language)
                }
            }
            .toSet()

        val legacyTasks = taskRepository.findAllByOwnerUserIdOrderByCreatedAtDesc(userId)
            .filter { task ->
                seedSignatures.contains(
                    normalizeTaskSignature(task.title, task.description, task.starterCode, task.language),
                )
            }

        if (legacyTasks.isEmpty()) return
        taskRepository.deleteAll(legacyTasks)
    }

    private fun ensureLanguageCategory(user: User, language: String): UserTaskCategory {
        return categoryRepository.findByOwnerUserIdAndNameIgnoreCase(user.id!!, language)
            ?: categoryRepository.save(UserTaskCategory(ownerUser = user, name = language))
    }

    private fun normalizeTaskSignature(title: String, description: String, starterCode: String, language: String): String {
        val normalizedLanguage = normalizeLanguage(language)
        val normalizedTitle = title.trim().lowercase()
        val normalizedDescription = description.replace("\r\n", "\n").trim()
        val normalizedStarterCode = starterCode.replace("\r\n", "\n").trim()
        return listOf(normalizedLanguage, normalizedTitle, normalizedDescription, normalizedStarterCode).joinToString("::")
    }


    private fun UserTaskTemplate.toDto(): TaskTemplateDto {
        return TaskTemplateDto(
            id = id!!,
            title = title,
            description = description,
            starterCode = starterCode,
            language = normalizeLanguage(language),
        )
    }
}
