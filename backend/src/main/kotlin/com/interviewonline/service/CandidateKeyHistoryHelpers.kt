package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.ws.CandidateKeyPayload

/**
 * Чистые помощники для работы с историей нажатий клавиш кандидата.
 *
 * Раньше жили внутри [CollaborationService] — выделены, чтобы:
 * 1. Отделить «чистую» сериализацию/нормализацию от состоянного сервиса.
 * 2. Сделать поведение тестируемым в изоляции (нужен только `ObjectMapper`).
 * 3. Сократить объём `CollaborationService.kt`.
 *
 * Здесь нет состояния и нет побочных эффектов кроме чтения/записи строк.
 * Все методы — `internal`, чтобы оставить их в рамках сервисного пакета.
 */
internal object CandidateKeyHistoryHelpers {
    /**
     * Максимальное число событий в истории нажатий, хранимой в памяти и в БД.
     * Совпадает с прошлой константой `candidateKeyHistoryMaxSize` сервиса.
     */
    const val MAX_HISTORY_SIZE: Int = 50

    /**
     * Парсит JSON-историю клавиш из БД (`Room.candidateKeyHistory`). Поддерживает
     * как «голый» массив событий, так и обёртку `{ "version": 1, "events": [...] }`.
     * Бракованные элементы тихо пропускаются — историю мы не считаем критичной,
     * восстанавливаем максимум того, что осталось.
     */
    fun parse(raw: String?, objectMapper: ObjectMapper): List<CandidateKeyPayload> {
        val normalized = raw.orEmpty().trim()
        if (normalized.isBlank()) return emptyList()
        val parsed = runCatching {
            val root = objectMapper.readTree(normalized)
            val eventsNode = when {
                root.isArray -> root
                root.isObject && root.has("events") -> root["events"]
                else -> null
            }
            if (eventsNode == null || !eventsNode.isArray) {
                emptyList()
            } else {
                eventsNode.mapNotNull { node ->
                    runCatching { objectMapper.treeToValue(node, CandidateKeyPayload::class.java) }
                        .getOrNull()
                }
            }
        }.getOrElse { emptyList() }
        return parsed
            .sortedBy { it.timestampEpochMs }
            .takeLast(MAX_HISTORY_SIZE)
    }

    /**
     * Сериализует историю в JSON для сохранения в БД. Тот же формат, что и
     * раньше: `{ "version": 1, "events": [...] }`. Сразу же сортирует и
     * обрезает до максимального размера, чтобы хранилище никогда не пухло.
     */
    fun serialize(history: List<CandidateKeyPayload>, objectMapper: ObjectMapper): String {
        val normalized = history
            .sortedBy { it.timestampEpochMs }
            .takeLast(MAX_HISTORY_SIZE)
        return objectMapper.writeValueAsString(mapOf("version" to 1, "events" to normalized))
    }

    /**
     * Сливает in-memory историю с тем, что было в БД. Использует составной
     * ключ дедупликации (sessionId + timestamp + key + keyCode + модификаторы +
     * eventKind), чтобы события с одинаковым ts но разными типами (например,
     * keydown и tab_hidden) не схлопывались в одно.
     */
    fun merge(
        inMemory: List<CandidateKeyPayload>,
        persisted: List<CandidateKeyPayload>,
    ): List<CandidateKeyPayload> {
        if (inMemory.isEmpty()) {
            return persisted.sortedBy { it.timestampEpochMs }.takeLast(MAX_HISTORY_SIZE)
        }
        if (persisted.isEmpty()) {
            return inMemory.sortedBy { it.timestampEpochMs }.takeLast(MAX_HISTORY_SIZE)
        }
        val merged = linkedMapOf<String, CandidateKeyPayload>()
        (persisted + inMemory)
            .sortedBy { it.timestampEpochMs }
            .forEach { event ->
                val dedupeKey = listOf(
                    event.sessionId,
                    event.timestampEpochMs.toString(),
                    event.key,
                    event.keyCode,
                    if (event.ctrlKey) "1" else "0",
                    if (event.altKey) "1" else "0",
                    if (event.shiftKey) "1" else "0",
                    if (event.metaKey) "1" else "0",
                    event.eventKind,
                ).joinToString(":")
                merged[dedupeKey] = event
            }
        return merged.values
            .sortedBy { it.timestampEpochMs }
            .takeLast(MAX_HISTORY_SIZE)
    }

    /**
     * Приводит входящий `eventKind` к одному из поддерживаемых значений.
     * Неизвестные/пустые значения трактуем как обычное `keydown`, чтобы
     * ничего не падало при появлении старых клиентов или новых, ещё не
     * добавленных категорий событий.
     */
    fun normalizeEventKind(rawKind: String?): String {
        val normalized = rawKind?.trim()?.lowercase().orEmpty()
        return when (normalized) {
            "window_blur",
            "window_focus",
            "tab_hidden",
            "tab_visible",
            "paste" -> normalized
            else -> "keydown"
        }
    }

    /**
     * Нормализует поле `key` из входящего payload: режет до 64 символов, маппит
     * пробел/таб/энтер/Spacebar/Esc/OS в стабильные имена. Возвращает пустую
     * строку, если после тримминга ничего не осталось (тогда вызывающий код
     * может опереться только на `keyCode`).
     */
    fun normalizeIncomingKey(rawKey: String?): String {
        val raw = rawKey?.take(64) ?: return ""
        if (raw == " " || raw == "\u00A0") return "Space"
        if (raw == "\t") return "Tab"
        if (raw == "\n" || raw == "\r" || raw == "\r\n") return "Enter"
        val trimmed = raw.trim()
        if (trimmed.isBlank()) return ""
        val normalized = when (trimmed) {
            "Spacebar" -> "Space"
            "Esc" -> "Escape"
            "OS" -> "Meta"
            else -> trimmed
        }
        return normalized.take(32)
    }

    fun sanitizePastePreview(raw: String?): String? {
        if (raw == null) return null
        return raw.take(50)
    }

    fun sanitizePasteLength(raw: Int?): Int? {
        if (raw == null) return null
        return raw.coerceIn(0, 1_000_000)
    }

    /**
     * Нормализует поле `keyCode` (DOM `KeyboardEvent.code`): чистит мусор и
     * обрезает длину, чтобы клиент не смог раздуть payload в логе.
     */
    fun normalizeIncomingKeyCode(rawCode: String?): String {
        val trimmed = rawCode?.trim().orEmpty()
        if (trimmed.isBlank()) return ""
        val normalized = when (trimmed) {
            "Spacebar" -> "Space"
            "Esc" -> "Escape"
            "OSLeft", "OSRight", "OS" -> "Meta"
            "Tab", "Enter", "Backspace", "Delete", "Space" -> trimmed
            else -> trimmed
        }
        return normalized.take(32)
    }
}
