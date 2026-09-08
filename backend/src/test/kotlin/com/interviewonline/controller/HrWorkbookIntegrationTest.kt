package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.apache.poi.ss.usermodel.CellType
import org.apache.poi.ss.usermodel.WorkbookFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.io.ByteArrayInputStream
import com.interviewonline.model.Room
import com.interviewonline.model.RoomHrAssignment
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.HrInterviewService
import org.springframework.http.MediaType
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest
@AutoConfigureMockMvc
class HrWorkbookIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val roomRepository: RoomRepository,
    @Autowired private val assignmentRepository: RoomHrAssignmentRepository,
    @Autowired private val userRepository: UserRepository,
) {
    @Test
    fun `export snapshot transaction is bounded to the renderer deadline`() {
        val method = HrInterviewService::class.java.getMethod(
            "exportSnapshot",
            com.interviewonline.model.User::class.java,
            String::class.java,
            String::class.java,
        )
        val transaction = AnnotationTransactionAttributeSource()
            .getTransactionAttribute(method, HrInterviewService::class.java)

        assertEquals(30, transaction?.timeout)
    }

    @Test
    fun `export returns a complete scoped OOXML workbook with safe download headers`() {
        val (owner, _) = HrHttpFixtures.register(mockMvc, objectMapper, false, "xlsx-owner")
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "xlsx-hr")
        val creation = mockMvc.post("/api/public/rooms") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"=FORMULA must be literal","language":"nodejs"}"""
        }.andExpect { status { isOk() } }.andReturn().response
        val created = objectMapper.readTree(creation.contentAsString)
        val room = HrTestRoom(created.path("id").asText(), created.path("inviteCode").asText())
        require(HrHttpFixtures.inviteHr(mockMvc, owner, room, hr).response.status == 200)
        mockMvc.put("/api/rooms/${room.inviteCode}/interview-metadata") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"candidateName":"=2+2","position":"+SUM(A1:A2)","scheduledAt":null,"revision":0}"""
        }.andExpect { status { isOk() } }
        mockMvc.post("/api/rooms/${room.inviteCode}/verdict") {
            header("Authorization", "Bearer ${owner.token}")
            contentType = MediaType.APPLICATION_JSON
            content = """{"verdict":"HIRE","verdictComment":"@danger"}"""
        }.andExpect { status { isOk() } }
        val stored = roomRepository.findWithTasksByInviteCode(room.inviteCode)!!
        stored.tasks.first().score = 5
        roomRepository.saveAndFlush(stored)

        val response = mockMvc.get("/api/me/hr/rooms/export") {
            header("Authorization", "Bearer ${hr.token}")
            header("Origin", "http://localhost:5173")
        }.andExpect {
            status { isOk() }
            header { string("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }
            header { exists("Content-Disposition") }
            header { string("Cache-Control", "no-store") }
            header { string("X-Content-Type-Options", "nosniff") }
            header { string("Interview-Count", "1") }
            header { string("Access-Control-Expose-Headers", "Content-Disposition, Interview-Count") }
        }.andReturn().response

        assertTrue(response.contentAsByteArray.size > 500)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            assertEquals(listOf("Интервью", "Оценки", "Параметры"), (0 until workbook.numberOfSheets).map(workbook::getSheetName))
            val titleCell = workbook.getSheet("Интервью").getRow(1).getCell(1)
            assertEquals(CellType.STRING, titleCell.cellType)
            assertEquals("=FORMULA must be literal", titleCell.stringCellValue)
            listOf(2 to "=2+2", 3 to "+SUM(A1:A2)", 10 to "@danger").forEach { (column, expected) ->
                val cell = workbook.getSheet("Интервью").getRow(1).getCell(column)
                assertEquals(CellType.STRING, cell.cellType)
                assertEquals(expected, cell.stringCellValue)
            }
            val scoreSheet = workbook.getSheet("Оценки")
            assertEquals(stored.tasks.size + 1, scoreSheet.physicalNumberOfRows)
            (1..stored.tasks.size).forEach { rowIndex ->
                assertEquals(room.id, scoreSheet.getRow(rowIndex).getCell(0).stringCellValue)
                assertTrue(scoreSheet.getRow(rowIndex).getCell(1).stringCellValue.isNotBlank())
            }
            assertEquals(5.0, scoreSheet.getRow(1).getCell(4).numericCellValue)
            val allStrings = (0 until workbook.numberOfSheets).flatMap { sheetIndex ->
                workbook.getSheetAt(sheetIndex).flatMap { row -> row.mapNotNull { cell ->
                    cell.takeIf { it.cellType == CellType.STRING }?.stringCellValue
                } }
            }
            assertFalse(allStrings.contains(room.inviteCode))
            assertFalse(allStrings.any { it.startsWith("owner_") || it.startsWith("interviewer_") })
        }
        assertFalse(response.contentAsString.contains("owner_"))
        assertFalse(response.contentAsString.contains("interviewer_"))
    }

    @Test
    fun `empty export stays valid and date validation matches personal list`() {
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "xlsx-empty")
        val response = mockMvc.get("/api/me/hr/rooms/export") {
            header("Authorization", "Bearer ${hr.token}")
        }.andExpect {
            status { isOk() }
            header { string("Interview-Count", "0") }
        }.andReturn().response
        assertTrue(response.contentAsByteArray.isNotEmpty())

        val invalid = mockMvc.get("/api/me/hr/rooms/export?from=2026-09-06&to=2026-09-05") {
            header("Authorization", "Bearer ${hr.token}")
        }.andReturn().response
        assertEquals(400, invalid.status)
    }

    @Test
    fun `same HR concurrent export is rejected with retry guidance while first export completes`() {
        val (hr, _) = HrHttpFixtures.register(mockMvc, objectMapper, true, "xlsx-race")
        val storedHr = userRepository.findById(hr.id).orElseThrow()
        val rooms = (1..600).map { index ->
            Room(
                title = "Export race $index ${"x".repeat(120)}",
                inviteCode = "r-${UUID.randomUUID()}",
                ownerSessionToken = "owner_${UUID.randomUUID()}",
                interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
                ownerUser = storedHr,
            )
        }
        val savedRooms = roomRepository.saveAll(rooms)
        assignmentRepository.saveAll(savedRooms.map { RoomHrAssignment(room = it, user = storedHr) })
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val results = (1..2).map {
                executor.submit<Pair<Int, String?>> {
                    ready.countDown()
                    start.await(5, TimeUnit.SECONDS)
                    val response = mockMvc.get("/api/me/hr/rooms/export") {
                        header("Authorization", "Bearer ${hr.token}")
                    }.andReturn().response
                    response.status to response.getHeader("Retry-After")
                }
            }
            check(ready.await(5, TimeUnit.SECONDS))
            start.countDown()
            val responses = results.map { it.get(30, TimeUnit.SECONDS) }
            assertEquals(listOf(200, 429), responses.map { it.first }.sorted())
            assertEquals("5", responses.single { it.first == 429 }.second)
        } finally {
            executor.shutdownNow()
        }
    }
}
