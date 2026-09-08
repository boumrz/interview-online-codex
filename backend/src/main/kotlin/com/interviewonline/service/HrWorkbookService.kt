package com.interviewonline.service

import com.interviewonline.dto.HrInterviewDto
import com.interviewonline.model.User
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
) {
    private val globalPermits = Semaphore(2)
    private val accountsInFlight = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun generate(user: User, from: String?, to: String?): HrWorkbookResult {
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
            val snapshot = interviewService.exportSnapshot(user, from, to)
            ensureBeforeDeadline(deadline)
            if (snapshot.overflow) {
                throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Слишком много данных. Уменьшите диапазон дат")
            }
            return HrWorkbookResult(
                render(snapshot.interviews, snapshot.range, deadline),
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
                    "Завершено", "Состояние", "Архив", "Вердикт", "Комментарий", "Дата фильтра", "Источник даты",
                ),
            )
            interviews.forEachIndexed { index, interview ->
                ensureBeforeDeadline(deadline)
                writeRow(
                    interviewsSheet.createRow(index + 1),
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
                    ),
                )
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

    private fun writeRow(row: org.apache.poi.ss.usermodel.Row, values: List<String?>) {
        values.forEachIndexed { index, value ->
            if (value != null) writeString(row.createCell(index, CellType.STRING), value)
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
