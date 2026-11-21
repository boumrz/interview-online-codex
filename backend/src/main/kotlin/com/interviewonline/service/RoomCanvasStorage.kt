package com.interviewonline.service

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import javax.sql.DataSource

/** The canvas documents and their shared room locks use the PostgreSQL schema. */
@Component
class RoomCanvasStorage(dataSource: DataSource) {
    val available = dataSource.connection.use { it.metaData.databaseProductName == "PostgreSQL" }

    fun visibleMode(storedMode: String): String =
        if (!available && (storedMode == "diagram" || storedMode == "whiteboard")) "code" else storedMode

    fun requireSupported() {
        if (!available) throw ApiException(HttpStatus.NOT_IMPLEMENTED,
            "Холсты доступны при подключении PostgreSQL", code = "ROOM_CANVAS_STORAGE_UNSUPPORTED")
    }
}
