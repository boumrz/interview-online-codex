package com.interviewonline.service

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

@Component
class RoomDiagramFeatureGate(
    @Value("\${app.features.room-diagrams-enabled:false}") private val rawValue: String,
) {
    val enabled: Boolean get() = rawValue == "true"

    fun visibleMode(storedMode: String): String = if (!enabled && storedMode == "diagram") "code" else storedMode

    fun requireEnabled() {
        if (!enabled) throw ApiException(HttpStatus.NOT_FOUND, "Функция недоступна", code = "FEATURE_DISABLED")
    }
}
