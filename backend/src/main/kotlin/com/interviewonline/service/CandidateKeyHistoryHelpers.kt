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
     * Размер хвоста для быстрого state_sync. Полная история хранится в отдельных строках.
     */
    const val MAX_HISTORY_SIZE: Int = 50

    private val canonicalOrder = compareBy<CandidateKeyPayload> { it.timestampEpochMs }
        .thenBy { it.acceptedSequence ?: Long.MIN_VALUE }
        .thenBy { it.sourceEventId.orEmpty() }
        .thenBy { legacyDedupeKey(it) }

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
        return canonicalize(parsed)
    }

    fun merge(
        inMemory: List<CandidateKeyPayload>,
        persisted: List<CandidateKeyPayload>,
    ): List<CandidateKeyPayload> = canonicalize(persisted + inMemory)

    /** Select the latest accepted rows even if the clock moved backwards, then order for display. */
    fun canonicalize(history: Collection<CandidateKeyPayload>): List<CandidateKeyPayload> =
        history.distinctBy(::dedupeKey)
            .sortedWith(compareBy<CandidateKeyPayload> { it.acceptedSequence ?: Long.MIN_VALUE }.then(canonicalOrder))
            .takeLast(MAX_HISTORY_SIZE)
            .sortedWith(canonicalOrder)

    private fun dedupeKey(event: CandidateKeyPayload): String {
        val sourceEventId = event.sourceEventId?.trim().orEmpty()
        return if (sourceEventId.isNotEmpty()) "source:$sourceEventId" else "legacy:${legacyDedupeKey(event)}"
    }

    private fun legacyDedupeKey(event: CandidateKeyPayload): String = listOf(
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

    /** Reproduce the old representation only when acknowledging a retry of a pre-upgrade row. */
    fun legacyStoredFields(payload: CandidateKeyPayload): CandidateKeyPayload {
        val key = normalizeIncomingKey(payload.key)
        val code = normalizeIncomingKeyCode(payload.keyCode)
        return payload.copy(
            key = key.ifEmpty { code },
            keyCode = code.ifEmpty { key }.ifBlank { "" },
            pasteLength = payload.pasteLength?.coerceIn(0, 1_000_000),
        )
    }

    /**
     * Нормализует поле `key` из входящего payload: режет до 64 символов, маппит
     * пробел/таб/энтер/Spacebar/Esc/OS в стабильные имена. Возвращает пустую
     * строку, если после тримминга ничего не осталось (тогда вызывающий код
     * может опереться только на `keyCode`).
     */
    private fun normalizeIncomingKey(rawKey: String?): String {
        val raw = rawKey?.take(64) ?: return ""
        if (raw == " ") return raw
        if (raw == "\u00A0") return "Space"
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

    /**
     * Нормализует поле `keyCode` (DOM `KeyboardEvent.code`): чистит мусор и
     * обрезает длину, чтобы клиент не смог раздуть payload в логе.
     */
    private fun normalizeIncomingKeyCode(rawCode: String?): String {
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
