package com.interviewonline.service

import com.interviewonline.model.Room
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component

@Component
class RoomCanvasTaskScope {
    /** An omitted scope follows the published task for older clients. An empty scope explicitly targets a taskless room. */
    fun resolve(room: Room, requestedTaskId: String?, canManageRoom: Boolean): String? {
        if (room.tasks.isEmpty() && requestedTaskId.isNullOrEmpty()) return null
        val task = if (requestedTaskId == null) {
            room.tasks.firstOrNull { it.stepIndex == room.currentStep }
        } else {
            room.tasks.firstOrNull { it.id == requestedTaskId }
        }
        if (task?.id == null || (!canManageRoom && task.stepIndex != room.currentStep)) {
            throw ApiException(HttpStatus.NOT_FOUND, "Задача недоступна", code = "CANVAS_TASK_UNAVAILABLE")
        }
        return task.id
    }
}
