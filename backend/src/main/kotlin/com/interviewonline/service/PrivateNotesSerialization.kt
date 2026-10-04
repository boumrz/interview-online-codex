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
    private val senderKeyPattern = Regex("^h1:[0-9a-f]{64}$")
    private val requestHashPattern = Regex("^[0-9a-f]{64}$")
    private val v2RootFields = setOf("version", "chatRevision", "messages", "receipts")
    private val v2ReceiptFields = setOf(
        "senderKey",
        "clientMessageId",
        "requestHash",
        "messageId",
        "persistedAtEpochMs",
        "expiresAtEpochMs",
    )

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
    ): MutableList<NoteMessagePayload> = parseChatThread(rawChatJson, legacyNotes, objectMapper)
        .messages
        .toMutableList()

    fun parseChatThread(
        rawChatJson: String?,
        legacyNotes: String?,
        objectMapper: ObjectMapper,
    ): NotesThreadPayload = parseChatThread(rawChatJson, legacyNotes, objectMapper, strictV2 = false)

    fun parseChatThreadForWrite(
        rawChatJson: String?,
        legacyNotes: String?,
        objectMapper: ObjectMapper,
    ): NotesThreadPayload = parseChatThread(rawChatJson, legacyNotes, objectMapper, strictV2 = true)

    private fun parseChatThread(
        rawChatJson: String?,
        legacyNotes: String?,
        objectMapper: ObjectMapper,
        strictV2: Boolean,
    ): NotesThreadPayload {
        val chat = rawChatJson.orEmpty().trim()
        if (chat.isNotBlank()) {
            val root = runCatching { objectMapper.readTree(chat) }.getOrElse {
                if (strictV2) throw MalformedChatThreadException()
                null
            }
            if (root != null && strictV2 && root.isObject && root.path("version").asInt(-1) == 2) {
                return parseStrictV2(root, objectMapper)
            }
            val parsed = root?.let {
                runCatching {
                val messagesNode = when {
                    root.isArray -> root
                    root.isObject && root.has("messages") -> root["messages"]
                    else -> null
                }
                val messages = if (messagesNode == null || !messagesNode.isArray) {
                    emptyList()
                } else {
                    messagesNode.mapNotNull { node ->
                        runCatching {
                            objectMapper.treeToValue(node, NoteMessagePayload::class.java)
                        }.getOrNull()
                    }
                }
                val receipts = if (root.isObject && root.path("receipts").isArray) {
                    root.path("receipts").mapNotNull { node ->
                        runCatching {
                            objectMapper.treeToValue(node, ChatReceiptPayload::class.java)
                        }.getOrNull()
                    }
                } else {
                    emptyList()
                }
                NotesThreadPayload(
                    version = root.path("version").takeIf { it.isInt }?.asInt()
                        ?: if (root.isArray) 0 else 1,
                    chatRevision = root.path("chatRevision").takeIf { it.isIntegralNumber }?.asLong() ?: 0,
                    messages = messages,
                    receipts = receipts,
                )
                }.getOrNull()
            }
            if (parsed != null && (parsed.messages.isNotEmpty() || parsed.receipts.isNotEmpty())) {
                return parsed
            }
        }

        val legacy = legacyNotes.orEmpty().trim()
        if (legacy.isBlank()) {
            return NotesThreadPayload(version = 1)
        }

        return NotesThreadPayload(
            version = 1,
            messages = listOf(
                NoteMessagePayload(
                    id = "legacy-${legacy.hashCode()}",
                    sessionId = "legacy-notes",
                    displayName = "Старые заметки",
                    role = RoomAccessService.RoomRole.INTERVIEWER.wireValue,
                    text = legacy,
                    timestampEpochMs = 0L,
                ),
            ),
        )
    }

    private fun parseStrictV2(
        root: com.fasterxml.jackson.databind.JsonNode,
        objectMapper: ObjectMapper,
    ): NotesThreadPayload {
        try {
            if (root.fieldNames().asSequence().toSet() != v2RootFields) throw MalformedChatThreadException()
            val revisionNode = root.path("chatRevision")
            val messagesNode = root.path("messages")
            val receiptsNode = root.path("receipts")
            if (!revisionNode.isIntegralNumber || revisionNode.asLong() < 0 || !messagesNode.isArray || !receiptsNode.isArray) {
                throw MalformedChatThreadException()
            }
            val messages = messagesNode.map { node ->
                objectMapper.treeToValue(node, NoteMessagePayload::class.java)
                    ?: throw MalformedChatThreadException()
            }
            val receipts = receiptsNode.map { node ->
                if (!node.isObject || node.fieldNames().asSequence().toSet() != v2ReceiptFields) {
                    throw MalformedChatThreadException()
                }
                val receipt = objectMapper.treeToValue(node, ChatReceiptPayload::class.java)
                    ?: throw MalformedChatThreadException()
                if (
                    !senderKeyPattern.matches(receipt.senderKey) ||
                    !requestHashPattern.matches(receipt.requestHash) ||
                    !isCanonicalUuid(receipt.clientMessageId) ||
                    !isCanonicalUuid(receipt.messageId) ||
                    receipt.persistedAtEpochMs < 0 ||
                    receipt.expiresAtEpochMs < receipt.persistedAtEpochMs
                ) {
                    throw MalformedChatThreadException()
                }
                receipt
            }
            return NotesThreadPayload(
                version = 2,
                chatRevision = revisionNode.asLong(),
                messages = messages,
                receipts = receipts,
            )
        } catch (ex: MalformedChatThreadException) {
            throw ex
        } catch (_: Exception) {
            throw MalformedChatThreadException()
        }
    }

    private fun isCanonicalUuid(raw: String): Boolean = runCatching { UUID.fromString(raw).toString() == raw.lowercase() }
        .getOrDefault(false)

    fun serializeChatMessages(
        messages: List<NoteMessagePayload>,
        objectMapper: ObjectMapper,
    ): String = objectMapper.writeValueAsString(NotesThreadPayload(messages = messages))

    fun serializeChatThread(
        chatRevision: Long,
        messages: List<NoteMessagePayload>,
        receipts: List<ChatReceiptPayload>,
        objectMapper: ObjectMapper,
    ): String = objectMapper.writeValueAsString(
        NotesThreadPayload(
            version = 2,
            chatRevision = chatRevision,
            messages = messages,
            receipts = receipts,
        ),
    )

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
            writtenByHost = entry.writtenByHost,
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

internal class MalformedChatThreadException : RuntimeException("Malformed durable chat thread")
