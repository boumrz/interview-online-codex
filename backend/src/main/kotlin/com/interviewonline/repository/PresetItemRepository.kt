package com.interviewonline.repository

import com.interviewonline.model.PresetItem
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface PresetItemRepository : JpaRepository<PresetItem, String> {
    @Modifying
    @Query("DELETE FROM PresetItem pi WHERE pi.preset.id = :presetId")
    fun deleteAllByPresetIdJpql(presetId: String): Int

    /** Returns all preset items referencing the given task template, with the preset eagerly loaded. */
    @Query("SELECT pi FROM PresetItem pi JOIN FETCH pi.preset WHERE pi.taskTemplate.id = :taskTemplateId")
    fun findByTaskTemplateIdWithPreset(taskTemplateId: String): List<PresetItem>
}
