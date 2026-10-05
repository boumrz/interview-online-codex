package com.interviewonline.service

import com.interviewonline.dto.PersonalInterviewDetailsDto
import com.interviewonline.dto.PersonalInterviewDetailsUpdateRequest
import com.interviewonline.model.Room
import com.interviewonline.model.User
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockById
import jakarta.persistence.EntityManager
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

@Service
class PersonalInterviewDetailsService(
    private val rooms: RoomRepository,
    private val access: RoomAccessService,
    private val entityManager: EntityManager,
) {
    @Transactional(readOnly = true)
    fun details(actor: User, roomId: String): PersonalInterviewDetailsDto {
        val room = rooms.findById(roomId).orElse(null) ?: throw notFound()
        requireScope(room)
        access.requireManager(room, actor)
        return dto(room)
    }

    @Transactional
    fun update(actor: User, roomId: String, request: PersonalInterviewDetailsUpdateRequest): PersonalInterviewDetailsDto {
        val room = rooms.lockById(roomId)?.also(entityManager::refresh) ?: throw notFound()
        requireScope(room)
        access.requireManager(room, actor)
        if (request.revision < 0) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная ревизия метаданных")
        if (room.interviewMetadataRevision != request.revision) {
            throw ApiException(HttpStatus.CONFLICT, "Сведения уже изменены другим менеджером", currentRevision = room.interviewMetadataRevision)
        }
        // Preserve an unchanged legacy title, including its original spacing.
        val title = if (request.title == room.title) room.title else request.title.trim()
        if (title.isBlank() || title.codePointCount(0, title.length) > 255) throw ApiException(HttpStatus.BAD_REQUEST, "Название интервью должно содержать от 1 до 255 символов")
        if (title != room.title && room.ownerUser?.id != actor.id) throw ApiException(HttpStatus.FORBIDDEN, "Только администратор комнаты может изменить название интервью")
        val candidateName = text(request.candidateName, "Имя кандидата")
        val position = text(request.position, "Позиция")
        val scheduledAt = scheduled(request.scheduledAt)
        room.title = title
        room.candidateName = candidateName
        room.position = position
        room.scheduledAt = scheduledAt
        room.interviewMetadataRevision += 1
        rooms.saveAndFlush(room)
        return dto(room)
    }

    private fun requireScope(room: Room) {
        if (room.teamId != null) throw notFound()
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
    }
    private fun text(raw: String?, label: String): String? {
        val value = raw?.trim()?.ifBlank { null } ?: return null
        if (value.codePointCount(0, value.length) > 200) throw ApiException(HttpStatus.BAD_REQUEST, "$label не может быть длиннее 200 символов")
        return value
    }
    private fun scheduled(raw: String?): Instant? {
        val value = raw?.trim()?.ifBlank { null } ?: return null
        return try { OffsetDateTime.parse(value).toInstant() } catch (_: DateTimeParseException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Запланированное время должно содержать часовой пояс")
        }
    }
    private fun dto(room: Room) = PersonalInterviewDetailsDto(room.title, room.candidateName, room.position, room.scheduledAt?.toString(), room.interviewMetadataRevision)
    private fun notFound() = ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
}
