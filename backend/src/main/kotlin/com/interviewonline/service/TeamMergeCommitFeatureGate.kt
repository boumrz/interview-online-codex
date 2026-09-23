package com.interviewonline.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

@Component
class TeamMergeCommitFeatureGate(
    @Value("\${app.features.team-merge-commit-enabled:false}") private val rawValue: String,
) {
    fun requireEnabled() {
        if (rawValue != "true") throw secure(HttpStatus.NOT_FOUND, "FEATURE_DISABLED", "Функция недоступна")
    }
}
