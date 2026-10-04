package com.interviewonline.service

import com.interviewonline.dto.TeamTrackCountsDto
import com.interviewonline.dto.TeamTrackDto
import com.interviewonline.dto.TeamTrackResponse
import com.interviewonline.dto.TeamTracksDto
import com.interviewonline.dto.TeamVacancyDto
import com.interviewonline.dto.TeamVacancyResponse
import com.interviewonline.dto.TeamInterviewProgrammeDraftRequest
import com.interviewonline.dto.TeamInterviewProgrammeDto
import com.interviewonline.dto.TeamInterviewProgrammePublishRequest
import com.interviewonline.dto.TeamInterviewProgrammeResponse
import com.interviewonline.dto.TeamInterviewProgrammeRevisionRequest
import com.interviewonline.dto.TeamInterviewProgrammeTaskDto
import com.interviewonline.model.Team
import com.interviewonline.model.TeamInterviewProgramme
import com.interviewonline.model.TeamInterviewProgrammeItem
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.TeamTaskTemplate
import com.interviewonline.model.TeamTrack
import com.interviewonline.model.TeamVacancy
import com.interviewonline.model.User
import com.interviewonline.repository.TeamInterviewProgrammeRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTaskTemplateRepository
import com.interviewonline.repository.TeamTrackRepository
import com.interviewonline.repository.TeamVacancyRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronizationManager
import jakarta.persistence.EntityManager
import java.text.Normalizer
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

@Service
class TeamTrackService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val trackRepository: TeamTrackRepository,
    private val vacancyRepository: TeamVacancyRepository,
    private val taskRepository: TeamTaskTemplateRepository,
    private val programmeRepository: TeamInterviewProgrammeRepository,
    private val jdbcTemplate: JdbcTemplate,
    private val entityManager: EntityManager,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String, rawStatus: String?, rawQuery: String?): TeamTracksDto {
        val access = requireActiveMember(actor, teamId)
        val status = parseCatalogStatus(rawStatus)
        val query = normalizedQuery(rawQuery)
        val allTracks = when (status) {
            ACTIVE -> trackRepository.findByTeamIdAndStatusOrderByNormalizedNameAscIdAsc(access.team.id, ACTIVE)
            ARCHIVED -> archivedTracks(access.team.id)
            else -> throw invalidTrackFilter()
        }
        val allVacanciesByTrack = vacanciesFor(allTracks, status)
        val tracks = filterTracks(allTracks, allVacanciesByTrack, query)
        val programmesByTrack = programmesForTracks(access.team.id, tracks)
        val programmesByVacancy = programmesForVacancies(access.team.id, allVacanciesByTrack.values.flatten())
        return TeamTracksDto(
            items = tracks.map { track ->
                trackDto(track, allVacanciesByTrack[track.id].orEmpty(), programmesByTrack[track.id], programmesByVacancy)
            },
            counts = counts(access.team.id),
        )
    }

    @Transactional
    fun createTrack(actor: User, teamId: String, rawName: String): TeamTrackResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val name = canonicalName(rawName, max = MAX_TRACK_NAME_CODE_POINTS, code = "INVALID_TRACK_NAME")
        val normalizedName = normalized(name)
        if (trackRepository.existsByTeamIdAndNormalizedNameAndStatus(access.team.id, normalizedName, ACTIVE)) {
            throw secure(HttpStatus.CONFLICT, "TRACK_ALREADY_EXISTS", "Трек с таким названием уже существует")
        }
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val track = trackRepository.saveAndFlush(
            TeamTrack(
                id = UUID.randomUUID().toString(),
                teamId = access.team.id,
                name = name,
                normalizedName = normalizedName,
                status = ACTIVE,
                createdByUserId = access.actorId,
                createdAt = now,
                updatedAt = now,
            ),
        )
        return TeamTrackResponse(trackDto(track, emptyList(), null, emptyMap()))
    }

    @Transactional
    fun deleteTrack(actor: User, teamId: String, trackId: String) {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        if (vacancyRepository.existsByTrackId(track.id) || referencedRoom("team_track_id", track.id)) {
            throw secure(HttpStatus.CONFLICT, "TRACK_IN_USE", "Удалите вакансии трека; трек с интервью удалить нельзя")
        }
        programmeForTrack(teamId, track.id)?.let(programmeRepository::delete)
        programmeRepository.flush()
        trackRepository.delete(track)
        trackRepository.flush()
    }

    @Transactional
    fun deleteVacancy(actor: User, teamId: String, trackId: String, vacancyId: String) {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, trackId, vacancyId)
        if (referencedRoom("team_vacancy_id", vacancy.id)) {
            throw secure(HttpStatus.CONFLICT, "VACANCY_IN_USE", "Вакансию с интервью удалить нельзя")
        }
        programmeForVacancy(teamId, vacancy.id)?.let(programmeRepository::delete)
        programmeRepository.flush()
        vacancyRepository.delete(vacancy)
        vacancyRepository.flush()
    }

    private fun referencedRoom(column: String, id: String): Boolean =
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM rooms WHERE $column = ?", Long::class.java, id)!! > 0

    @Transactional
    fun createVacancy(actor: User, teamId: String, trackId: String, rawTitle: String): TeamVacancyResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = trackRepository.findByIdAndTeamId(trackId, access.team.id)
            ?.takeIf { it.status == ACTIVE }
            ?: throw trackNotFound()
        val title = canonicalName(rawTitle, max = MAX_VACANCY_TITLE_CODE_POINTS, code = "INVALID_VACANCY_TITLE")
        val normalizedTitle = normalized(title)
        if (vacancyRepository.existsByTrackIdAndNormalizedTitleAndStatus(track.id, normalizedTitle, ACTIVE)) {
            throw secure(HttpStatus.CONFLICT, "VACANCY_ALREADY_EXISTS", "Вакансия с таким названием уже существует")
        }
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val vacancy = vacancyRepository.saveAndFlush(
            TeamVacancy(
                id = UUID.randomUUID().toString(),
                teamId = access.team.id,
                trackId = track.id,
                title = title,
                normalizedTitle = normalizedTitle,
                status = ACTIVE,
                createdByUserId = access.actorId,
                createdAt = now,
                updatedAt = now,
            ),
        )
        return TeamVacancyResponse(vacancyDto(vacancy))
    }

    @Transactional
    fun updateTrack(actor: User, teamId: String, trackId: String, rawName: String, revision: Long): TeamTrackResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        if (track.revision != revision) throw trackRevisionConflict(track.revision)
        val name = canonicalName(rawName, max = MAX_TRACK_NAME_CODE_POINTS, code = "INVALID_TRACK_NAME")
        val normalizedName = normalized(name)
        if (
            track.status == ACTIVE &&
            trackRepository.existsByTeamIdAndNormalizedNameAndStatusAndIdNot(access.team.id, normalizedName, ACTIVE, track.id)
        ) {
            throw trackAlreadyExists()
        }
        if (track.name != name || track.normalizedName != normalizedName) {
            track.name = name
            track.normalizedName = normalizedName
            bumpTrack(track)
        }
        return TeamTrackResponse(trackDto(access.team.id, track, vacanciesForTrack(track), programmeForTrack(access.team.id, track.id)))
    }

    @Transactional
    fun archiveTrack(actor: User, teamId: String, trackId: String): TeamTrackResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        if (track.status != ARCHIVED) {
            track.status = ARCHIVED
            bumpTrack(track)
        }
        return TeamTrackResponse(
            trackDto(
                access.team.id,
                track,
                vacanciesForTrack(track, includeArchivedForArchivedTrack = true),
                programmeForTrack(access.team.id, track.id),
            ),
        )
    }

    @Transactional
    fun restoreTrack(actor: User, teamId: String, trackId: String): TeamTrackResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        if (track.status != ACTIVE) {
            if (trackRepository.existsByTeamIdAndNormalizedNameAndStatusAndIdNot(access.team.id, track.normalizedName, ACTIVE, track.id)) {
                throw trackAlreadyExists()
            }
            track.status = ACTIVE
            bumpTrack(track)
        }
        return TeamTrackResponse(trackDto(access.team.id, track, vacanciesForTrack(track), programmeForTrack(access.team.id, track.id)))
    }

    @Transactional(readOnly = true)
    fun trackProgramme(actor: User, teamId: String, trackId: String): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireTrack(access.team.id, trackId)
        return TeamInterviewProgrammeResponse(programmeForTrack(access.team.id, trackId)?.let(::programmeDto))
    }

    @Transactional
    fun saveTrackProgrammeDraft(
        actor: User,
        teamId: String,
        trackId: String,
        request: TeamInterviewProgrammeDraftRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId).takeIf { it.status == ACTIVE } ?: throw trackNotFound()
        val existing = programmeForTrack(access.team.id, track.id)
        if (existing != null) {
            val expectedRevision = request.revision ?: throw programmeRevisionConflict(existing.revision)
            if (existing.revision != expectedRevision) throw programmeRevisionConflict(existing.revision)
        }
        val tasks = requireOrderedActiveProgrammeTasks(access.team.id, request.taskIds)
        val now = now()
        val programme = existing ?: TeamInterviewProgramme(
            id = UUID.randomUUID().toString(),
            teamId = access.team.id,
            targetType = TRACK,
            targetId = track.id,
            status = DRAFT,
            version = 0,
            revision = 0,
            createdByUserId = access.actorId,
            createdAt = now,
            updatedAt = now,
        )
        if (existing != null) {
            programme.status = DRAFT
            programme.revision += 1
            programme.updatedAt = now
        }
        programme.items.clear()
        if (existing != null) programmeRepository.flush()
        attachProgrammeItems(programme, tasks)
        val saved = programmeRepository.saveAndFlush(programme)
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, TRACK, saved.targetId)))
    }

    @Transactional
    fun publishTrackProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        request: TeamInterviewProgrammePublishRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId).takeIf { it.status == ACTIVE } ?: throw trackNotFound()
        val programme = programmeForTrack(access.team.id, track.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.items.isEmpty()) throw programmeEmpty()
        if (programme.status != PUBLISHED) {
            programme.status = PUBLISHED
            programme.version += 1
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, TRACK, track.id)))
    }

    @Transactional
    fun archiveTrackProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        request: TeamInterviewProgrammeRevisionRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        val programme = programmeForTrack(access.team.id, track.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.status != ARCHIVED) {
            programme.status = ARCHIVED
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, TRACK, track.id)))
    }

    @Transactional
    fun restoreTrackProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        request: TeamInterviewProgrammeRevisionRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        val programme = programmeForTrack(access.team.id, track.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.status == ARCHIVED) {
            programme.status = PUBLISHED
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, TRACK, track.id)))
    }

    @Transactional(readOnly = true)
    fun vacancyProgramme(actor: User, teamId: String, trackId: String, vacancyId: String): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        val track = requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, track.id, vacancyId)
        return TeamInterviewProgrammeResponse(resolvedProgrammeForVacancy(access.team.id, track.id, vacancy.id)?.let(::programmeDto))
    }

    @Transactional
    fun saveVacancyProgrammeDraft(
        actor: User,
        teamId: String,
        trackId: String,
        vacancyId: String,
        request: TeamInterviewProgrammeDraftRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId).takeIf { it.status == ACTIVE } ?: throw trackNotFound()
        val vacancy = requireVacancy(access.team.id, track.id, vacancyId).takeIf { it.status == ACTIVE } ?: throw vacancyNotFound()
        val existing = programmeForVacancy(access.team.id, vacancy.id)
        if (existing != null) {
            val expectedRevision = request.revision ?: throw programmeRevisionConflict(existing.revision)
            if (existing.revision != expectedRevision) throw programmeRevisionConflict(existing.revision)
        }
        val tasks = requireOrderedActiveProgrammeTasks(access.team.id, request.taskIds)
        val now = now()
        val programme = existing ?: TeamInterviewProgramme(
            id = UUID.randomUUID().toString(),
            teamId = access.team.id,
            targetType = VACANCY,
            targetId = vacancy.id,
            status = DRAFT,
            version = 0,
            revision = 0,
            createdByUserId = access.actorId,
            createdAt = now,
            updatedAt = now,
        )
        if (existing != null) {
            programme.status = DRAFT
            programme.revision += 1
            programme.updatedAt = now
        }
        programme.items.clear()
        if (existing != null) programmeRepository.flush()
        attachProgrammeItems(programme, tasks)
        val saved = programmeRepository.saveAndFlush(programme)
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, VACANCY, saved.targetId)))
    }

    @Transactional
    fun publishVacancyProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        vacancyId: String,
        request: TeamInterviewProgrammePublishRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId).takeIf { it.status == ACTIVE } ?: throw trackNotFound()
        val vacancy = requireVacancy(access.team.id, track.id, vacancyId).takeIf { it.status == ACTIVE } ?: throw vacancyNotFound()
        val programme = programmeForVacancy(access.team.id, vacancy.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.items.isEmpty()) throw programmeEmpty()
        if (programme.status != PUBLISHED) {
            programme.status = PUBLISHED
            programme.version += 1
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, VACANCY, vacancy.id)))
    }

    @Transactional
    fun archiveVacancyProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        vacancyId: String,
        request: TeamInterviewProgrammeRevisionRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, track.id, vacancyId)
        val programme = programmeForVacancy(access.team.id, vacancy.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.status != ARCHIVED) {
            programme.status = ARCHIVED
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, VACANCY, vacancy.id)))
    }

    @Transactional
    fun restoreVacancyProgramme(
        actor: User,
        teamId: String,
        trackId: String,
        vacancyId: String,
        request: TeamInterviewProgrammeRevisionRequest,
    ): TeamInterviewProgrammeResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, track.id, vacancyId)
        val programme = programmeForVacancy(access.team.id, vacancy.id) ?: throw programmeNotFound()
        if (programme.revision != request.revision) throw programmeRevisionConflict(programme.revision)
        if (programme.status == ARCHIVED) {
            programme.status = PUBLISHED
            programme.revision += 1
            programme.updatedAt = now()
            programmeRepository.saveAndFlush(programme)
        }
        return TeamInterviewProgrammeResponse(programmeDto(requireProgramme(access.team.id, VACANCY, vacancy.id)))
    }

    @Transactional
    fun updateVacancy(
        actor: User,
        teamId: String,
        trackId: String,
        vacancyId: String,
        rawTitle: String,
        revision: Long,
    ): TeamVacancyResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, trackId, vacancyId)
        if (vacancy.revision != revision) throw vacancyRevisionConflict(vacancy.revision)
        val title = canonicalName(rawTitle, max = MAX_VACANCY_TITLE_CODE_POINTS, code = "INVALID_VACANCY_TITLE")
        val normalizedTitle = normalized(title)
        if (
            vacancy.status == ACTIVE &&
            vacancyRepository.existsByTrackIdAndNormalizedTitleAndStatusAndIdNot(trackId, normalizedTitle, ACTIVE, vacancy.id)
        ) {
            throw vacancyAlreadyExists()
        }
        if (vacancy.title != title || vacancy.normalizedTitle != normalizedTitle) {
            vacancy.title = title
            vacancy.normalizedTitle = normalizedTitle
            bumpVacancy(vacancy)
        }
        return TeamVacancyResponse(vacancyDto(vacancy))
    }

    @Transactional
    fun archiveVacancy(actor: User, teamId: String, trackId: String, vacancyId: String): TeamVacancyResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        requireTrack(access.team.id, trackId)
        val vacancy = requireVacancy(access.team.id, trackId, vacancyId)
        if (vacancy.status != ARCHIVED) {
            vacancy.status = ARCHIVED
            bumpVacancy(vacancy)
        }
        return TeamVacancyResponse(vacancyDto(vacancy))
    }

    @Transactional
    fun restoreVacancy(actor: User, teamId: String, trackId: String, vacancyId: String): TeamVacancyResponse {
        val access = requireActiveMember(actor, teamId)
        requireManager(access)
        val track = requireTrack(access.team.id, trackId)
        if (track.status != ACTIVE) throw trackNotFound()
        val vacancy = requireVacancy(access.team.id, trackId, vacancyId)
        if (vacancy.status != ACTIVE) {
            if (vacancyRepository.existsByTrackIdAndNormalizedTitleAndStatusAndIdNot(trackId, vacancy.normalizedTitle, ACTIVE, vacancy.id)) {
                throw vacancyAlreadyExists()
            }
            vacancy.status = ACTIVE
            bumpVacancy(vacancy)
        }
        return TeamVacancyResponse(vacancyDto(vacancy))
    }

    private fun requireActiveMember(actor: User, teamId: String): TeamAccess {
        val actorId = requireNotNull(actor.id)
        val team = if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            teamRepository.findById(teamId).orElse(null)
        } else {
            teamRepository.lockById(teamId)?.also(entityManager::refresh)
        }
        if (team == null || team.state != ACTIVE) throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        return TeamAccess(
            actorId = actorId,
            team = team,
            membership = membership,
            role = if (team.ownerUserId == membership.userId) "OWNER" else membership.role,
        )
    }

    private fun requireManager(access: TeamAccess) {
        if (access.role == "OWNER" || access.role == "ADMIN") return
        throw secure(HttpStatus.FORBIDDEN, "INSUFFICIENT_TEAM_ROLE", "Недостаточно прав в команде")
    }

    private fun canonicalName(raw: String, max: Int, code: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..max) {
            throw secure(HttpStatus.BAD_REQUEST, code, "Название должно содержать от 1 до $max символов")
        }
        return value
    }

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim { it.isWhitespace() }
        .lowercase(Locale.ROOT)

    private fun normalizedQuery(value: String?): String? = value
        ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() } }
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)

    private fun parseCatalogStatus(rawStatus: String?): String = when (rawStatus?.trim()?.lowercase(Locale.ROOT)) {
        null, "", "active" -> ACTIVE
        "archived" -> ARCHIVED
        else -> throw invalidTrackFilter()
    }

    private fun archivedTracks(teamId: String): List<TeamTrack> {
        val archived = trackRepository.findByTeamIdAndStatusOrderByNormalizedNameAscIdAsc(teamId, ARCHIVED)
        val archivedVacancyTrackIds = vacancyRepository
            .findByTeamIdAndStatusOrderByNormalizedTitleAscIdAsc(teamId, ARCHIVED)
            .map { it.trackId }
            .toSet()
            .minus(archived.map { it.id }.toSet())
        val activeWithArchivedVacancies = if (archivedVacancyTrackIds.isEmpty()) {
            emptyList()
        } else {
            trackRepository.findByTeamIdAndIdIn(teamId, archivedVacancyTrackIds)
        }
        return (archived + activeWithArchivedVacancies)
            .distinctBy { it.id }
            .sortedWith(compareBy<TeamTrack> { it.normalizedName }.thenBy { it.id })
    }

    private fun vacanciesFor(tracks: List<TeamTrack>, status: String): Map<String, List<TeamVacancy>> {
        if (tracks.isEmpty()) return emptyMap()
        val trackIds = tracks.map { it.id }
        return when (status) {
            ACTIVE -> vacancyRepository
                .findByTrackIdInAndStatusOrderByNormalizedTitleAscIdAsc(trackIds, ACTIVE)
                .groupBy { it.trackId }
            ARCHIVED -> {
                val archivedTrackIds = tracks.filter { it.status == ARCHIVED }.map { it.id }.toSet()
                vacancyRepository
                    .findByTrackIdInOrderByNormalizedTitleAscIdAsc(trackIds)
                    .filter { vacancy -> vacancy.status == ARCHIVED || vacancy.trackId in archivedTrackIds }
                    .groupBy { it.trackId }
            }
            else -> emptyMap()
        }
    }

    private fun filterTracks(
        tracks: List<TeamTrack>,
        vacanciesByTrack: Map<String, List<TeamVacancy>>,
        query: String?,
    ): List<TeamTrack> {
        if (query == null) return tracks
        return tracks.filter { track ->
            track.normalizedName.contains(query) ||
                vacanciesByTrack[track.id].orEmpty().any { vacancy -> vacancy.normalizedTitle.contains(query) }
        }
    }

    private fun counts(teamId: String): TeamTrackCountsDto = TeamTrackCountsDto(
        activeTracks = trackRepository.countByTeamIdAndStatus(teamId, ACTIVE),
        archivedTracks = trackRepository.countByTeamIdAndStatus(teamId, ARCHIVED),
        activeVacancies = vacancyRepository.countVisibleByTeamIdAndStatus(teamId, ACTIVE),
        archivedVacancies = vacancyRepository.countVisibleByTeamIdAndStatus(teamId, ARCHIVED),
    )

    private fun vacanciesForTrack(track: TeamTrack, includeArchivedForArchivedTrack: Boolean = false): List<TeamVacancy> =
        if (includeArchivedForArchivedTrack && track.status == ARCHIVED) {
            vacancyRepository.findByTrackIdInOrderByNormalizedTitleAscIdAsc(listOf(track.id))
        } else {
            vacancyRepository.findByTrackIdInAndStatusOrderByNormalizedTitleAscIdAsc(listOf(track.id), ACTIVE)
        }

    private fun programmesForTracks(teamId: String, tracks: List<TeamTrack>): Map<String, TeamInterviewProgramme> {
        if (tracks.isEmpty()) return emptyMap()
        return programmeRepository
            .findByTeamAndTargetIdsWithItems(teamId, TRACK, tracks.map { it.id })
            .associateBy { it.targetId }
    }

    private fun programmesForVacancies(teamId: String, vacancies: List<TeamVacancy>): Map<String, TeamInterviewProgramme> {
        if (vacancies.isEmpty()) return emptyMap()
        return programmeRepository
            .findByTeamAndTargetIdsWithItems(teamId, VACANCY, vacancies.map { it.id })
            .associateBy { it.targetId }
    }

    private fun programmeForTrack(teamId: String, trackId: String): TeamInterviewProgramme? =
        programmeRepository.findByTeamAndTargetWithItems(teamId, TRACK, trackId)

    private fun programmeForVacancy(teamId: String, vacancyId: String): TeamInterviewProgramme? =
        programmeRepository.findByTeamAndTargetWithItems(teamId, VACANCY, vacancyId)

    private fun resolvedProgrammeForVacancy(teamId: String, trackId: String, vacancyId: String): TeamInterviewProgramme? =
        programmeForVacancy(teamId, vacancyId) ?: programmeForTrack(teamId, trackId)

    private fun requireProgramme(teamId: String, targetType: String, targetId: String): TeamInterviewProgramme =
        programmeRepository.findByTeamAndTargetWithItems(teamId, targetType, targetId) ?: throw programmeNotFound()

    private fun requireTrack(teamId: String, trackId: String): TeamTrack =
        trackRepository.findByIdAndTeamId(trackId, teamId) ?: throw trackNotFound()

    private fun requireVacancy(teamId: String, trackId: String, vacancyId: String): TeamVacancy =
        vacancyRepository.findByIdAndTeamIdAndTrackId(vacancyId, teamId, trackId) ?: throw vacancyNotFound()

    private fun bumpTrack(track: TeamTrack) {
        track.revision += 1
        track.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        trackRepository.saveAndFlush(track)
    }

    private fun bumpVacancy(vacancy: TeamVacancy) {
        vacancy.revision += 1
        vacancy.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        vacancyRepository.saveAndFlush(vacancy)
    }

    private fun requireOrderedActiveProgrammeTasks(teamId: String, taskIds: List<String>): List<TeamTaskTemplate> {
        if (taskIds.isEmpty()) throw programmeEmpty()
        if (taskIds.size != taskIds.distinct().size) {
            throw secure(HttpStatus.BAD_REQUEST, "TEAM_PROGRAMME_DUPLICATE_TASK", "Программа содержит повторяющиеся задачи")
        }
        return taskIds.map { taskId ->
            val task = taskRepository.findByIdAndTeamId(taskId, teamId) ?: throw taskNotFound()
            if (task.status != ACTIVE) throw taskNotFound()
            task
        }
    }

    private fun attachProgrammeItems(programme: TeamInterviewProgramme, tasks: List<TeamTaskTemplate>) {
        tasks.forEachIndexed { index, task ->
            programme.items.add(
                TeamInterviewProgrammeItem(
                    id = UUID.randomUUID().toString(),
                    programme = programme,
                    taskTemplate = task,
                    position = index,
                    mandatory = true,
                ),
            )
        }
    }

    private fun trackDto(
        teamId: String,
        track: TeamTrack,
        vacancies: List<TeamVacancy>,
        programme: TeamInterviewProgramme?,
    ): TeamTrackDto =
        trackDto(track, vacancies, programme, programmesForVacancies(teamId, vacancies))

    private fun trackDto(
        track: TeamTrack,
        vacancies: List<TeamVacancy>,
        programme: TeamInterviewProgramme?,
        vacancyProgrammes: Map<String, TeamInterviewProgramme>,
    ): TeamTrackDto =
        TeamTrackDto(
            id = track.id,
            name = track.name,
            status = track.status,
            revision = track.revision,
            programme = programme?.let(::programmeDto),
            vacancies = vacancies.map { vacancy -> vacancyDto(vacancy, vacancyProgrammes[vacancy.id] ?: programme) },
        )

    private fun vacancyDto(vacancy: TeamVacancy, programme: TeamInterviewProgramme? = null): TeamVacancyDto =
        TeamVacancyDto(
            id = vacancy.id,
            title = vacancy.title,
            status = vacancy.status,
            revision = vacancy.revision,
            programme = programme?.let(::programmeDto),
        )

    private fun programmeDto(programme: TeamInterviewProgramme): TeamInterviewProgrammeDto {
        val tasks = programme.items.sortedBy { it.position }.map { item ->
            val task = requireNotNull(item.taskTemplate)
            TeamInterviewProgrammeTaskDto(
                taskId = task.id,
                title = task.title,
                language = normalizeLanguage(task.language),
                position = item.position,
                mandatory = item.mandatory,
            )
        }
        return TeamInterviewProgrammeDto(
            id = programme.id,
            origin = programme.targetType,
            targetType = programme.targetType,
            targetId = programme.targetId,
            status = programme.status,
            version = programme.version,
            revision = programme.revision,
            mandatory = tasks.isNotEmpty() && tasks.all { it.mandatory },
            tasks = tasks,
        )
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun trackNotFound() = secure(HttpStatus.NOT_FOUND, "TRACK_NOT_FOUND", "Трек не найден")
    private fun vacancyNotFound() = secure(HttpStatus.NOT_FOUND, "VACANCY_NOT_FOUND", "Вакансия не найдена")
    private fun taskNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_NOT_FOUND", "Задача не найдена")
    private fun programmeNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_PROGRAMME_NOT_FOUND", "Программа интервью не найдена")
    private fun programmeEmpty() = secure(HttpStatus.BAD_REQUEST, "TEAM_PROGRAMME_EMPTY", "Программа должна содержать хотя бы одну задачу")
    private fun invalidTrackFilter() = secure(HttpStatus.BAD_REQUEST, "INVALID_TRACK_FILTER", "Фильтр треков должен быть active или archived")
    private fun trackAlreadyExists() = secure(HttpStatus.CONFLICT, "TRACK_ALREADY_EXISTS", "Трек с таким названием уже существует")
    private fun vacancyAlreadyExists() = secure(HttpStatus.CONFLICT, "VACANCY_ALREADY_EXISTS", "Вакансия с таким названием уже существует")
    private fun trackRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Трек уже изменился",
        code = "TRACK_REVISION_CONFLICT",
        currentRevision = current,
    )
    private fun programmeRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Программа интервью уже изменилась",
        code = "TEAM_PROGRAMME_REVISION_CONFLICT",
        currentRevision = current,
    )
    private fun vacancyRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Вакансия уже изменилась",
        code = "VACANCY_REVISION_CONFLICT",
        currentRevision = current,
    )

    private data class TeamAccess(
        val actorId: String,
        val team: Team,
        val membership: TeamMembership,
        val role: String,
    )

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val ARCHIVED = "ARCHIVED"
        const val DRAFT = "DRAFT"
        const val PUBLISHED = "PUBLISHED"
        const val TRACK = "TRACK"
        const val VACANCY = "VACANCY"
        const val MAX_TRACK_NAME_CODE_POINTS = 100
        const val MAX_VACANCY_TITLE_CODE_POINTS = 120
    }
}
