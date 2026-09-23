package com.interviewonline.service

import com.interviewonline.dto.CreatePresetRequest
import com.interviewonline.dto.PresetDetailDto
import com.interviewonline.dto.PresetItemDto
import com.interviewonline.dto.PresetSummaryDto
import com.interviewonline.dto.UpdatePresetRequest
import com.interviewonline.model.PresetItem
import com.interviewonline.model.TaskPreset
import com.interviewonline.model.User
import com.interviewonline.repository.TaskPresetRepository
import com.interviewonline.repository.UserTaskTemplateRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale

@Service
@Transactional
class UserPresetService(
    private val presetRepository: TaskPresetRepository,
    private val taskTemplateRepository: UserTaskTemplateRepository,
) {

    // TODO: N+1 — listPresets loads items lazily per-preset; acceptable for MVP (<20 presets per user).
    //       Optimize with @EntityGraph or a single JOIN FETCH query when needed.
    fun listPresets(user: User, rawStatus: String? = null): List<PresetSummaryDto> {
        val userId = user.id!!
        val status = parseStatus(rawStatus)
        val presets = presetRepository.findAllByOwnerUserIdAndStatusOrderByCreatedAtDescIdAsc(userId, status)
        return presets.map { preset ->
            PresetSummaryDto(
                id = preset.id!!,
                name = preset.name,
                itemCount = preset.items.size,
                languageCounts = preset.items
                    .mapNotNull { it.taskTemplate?.language?.trim()?.lowercase()?.takeIf(String::isNotEmpty) }
                    .groupingBy { it }
                    .eachCount(),
                status = preset.status,
                revision = preset.revision,
            )
        }
    }

    fun getPreset(user: User, presetId: String): PresetDetailDto {
        val userId = user.id!!
        val preset = presetRepository.findByIdWithItems(presetId, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Пресет не найден")
        return preset.toDetailDto()
    }

    fun createPreset(user: User, request: CreatePresetRequest): PresetDetailDto {
        val userId = user.id!!
        val name = request.name.trim()
        if (name.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название пресета обязательно")
        }
        if (presetRepository.existsByOwnerUserIdAndNameIgnoreCase(userId, name)) {
            throw ApiException(HttpStatus.CONFLICT, "Пресет с таким именем уже существует")
        }

        val templateIds = request.taskTemplateIds
        if (templateIds.size != templateIds.distinct().size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Список задач содержит дубликаты")
        }

        val preset = TaskPreset(ownerUser = user, name = name)

        templateIds.forEachIndexed { index, templateId ->
            val template = taskTemplateRepository.findByIdAndOwnerUserId(templateId, userId)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "Задача не найдена: $templateId")
            preset.items.add(
                PresetItem(preset = preset, taskTemplate = template, position = index)
            )
        }

        val saved = presetRepository.save(preset)
        return presetRepository.findByIdWithItems(saved.id!!, userId)!!.toDetailDto()
    }

    fun updatePreset(user: User, presetId: String, request: UpdatePresetRequest): PresetDetailDto {
        val userId = user.id!!
        val preset = presetRepository.findByIdAndOwnerUserId(presetId, userId)
            ?: throw presetNotFound()
        if (request.revision != null && preset.revision != request.revision) {
            throw presetRevisionConflict(preset.revision)
        }

        val name = request.name.trim()
        if (name.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Название пресета обязательно")
        }
        if (!preset.name.equals(name, ignoreCase = true)) {
            if (presetRepository.existsByOwnerUserIdAndNameIgnoreCaseAndIdNot(userId, name, presetId)) {
                throw ApiException(HttpStatus.CONFLICT, "Пресет с таким именем уже существует")
            }
        }

        val templateIds = request.taskTemplateIds
        if (templateIds.size != templateIds.distinct().size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Список задач содержит дубликаты")
        }

        val templates = templateIds.mapIndexed { index, templateId ->
            val template = taskTemplateRepository.findByIdAndOwnerUserId(templateId, userId)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "Задача не найдена: $templateId")
            Triple(index, templateId, template)
        }

        preset.name = name
        preset.items.clear()
        presetRepository.flush()
        templates.forEach { (index, _, template) ->
            preset.items.add(
                PresetItem(preset = preset, taskTemplate = template, position = index)
            )
        }
        bump(preset)

        presetRepository.save(preset)
        return presetRepository.findByIdWithItems(presetId, userId)!!.toDetailDto()
    }

    fun copyPreset(user: User, presetId: String): PresetDetailDto {
        val userId = user.id!!
        val source = presetRepository.findByIdWithItems(presetId, userId)
            ?: throw presetNotFound()
        val copy = TaskPreset(
            ownerUser = user,
            name = copyName(userId, source.name),
            status = ACTIVE,
            revision = 0,
            createdAt = now(),
            updatedAt = now(),
        )
        source.items.forEachIndexed { index, item ->
            copy.items.add(
                PresetItem(
                    preset = copy,
                    taskTemplate = item.taskTemplate,
                    position = index,
                ),
            )
        }
        val saved = presetRepository.save(copy)
        return presetRepository.findByIdWithItems(saved.id!!, userId)!!.toDetailDto()
    }

    fun archivePreset(user: User, presetId: String): PresetDetailDto = changeStatus(user, presetId, ARCHIVED)

    fun restorePreset(user: User, presetId: String): PresetDetailDto = changeStatus(user, presetId, ACTIVE)

    fun deletePreset(user: User, presetId: String) {
        val userId = user.id!!
        val deleted = presetRepository.deleteByIdAndOwnerUserId(presetId, userId)
        if (deleted == 0L) {
            throw presetNotFound()
        }
    }

    private fun TaskPreset.toDetailDto(): PresetDetailDto = PresetDetailDto(
        id = id!!,
        name = name,
        items = items.map { item ->
            PresetItemDto(
                taskTemplateId = item.taskTemplate!!.id!!,
                title = item.taskTemplate!!.title,
                language = item.taskTemplate!!.language,
                position = item.position,
            )
        },
        status = status,
        revision = revision,
    )

    private fun changeStatus(user: User, presetId: String, status: String): PresetDetailDto {
        val userId = user.id!!
        val preset = presetRepository.findByIdAndOwnerUserId(presetId, userId)
            ?: throw presetNotFound()
        if (preset.status != status) {
            preset.status = status
            bump(preset)
            presetRepository.save(preset)
        }
        return presetRepository.findByIdWithItems(presetId, userId)!!.toDetailDto()
    }

    private fun parseStatus(rawStatus: String?): String = when (rawStatus?.trim()?.lowercase(Locale.ROOT)) {
        null, "", "active" -> ACTIVE
        "archived" -> ARCHIVED
        else -> throw ApiException(HttpStatus.BAD_REQUEST, "Фильтр пресетов должен быть active или archived", code = "INVALID_PRESET_FILTER")
    }

    private fun bump(preset: TaskPreset) {
        preset.revision += 1
        preset.updatedAt = now()
    }

    private fun copyName(userId: String, sourceName: String): String {
        var attempt = 1
        while (true) {
            val suffix = if (attempt == 1) " (копия)" else " (копия $attempt)"
            val base = sourceName.trim()
            val clippedBase = if (base.length + suffix.length <= MAX_NAME_LENGTH) {
                base
            } else {
                base.take(MAX_NAME_LENGTH - suffix.length).trimEnd()
            }
            val candidate = "$clippedBase$suffix"
            if (!presetRepository.existsByOwnerUserIdAndNameIgnoreCase(userId, candidate)) return candidate
            attempt += 1
        }
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    private fun presetNotFound() = ApiException(HttpStatus.NOT_FOUND, "Пресет не найден", code = "PRESET_NOT_FOUND")

    private fun presetRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Пресет уже изменился",
        code = "PRESET_REVISION_CONFLICT",
        currentRevision = current,
    )

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val ARCHIVED = "ARCHIVED"
        const val MAX_NAME_LENGTH = 255
    }
}
