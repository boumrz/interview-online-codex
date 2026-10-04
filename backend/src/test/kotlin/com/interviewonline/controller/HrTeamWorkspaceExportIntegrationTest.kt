package com.interviewonline.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomTask
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.support.Postgres16TestSupport
import org.apache.poi.ss.usermodel.CellType
import org.apache.poi.ss.usermodel.WorkbookFactory
import org.apache.poi.xssf.streaming.SXSSFWorkbook
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Answers.RETURNS_DEEP_STUBS
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.io.ByteArrayInputStream
import java.io.OutputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HrTeamWorkspaceExportIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val teams: TeamRepository,
    @Autowired private val memberships: TeamMembershipRepository,
    @Autowired private val rooms: RoomRepository,
    @Autowired private val participants: RoomParticipantRepository,
    @Autowired private val users: UserRepository,
    @Autowired private val jdbc: JdbcTemplate,
) {
    companion object {
        private val postgres = Postgres16TestSupport.create("hr_team_export")
        @JvmStatic @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) = postgres.register(registry)
        @JvmStatic @AfterAll
        fun cleanup() = postgres.close()
    }

    @Test
    fun `team list and workbook share active membership scope ordering dates and result projection`() {
        postgres.verifyPostgres16()
        val hr = account("hr-scope")
        val owner = account("hr-owner", false)
        val team = team(owner)
        val other = team(owner)
        join(team, hr)
        join(other, hr)
        val first = room(owner, team, "=safe-title", "2026-09-04T21:00:00Z")
        jdbc.update("UPDATE rooms SET status = 'finished', finished_at = ? WHERE id = ?", java.sql.Timestamp.from(Instant.parse("2026-09-07T10:00:00Z")), first.id)
        grant(first, hr, "interviewer")
        val end = room(hr, team, "last date", "2026-09-05T20:59:59Z")
        grant(end, hr, "owner")
        val before = room(owner, team, "before", "2026-09-04T20:59:59Z")
        grant(before, hr, "interviewer")
        val after = room(owner, team, "after", "2026-09-05T21:00:00Z")
        grant(after, hr, "interviewer")
        val personal = room(hr, null, "personal")
        val otherRoom = room(owner, other, "other-team")
        grant(otherRoom, hr, "interviewer")
        val noGrant = room(owner, team, "no grant")
        val historicalOwner = room(hr, team, "historical owner")
        val candidate = room(owner, team, "candidate only")
        grant(candidate, hr, "candidate")
        val nonCanonical = room(owner, team, "noncanonical")
        grant(nonCanonical, hr, "interviewer")
        jdbc.update("UPDATE rooms SET origin_team_id = ? WHERE id = ?", other.id, nonCanonical.id)

        val page = list(hr, team.id, "2026-09-05", "2026-09-05", "1")
        assertEquals(200, page.status)
        val body = mapper.readTree(page.contentAsString)
        assertEquals(2, body.path("totalElements").asInt())
        assertEquals(2, body.path("totalPages").asInt())
        assertEquals(end.id, body.path("items")[0].path("roomId").asText())
        val second = mapper.readTree(mockMvc.get("/api/me/hr/rooms") {
            header("Authorization", "Bearer ${hr.token}")
            param("teamId", team.id); param("from", "2026-09-05"); param("to", "2026-09-05"); param("page", "1"); param("size", "1")
        }.andReturn().response.contentAsString)
        assertEquals(first.id, second.path("items")[0].path("roomId").asText())
        assertEquals("finished", second.path("items")[0].path("status").asText())
        val export = export(hr, team.id, "2026-09-05", "2026-09-05")
        assertEquals(200, export.status)
        assertEquals("2", export.getHeader("Interview-Count"))
        assertEquals("no-store", export.getHeader("Cache-Control"))
        assertEquals("nosniff", export.getHeader("X-Content-Type-Options"))
        WorkbookFactory.create(ByteArrayInputStream(export.contentAsByteArray)).use { workbook ->
            val sheet = workbook.getSheet("Интервью")
            assertEquals(listOf(end.id, first.id), (1 until sheet.physicalNumberOfRows).map { sheet.getRow(it).getCell(0).stringCellValue })
            assertEquals(CellType.STRING, sheet.getRow(2).getCell(1).cellType)
            assertEquals("=safe-title", sheet.getRow(2).getCell(1).stringCellValue)
            assertEquals("HIRE", sheet.getRow(2).getCell(9).stringCellValue)
            assertEquals("finished", sheet.getRow(2).getCell(7).stringCellValue)
            assertEquals("=private candidate", sheet.getRow(2).getCell(2).stringCellValue)
            val scores = workbook.getSheet("Оценки")
            assertEquals(setOf(first.id, end.id), (1 until scores.physicalNumberOfRows).map { scores.getRow(it).getCell(0).stringCellValue }.toSet())
            assertEquals(4.0, scores.getRow(1).getCell(4).numericCellValue)
        }
        val allScoped = mapper.readTree(list(hr, team.id).contentAsString).path("items").map { it.path("roomId").asText() }.toSet()
        assertEquals(setOf(first.id, end.id, before.id, after.id, noGrant.id, historicalOwner.id, candidate.id), allScoped)
        val aggregate = mapper.readTree(list(hr, null).contentAsString).path("items").map { it.path("roomId").asText() }.toSet()
        assertTrue(aggregate.containsAll(listOf(personal.id, otherRoom.id, first.id)))
        assertFalse(allScoped.contains(nonCanonical.id))
        assertEquals(200, mockMvc.get("/api/me/hr/rooms/${historicalOwner.id}") { header("Authorization", "Bearer ${hr.token}") }.andReturn().response.status)
    }

    @Test
    fun `invalid foreign inactive and revoked team scopes stay hidden for both routes`() {
        val owner = account("hr-auth-owner", false)
        val hr = account("hr-auth")
        val noHr = account("not-hr", false)
        val team = team(owner)
        join(team, hr)
        join(team, noHr)
        val foreign = team(owner)
        fun expectBoth(actor: HrTestAccount, id: String, status: Int) {
            assertEquals(status, list(actor, id).status, "list scope $id")
            assertEquals(status, export(actor, id).status, "export scope $id")
        }
        listOf("not-uuid", "1-1-1-1-1", UUID.randomUUID().toString(), foreign.id).forEach { expectBoth(hr, it, 404) }
        expectBoth(noHr, team.id, 200)
        listOf("SUSPENDED", "REMOVED", "LEFT").forEach { state ->
            jdbc.update("UPDATE team_memberships SET state = ? WHERE team_id = ? AND user_id = ?", state, team.id, hr.id)
            expectBoth(hr, team.id, 404)
        }
        jdbc.update("UPDATE team_memberships SET state = 'ACTIVE' WHERE team_id = ? AND user_id = ?", team.id, hr.id)
        jdbc.update("UPDATE teams SET state = 'MERGED' WHERE id = ?", team.id)
        expectBoth(hr, team.id, 404)
        listOf("/api/me/hr/rooms", "/api/me/hr/rooms/export").forEach { route ->
            assertEquals(401, mockMvc.get(route) { param("teamId", team.id) }.andReturn().response.status)
        }
    }

    @Test
    fun `empty scoped workbook stays empty and range validation matches list`() {
        val hr = account("empty-team")
        val team = team(hr)
        val outsiderRoomOwner = account("empty-peer-owner", false)
        val foreignTeam = team(outsiderRoomOwner)
        room(outsiderRoomOwner, foreignTeam, "another team must not fill empty team")
        room(hr, null, "personal must not fill empty team")
        assertEquals(0, mapper.readTree(list(hr, team.id).contentAsString).path("totalElements").asInt())
        val response = export(hr, team.id)
        assertEquals(200, response.status)
        assertEquals("0", response.getHeader("Interview-Count"))
        WorkbookFactory.create(ByteArrayInputStream(response.contentAsByteArray)).use { workbook ->
            assertEquals(1, workbook.getSheet("Интервью").physicalNumberOfRows)
            assertEquals(1, workbook.getSheet("Оценки").physicalNumberOfRows)
        }
        listOf("2026-09-06" to "2026-09-05", "2026-09-31" to "2026-10-01", "2026-9-5" to "2026-09-05", "2026-09-05" to null).forEach { (from, to) ->
            assertEquals(400, list(hr, team.id, from, to).status)
            assertEquals(400, export(hr, team.id, from, to).status)
        }
    }

    @Test
    fun `membership removal during rendering cancels both populated and empty scoped workbook`() {
        listOf(false, true).forEach { populated ->
            val hr = account("render-membership")
            val team = team(hr)
            if (populated) grant(room(hr, team, "rendered room"), hr, "owner")
            duringRender(hr, team.id) { jdbc.update("UPDATE team_memberships SET state = 'REMOVED' WHERE team_id = ? AND user_id = ?", team.id, hr.id) }
        }
    }

    @Test
    fun `team closing during rendering cancels empty workbook`() {
        val hr = account("render-team")
        val team = team(hr)
        duringRender(hr, team.id) { jdbc.update("UPDATE teams SET state = 'MERGED' WHERE id = ?", team.id) }
    }

    @Test
    fun `room grant and HR flag removal during rendering retain active team member access`() {
        listOf(false, true).forEach { roleRemoval ->
            val hr = account("render-grant")
            val team = team(hr)
            val room = room(hr, team, "historical owner loses grant")
            grant(room, hr, "owner")
            duringRender(hr, team.id, accessChanged = false) {
                if (roleRemoval) jdbc.update("UPDATE users SET is_hr = false WHERE id = ?", hr.id)
                else jdbc.update("DELETE FROM room_participants WHERE room_id = ? AND user_id = ?", room.id, hr.id)
            }
        }
    }

    private fun duringRender(hr: HrTestAccount, teamId: String, accessChanged: Boolean = true, revoke: () -> Unit) {
        val revoked = AtomicBoolean(false)
        mockConstruction(SXSSFWorkbook::class.java, withSettings().defaultAnswer(RETURNS_DEEP_STUBS)) { workbook, _ ->
            doAnswer { if (revoked.compareAndSet(false, true)) revoke(); null }.`when`(workbook).write(any(OutputStream::class.java))
        }.use {
            val response = export(hr, teamId)
            assertTrue(revoked.get(), "revocation must happen after snapshot and before final access check")
            if (accessChanged) {
                assertEquals(409, response.status)
                assertEquals("HR_EXPORT_ACCESS_CHANGED", mapper.readTree(response.contentAsString).path("code").asText())
                assertNull(response.getHeader("Content-Disposition"))
                assertFalse(response.contentType.orEmpty().contains("spreadsheet"))
            } else {
                assertEquals(200, response.status)
                assertNotNull(response.getHeader("Content-Disposition"))
                assertTrue(response.contentType.orEmpty().contains("spreadsheet"))
            }
        }
    }

    private fun account(prefix: String, hr: Boolean = true) = HrHttpFixtures.register(mockMvc, mapper, hr, prefix).first
    private fun team(owner: HrTestAccount): Team {
        val id = UUID.randomUUID().toString()
        val saved = teams.saveAndFlush(Team(id = id, name = "Team $id", normalizedName = "team $id", ownerUserId = owner.id))
        join(saved, owner, "ADMIN")
        return saved
    }
    private fun join(team: Team, account: HrTestAccount, role: String = "MEMBER") = memberships.saveAndFlush(TeamMembership(id = UUID.randomUUID().toString(), teamId = team.id, userId = account.id, role = role))
    private fun grant(room: Room, account: HrTestAccount, role: String) = participants.saveAndFlush(RoomParticipant(room = room, user = users.findById(account.id).orElseThrow(), role = role))
    private fun room(owner: HrTestAccount, team: Team?, title: String, scheduled: String? = null): Room {
        val room = Room(title = title, inviteCode = "r-${UUID.randomUUID()}", ownerSessionToken = "owner_${UUID.randomUUID()}", interviewerSessionToken = "interviewer_${UUID.randomUUID()}", ownerUser = users.findById(owner.id).orElseThrow(), teamId = team?.id, originTeamId = team?.id, teamInterviewCreated = team != null, scheduledAt = scheduled?.let(Instant::parse), candidateName = "=private candidate", verdict = "HIRE")
        room.tasks.add(RoomTask(room = room, title = "@literal task", score = 4))
        return rooms.saveAndFlush(room)
    }
    private fun list(hr: HrTestAccount, teamId: String?, from: String? = null, to: String? = null, size: String = "20") = mockMvc.get("/api/me/hr/rooms") {
        header("Authorization", "Bearer ${hr.token}")
        teamId?.let { param("teamId", it) }; from?.let { param("from", it) }; to?.let { param("to", it) }; param("size", size)
    }.andReturn().response
    private fun export(hr: HrTestAccount, teamId: String?, from: String? = null, to: String? = null) = mockMvc.get("/api/me/hr/rooms/export") {
        header("Authorization", "Bearer ${hr.token}")
        teamId?.let { param("teamId", it) }; from?.let { param("from", it) }; to?.let { param("to", it) }
    }.andReturn().response
}
