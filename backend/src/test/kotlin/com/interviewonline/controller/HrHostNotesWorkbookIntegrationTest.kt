package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomTask
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.support.Postgres16TestSupport
import org.apache.poi.ss.usermodel.CellType
import org.apache.poi.ss.usermodel.WorkbookFactory
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import java.io.ByteArrayInputStream
import java.util.UUID

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HrHostNotesWorkbookIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val users: UserRepository,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("hr_host_notes")
        @JvmStatic @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll
        fun cleanup() = postgres.close()
    }

    @Test
    fun `comment contains every host note with task and custom blocks and keeps verdict separate`() {
        postgres.verifyPostgres16()
        val owner = account("notes-owner", false)
        val hiring = account("notes-hiring", true)
        val stranger = account("notes-stranger", true)
        val room = room(owner)
        room.verdictComment = "@verdict stays text"
        room.notes = "Legacy shared note must not replace personal history"
        room.privateNotesJson = notes(
            owner.id to listOf(
                entry("last", "Свободное резюме\nВторая строка", 3),
                entry("step", "=SUM(A1:A2) — личная заметка хоста", 1, step = 0),
                entry("custom", "Ожидания кандидата", 2, block = "Мотивация"),
            ),
            hiring.id to listOf(entry("other", "PRIVATE hiring observer", 4)),
            stranger.id to listOf(entry("stranger", "PRIVATE unrelated author", 5)),
        )
        rooms.saveAndFlush(room)
        invite(room, owner, hiring)

        val response = export(hiring)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val headers = sheet.getRow(0).associate { it.stringCellValue to it.columnIndex }
            assertEquals("@verdict stays text", sheet.getRow(1).getCell(headers.getValue("Комментарий к решению")).stringCellValue)
            val comment = sheet.getRow(1).getCell(headers.getValue("Комментарий"))
            assertEquals(CellType.STRING, comment.cellType)
            assertEquals(
                "Шаг 1 — Задача хоста\n=SUM(A1:A2) — личная заметка хоста\n\nМотивация\nОжидания кандидата\n\nВ свободной форме\nСвободное резюме\nВторая строка",
                comment.stringCellValue,
            )
            val allText = workbook.flatMap { it.flatMap { row -> row.filter { cell -> cell.cellType == CellType.STRING }.map { cell -> cell.stringCellValue } } }.joinToString("\n")
            listOf("PRIVATE hiring observer", "PRIVATE unrelated author", room.inviteCode, room.ownerSessionToken, room.interviewerSessionToken, "Legacy shared note").forEach {
                assertFalse(allText.contains(it), "workbook must exclude $it")
            }
        }
        val strangerResponse = export(stranger)
        assertEquals("0", strangerResponse.getHeader("Interview-Count"))
        val list = mockMvc.get("/api/me/hr/rooms") { header("Authorization", "Bearer ${hiring.token}") }.andReturn().response.contentAsString
        assertFalse(list.contains("личная заметка хоста"), "private text belongs only to the explicit authorized export")
        assertFalse(list.contains("privateNotesJson"))
    }

    @Test
    fun `legacy per task private notes export only the host author with original step labels`() {
        val owner = account("legacy-host", true)
        val room = room(owner)
        room.tasks.first().privateNotesJson = notes(
            owner.id to listOf(entry("legacy", "Историческая личная заметка", 10)),
            UUID.randomUUID().toString() to listOf(entry("other", "PRIVATE legacy outsider", 10)),
        )
        rooms.saveAndFlush(room)
        val response = export(owner)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals("Шаг 1 — Задача хоста\nИсторическая личная заметка", sheet.getRow(1).getCell(column).stringCellValue)
        }
    }

    @Test
    fun `legacy shared notes are used only when there is no host personal history`() {
        val owner = account("legacy-shared-host", true)
        val room = room(owner)
        room.notes = "Старые заметки комнаты\nСохранённая строка"
        room.privateNotesJson = notes(UUID.randomUUID().toString() to listOf(entry("other", "PRIVATE other author", 1)))
        rooms.saveAndFlush(room)
        val response = export(owner)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals(room.notes, sheet.getRow(1).getCell(column).stringCellValue)
        }
    }

    @Test
    fun `comments above the Excel cell limit are preserved completely on a continuation sheet`() {
        val owner = account("long-host", true)
        val room = room(owner)
        val texts = (1..12).map { index ->
            (1..120).joinToString("\n") { line -> "Кириллица и детали $index/$line: ${UUID.nameUUIDFromBytes("$index-$line".toByteArray())}" }
        }
        room.privateNotesJson = notes(owner.id to texts.mapIndexed { index, text -> entry("long-$index", text, index.toLong()) })
        rooms.saveAndFlush(room)
        val response = export(owner)
        assertEquals(200, response.status)
        assertEquals("1", response.getHeader("Interview-Count"))
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertTrue(sheet.getRow(1).getCell(column).stringCellValue.contains("Комментарии"))
            val comments = workbook.getSheet("Комментарии")
            assertNotNull(comments)
            val chunks = (1 until comments.physicalNumberOfRows).map { index ->
                val row = comments.getRow(index)
                assertEquals(room.id, row.getCell(0).stringCellValue)
                assertEquals(index.toDouble(), row.getCell(1).numericCellValue)
                assertEquals(CellType.STRING, row.getCell(2).cellType)
                assertTrue(row.getCell(2).stringCellValue.length <= 32_767)
                row.getCell(2).stringCellValue
            }
            assertEquals("В свободной форме\n${texts.joinToString("\n")}", chunks.joinToString(""))
        }
    }

    @Test
    fun `continuation comments preserve emoji at the exact cell boundary`() {
        val owner = account("unicode-host", true)
        val room = room(owner)
        val prefix = "В свободной форме\n"
        val padding = buildString {
            var index = 0
            while (length < 32_767) append(UUID.nameUUIDFromBytes("unicode-${index++}".toByteArray()))
        }.take(32_767 - prefix.length - 1)
        val text = "$padding🙂Кандидат завершил задачу"
        room.privateNotesJson = notes(owner.id to listOf(entry("unicode", text, 1)))
        rooms.saveAndFlush(room)
        val response = export(owner)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val comments = workbook.getSheet("Комментарии")
            assertNotNull(comments)
            val restored = (1 until comments.physicalNumberOfRows).joinToString("") { comments.getRow(it).getCell(2).stringCellValue }
            assertTrue(restored == "$prefix$text", "Unicode and the complete note must survive an Excel cell boundary")
        }
    }

    @Test
    fun `external hiring export includes guest host notes but never peer entries or forged host flags`() {
        val hiring = account("guest-host-hiring", true)
        val creation = mockMvc.post("/api/public/rooms") {
            contentType = MediaType.APPLICATION_JSON
            content = """{"title":"Guest host export","ownerDisplayName":"Guest host","language":"nodejs"}"""
        }.andReturn().response
        assertEquals(200, creation.status)
        val body = mapper.readTree(creation.contentAsString)
        val room = HrTestRoom(body.path("id").asText(), body.path("inviteCode").asText())
        val ownerToken = body.path("ownerToken").asText()
        assertTrue(ownerToken.isNotBlank())
        assertNull(rooms.findById(room.id).orElseThrow().ownerUser)
        val participantId = "guest-host-${UUID.randomUUID()}"
        val owner = join(room, participantId, ownerToken)
        val peer = join(room, participantId)
        assertEquals(204, event(room, owner, mapOf("type" to "grant_interviewer_access", "targetSessionId" to peer.sessionId)).status)

        assertEquals(204, event(room, owner, mapOf("type" to "private_note_entry", "privateNoteId" to "host-first", "privateNoteText" to "Первая заметка гостевого хоста", "privateNoteTimestampEpochMs" to 1)).status)
        assertEquals(204, event(room, peer, mapOf("type" to "private_note_entry", "privateNoteId" to "peer-forged", "privateNoteText" to "PRIVATE peer forged owner", "writtenByHost" to true, "privateNoteTimestampEpochMs" to 2)).status)
        assertEquals(204, event(room, owner, mapOf("type" to "private_note_entry", "privateNoteId" to "host-last", "privateNoteText" to "Вторая заметка гостевого хоста", "privateNoteTimestampEpochMs" to 3)).status)

        val stored = mapper.readTree(rooms.findById(room.id).orElseThrow().privateNotesJson).path("authors").path("p:$participantId").path("entries")
        assertTrue(stored.single { it.path("id").asText() == "host-first" }.path("writtenByHost").asBoolean(), "host proof must survive subsequent normalization and durable saves")
        assertFalse(stored.single { it.path("id").asText() == "peer-forged" }.path("writtenByHost").asBoolean(), "peer must not set host proof through its request")
        assertTrue(stored.single { it.path("id").asText() == "host-last" }.path("writtenByHost").asBoolean())
        val reloaded = join(room, participantId, ownerToken)
        assertTrue(payload(reloaded.response).path("personalNotes").single { it.path("id").asText() == "host-first" }.path("writtenByHost").asBoolean())

        assertEquals(200, mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") {
            header("X-Room-Owner-Token", ownerToken)
        }.andReturn().response.status)
        val response = export(hiring)
        assertEquals(200, response.status)
        assertEquals("1", response.getHeader("Interview-Count"))
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals("В свободной форме\nПервая заметка гостевого хоста\nВторая заметка гостевого хоста", sheet.getRow(1).getCell(column).stringCellValue)
        }
    }

    @Test
    fun `guest export requires explicit durable host proof for every entry in current and legacy buckets`() {
        val hiring = account("guest-proof-hiring", true)
        val room = rooms.saveAndFlush(Room(title = "Guest proof", inviteCode = "guest-${UUID.randomUUID()}", ownerSessionToken = "owner_${UUID.randomUUID()}", interviewerSessionToken = "interviewer_${UUID.randomUUID()}"))
        room.privateNotesJson = mapper.writeValueAsString(mapOf("version" to 1, "authors" to mapOf(
            "p:guest-host" to mapOf("entries" to listOf(entry("host", "Подтверждённая запись", 1) + ("writtenByHost" to true), entry("legacy", "PRIVATE unproven old guest note", 2))),
            "p:guest-peer" to mapOf("entries" to listOf(entry("peer", "PRIVATE guest peer", 3) + ("writtenByHost" to false))),
        )))
        rooms.saveAndFlush(room)
        assertEquals(200, mockMvc.put("/api/rooms/${room.inviteCode}/hr-managers/${hiring.id}") { header("X-Room-Owner-Token", room.ownerSessionToken) }.andReturn().response.status)
        val response = export(hiring)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals("В свободной форме\nПодтверждённая запись", sheet.getRow(1).getCell(column).stringCellValue)
        }

        val legacyPayload = room.privateNotesJson
        room.privateNotesJson = null
        room.tasks.add(RoomTask(room = room, stepIndex = 0, title = "Гостевая задача", privateNotesJson = legacyPayload))
        rooms.saveAndFlush(room)
        val legacyResponse = export(hiring)
        assertEquals(200, legacyResponse.status)
        WorkbookFactory.create(ByteArrayInputStream(legacyResponse.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals("Шаг 1 — Гостевая задача\nПодтверждённая запись", sheet.getRow(1).getCell(column).stringCellValue)
        }
    }

    @Test
    fun `proven host history survives ownership association and deduplicates the current owner stream`() {
        val owner = account("claimed-host", true)
        val former = account("former-host", false)
        val room = room(owner)
        room.privateNotesJson = mapper.writeValueAsString(mapOf("version" to 1, "authors" to mapOf(
            "p:former-guest" to mapOf("entries" to listOf(entry("guest", "Заметка до привязки аккаунта", 1) + ("writtenByHost" to true))),
            "s:former-session" to mapOf("entries" to listOf(entry("session", "Заметка прежней гостевой сессии", 2) + ("writtenByHost" to true))),
            "u:${former.id}" to mapOf("entries" to listOf(entry("former", "Заметка прежнего хоста", 3) + ("writtenByHost" to true), entry("peer", "PRIVATE former peer", 4))),
            "u:${owner.id}" to mapOf("entries" to listOf(entry("current", "История текущего владельца", 5), entry("duplicate", "Текущая запись", 6) + ("writtenByHost" to true))),
            "p:unproven" to mapOf("entries" to listOf(entry("unproven", "PRIVATE old guest", 7))),
        )))
        rooms.saveAndFlush(room)
        val response = export(owner)
        assertEquals(200, response.status)
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            val column = sheet.getRow(0).single { it.stringCellValue == "Комментарий" }.columnIndex
            assertEquals("В свободной форме\nЗаметка до привязки аккаунта\nЗаметка прежней гостевой сессии\nЗаметка прежнего хоста\nИстория текущего владельца\nТекущая запись", sheet.getRow(1).getCell(column).stringCellValue)
        }
    }

    private data class GuestTab(val sessionId: String, val eventToken: String, val cookie: String?, val response: MvcResult)

    private fun join(room: HrTestRoom, participantId: String, ownerToken: String? = null): GuestTab {
        val session = "guest-${UUID.randomUUID()}"
        val response = mockMvc.get("/api/realtime/rooms/${room.inviteCode}/stream") {
            param("sessionId", session); param("participantId", participantId); param("displayName", "Guest notes")
            ownerToken?.let { param("ownerToken", it) }
        }.andReturn()
        assertEquals(200, response.response.status)
        val cookie = response.response.getHeader(HttpHeaders.SET_COOKIE)?.substringBefore(';')
        return GuestTab(session, payload(response).path("eventToken").asText(), cookie, response)
    }

    private fun payload(response: MvcResult) = response.response.contentAsString.lineSequence()
        .filter { it.startsWith("data:") }.map { mapper.readTree(it.removePrefix("data:")) }
        .last { it.path("type").asText() == "state_sync" }.path("payload")

    private fun event(room: HrTestRoom, tab: GuestTab, values: Map<String, Any>) = mockMvc.post("/api/realtime/rooms/${room.inviteCode}/events") {
        contentType = MediaType.APPLICATION_JSON
        tab.cookie?.let { header(HttpHeaders.COOKIE, it) }
        content = mapper.writeValueAsString(values + mapOf("sessionId" to tab.sessionId, "eventToken" to tab.eventToken))
    }.andReturn().response

    private fun account(prefix: String, isHr: Boolean) = HrHttpFixtures.register(mockMvc, mapper, isHr, prefix).first

    private fun room(owner: HrTestAccount): Room {
        val room = Room(
            title = "Workbook notes ${UUID.randomUUID()}",
            inviteCode = "notes-${UUID.randomUUID()}",
            ownerUser = users.findById(owner.id).orElseThrow(),
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
        )
        room.tasks.add(RoomTask(room = room, stepIndex = 0, title = "Задача хоста"))
        return rooms.saveAndFlush(room)
    }

    private fun invite(room: Room, owner: HrTestAccount, hiring: HrTestAccount) {
        assertEquals(200, HrHttpFixtures.inviteHr(mockMvc, owner, HrTestRoom(requireNotNull(room.id), room.inviteCode), hiring).response.status)
    }

    private fun export(account: HrTestAccount) = mockMvc.get("/api/me/hr/rooms/export") { header("Authorization", "Bearer ${account.token}") }.andReturn().response

    private fun entry(id: String, text: String, time: Long, step: Int? = null, block: String? = null) = mapOf(
        "id" to id, "text" to text, "timestampEpochMs" to time, "blockStepIndex" to step, "blockName" to block,
    )

    private fun notes(vararg authors: Pair<String, List<Map<String, Any?>>>) = mapper.writeValueAsString(
        mapOf("version" to 1, "authors" to authors.associate { (id, entries) -> "u:$id" to mapOf("entries" to entries) }),
    )
}
