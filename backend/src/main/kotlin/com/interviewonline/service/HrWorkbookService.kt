package com.interviewonline.service

import com.interviewonline.dto.HrInterviewDto
import com.interviewonline.model.User
import com.interviewonline.repository.HrHostNotesExportRepository
import com.interviewonline.repository.HrHostNotesExportSnapshot
import com.fasterxml.jackson.databind.ObjectMapper
import org.apache.poi.ss.usermodel.CellType
import org.apache.poi.xssf.streaming.SXSSFWorkbook
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.concurrent.Semaphore

data class HrWorkbookResult(
    val bytes: ByteArray,
    val interviewCount: Int,
)

@Service
class HrWorkbookService(
    private val interviewService: HrInterviewService,
    private val hostNotesRepository: HrHostNotesExportRepository,
    private val objectMapper: ObjectMapper,
) {
    private val globalPermits = Semaphore(2)
    private val accountsInFlight = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    @JvmOverloads
    fun generate(
        user: User,
        from: String?,
        to: String?,
        teamId: String? = null,
        trackId: String? = null,
        vacancyId: String? = null,
    ): HrWorkbookResult {
        val userId = requireNotNull(user.id)
        var globalAcquired = false
        var accountAcquired = false
        try {
            accountAcquired = accountsInFlight.add(userId)
            globalAcquired = accountAcquired && globalPermits.tryAcquire()
            if (!accountAcquired || !globalAcquired) {
                throw ApiException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "Экспорт уже выполняется. Повторите через несколько секунд",
                    HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, "5") },
                )
            }
            val deadline = System.nanoTime() + 30_000_000_000L
            val snapshot = interviewService.exportSnapshot(user, from, to, teamId, trackId, vacancyId)
            ensureBeforeDeadline(deadline)
            if (snapshot.overflow) {
                throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Слишком много данных. Уменьшите диапазон дат")
            }
            val roomIds = snapshot.interviews.map { it.roomId }
            val notes = hostNotesRepository.snapshot(roomIds)
            val bytes = render(snapshot.interviews, snapshot.range, notes, deadline)
            interviewService.requireExportAccess(user, roomIds, teamId)
            ensureBeforeDeadline(deadline)
            return HrWorkbookResult(
                bytes,
                snapshot.interviews.size,
            )
        } finally {
            if (globalAcquired) globalPermits.release()
            if (accountAcquired) accountsInFlight.remove(userId)
        }
    }

    private fun render(
        interviews: List<HrInterviewDto>,
        range: HrInterviewService.DateRange,
        hostNotes: HrHostNotesExportSnapshot,
        deadline: Long,
    ): ByteArray {
        val temp = Files.createTempFile("hr-interviews-", ".xlsx")
        var allocatedWorkbook: SXSSFWorkbook? = null
        var primaryFailure: Throwable? = null
        try {
            val workbook = SXSSFWorkbook(100).also { allocatedWorkbook = it }
            workbook.setCompressTempFiles(true)
            val interviewsSheet = workbook.createSheet("Интервью")
            writeRow(
                interviewsSheet.createRow(0),
                listOf(
                    "ID интервью", "Комната", "Кандидат", "Позиция", "Запланировано", "Создано",
                    "Завершено", "Состояние", "Архив", "Вердикт", "Комментарий к решению", "Дата фильтра", "Источник даты", "Комментарий",
                ),
            )
            var continuationSheet: org.apache.poi.ss.usermodel.Sheet? = null
            var continuationRow = 1
            val commentStyle = workbook.createCellStyle().apply { wrapText = true }
            interviewsSheet.setColumnWidth(13, 60 * 256)
            interviews.forEachIndexed { index, interview ->
                ensureBeforeDeadline(deadline)
                val comment = hostComment(interview, hostNotes)
                val cellComment = if (comment.length > 32_767) {
                    val sheet = continuationSheet ?: workbook.createSheet("Комментарии").also {
                        continuationSheet = it
                        writeRow(it.createRow(0), listOf("ID интервью", "Часть", "Комментарий"))
                        it.setColumnWidth(2, 60 * 256)
                    }
                    val chunks = splitCommentCells(comment)
                    chunks.forEachIndexed { part, text ->
                        ensureBeforeDeadline(deadline)
                        val row = sheet.createRow(continuationRow++)
                        writeString(row.createCell(0, CellType.STRING), interview.roomId)
                        row.createCell(1).setCellValue((part + 1).toDouble())
                        row.createCell(2, CellType.STRING).also { cell ->
                            writeString(cell, text)
                            cell.cellStyle = commentStyle
                        }
                    }
                    "Полный комментарий — на листе «Комментарии» (${chunks.size} части)."
                } else comment
                val row = interviewsSheet.createRow(index + 1)
                writeRow(
                    row,
                    listOf(
                        interview.roomId,
                        interview.title,
                        interview.candidateName,
                        interview.position,
                        moscow(interview.scheduledAt),
                        moscow(interview.createdAt),
                        moscow(interview.finishedAt),
                        interview.interviewState,
                        if (interview.archivedAt == null) "нет" else "да",
                        interview.verdict,
                        interview.verdictComment,
                        moscow(interview.effectiveAt),
                        interview.dateSource,
                        cellComment,
                    ),
                )
                row.getCell(13)?.cellStyle = commentStyle
            }

            val scoresSheet = workbook.createSheet("Оценки")
            writeRow(scoresSheet.createRow(0), listOf("ID интервью", "ID задачи", "Шаг", "Задача", "Оценка"))
            var scoreRow = 1
            interviews.forEach { interview ->
                interview.taskScores.forEach { score ->
                    ensureBeforeDeadline(deadline)
                    val row = scoresSheet.createRow(scoreRow++)
                    writeString(row.createCell(0, CellType.STRING), interview.roomId)
                    writeString(row.createCell(1, CellType.STRING), score.taskId)
                    row.createCell(2).setCellValue(score.stepIndex.toDouble())
                    writeString(row.createCell(3, CellType.STRING), score.title)
                    score.score?.let { row.createCell(4).setCellValue(it.toDouble()) }
                }
            }

            val params = workbook.createSheet("Параметры")
            val rangeText = if (range.from == null) "всё время" else "${range.from} — ${range.to}"
            listOf(
                "Сформировано" to moscow(Instant.now().toString()),
                "Диапазон" to rangeText,
                "Часовой пояс" to "Europe/Moscow",
                "Количество интервью" to interviews.size.toString(),
                "Дата фильтра" to "Запланировано, иначе первое завершение, иначе создание",
                "Пустые значения" to "Данные отсутствуют и не были восстановлены искусственно",
            ).forEachIndexed { index, pair -> writeRow(params.createRow(index), listOf(pair.first, pair.second)) }

            Files.newOutputStream(temp).use(workbook::write)
            ensureBeforeDeadline(deadline)
            return Files.readAllBytes(temp)
        } catch (failure: Throwable) {
            primaryFailure = failure
            throw failure
        } finally {
            val cleanupFailures = listOfNotNull(
                runCatching { allocatedWorkbook?.close() }.exceptionOrNull(),
                runCatching { allocatedWorkbook?.dispose() }.exceptionOrNull(),
                runCatching { Files.deleteIfExists(temp) }.exceptionOrNull(),
            )
            val failure = primaryFailure ?: cleanupFailures.firstOrNull()
            cleanupFailures.filter { it !== failure }.forEach { failure?.addSuppressed(it) }
            if (primaryFailure == null && failure != null) throw failure
        }
    }

    private data class HostNote(
        val id: String,
        val text: String,
        val timestamp: Long,
        val step: Int?,
        val block: String?,
    )

    private fun hostComment(interview: HrInterviewDto, snapshot: HrHostNotesExportSnapshot): String {
        val room = snapshot.rooms[interview.roomId] ?: return ""
        val tasks = snapshot.tasks[interview.roomId].orEmpty()
        val modern = readHostNotes(room.privateNotesJson, room.ownerUserId)
        val entries = (modern ?: tasks.flatMap { readHostNotes(it.privateNotesJson, room.ownerUserId, it.stepIndex).orEmpty() })
            .distinctBy { it.id }
            .sortedWith(compareBy<HostNote> { it.timestamp }.thenBy { it.id })
        if (entries.isEmpty()) {
            return room.notes?.takeIf { it.isNotBlank() }
                ?: tasks.mapNotNull { task ->
                    task.interviewerNotes?.takeIf { it.isNotBlank() }?.let { "${stepLabel(interview, task.stepIndex)}\n$it" }
                }.joinToString("\n\n")
        }
        val groups = entries.groupBy { note ->
            when {
                note.step != null -> "step:${note.step}"
                note.block != null -> "custom:${note.block.lowercase(java.util.Locale.forLanguageTag("ru-RU"))}"
                else -> "free"
            }
        }
        return groups.entries.sortedWith(compareBy<Map.Entry<String, List<HostNote>>> {
            when {
                it.key.startsWith("step:") -> 0
                it.key == "free" -> 2
                else -> 1
            }
        }.thenBy { it.value.first().step ?: 0 }).joinToString("\n\n") { (_, notes) ->
            val first = notes.first()
            val label = first.step?.let { stepLabel(interview, it) } ?: first.block ?: "В свободной форме"
            "$label\n${notes.joinToString("\n") { it.text }}"
        }
    }

    private fun stepLabel(interview: HrInterviewDto, step: Int): String {
        val title = interview.taskScores.firstOrNull { it.stepIndex == step }?.title?.trim().orEmpty()
        return "Шаг ${step + 1}" + if (title.isNotEmpty()) " — $title" else ""
    }

    /** Null means no modern payload; an empty host stream must never expose another author. */
    private fun readHostNotes(raw: String?, ownerId: String?, defaultStep: Int? = null): List<HostNote>? {
        if (raw.isNullOrBlank()) return null
        val payload = runCatching { objectMapper.readTree(raw) }.getOrNull() ?: return null
        if (payload.path("authors").isObject != true) return null
        val currentOwnerKey = ownerId?.takeIf { it.isNotBlank() }?.let { "u:$it" }
        return payload.path("authors").fields().asSequence().flatMap { (authorKey, author) ->
            val entries = author.path("entries")
            if (!entries.isArray) return@flatMap emptySequence()
            entries.asSequence().mapIndexedNotNull { index, entry ->
                val hostProof = entry.path("writtenByHost").let { it.isBoolean && it.booleanValue() }
                if (authorKey != currentOwnerKey && !hostProof) return@mapIndexedNotNull null
                val text = entry.path("text").takeIf { it.isTextual }?.asText()?.replace("\u0000", "")?.trim().orEmpty()
                if (text.isEmpty()) return@mapIndexedNotNull null
                val step = entry.path("blockStepIndex").takeIf { it.isIntegralNumber }?.asInt()?.takeIf { it >= 0 } ?: defaultStep
                val block = entry.path("blockName").takeIf { it.isTextual }?.asText()?.replace("\u0000", "")?.trim()?.takeIf { it.isNotEmpty() }
                HostNote(entry.path("id").asText().ifBlank { "$authorKey:$defaultStep:$index" }, text, entry.path("timestampEpochMs").asLong(), step, block)
            }
        }.toList()
    }

    private fun writeRow(row: org.apache.poi.ss.usermodel.Row, values: List<String?>) {
        values.forEachIndexed { index, value ->
            if (value != null) writeString(row.createCell(index, CellType.STRING), value)
        }
    }

    private fun splitCommentCells(text: String): List<String> = buildList {
        var start = 0
        while (start < text.length) {
            var end = minOf(start + 32_767, text.length)
            if (end < text.length && text[end - 1].isHighSurrogate() && text[end].isLowSurrogate()) end -= 1
            add(text.substring(start, end))
            start = end
        }
    }

    private fun writeString(cell: org.apache.poi.ss.usermodel.Cell, value: String) {
        if (value.length > 32_767) {
            throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Текст слишком длинный для XLSX")
        }
        cell.setCellValue(value)
    }

    private fun moscow(raw: String?): String? = raw?.let {
        DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(Instant.parse(it).atZone(HrInterviewService.REPORTING_ZONE))
    }

    private fun ensureBeforeDeadline(deadline: Long) {
        if (System.nanoTime() > deadline) {
            throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Экспорт не успел завершиться за 30 секунд")
        }
    }
}
