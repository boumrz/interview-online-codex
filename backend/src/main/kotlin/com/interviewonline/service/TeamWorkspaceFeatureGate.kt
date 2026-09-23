package com.interviewonline.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

@Component
class TeamWorkspaceFeatureGate(
    @Value("\${app.features.team-workspaces-enabled:false}") rawValue: String,
) {
    private val enabled = rawValue == "true"

    fun requireEnabled() {
        if (!enabled) throw secure(HttpStatus.NOT_FOUND, "FEATURE_DISABLED", "Функция недоступна")
    }

    fun isEnabled(): Boolean = enabled
}
