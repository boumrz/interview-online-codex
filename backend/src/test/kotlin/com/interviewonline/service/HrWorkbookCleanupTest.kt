package com.interviewonline.service

import com.interviewonline.model.User
import com.interviewonline.repository.HrHostNotesExportRepository
import com.interviewonline.repository.HrHostNotesExportSnapshot
import com.fasterxml.jackson.databind.ObjectMapper
import org.apache.poi.xssf.streaming.SXSSFWorkbook
import org.junit.jupiter.api.Assertions.assertAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID

class HrWorkbookCleanupTest {
    @Test
    fun `render failure preserves its cause and attempts every cleanup even when close fails`() {
        val interviewService = mock(HrInterviewService::class.java)
        val user = User(id = UUID.randomUUID().toString())
        `when`(interviewService.exportSnapshot(user, null, null, null, null, null)).thenReturn(
            HrInterviewService.ExportSnapshot(emptyList(), HrInterviewService.DateRange(null, null, null, null), false, 0),
        )
        val hostNotes = mock(HrHostNotesExportRepository::class.java)
        `when`(hostNotes.snapshot(emptyList())).thenReturn(HrHostNotesExportSnapshot(emptyMap(), emptyMap()))
        val before = reportFiles()
        try {
            mockConstruction(SXSSFWorkbook::class.java, withSettings().defaultAnswer(RETURNS_DEEP_STUBS)) { workbook, _ ->
                doThrow(IOException("write failure")).`when`(workbook).write(any(OutputStream::class.java))
                doThrow(IOException("close failure")).`when`(workbook).close()
            }.use { construction ->
                val failure = assertThrows(IOException::class.java) {
                    HrWorkbookService(interviewService, hostNotes, ObjectMapper()).generate(user, null, null)
                }
                assertAll(
                    { assertEquals("write failure", failure.message) },
                    { verify(construction.constructed().single()).dispose() },
                    { assertEquals(before, reportFiles(), "temporary candidate workbook must be removed") },
                )
            }
        } finally {
            (reportFiles() - before).forEach(Files::deleteIfExists)
        }
    }

    private fun reportFiles(): Set<Path> = Files.list(Path.of(System.getProperty("java.io.tmpdir"))).use { paths ->
        paths.filter { it.fileName.toString().startsWith("hr-interviews-") }.toList().toSet()
    }
}
