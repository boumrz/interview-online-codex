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

@Service
@Transactional
class UserPresetService(
    private val presetRepository: TaskPresetRepository,
    private val taskTemplateRepository: UserTaskTemplateRepository,
) {

    // TODO: N+1 — listPresets loads items lazily per-preset; acceptable for MVP (<20 presets per user).
    //       Optimize with @EntityGraph or a single JOIN FETCH query when needed.
    fun listPresets(user: User): List<PresetSummaryDto> {
        val userId = user.id!!
        val presets = presetRepository.findAllByOwnerUserIdOrderByCreatedAtDesc(userId)
        return presets.map { preset ->
            PresetSummaryDto(
                id = preset.id!!,
                name = preset.name,
                itemCount = preset.items.size,
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
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Пресет не найден")

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
        templates.forEach { (index, _, template) ->
            preset.items.add(
                PresetItem(preset = preset, taskTemplate = template, position = index)
            )
        }

        presetRepository.save(preset)
        return presetRepository.findByIdWithItems(presetId, userId)!!.toDetailDto()
    }

    fun deletePreset(user: User, presetId: String) {
        val userId = user.id!!
        val deleted = presetRepository.deleteByIdAndOwnerUserId(presetId, userId)
        if (deleted == 0L) {
            throw ApiException(HttpStatus.NOT_FOUND, "Пресет не найден")
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
    )
}
