package com.interviewonline.controller

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.support.Postgres16TestSupport
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import java.util.UUID

@SpringBootTest(
    properties = [
        "app.features.team-workspaces-enabled=true",
        "app.team-invitation-link-encryption.active-key-id=integration-v1",
        "app.team-invitation-link-encryption.keys.integration-v1=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    ],
)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TeamTrackVacancyIntegrationTest(
    @Autowired private val mockMvc: MockMvc,
    @Autowired private val objectMapper: ObjectMapper,
    @Autowired private val jdbcTemplate: JdbcTemplate,
) {
    @Test
    fun `archive count follows visible vacancies and deletion checks dependencies`() {
        val owner = account("track-delete-owner")
        val member = account("track-delete-member")
        val team = team(owner, "Delete tracks")
        seedMembership(team.id, member.id, role = "MEMBER")
        val trackId = body(createTrack(owner, team.id, "Backend")).path("track").path("id").asText()
        val vacancyId = body(createVacancy(owner, team.id, trackId, "Kotlin")).path("vacancy").path("id").asText()
        val root = "/api/teams/${team.id}/tracks/$trackId"
        assertEquals(1, body(tracks(owner, team.id)).path("counts").path("activeVacancies").asInt())
        assertStatus(archiveTrack(owner, team.id, trackId), 200, "track archived")
        assertEquals(0, body(tracks(owner, team.id)).path("counts").path("activeVacancies").asInt())
        assertStatus(restoreTrack(owner, team.id, trackId), 200, "track restored")
        assertStatusAndCode(mockMvc.delete(root) { header("Authorization", "Bearer ${member.token}") }.andReturn(), 403, "INSUFFICIENT_TEAM_ROLE")
        assertStatusAndCode(mockMvc.delete(root) { header("Authorization", "Bearer ${owner.token}") }.andReturn(), 409, "TRACK_IN_USE")
        assertStatus(mockMvc.delete("$root/vacancies/$vacancyId") { header("Authorization", "Bearer ${owner.token}") }.andReturn(), 204, "owner deletes unused vacancy")
        assertStatus(mockMvc.delete(root) { header("Authorization", "Bearer ${owner.token}") }.andReturn(), 204, "owner deletes empty track")
        assertEquals(0, body(tracks(owner, team.id)).path("counts").path("activeTracks").asInt())

        val usedTrackId = body(createTrack(owner, team.id, "Frontend")).path("track").path("id").asText()
        val usedVacancyId = body(createVacancy(owner, team.id, usedTrackId, "React")).path("vacancy").path("id").asText()
        assertStatus(mockMvc.post("/api/teams/${team.id}/interviews") {
            header("Authorization", "Bearer ${owner.token}")
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to "Using vacancy", "trackId" to usedTrackId, "vacancyId" to usedVacancyId, "taskIds" to emptyList<String>()))
        }.andReturn(), 201, "interview references vacancy")
        assertStatusAndCode(mockMvc.delete("/api/teams/${team.id}/tracks/$usedTrackId/vacancies/$usedVacancyId") {
            header("Authorization", "Bearer ${owner.token}")
        }.andReturn(), 409, "VACANCY_IN_USE")
    }
    companion object {
        private val postgres = Postgres16TestSupport.create("team_tracks")

        @JvmStatic
        @DynamicPropertySource
        fun postgresProperties(registry: DynamicPropertyRegistry) = postgres.register(registry)

        @JvmStatic
        @AfterAll
        fun cleanupPostgres() = postgres.close()
    }

    @Test
    fun `team tracks and vacancies are real team-scoped resources with member read boundary`() {
        postgres.verifyPostgres16()
        val owner = account("tracks-owner")
        val member = account("tracks-member")
        val foreign = account("tracks-foreign")
        val team = team(owner, "Tracks contract")
        seedMembership(team.id, member.id, role = "MEMBER")

        val initial = tracks(owner, team.id)
        assertStatus(initial, 200, "owner reads an empty tracks surface")
        assertProtectedNoStore(initial)
        assertEquals(setOf("items", "counts"), body(initial).fieldNames().asSequence().toSet())
        assertEquals(0, body(initial).path("items").size())
        assertEquals(0, body(initial).path("counts").path("activeTracks").asInt())

        val createdTrack = createTrack(owner, team.id, " Backend ")
        assertStatus(createdTrack, 201, "owner creates a track")
        assertProtectedNoStore(createdTrack)
        val track = body(createdTrack).path("track")
        assertEquals(setOf("id", "name", "status", "revision", "vacancies", "programme"), track.fieldNames().asSequence().toSet())
        assertEquals("Backend", track.path("name").asText())
        assertEquals("ACTIVE", track.path("status").asText())
        assertEquals(0, track.path("revision").asLong())
        assertEquals(0, track.path("vacancies").size())
        assertTrue(track.path("programme").isNull, "a missing track programme must stay distinct from an empty programme")
        assertEquals("/api/teams/${team.id}/tracks/${track.path("id").asText()}", createdTrack.response.getHeader("Location"))

        val memberCreate = createTrack(member, team.id, "Frontend")
        assertStatusAndCode(memberCreate, 403, "INSUFFICIENT_TEAM_ROLE")
        assertFalse(body(memberCreate).has("track"), "member create denial must not include track data")

        val memberRead = tracks(member, team.id)
        assertStatus(memberRead, 200, "active MEMBER reads team tracks")
        assertEquals("Backend", body(memberRead).path("items")[0].path("name").asText())

        val createdVacancy = createVacancy(owner, team.id, track.path("id").asText(), " Kotlin разработчик ")
        assertStatus(createdVacancy, 201, "owner creates a vacancy inside a team track")
        assertProtectedNoStore(createdVacancy)
        val vacancy = body(createdVacancy).path("vacancy")
        assertEquals(setOf("id", "title", "status", "revision", "programme"), vacancy.fieldNames().asSequence().toSet())
        assertEquals("Kotlin разработчик", vacancy.path("title").asText())
        assertEquals("ACTIVE", vacancy.path("status").asText())
        assertTrue(vacancy.path("programme").isNull, "a missing vacancy programme must stay distinct from an empty programme")

        val withVacancy = tracks(owner, team.id)
        val reloadedTrack = body(withVacancy).path("items")[0]
        assertEquals(1, reloadedTrack.path("vacancies").size())
        assertEquals("Kotlin разработчик", reloadedTrack.path("vacancies")[0].path("title").asText())

        val foreignRead = tracks(foreign, team.id)
        assertStatusAndCode(foreignRead, 404, "TEAM_NOT_FOUND")
        assertProtectedNoStore(foreignRead)
        assertFalse(body(foreignRead).has("items"), "foreign read must not leak the track list")
    }

    @Test
    fun `owner publishes a mandatory track interview programme with versioned preview`() {
        val owner = account("prog-owner")
        val member = account("prog-member")
        val foreign = account("prog-foreign")
        val team = team(owner, "Track programme")
        seedMembership(team.id, member.id, role = "MEMBER")

        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val graphTask = body(createTeamTask(owner, team.id, "Graph warmup", "Graph brief", "// graph", "kotlin")).path("task")
        val queueTask = body(createTeamTask(owner, team.id, "Queue deep dive", "Queue brief", "// queue", "nodejs")).path("task")
        val graphTaskId = graphTask.path("id").asText()
        val queueTaskId = queueTask.path("id").asText()

        val emptyPreview = trackProgramme(owner, team.id, trackId)
        assertStatus(emptyPreview, 200, "owner previews a track without programme")
        assertProtectedNoStore(emptyPreview)
        assertTrue(body(emptyPreview).path("programme").isNull, "programme absence is explicit")

        val memberDraft = saveTrackProgrammeDraft(member, team.id, trackId, listOf(graphTaskId), revision = null)
        assertStatusAndCode(memberDraft, 403, "INSUFFICIENT_TEAM_ROLE")

        val draft = saveTrackProgrammeDraft(owner, team.id, trackId, listOf(queueTaskId, graphTaskId), revision = null)
        assertStatus(draft, 200, "owner saves a draft programme")
        val draftProgramme = body(draft).path("programme")
        assertEquals("TRACK", draftProgramme.path("origin").asText())
        assertEquals("DRAFT", draftProgramme.path("status").asText())
        assertEquals(0, draftProgramme.path("version").asLong())
        assertEquals(0, draftProgramme.path("revision").asLong())
        assertTrue(draftProgramme.path("mandatory").asBoolean())
        assertEquals(queueTaskId, draftProgramme.path("tasks")[0].path("taskId").asText())
        assertEquals("Queue deep dive", draftProgramme.path("tasks")[0].path("title").asText())
        assertEquals("nodejs", draftProgramme.path("tasks")[0].path("language").asText())
        assertEquals(0, draftProgramme.path("tasks")[0].path("position").asInt())
        assertTrue(draftProgramme.path("tasks")[0].path("mandatory").asBoolean())
        assertEquals(graphTaskId, draftProgramme.path("tasks")[1].path("taskId").asText())
        assertEquals(1, draftProgramme.path("tasks")[1].path("position").asInt())

        val published = publishTrackProgramme(owner, team.id, trackId, revision = 0)
        assertStatus(published, 200, "owner publishes the programme")
        val publishedProgramme = body(published).path("programme")
        assertEquals("PUBLISHED", publishedProgramme.path("status").asText())
        assertEquals(1, publishedProgramme.path("version").asLong())
        assertEquals(1, publishedProgramme.path("revision").asLong())

        val stalePublish = publishTrackProgramme(owner, team.id, trackId, revision = 0)
        assertStatusAndCode(stalePublish, 409, "TEAM_PROGRAMME_REVISION_CONFLICT")
        assertEquals(1, body(stalePublish).path("currentRevision").asLong())

        val memberRead = tracks(member, team.id)
        val listedProgramme = body(memberRead).path("items")[0].path("programme")
        assertEquals("TRACK", listedProgramme.path("origin").asText())
        assertEquals(1, listedProgramme.path("version").asLong())
        assertTrue(listedProgramme.path("mandatory").asBoolean())
        assertEquals(2, listedProgramme.path("tasks").size())

        val emptyDraft = saveTrackProgrammeDraft(owner, team.id, trackId, emptyList(), revision = 1)
        assertStatusAndCode(emptyDraft, 400, "TEAM_PROGRAMME_EMPTY")

        val duplicateTaskDraft = saveTrackProgrammeDraft(owner, team.id, trackId, listOf(graphTaskId, graphTaskId), revision = 1)
        assertStatusAndCode(duplicateTaskDraft, 400, "TEAM_PROGRAMME_DUPLICATE_TASK")

        val archived = archiveTrackProgramme(owner, team.id, trackId, revision = 1)
        assertStatus(archived, 200, "owner archives a published programme")
        val archivedProgramme = body(archived).path("programme")
        assertEquals("ARCHIVED", archivedProgramme.path("status").asText())
        assertEquals(1, archivedProgramme.path("version").asLong())
        assertEquals(2, archivedProgramme.path("revision").asLong())

        val restored = restoreTrackProgramme(owner, team.id, trackId, revision = 2)
        assertStatus(restored, 200, "owner restores an archived programme")
        val restoredProgramme = body(restored).path("programme")
        assertEquals("PUBLISHED", restoredProgramme.path("status").asText())
        assertEquals(1, restoredProgramme.path("version").asLong())
        assertEquals(3, restoredProgramme.path("revision").asLong())

        val foreignPreview = trackProgramme(foreign, team.id, trackId)
        assertStatusAndCode(foreignPreview, 404, "TEAM_NOT_FOUND")
        assertFalse(body(foreignPreview).has("programme"), "foreign preview must not leak programme data")
    }

    @Test
    fun `vacancy programme inherits track programme until vacancy publishes its own version`() {
        val owner = account("vac-prog-owner")
        val member = account("vac-prog-member")
        val team = team(owner, "Vacancy programme")
        seedMembership(team.id, member.id, role = "MEMBER")

        val track = body(createTrack(owner, team.id, "Backend")).path("track")
        val trackId = track.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, trackId, "Kotlin developer")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()
        val baseTask = body(createTeamTask(owner, team.id, "Base systems", "Base brief", "// base", "kotlin")).path("task")
        val vacancyTask = body(createTeamTask(owner, team.id, "Vacancy focus", "Vacancy brief", "// vacancy", "nodejs")).path("task")
        val baseTaskId = baseTask.path("id").asText()
        val vacancyTaskId = vacancyTask.path("id").asText()

        assertStatus(saveTrackProgrammeDraft(owner, team.id, trackId, listOf(baseTaskId), revision = null), 200, "track draft fixture must save")
        assertStatus(publishTrackProgramme(owner, team.id, trackId, revision = 0), 200, "track programme fixture must publish")

        val inheritedPreview = vacancyProgramme(owner, team.id, trackId, vacancyId)
        assertStatus(inheritedPreview, 200, "vacancy previews inherited track programme")
        assertProtectedNoStore(inheritedPreview)
        val inheritedProgramme = body(inheritedPreview).path("programme")
        assertEquals("TRACK", inheritedProgramme.path("origin").asText())
        assertEquals(trackId, inheritedProgramme.path("targetId").asText())
        assertEquals(1, inheritedProgramme.path("version").asLong())
        assertTrue(inheritedProgramme.path("mandatory").asBoolean())
        assertEquals(baseTaskId, inheritedProgramme.path("tasks")[0].path("taskId").asText())

        val inheritedListProgramme = body(tracks(member, team.id)).path("items")[0].path("vacancies")[0].path("programme")
        assertEquals("TRACK", inheritedListProgramme.path("origin").asText())
        assertEquals(baseTaskId, inheritedListProgramme.path("tasks")[0].path("taskId").asText())

        val memberDraft = saveVacancyProgrammeDraft(member, team.id, trackId, vacancyId, listOf(vacancyTaskId), revision = null)
        assertStatusAndCode(memberDraft, 403, "INSUFFICIENT_TEAM_ROLE")

        val vacancyDraft = saveVacancyProgrammeDraft(owner, team.id, trackId, vacancyId, listOf(vacancyTaskId), revision = null)
        assertStatus(vacancyDraft, 200, "owner saves vacancy-specific programme draft")
        val draftProgramme = body(vacancyDraft).path("programme")
        assertEquals("VACANCY", draftProgramme.path("origin").asText())
        assertEquals(vacancyId, draftProgramme.path("targetId").asText())
        assertEquals("DRAFT", draftProgramme.path("status").asText())
        assertEquals(0, draftProgramme.path("version").asLong())
        assertEquals(vacancyTaskId, draftProgramme.path("tasks")[0].path("taskId").asText())

        val vacancyPublished = publishVacancyProgramme(owner, team.id, trackId, vacancyId, revision = 0)
        assertStatus(vacancyPublished, 200, "owner publishes vacancy-specific programme")
        val ownProgramme = body(vacancyPublished).path("programme")
        assertEquals("VACANCY", ownProgramme.path("origin").asText())
        assertEquals("PUBLISHED", ownProgramme.path("status").asText())
        assertEquals(1, ownProgramme.path("version").asLong())
        assertEquals(1, ownProgramme.path("revision").asLong())

        val ownPreview = vacancyProgramme(owner, team.id, trackId, vacancyId)
        assertEquals("VACANCY", body(ownPreview).path("programme").path("origin").asText())
        assertEquals(vacancyTaskId, body(ownPreview).path("programme").path("tasks")[0].path("taskId").asText())

        val ownListProgramme = body(tracks(member, team.id)).path("items")[0].path("vacancies")[0].path("programme")
        assertEquals("VACANCY", ownListProgramme.path("origin").asText())
        assertEquals(vacancyTaskId, ownListProgramme.path("tasks")[0].path("taskId").asText())
    }

    @Test
    fun `active track and vacancy names are unique within their team scope only`() {
        val owner = account("track-dupe-owner")
        val otherOwner = account("track-dupe-other")
        val team = team(owner, "Duplicate tracks")
        val otherTeam = team(otherOwner, "Other duplicate tracks")

        val track = createTrack(owner, team.id, "Backend")
        assertStatus(track, 201, "first track is accepted")
        val duplicate = createTrack(owner, team.id, " backend ")
        assertStatusAndCode(duplicate, 409, "TRACK_ALREADY_EXISTS")
        val sameNameOtherTeam = createTrack(otherOwner, otherTeam.id, "Backend")
        assertStatus(sameNameOtherTeam, 201, "same track name is allowed in another team")

        val trackId = body(track).path("track").path("id").asText()
        val vacancy = createVacancy(owner, team.id, trackId, "Senior Kotlin")
        assertStatus(vacancy, 201, "first vacancy is accepted")
        val duplicateVacancy = createVacancy(owner, team.id, trackId, " senior kotlin ")
        assertStatusAndCode(duplicateVacancy, 409, "VACANCY_ALREADY_EXISTS")
    }

    @Test
    fun `team managers edit archive and restore tracks and vacancies without leaking write access to members`() {
        val owner = account("track-edit-owner")
        val member = account("track-edit-member")
        val team = team(owner, "Editable tracks")
        seedMembership(team.id, member.id, role = "MEMBER")

        val backendTrack = body(createTrack(owner, team.id, "Backend")).path("track")
        val frontendTrack = body(createTrack(owner, team.id, "Frontend")).path("track")
        val backendTrackId = backendTrack.path("id").asText()
        val frontendTrackId = frontendTrack.path("id").asText()
        val vacancy = body(createVacancy(owner, team.id, backendTrackId, "Kotlin разработчик")).path("vacancy")
        val vacancyId = vacancy.path("id").asText()

        assertStatusAndCode(updateTrack(member, team.id, backendTrackId, "Platform", 0), 403, "INSUFFICIENT_TEAM_ROLE")
        val renamedTrack = body(updateTrack(owner, team.id, backendTrackId, " Platform ", 0)).path("track")
        assertEquals("Platform", renamedTrack.path("name").asText())
        assertEquals(1, renamedTrack.path("revision").asLong())

        val staleTrack = updateTrack(owner, team.id, backendTrackId, "Data", 0)
        assertStatusAndCode(staleTrack, 409, "TRACK_REVISION_CONFLICT")
        assertEquals(1, body(staleTrack).path("currentRevision").asLong())

        val duplicateTrack = updateTrack(owner, team.id, frontendTrackId, "platform", 0)
        assertStatusAndCode(duplicateTrack, 409, "TRACK_ALREADY_EXISTS")

        assertStatusAndCode(updateVacancy(member, team.id, backendTrackId, vacancyId, "Platform Engineer", 0), 403, "INSUFFICIENT_TEAM_ROLE")
        val renamedVacancy = body(updateVacancy(owner, team.id, backendTrackId, vacancyId, " Platform Engineer ", 0)).path("vacancy")
        assertEquals("Platform Engineer", renamedVacancy.path("title").asText())
        assertEquals(1, renamedVacancy.path("revision").asLong())

        val archivedVacancy = body(archiveVacancy(owner, team.id, backendTrackId, vacancyId)).path("vacancy")
        assertEquals("ARCHIVED", archivedVacancy.path("status").asText())
        assertEquals(2, archivedVacancy.path("revision").asLong())
        assertEquals(0, body(tracks(owner, team.id)).path("items").first { it.path("id").asText() == backendTrackId }.path("vacancies").size())
        val archivedVacancyList = body(tracks(owner, team.id, "archived")).path("items")
        assertTrue(
            archivedVacancyList.any { track ->
                track.path("id").asText() == backendTrackId &&
                    track.path("status").asText() == "ACTIVE" &&
                    track.path("vacancies").any { it.path("id").asText() == vacancyId && it.path("status").asText() == "ARCHIVED" }
            },
            "archived vacancy must be visible from the archive filter without archiving its active track",
        )

        val restoredVacancy = body(restoreVacancy(owner, team.id, backendTrackId, vacancyId)).path("vacancy")
        assertEquals("ACTIVE", restoredVacancy.path("status").asText())
        assertEquals(3, restoredVacancy.path("revision").asLong())

        val archivedTrack = body(archiveTrack(owner, team.id, backendTrackId)).path("track")
        assertEquals("ARCHIVED", archivedTrack.path("status").asText())
        assertEquals(2, archivedTrack.path("revision").asLong())
        assertEquals(1, body(tracks(owner, team.id)).path("items").size(), "archived track must leave the active filter")
        assertEquals(
            backendTrackId,
            body(tracks(owner, team.id, "archived")).path("items").first { it.path("status").asText() == "ARCHIVED" }.path("id").asText(),
        )

        val restoredTrack = body(restoreTrack(owner, team.id, backendTrackId)).path("track")
        assertEquals("ACTIVE", restoredTrack.path("status").asText())
        assertEquals(3, restoredTrack.path("revision").asLong())
        assertEquals(2, body(tracks(owner, team.id)).path("items").size(), "restored track returns to the active filter")

        val searchByVacancy = body(tracks(owner, team.id, status = "active", query = "engineer"))
        assertEquals(1, searchByVacancy.path("items").size(), "search must match visible vacancy titles")
        assertEquals("Platform", searchByVacancy.path("items")[0].path("name").asText())
        assertEquals(2, searchByVacancy.path("counts").path("activeTracks").asInt(), "counts are not reduced by a search query")
        assertEquals(0, body(tracks(owner, team.id, status = "active", query = "golang")).path("items").size())
    }

    private fun account(prefix: String): HrTestAccount = HrHttpFixtures.register(mockMvc, objectMapper, false, prefix).first

    private fun team(owner: HrTestAccount, name: String): TeamFixture {
        val result = mockMvc.post("/api/teams") {
            authorize(owner)
            header("Idempotency-Key", UUID.randomUUID().toString())
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()
        assertStatus(result, 201, "team fixture must exist")
        return TeamFixture(body(result).path("team").path("id").asText())
    }

    private fun seedMembership(teamId: String, userId: String, role: String) {
        jdbcTemplate.update(
            """
            INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ACTIVE', 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            """.trimIndent(),
            UUID.randomUUID().toString(), teamId, userId, role,
        )
    }

    private fun tracks(actor: HrTestAccount, teamId: String, status: String? = null, query: String? = null): MvcResult =
        mockMvc.get("/api/teams/$teamId/tracks") {
            authorize(actor)
            status?.let { param("status", it) }
            query?.let { param("q", it) }
        }.andReturn()

    private fun createTrack(actor: HrTestAccount, teamId: String, name: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name))
        }.andReturn()

    private fun createVacancy(actor: HrTestAccount, teamId: String, trackId: String, title: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to title))
        }.andReturn()

    private fun createTeamTask(
        actor: HrTestAccount,
        teamId: String,
        title: String,
        description: String,
        starterCode: String,
        language: String,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tasks") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                mapOf(
                    "title" to title,
                    "description" to description,
                    "starterCode" to starterCode,
                    "language" to language,
                ),
            )
        }.andReturn()

    private fun trackProgramme(actor: HrTestAccount, teamId: String, trackId: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/tracks/$trackId/programme") {
            authorize(actor)
        }.andReturn()

    private fun saveTrackProgrammeDraft(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        taskIds: List<String>,
        revision: Long?,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId/programme/draft") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                buildMap {
                    put("taskIds", taskIds)
                    revision?.let { put("revision", it) }
                },
            )
        }.andReturn()

    private fun publishTrackProgramme(actor: HrTestAccount, teamId: String, trackId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/programme/publish") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun archiveTrackProgramme(actor: HrTestAccount, teamId: String, trackId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/programme/archive") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun restoreTrackProgramme(actor: HrTestAccount, teamId: String, trackId: String, revision: Long): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/programme/restore") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun vacancyProgramme(actor: HrTestAccount, teamId: String, trackId: String, vacancyId: String): MvcResult =
        mockMvc.get("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme") {
            authorize(actor)
        }.andReturn()

    private fun saveVacancyProgrammeDraft(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        taskIds: List<String>,
        revision: Long?,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme/draft") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(
                buildMap {
                    put("taskIds", taskIds)
                    revision?.let { put("revision", it) }
                },
            )
        }.andReturn()

    private fun publishVacancyProgramme(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        revision: Long,
    ): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/programme/publish") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("revision" to revision))
        }.andReturn()

    private fun updateTrack(actor: HrTestAccount, teamId: String, trackId: String, name: String, revision: Long): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("name" to name, "revision" to revision))
        }.andReturn()

    private fun archiveTrack(actor: HrTestAccount, teamId: String, trackId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/archive") { authorize(actor) }.andReturn()

    private fun restoreTrack(actor: HrTestAccount, teamId: String, trackId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/restore") { authorize(actor) }.andReturn()

    private fun updateVacancy(
        actor: HrTestAccount,
        teamId: String,
        trackId: String,
        vacancyId: String,
        title: String,
        revision: Long,
    ): MvcResult =
        mockMvc.patch("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId") {
            authorize(actor)
            contentType = MediaType.APPLICATION_JSON
            content = objectMapper.writeValueAsString(mapOf("title" to title, "revision" to revision))
        }.andReturn()

    private fun archiveVacancy(actor: HrTestAccount, teamId: String, trackId: String, vacancyId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/archive") { authorize(actor) }.andReturn()

    private fun restoreVacancy(actor: HrTestAccount, teamId: String, trackId: String, vacancyId: String): MvcResult =
        mockMvc.post("/api/teams/$teamId/tracks/$trackId/vacancies/$vacancyId/restore") { authorize(actor) }.andReturn()

    private fun body(result: MvcResult): JsonNode = objectMapper.readTree(result.response.contentAsString)

    private fun assertStatus(result: MvcResult, expected: Int, marker: String) {
        assertEquals(expected, result.response.status, marker)
    }

    private fun assertStatusAndCode(result: MvcResult, expected: Int, code: String) {
        assertEquals(expected, result.response.status, "unexpected team-track status")
        assertEquals(code, body(result).path("code").asText(), "unexpected team-track error code")
    }

    private fun assertProtectedNoStore(result: MvcResult) {
        assertEquals("private, no-store", result.response.getHeader("Cache-Control"), "tracks response must be private and non-cacheable")
    }

    private data class TeamFixture(val id: String)
}

private fun org.springframework.test.web.servlet.MockHttpServletRequestDsl.authorize(actor: HrTestAccount) {
    header("Authorization", "Bearer ${actor.token}")
}
