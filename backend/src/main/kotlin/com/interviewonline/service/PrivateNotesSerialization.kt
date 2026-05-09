package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.ws.NoteMessagePayload
import com.interviewonline.ws.PersonalNoteEntryPayload
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Чистая сериализация/нормализация для notes-подсистемы комнаты.
 *
 * Содержит:
 * - чат-нити заметок (`NoteMessagePayload`),
 * - приватных заметок интервьюеров (`PersonalNoteEntryPayload`),
 * - one-shot миграция старого per-task хранилища приватных заметок в новый
 *   room-level формат.
 *
 * Зависит только от Jackson и моделей. Никаких ссылок на сервис или БД —
 * `Room` принимается уже загруженным, побочные эффекты (`roomRepository.save`)
 * остаются в [CollaborationService].
 *
 * Лимиты передаются параметрами, чтобы их можно было прозрачно изменить из
 * вызывающего сервиса и протестировать с нестандартными значениями.
 */
internal object PrivateNotesSerialization {
    /**
     * Парсит JSON-нить чата заметок. Поддерживает и «голый» массив сообщений,
     * и обёртку `{ "version": 1, "messages": [...] }`. Если нить пустая, но
     * есть legacy-поле `notes` — оборачивает его в одно «псевдо-сообщение»
     * с фиксированным id, чтобы не терять существующие тексты.
     */
    fun parseChatMessages(
        rawChatJson: String?,
        legacyNotes: String?,
        objectMapper: ObjectMapper,
    ): MutableList<NoteMessagePayload> {
        val chat = rawChatJson.orEmpty().trim()
        if (chat.isNotBlank()) {
            val parsed = runCatching {
                val root = objectMapper.readTree(chat)
                val messagesNode = when {
                    root.isArray -> root
                    root.isObject && root.has("messages") -> root["messages"]
                    else -> null
                }
                if (messagesNode == null || !messagesNode.isArray) {
                    emptyList()
                } else {
                    messagesNode.mapNotNull { node ->
                        runCatching {
                            objectMapper.treeToValue(node, NoteMessagePayload::class.java)
                        }.getOrNull()
                    }
                }
            }.getOrElse { emptyList() }
            if (parsed.isNotEmpty()) {
                return parsed.toMutableList()
            }
        }

        val legacy = legacyNotes.orEmpty().trim()
        if (legacy.isBlank()) {
            return mutableListOf()
        }

        return mutableListOf(
            NoteMessagePayload(
                id = "legacy-${legacy.hashCode()}",
                sessionId = "legacy-notes",
                displayName = "Старые заметки",
                role = RoomAccessService.RoomRole.INTERVIEWER.wireValue,
                text = legacy,
                timestampEpochMs = 0L,
            ),
        )
    }

    fun serializeChatMessages(
        messages: List<NoteMessagePayload>,
        objectMapper: ObjectMapper,
    ): String = objectMapper.writeValueAsString(NotesThreadPayload(messages = messages))

    /**
     * Конвертирует JSON приватных заметок (один автор → список записей) в
     * runtime-структуру: дедуп через `id`, обрезка по `historyLimit`, удаление
     * нулевых символов и пустых текстов.
     */
    fun readAuthorsPayload(
        authors: Map<String, RoomPrivateNotesAuthorPayload>,
        historyLimit: Int,
        blockNameMaxChars: Int,
        textMaxChars: Int,
    ): MutableMap<String, MutableList<PersonalNoteEntryPayload>> {
        val byAuthor = ConcurrentHashMap<String, MutableList<PersonalNoteEntryPayload>>()
        authors.forEach { (authorKeyRaw, authorPayload) ->
            val authorKey = authorKeyRaw.trim()
            if (authorKey.isBlank()) return@forEach
            val entries = authorPayload.entries
                .mapNotNull { normalizeStoredEntry(it, blockNameMaxChars, textMaxChars) }
                .sortedWith(
                    compareBy<PersonalNoteEntryPayload> { it.timestampEpochMs }
                        .thenBy { it.id },
                )
                .takeLast(historyLimit)
                .toMutableList()
            if (entries.isNotEmpty()) {
                byAuthor[authorKey] = entries
            }
        }
        return byAuthor
    }

    /**
     * One-shot migration helper. Reads the legacy per-task `privateNotesJson`
     * blobs and folds them into the room-level shape, tagging every entry with
     * its original `stepIndex` as `blockStepIndex` so the new UI/export can still
     * label them as `Шаг N - <task title>`.
     *
     * Не сохраняет результат в БД — это ответственность вызывающего кода
     * ([CollaborationService.parseRoomPrivateNotes]). Так миграция остаётся
     * чистой функцией от `Room`, которую можно гонять в тестах.
     */
    fun migrateLegacyTaskPrivateNotes(
        room: Room,
        objectMapper: ObjectMapper,
        historyLimit: Int,
        blockNameMaxChars: Int,
        textMaxChars: Int,
    ): MutableMap<String, MutableList<PersonalNoteEntryPayload>> {
        val byAuthor = ConcurrentHashMap<String, MutableList<PersonalNoteEntryPayload>>()
        room.tasks.forEach { task ->
            val rawTask = task.privateNotesJson.orEmpty().trim()
            if (rawTask.isBlank()) return@forEach
            val parsed = runCatching {
                objectMapper.readValue(rawTask, RoomPrivateNotesPayload::class.java)
            }.getOrNull() ?: return@forEach
            parsed.authors.forEach { (authorKeyRaw, authorPayload) ->
                val authorKey = authorKeyRaw.trim()
                if (authorKey.isBlank()) return@forEach
                val sink = byAuthor.getOrPut(authorKey) { mutableListOf() }
                authorPayload.entries.forEach { entry ->
                    val normalized = normalizeStoredEntry(
                        entry,
                        blockNameMaxChars,
                        textMaxChars,
                    ) ?: return@forEach
                    sink.add(
                        normalized.copy(
                            blockStepIndex = normalized.blockStepIndex ?: task.stepIndex,
                        ),
                    )
                }
            }
        }
        byAuthor.forEach { (authorKey, entries) ->
            byAuthor[authorKey] = entries
                .sortedWith(
                    compareBy<PersonalNoteEntryPayload> { it.timestampEpochMs }
                        .thenBy { it.id },
                )
                .takeLast(historyLimit)
                .toMutableList()
        }
        return byAuthor
    }

    /**
     * Нормализует одну запись приватных заметок:
     * - режет текст до `textMaxChars`,
     * - подрезает имя блока до `blockNameMaxChars`,
     * - чистит null-байты, дефолтит `id` на UUID,
     * - выбрасывает пустые записи.
     *
     * Возвращает `null`, если после очистки текст пустой — такие записи
     * нельзя сохранять (они уйдут «фантомами»).
     */
    fun normalizeStoredEntry(
        entry: PersonalNoteEntryPayload,
        blockNameMaxChars: Int,
        textMaxChars: Int,
    ): PersonalNoteEntryPayload? {
        val text = entry.text.replace("\u0000", "").trim()
        if (text.isBlank()) return null
        return PersonalNoteEntryPayload(
            id = entry.id.trim().ifBlank { UUID.randomUUID().toString() },
            text = text.take(textMaxChars),
            blockName = entry.blockName
                ?.replace("\u0000", "")
                ?.trim()
                ?.take(blockNameMaxChars)
                ?.ifBlank { null },
            blockStepIndex = entry.blockStepIndex?.takeIf { it >= 0 },
            timestampEpochMs = entry.timestampEpochMs.coerceAtLeast(0L),
        )
    }

    fun serializeRoomPrivateNotes(
        authors: Map<String, List<PersonalNoteEntryPayload>>,
        objectMapper: ObjectMapper,
        historyLimit: Int,
        blockNameMaxChars: Int,
        textMaxChars: Int,
    ): String {
        val normalizedAuthors = linkedMapOf<String, RoomPrivateNotesAuthorPayload>()
        authors.forEach { (authorKeyRaw, entriesRaw) ->
            val authorKey = authorKeyRaw.trim()
            if (authorKey.isBlank()) return@forEach
            val entries = entriesRaw
                .mapNotNull { normalizeStoredEntry(it, blockNameMaxChars, textMaxChars) }
                .sortedWith(
                    compareBy<PersonalNoteEntryPayload> { it.timestampEpochMs }
                        .thenBy { it.id },
                )
                .takeLast(historyLimit)
            if (entries.isEmpty()) return@forEach
            normalizedAuthors[authorKey] = RoomPrivateNotesAuthorPayload(entries = entries)
        }
        return objectMapper.writeValueAsString(RoomPrivateNotesPayload(authors = normalizedAuthors))
    }
}
