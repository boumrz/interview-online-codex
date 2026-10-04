package com.interviewonline.service

import com.interviewonline.dto.TeamInterviewCreateRequest
import com.interviewonline.dto.TeamInterviewDetailsDto
import com.interviewonline.dto.TeamInterviewDetailsUpdateRequest
import com.interviewonline.dto.TeamInterviewAssigneeDto
import com.interviewonline.dto.TeamInterviewDto
import com.interviewonline.dto.TeamInterviewOwnerOfferCreateRequest
import com.interviewonline.dto.TeamInterviewRenameRequest
import com.interviewonline.dto.TeamInterviewOwnerOfferListDto
import com.interviewonline.dto.TeamInterviewOwnerOfferListItemDto
import com.interviewonline.dto.TeamInterviewOwnerOfferDto
import com.interviewonline.dto.TeamInterviewOwnerOfferResponse
import com.interviewonline.dto.TeamInterviewListDto
import com.interviewonline.dto.TeamInterviewListItemDto
import com.interviewonline.dto.TeamInterviewListTaskDto
import com.interviewonline.dto.TeamInterviewResponse
import com.interviewonline.dto.TeamInterviewTaskDto
import com.interviewonline.dto.TeamInterviewTaskScoreDto
import com.interviewonline.model.CommandReceipt
import com.interviewonline.model.CommandReceiptId
import com.interviewonline.model.Room
import com.interviewonline.model.RoomParticipant
import com.interviewonline.model.RoomStatus
import com.interviewonline.model.RoomTask
import com.interviewonline.model.Team
import com.interviewonline.model.TeamInterviewProgramme
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamInterviewOwnerOffer
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.TeamTaskSet
import com.interviewonline.model.TeamTaskTemplate
import com.interviewonline.model.TeamTrack
import com.interviewonline.model.TeamVacancy
import com.interviewonline.model.User
import com.interviewonline.repository.CommandReceiptRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.lockById
import com.interviewonline.repository.TeamInterviewProgrammeRepository
import com.interviewonline.repository.TeamInterviewOwnerOfferRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTaskSetRepository
import com.interviewonline.repository.TeamTaskTemplateRepository
import com.interviewonline.repository.TeamTrackRepository
import com.interviewonline.repository.TeamVacancyRepository
import com.interviewonline.repository.UserRepository
import com.interviewonline.service.LanguageNormalizer.normalize as normalizeLanguage
import jakarta.persistence.EntityManager
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.Normalizer
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

@Service
class TeamInterviewService(
    private val entityManager: EntityManager,
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val taskSetRepository: TeamTaskSetRepository,
    private val taskRepository: TeamTaskTemplateRepository,
    private val trackRepository: TeamTrackRepository,
    private val vacancyRepository: TeamVacancyRepository,
    private val programmeRepository: TeamInterviewProgrammeRepository,
    private val roomRepository: RoomRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val roomHrTrackingService: RoomHrTrackingService,
    private val userRepository: UserRepository,
    private val ownerOfferRepository: TeamInterviewOwnerOfferRepository,
    private val receiptRepository: CommandReceiptRepository,
    private val teamAuditWriter: TeamAuditWriter,
    private val roomProductMetricsProjector: RoomProductMetricsProjector,
    private val collaborationService: CollaborationService,
    private val teamRoomLineageService: TeamRoomLineageService,
    private val featureGate: TeamWorkspaceFeatureGate,
    private val jdbcTemplate: JdbcTemplate,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String, rawQuery: String?, rawOwnership: String?, rawTrackId: String? = null, rawVacancyId: String? = null): TeamInterviewListDto {
        val access = requireActiveMember(actor, teamId)
        val query = listQuery(rawQuery, rawOwnership)
        val trackId = optionalId(rawTrackId)
        val vacancyId = optionalId(rawVacancyId)
        if (query.ownership == OWNERSHIP_ORPHANED && !access.isManager) throw interviewQueueForbidden()
        val rooms = roomRepository.findAllByTeamIdAndArchivedAtIsNullOrderByCreatedAtDescIdAsc(access.team.id)
        val tracksById = tracksById(access.team.id, rooms.mapNotNull { it.teamTrackId }.toSet())
        val vacanciesById = vacanciesById(access.team.id, rooms.mapNotNull { it.teamVacancyId }.toSet())
        val assigneesByRoomId = assigneesByRoomId(rooms.mapNotNull { it.id }.toSet())
        val items = rooms
            .filter { room -> (trackId == null || room.teamTrackId == trackId) && (vacancyId == null || room.teamVacancyId == vacancyId) }
            .map { room -> room to ownershipSnapshot(access.team.id, room) }
            .filter { (room, ownership) ->
                query.ownership != OWNERSHIP_ORPHANED ||
                    (ownership.state != OWNERSHIP_ACTIVE && !room.isFinishedResult())
            }
            .filter { (room, _) -> matchesQuery(room, query.normalizedText, tracksById[room.teamTrackId], vacanciesById[room.teamVacancyId], canReadMetadata = teamRoomLineageService.isCanonical(room)) }
            .map { (room, ownership) ->
                listItem(room, ownership, tracksById[room.teamTrackId], vacanciesById[room.teamVacancyId], assigneesByRoomId[room.id].orEmpty())
        }
        return TeamInterviewListDto(items)
    }

    @Transactional(readOnly = true)
    fun listMineByProcess(actor: User, teamId: String, rawTrackId: String?, rawVacancyId: String?): TeamInterviewListDto {
        val access = requireActiveMember(actor, teamId)
        val trackId = rawTrackId?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw secure(HttpStatus.BAD_REQUEST, "TEAM_PROCESS_REQUIRED", "Выберите процесс")
        val vacancyId = rawVacancyId?.trim()?.takeIf { it.isNotEmpty() }
        val rooms = roomRepository.findAllByTeamIdAndArchivedAtIsNullOrderByCreatedAtDescIdAsc(access.team.id)
            .filter { room ->
                room.teamTrackId == trackId && room.teamVacancyId == vacancyId
            }
        val tracksById = tracksById(access.team.id, setOf(trackId))
        val vacanciesById = vacanciesById(access.team.id, listOfNotNull(vacancyId).toSet())
        val assigneesByRoomId = assigneesByRoomId(rooms.mapNotNull { it.id }.toSet())
        return TeamInterviewListDto(rooms.map { room ->
            listItem(
                room,
                ownershipSnapshot(access.team.id, room),
                tracksById[room.teamTrackId],
                vacanciesById[room.teamVacancyId],
                assigneesByRoomId[room.id].orEmpty(),
            )
        })
    }

    @Transactional
    fun listOwnerOffers(actor: User, teamId: String, rawStatus: String?): TeamInterviewOwnerOfferListDto {
        val access = requireActiveMember(actor, teamId)
        val status = rawStatus
            ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() }.lowercase(Locale.ROOT) }
            ?.takeIf { it.isNotEmpty() }
            ?: OWNER_OFFER_PENDING.lowercase(Locale.ROOT)
        if (status != OWNER_OFFER_PENDING.lowercase(Locale.ROOT)) throw invalidInterviewQuery()
        val now = now()
        ownerOfferRepository.expirePendingForTarget(access.team.id, access.actorId, now)
        val offers = ownerOfferRepository.findActivePendingByTeamIdAndToUserId(access.team.id, access.actorId, now)
        val roomsById = roomRepository.findAllById(offers.map { it.roomId }.toSet())
            .filter { it.teamId == access.team.id && teamRoomLineageService.isCanonical(it) && it.archivedAt == null }
            .associateBy { requireNotNull(it.id) }
        val fromUsers = userRepository.findAllById(offers.map { it.fromUserId }.toSet())
            .associateBy { requireNotNull(it.id) }
        return TeamInterviewOwnerOfferListDto(
            offers.mapNotNull { offer ->
                val room = roomsById[offer.roomId] ?: return@mapNotNull null
                TeamInterviewOwnerOfferListItemDto(
                    id = offer.id,
                    teamId = offer.teamId,
                    interviewId = offer.roomId,
                    interviewTitle = room.title,
                    fromUserId = offer.fromUserId,
                    fromDisplayName = fromUsers[offer.fromUserId]?.let(::displayName) ?: "Участник",
                    toUserId = offer.toUserId,
                    status = offer.status,
                    createdAt = offer.createdAt,
                    expiresAt = offer.expiresAt,
                )
            },
        )
    }

    @Transactional
    fun create(actor: User, teamId: String, request: TeamInterviewCreateRequest, key: UUID): TeamInterviewResponse {
        teamRepository.lockById(teamId)?.also { entityManager.refresh(it) }?.takeIf { it.state == ACTIVE } ?: throw teamNotFound()
        val access = requireActiveMember(actor, teamId)
        val title = canonicalTitle(request.title)
        val candidateName = canonicalMetadataText(request.candidateName, "Имя кандидата")
        val position = canonicalMetadataText(request.position, "Позиция")
        val scheduledAt = canonicalScheduledAt(request.scheduledAt)
        val taskSetId = optionalId(request.taskSetId)
        val taskIds = request.taskIds.map { requiredId(it, "TEAM_TASK_NOT_FOUND") }.distinct()
        val explicitSelectedTaskIds = request.selectedTaskIds?.map { requiredId(it, "TEAM_TASK_NOT_FOUND") }
        if (explicitSelectedTaskIds != null && explicitSelectedTaskIds.size != explicitSelectedTaskIds.distinct().size) {
            throw taskNotFound()
        }
        val trackId = optionalId(request.trackId)
        val vacancyId = optionalId(request.vacancyId)
        val assignmentRequest = canonicalAssignmentRequest(request)
        val requestHash = requestHash(
            title,
            taskSetId,
            taskIds,
            explicitSelectedTaskIds,
            trackId,
            vacancyId,
            request.programmeId,
            request.programmeVersion,
            assignmentRequest,
            candidateName,
            position,
            scheduledAt,
        )
        val receiptId = CommandReceiptId(
            actorUserId = access.actorId,
            scopeKind = SCOPE_TEAM,
            scopeId = access.team.id,
            operation = TEAM_INTERVIEW_CREATE,
            idempotencyKey = key.toString(),
        )

        receiptRepository.findById(receiptId).orElse(null)?.let { receipt ->
            requireActiveReceipt(receipt)
            requireMatchingReceipt(receipt, requestHash)
            val room = roomRepository.findWithTasksById(receipt.resourceId)
                ?.takeIf { it.teamId == access.team.id && it.originTeamId == access.team.id && it.archivedAt == null }
                ?: throw commandNotFound()
            return response(room)
        }

        val taskSet = taskSetId?.let { id ->
            taskSetRepository.findByIdAndTeamIdWithItems(id, access.team.id)
                ?.takeIf { it.status == ACTIVE }
                ?: throw taskSetNotFound()
        }
        val requestedTaskIds = explicitSelectedTaskIds
            ?: (taskSet?.let(::orderedActiveTasks).orEmpty().map { it.id } + taskIds)
        val requestedTasks = requestedTaskIds.distinct().map { id ->
            taskRepository.findByIdAndTeamId(id, access.team.id)
                ?.takeIf { it.status == ACTIVE }
                ?: throw taskNotFound()
        }
        val track = resolveTrack(access.team.id, trackId)
        val vacancy = resolveVacancy(access.team.id, track, vacancyId)
        val programme = resolvedCreatableProgramme(access.team.id, track, vacancy)
        if (programme?.id != request.programmeId || programme?.version != request.programmeVersion) {
            throw programmeVersionConflict(programme?.version)
        }
        val tasks = interviewTasks(programme, requestedTasks, explicitSelectedTaskIds)
        val assignments = resolveAssignments(access.team.id, assignmentRequest, access.actorId)
        val now = now()
        val room = Room(
            title = title,
            inviteCode = "r-${UUID.randomUUID()}",
            ownerSessionToken = "owner_${UUID.randomUUID()}",
            interviewerSessionToken = "interviewer_${UUID.randomUUID()}",
            ownerUser = actor,
            createdByUserId = access.actorId,
            teamId = access.team.id,
            originTeamId = access.team.id,
            teamInterviewCreated = true,
            teamTrackId = track?.id,
            teamVacancyId = vacancy?.id,
            teamTaskSetId = taskSet?.id,
            teamTaskSetRevision = taskSet?.revision,
            teamInterviewProgrammeId = programme?.id,
            teamInterviewProgrammeOrigin = programme?.targetType,
            teamInterviewProgrammeVersion = programme?.version,
            language = normalizeLanguage(tasks.firstOrNull()?.template?.language ?: "nodejs"),
            createdAt = now,
            candidateName = candidateName,
            position = position,
            scheduledAt = scheduledAt,
        )
        room.tasks = tasks.mapIndexed { index, task ->
            RoomTask(
                stepIndex = index,
                title = task.template.title,
                description = task.template.description,
                starterCode = task.template.starterCode,
                briefingMarkdown = null,
                language = normalizeLanguage(task.template.language),
                categoryName = normalizeLanguage(task.template.language),
                sourceTaskTemplateId = task.template.id,
                mandatory = task.mandatory,
            ).apply { this.room = room }
        }.toMutableList()
        initializeCurrentStepSnapshot(room)
        val saved = roomRepository.saveAndFlush(room)
        saveAssignments(saved, assignments, now)
        grantOwnerRoomAccess(saved, actor, now)
        roomHrTrackingService.assignHiringManagersOnRoomCreation(saved, assignments.filter { it.user.id in assignmentRequest.hiringManagerIds }.map { it.user })
        receiptRepository.saveAndFlush(
            CommandReceipt(
                id = receiptId,
                requestHash = requestHash,
                outcome = "created",
                status = 201,
                resourceId = requireNotNull(saved.id),
                createdAt = now,
                expiresAt = now.plus(24, ChronoUnit.HOURS),
            ),
        )
        roomProductMetricsProjector.recordRoomCreated(saved, RoomProductMetricsProjector.SOURCE_TEAM)
        collaborationService.bootstrapRoom(saved)
        return response(saved)
    }

    @Transactional
    fun details(actor: User, teamId: String, interviewId: String): TeamInterviewDetailsDto =
        detailsDto(requireDetailsRoom(actor, teamId, interviewId))

    @Transactional
    fun updateDetails(actor: User, teamId: String, interviewId: String, request: TeamInterviewDetailsUpdateRequest): TeamInterviewDetailsDto {
        if (request.revision < 0) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная ревизия метаданных")
        val room = requireDetailsRoom(actor, teamId, interviewId)
        if (room.interviewMetadataRevision != request.revision) {
            throw ApiException(HttpStatus.CONFLICT, "Сведения уже изменены другим менеджером")
        }
        val title = canonicalTitle(request.title)
        val candidateName = canonicalMetadataText(request.candidateName, "Имя кандидата")
        val position = canonicalMetadataText(request.position, "Позиция")
        val scheduledAt = canonicalScheduledAt(request.scheduledAt)
        room.title = title
        room.candidateName = candidateName
        room.position = position
        room.scheduledAt = scheduledAt
        room.interviewMetadataRevision += 1
        roomRepository.saveAndFlush(room)
        return detailsDto(room)
    }

    @Transactional
    fun rename(actor: User, teamId: String, interviewId: String, request: TeamInterviewRenameRequest): TeamInterviewResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        val room = lockTeamRoom(access.team.id, interviewId)
        if (!access.isManager && room.ownerUser?.id != access.actorId) throw interviewRenameForbidden()
        val title = canonicalTitle(request.title)
        if (room.title != title) {
            room.title = title
            room.interviewMetadataRevision += 1
            roomRepository.saveAndFlush(room)
        }
        return response(room)
    }

    @Transactional
    fun createOwnerOffer(
        actor: User,
        teamId: String,
        interviewId: String,
        request: TeamInterviewOwnerOfferCreateRequest,
        key: UUID,
    ): TeamInterviewOwnerOfferResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        if (!access.isManager) throw ownerOfferForbidden()
        val targetUserId = requiredId(request.targetUserId, "TEAM_MEMBER_NOT_FOUND")
        val requestHash = ownerOfferRequestHash(interviewId, targetUserId)
        val receiptId = CommandReceiptId(
            actorUserId = access.actorId,
            scopeKind = SCOPE_TEAM,
            scopeId = access.team.id,
            operation = TEAM_INTERVIEW_OWNER_OFFER_CREATE,
            idempotencyKey = key.toString(),
        )

        receiptRepository.findById(receiptId).orElse(null)?.let { receipt ->
            requireActiveReceipt(receipt)
            requireMatchingReceipt(receipt, requestHash)
            val offer = ownerOfferRepository.findByIdAndTeamIdAndRoomId(receipt.resourceId, access.team.id, interviewId)
                ?: throw commandNotFound()
            return TeamInterviewOwnerOfferResponse(ownerOfferDto(offer))
        }

        val room = lockTeamRoom(access.team.id, interviewId)
        requireNotFinishedResult(room)
        val ownership = ownershipSnapshot(access.team.id, room)
        if (ownership.state == OWNERSHIP_ACTIVE) throw ownerOfferRoomActive()
        activeMemberTarget(access.team.id, targetUserId)
        val now = now()
        ownerOfferRepository.expirePendingForRoom(access.team.id, interviewId, now)
        if (ownerOfferRepository.findActivePendingByTeamIdAndRoomId(access.team.id, interviewId, now).isNotEmpty()) {
            throw ownerOfferAlreadyPending()
        }

        val offer = ownerOfferRepository.saveAndFlush(
            TeamInterviewOwnerOffer(
                id = UUID.randomUUID().toString(),
                teamId = access.team.id,
                roomId = interviewId,
                fromUserId = access.actorId,
                toUserId = targetUserId,
                status = OWNER_OFFER_PENDING,
                createdAt = now,
                expiresAt = now.plus(24, ChronoUnit.HOURS),
            ),
        )
        receiptRepository.saveAndFlush(
            CommandReceipt(
                id = receiptId,
                requestHash = requestHash,
                outcome = OWNER_OFFER_CREATED,
                status = 201,
                resourceId = offer.id,
                createdAt = now,
                expiresAt = now.plus(24, ChronoUnit.HOURS),
            ),
        )
        teamAuditWriter.append(
            access.actorId,
            access.team.id,
            TeamAuditAction.TEAM_INTERVIEW_OWNER_OFFER_CREATED,
            now,
            targetUserId = targetUserId,
            opaqueEntityId = interviewId,
        )
        return TeamInterviewOwnerOfferResponse(ownerOfferDto(offer))
    }

    @Transactional
    fun acceptOwnerOffer(actor: User, teamId: String, interviewId: String, offerId: String): TeamInterviewOwnerOfferResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        val room = lockTeamRoom(access.team.id, interviewId)
        val offer = ownerOfferRepository.lockById(offerId)
            ?.takeIf { it.teamId == access.team.id && it.roomId == interviewId }
            ?: throw ownerOfferNotFound()
        if (offer.toUserId != access.actorId) throw ownerOfferForbidden()
        if (offer.status != OWNER_OFFER_PENDING) throw ownerOfferNotPending()
        val now = now()
        if (!offer.expiresAt.isAfter(now)) {
            offer.status = OWNER_OFFER_EXPIRED
            offer.respondedAt = now
            ownerOfferRepository.saveAndFlush(offer)
            throw ownerOfferExpired()
        }
        val targetUser = userRepository.findById(access.actorId).orElse(null) ?: throw ownerOfferNotFound()
        room.ownerUser = targetUser
        room.interviewMetadataRevision += 1
        grantOwnerRoomAccess(room, targetUser, now)
        roomRepository.saveAndFlush(room)
        offer.status = OWNER_OFFER_ACCEPTED
        offer.respondedAt = now
        val saved = ownerOfferRepository.saveAndFlush(offer)
        teamAuditWriter.append(
            access.actorId,
            access.team.id,
            TeamAuditAction.TEAM_INTERVIEW_OWNER_OFFER_ACCEPTED,
            now,
            targetUserId = access.actorId,
            opaqueEntityId = interviewId,
        )
        return TeamInterviewOwnerOfferResponse(ownerOfferDto(saved))
    }

    @Transactional
    fun declineOwnerOffer(actor: User, teamId: String, interviewId: String, offerId: String): TeamInterviewOwnerOfferResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        lockTeamRoom(access.team.id, interviewId)
        val offer = ownerOfferRepository.lockById(offerId)
            ?.takeIf { it.teamId == access.team.id && it.roomId == interviewId }
            ?: throw ownerOfferNotFound()
        if (offer.toUserId != access.actorId) throw ownerOfferForbidden()
        if (offer.status != OWNER_OFFER_PENDING) throw ownerOfferNotPending()
        val now = now()
        if (!offer.expiresAt.isAfter(now)) {
            offer.status = OWNER_OFFER_EXPIRED
            offer.respondedAt = now
            ownerOfferRepository.saveAndFlush(offer)
            throw ownerOfferExpired()
        }
        offer.status = OWNER_OFFER_DECLINED
        offer.respondedAt = now
        val saved = ownerOfferRepository.saveAndFlush(offer)
        teamAuditWriter.append(
            access.actorId,
            access.team.id,
            TeamAuditAction.TEAM_INTERVIEW_OWNER_OFFER_DECLINED,
            now,
            targetUserId = access.actorId,
            opaqueEntityId = interviewId,
        )
        return TeamInterviewOwnerOfferResponse(ownerOfferDto(saved))
    }

    @Transactional
    fun archive(actor: User, teamId: String, interviewId: String): TeamInterviewResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        if (!access.isManager) throw interviewArchiveForbidden()
        val room = lockTeamRoom(access.team.id, interviewId)
        requireNotFinishedResult(room)
        val ownership = ownershipSnapshot(access.team.id, room)
        if (ownership.state == OWNERSHIP_ACTIVE) throw ownerOfferRoomActive()
        val now = now()
        ownerOfferRepository.cancelPendingForRoom(access.team.id, interviewId, now)
        room.archivedAt = now
        room.interviewMetadataRevision += 1
        val saved = roomRepository.saveAndFlush(room)
        teamAuditWriter.append(
            access.actorId,
            access.team.id,
            TeamAuditAction.TEAM_INTERVIEW_ARCHIVED,
            now,
            targetUserId = room.ownerUser?.id,
            opaqueEntityId = interviewId,
        )
        val inviteCode = saved.inviteCode
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() = collaborationService.closeRoom(inviteCode)
        })
        return response(saved)
    }

    @Transactional
    fun delete(actor: User, teamId: String, interviewId: String) {
        val access = requireActiveMemberForMutation(actor, teamId)
        if (!access.isManager) throw interviewArchiveForbidden()
        val room = lockTeamRoom(access.team.id, interviewId)
        val inviteCode = room.inviteCode
        jdbcTemplate.update("DELETE FROM team_interview_owner_offers WHERE room_id = ?", interviewId)
        jdbcTemplate.update("DELETE FROM room_keystroke_events WHERE room_id = ?", interviewId)
        roomParticipantRepository.deleteAllByRoomId(interviewId)
        roomParticipantRepository.flush()
        roomProductMetricsProjector.deleteProjection(interviewId)
        roomRepository.delete(room)
        roomRepository.flush()
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() = collaborationService.closeRoom(inviteCode)
        })
    }

    @Transactional
    fun freeze(actor: User, teamId: String, interviewId: String): TeamInterviewResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        if (!access.isManager) throw interviewFreezeForbidden()
        val room = lockTeamRoom(access.team.id, interviewId)
        requireNotFinishedResult(room)
        val ownership = ownershipSnapshot(access.team.id, room)
        if (ownership.state == OWNERSHIP_ACTIVE) throw ownerOfferRoomActive()
        val now = now()
        if (room.status != ROOM_STATUS_FROZEN) {
            room.status = ROOM_STATUS_FROZEN
            room.interviewMetadataRevision += 1
            roomRepository.saveAndFlush(room)
            teamAuditWriter.append(
                access.actorId,
                access.team.id,
                TeamAuditAction.TEAM_INTERVIEW_FROZEN,
                now,
                targetUserId = room.ownerUser?.id,
                opaqueEntityId = interviewId,
            )
        }
        val inviteCode = room.inviteCode
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() = collaborationService.closeRoom(inviteCode)
        })
        return response(room)
    }

    @Transactional
    fun resume(actor: User, teamId: String, interviewId: String): TeamInterviewResponse {
        val access = requireActiveMemberForMutation(actor, teamId)
        val room = lockTeamRoom(access.team.id, interviewId)
        val ownerId = room.ownerUser?.id
        if (!access.isManager && ownerId != access.actorId) throw interviewResumeForbidden()
        requireNotFinishedResult(room)
        if (room.status != ROOM_STATUS_FROZEN) throw interviewNotFrozen()
        val now = now()
        room.status = ROOM_STATUS_ACTIVE
        room.interviewMetadataRevision += 1
        val saved = roomRepository.saveAndFlush(room)
        teamAuditWriter.append(
            access.actorId,
            access.team.id,
            TeamAuditAction.TEAM_INTERVIEW_RESUMED,
            now,
            targetUserId = ownerId,
            opaqueEntityId = interviewId,
        )
        val inviteCode = saved.inviteCode
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() = collaborationService.closeRoom(inviteCode)
        })
        return response(saved)
    }

    private fun requireActiveMemberForMutation(actor: User, teamId: String): TeamAccess {
        featureGate.requireEnabled()
        // Membership changes take the team lock before touching room grants.
        // Holding that same lock keeps authority valid across a room-row wait.
        teamRepository.lockById(teamId)?.also { entityManager.refresh(it) }?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        return requireActiveMember(actor, teamId)
    }

    private fun requireActiveMember(actor: User, teamId: String): TeamAccess {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(teamId).orElse(null)?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        return TeamAccess(
            actorId = actorId,
            team = team,
            membership = membership,
            role = if (team.ownerUserId == membership.userId) OWNER else membership.role,
        )
    }

    private fun lockTeamRoom(teamId: String, interviewId: String, includeArchived: Boolean = false): Room =
        roomRepository.lockById(interviewId)
            ?.also { entityManager.refresh(it) }
            ?.takeIf { it.teamId == teamId && teamRoomLineageService.isCanonical(it) && (includeArchived || it.archivedAt == null) }
            ?: throw teamInterviewNotFound()

    private fun requireDetailsRoom(actor: User, teamId: String, interviewId: String): Room {
        val access = requireActiveMemberForMutation(actor, teamId)
        val room = lockTeamRoom(access.team.id, interviewId, includeArchived = true)
        entityManager.refresh(access.membership)
        if (access.membership.state != ACTIVE) throw teamNotFound()
        if (room.archivedAt != null) throw ApiException(HttpStatus.GONE, "Комната архивирована")
        return room
    }

    private fun detailsDto(room: Room) = TeamInterviewDetailsDto(
        title = room.title,
        candidateName = room.candidateName,
        position = room.position,
        scheduledAt = room.scheduledAt?.toString(),
        revision = room.interviewMetadataRevision,
    )

    private fun activeMemberTarget(teamId: String, userId: String): TeamMembership =
        membershipRepository.lockByTeamIdAndUserId(teamId, userId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamMemberNotFound()

    private fun orderedActiveTasks(taskSet: TeamTaskSet): List<TeamTaskTemplate> {
        val tasks = taskSet.items.sortedBy { it.position }.map { item ->
            val task = requireNotNull(item.taskTemplate)
            if (task.status != ACTIVE) throw taskNotFound()
            task
        }
        if (tasks.isEmpty()) throw taskSetNotFound()
        return tasks
    }

    private fun resolveTrack(teamId: String, trackId: String?): TeamTrack? {
        if (trackId == null) return null
        return trackRepository.findByIdAndTeamId(trackId, teamId)
            ?.takeIf { it.status == ACTIVE }
            ?: throw trackNotFound()
    }

    private fun resolveVacancy(teamId: String, track: TeamTrack?, vacancyId: String?): TeamVacancy? {
        if (vacancyId == null) return null
        val activeTrack = track ?: throw vacancyNotFound()
        return vacancyRepository.findByIdAndTeamIdAndTrackId(vacancyId, teamId, activeTrack.id)
            ?.takeIf { it.status == ACTIVE }
            ?: throw vacancyNotFound()
    }

    private fun resolvedCreatableProgramme(teamId: String, track: TeamTrack?, vacancy: TeamVacancy?): TeamInterviewProgramme? {
        if (vacancy != null) {
            val vacancyProgramme = programmeRepository.findByTeamAndTargetWithItems(teamId, PROGRAMME_TARGET_VACANCY, vacancy.id)
            if (vacancyProgramme != null) {
                if (vacancyProgramme.status == PROGRAMME_ARCHIVED) throw programmeArchived()
                if (vacancyProgramme.status != "PUBLISHED") throw programmeDraft()
                return vacancyProgramme
            }
        }
        if (track == null) return null
        val programme = programmeRepository.findByTeamAndTargetWithItems(teamId, PROGRAMME_TARGET_TRACK, track.id) ?: return null
        if (programme.status == PROGRAMME_ARCHIVED) throw programmeArchived()
        if (programme.status != "PUBLISHED") throw programmeDraft()
        return programme
    }

    private fun interviewTasks(
        programme: TeamInterviewProgramme?,
        selectedTasks: List<TeamTaskTemplate>,
        explicitSelection: List<String>?,
    ): List<InterviewTaskSnapshot> {
        val mandatoryTasks = programme
            ?.items
            ?.sortedBy { it.position }
            ?.map { item ->
                val task = requireNotNull(item.taskTemplate)
                if (task.status != ACTIVE) throw taskNotFound()
                InterviewTaskSnapshot(task, mandatory = item.mandatory)
            }
            .orEmpty()
        val mandatoryTaskIds = mandatoryTasks.map { it.template.id }.toSet()
        if (explicitSelection != null) {
            val taskById = (mandatoryTasks.map { it.template } + selectedTasks).associateBy { it.id }
            return explicitSelection.mapNotNull { taskById[it] }.map { task ->
                InterviewTaskSnapshot(task, mandatory = task.id in mandatoryTaskIds)
            }
        }
        return mandatoryTasks + selectedTasks
            .filter { task -> task.id !in mandatoryTaskIds }
            .map { task -> InterviewTaskSnapshot(task, mandatory = false) }
    }

    private fun initializeCurrentStepSnapshot(room: Room) {
        val firstTask = room.tasks.firstOrNull()
        if (firstTask == null) {
            room.code = ""
            room.language = "nodejs"
            room.briefingMarkdown = ""
            room.notes = ""
            return
        }
        firstTask.solutionCode = firstTask.starterCode
        firstTask.solutionLanguage = firstTask.language
        room.code = firstTask.starterCode
        room.language = normalizeLanguage(firstTask.language)
        room.briefingMarkdown = firstTask.description
        room.notes = ""
    }

    private fun response(room: Room): TeamInterviewResponse {
        val roomId = requireNotNull(room.id)
        return TeamInterviewResponse(
            TeamInterviewDto(
            id = roomId,
            title = room.title,
            inviteCode = room.inviteCode,
            teamId = requireNotNull(room.teamId),
            status = roomStatus(room),
            trackId = room.teamTrackId,
            vacancyId = room.teamVacancyId,
            taskSetId = room.teamTaskSetId,
            taskSetRevision = room.teamTaskSetRevision,
            programmeId = room.teamInterviewProgrammeId,
            programmeOrigin = room.teamInterviewProgrammeOrigin,
            programmeVersion = room.teamInterviewProgrammeVersion,
            tasks = room.tasks.sortedBy { it.stepIndex }.map { task ->
                TeamInterviewTaskDto(
                    stepIndex = task.stepIndex,
                    title = task.title,
                    description = task.description,
                    starterCode = task.starterCode,
                    language = normalizeLanguage(task.language),
                    sourceTaskTemplateId = task.sourceTaskTemplateId.orEmpty(),
                    mandatory = task.mandatory,
                )
            },
            assignees = assigneesForRoom(roomId),
        ),
        )
    }

    private fun listItem(
        room: Room,
        ownership: OwnershipSnapshot,
        track: TeamTrack?,
        vacancy: TeamVacancy?,
        assignees: List<TeamInterviewAssigneeDto>,
    ): TeamInterviewListItemDto {
        val tasks = room.tasks.sortedBy { it.stepIndex }
        return TeamInterviewListItemDto(
            id = requireNotNull(room.id),
            title = room.title,
            inviteCode = room.inviteCode,
            teamId = requireNotNull(room.teamId),
            status = roomStatus(room),
            ownerUserId = ownership.ownerUserId,
            createdByUserId = room.createdByUserId,
            ownerDisplayName = ownership.ownerDisplayName,
            ownershipState = ownership.state,
            trackId = room.teamTrackId,
            trackName = track?.name,
            vacancyId = room.teamVacancyId,
            vacancyTitle = vacancy?.title,
            taskSetId = room.teamTaskSetId,
            taskSetRevision = room.teamTaskSetRevision,
            programmeId = room.teamInterviewProgrammeId,
            programmeOrigin = room.teamInterviewProgrammeOrigin,
            programmeVersion = room.teamInterviewProgrammeVersion,
            taskCount = tasks.size,
            createdAt = room.createdAt,
            finishedAt = room.finishedAt,
            verdict = room.verdict,
            verdictComment = room.verdictComment,
            tasks = tasks.map { task ->
                TeamInterviewListTaskDto(
                    stepIndex = task.stepIndex,
                    title = task.title,
                    language = normalizeLanguage(task.language),
                    mandatory = task.mandatory,
                )
            },
            taskScores = tasks.map { task ->
                TeamInterviewTaskScoreDto(
                    stepIndex = task.stepIndex,
                    title = task.title,
                    score = task.score,
                )
            },
            assignees = assignees,
        )
    }

    private fun ownershipSnapshot(teamId: String, room: Room): OwnershipSnapshot {
        val owner = room.ownerUser ?: return OwnershipSnapshot(null, null, OWNER_MISSING)
        val ownerId = owner.id ?: return OwnershipSnapshot(null, null, OWNER_MISSING)
        val membership = membershipRepository.findByTeamIdAndUserId(teamId, ownerId)
        val state = when (membership?.state) {
            ACTIVE -> OWNERSHIP_ACTIVE
            SUSPENDED -> OWNER_SUSPENDED
            LEFT -> OWNER_LEFT
            REMOVED -> OWNER_REMOVED
            else -> OWNER_MISSING
        }
        return OwnershipSnapshot(ownerId, displayName(owner), state)
    }

    private fun canonicalAssignmentRequest(request: TeamInterviewCreateRequest): AssignmentRequest {
        val hiringManagerIds = canonicalIds(request.hiringManagerIds.map { raw ->
            val id = raw.trim()
            val parsed = runCatching { UUID.fromString(id).toString() }.getOrNull()
            if (parsed == null || !parsed.equals(id, ignoreCase = true)) throw teamMemberNotFound()
            parsed
        })
        val interviewerIds = canonicalIds(request.interviewerIds)
        val candidateIds = canonicalIds(request.candidateIds)
        val intersection = (interviewerIds + hiringManagerIds).toSet().intersect(candidateIds.toSet())
        if (intersection.isNotEmpty()) {
            throw secure(HttpStatus.BAD_REQUEST, "TEAM_ASSIGNEE_ROLE_CONFLICT", "Сотрудник не может быть выбран в двух ролях интервью")
        }
        return AssignmentRequest(interviewerIds, candidateIds, hiringManagerIds)
    }

    private fun canonicalIds(values: List<String>): List<String> {
        val seen = linkedSetOf<String>()
        values.forEach { raw ->
            val id = raw.trim()
            if (id.isBlank()) throw teamMemberNotFound()
            seen += id
        }
        return seen.toList()
    }

    private fun resolveAssignments(teamId: String, request: AssignmentRequest, actorId: String): List<ResolvedAssignment> {
        val employeeIds = request.interviewerIds + request.candidateIds
        val requestedIds = employeeIds + request.hiringManagerIds
        if (requestedIds.isEmpty()) return emptyList()
        val activeMemberships = membershipRepository.findByTeamIdAndState(teamId, ACTIVE).associateBy { it.userId }
        employeeIds.forEach { userId ->
            if (!activeMemberships.containsKey(userId)) throw teamMemberNotFound()
        }
        val usersById = (requestedIds + actorId).distinct().sorted().mapNotNull { id -> userRepository.lockById(id)?.also { entityManager.refresh(it) } }.associateBy { requireNotNull(it.id) }
        requestedIds.forEach { userId ->
            if (!usersById.containsKey(userId)) throw teamMemberNotFound()
        }
        request.hiringManagerIds.forEach { userId ->
            val membership = membershipRepository.findByTeamIdAndUserId(teamId, userId)
            if (usersById[userId]?.isHr != true ||
                (membership != null && membership.state !in setOf(LEFT, REMOVED))
            ) throw teamMemberNotFound()
        }
        return (request.interviewerIds + request.hiringManagerIds).distinct().map { userId ->
            ResolvedAssignment(requireNotNull(usersById[userId]), INTERVIEWER)
        } + request.candidateIds.map { userId ->
            ResolvedAssignment(requireNotNull(usersById[userId]), CANDIDATE)
        }
    }

    private fun saveAssignments(room: Room, assignments: List<ResolvedAssignment>, now: Instant) {
        if (assignments.isEmpty()) return
        roomParticipantRepository.saveAllAndFlush(
            assignments.map { assignment ->
                RoomParticipant(
                    room = room,
                    user = assignment.user,
                    role = assignment.role,
                    createdAt = now,
                )
            },
        )
    }

    private fun grantOwnerRoomAccess(room: Room, owner: User, now: Instant) {
        val roomId = requireNotNull(room.id)
        val ownerId = requireNotNull(owner.id)
        val existing = roomParticipantRepository.findByRoomIdAndUserId(roomId, ownerId)
        if (existing == null) {
            roomParticipantRepository.saveAndFlush(
                RoomParticipant(
                    room = room,
                    user = owner,
                    role = RoomAccessService.RoomRole.OWNER.wireValue,
                    createdAt = now,
                ),
            )
        } else if (existing.role != RoomAccessService.RoomRole.OWNER.wireValue) {
            existing.role = RoomAccessService.RoomRole.OWNER.wireValue
            roomParticipantRepository.saveAndFlush(existing)
        }
    }

    private fun assigneesByRoomId(roomIds: Set<String>): Map<String, List<TeamInterviewAssigneeDto>> =
        if (roomIds.isEmpty()) {
            emptyMap()
        } else {
            roomParticipantRepository.findAllByRoomIdIn(roomIds)
                .groupBy { requireNotNull(it.room?.id) }
                .mapValues { (_, participants) -> assigneeDtos(participants) }
        }

    private fun assigneesForRoom(roomId: String): List<TeamInterviewAssigneeDto> =
        assigneeDtos(roomParticipantRepository.findAllByRoomIdOrderByCreatedAtAsc(roomId))

    private fun assigneeDtos(participants: List<RoomParticipant>): List<TeamInterviewAssigneeDto> =
        participants
            .mapNotNull { participant ->
                val user = participant.user ?: return@mapNotNull null
                val userId = user.id ?: return@mapNotNull null
                TeamInterviewAssigneeDto(
                    userId = userId,
                    displayName = displayName(user),
                    role = normalizeAssignmentRole(participant.role),
                )
            }
            .sortedWith(compareBy<TeamInterviewAssigneeDto> { roleRank(it.role) }.thenBy { normalized(it.displayName) }.thenBy { it.userId })

    private fun normalizeAssignmentRole(role: String): String =
        when (role.trim().lowercase(Locale.ROOT)) {
            OWNER_ROOM_ROLE -> OWNER_ROOM_ROLE
            INTERVIEWER -> INTERVIEWER
            else -> CANDIDATE
        }

    private fun roleRank(role: String): Int = when (role) {
        OWNER_ROOM_ROLE -> 0
        INTERVIEWER -> 1
        else -> 2
    }

    private fun ownerOfferDto(offer: TeamInterviewOwnerOffer): TeamInterviewOwnerOfferDto =
        TeamInterviewOwnerOfferDto(
            id = offer.id,
            teamId = offer.teamId,
            interviewId = offer.roomId,
            fromUserId = offer.fromUserId,
            toUserId = offer.toUserId,
            status = offer.status,
            createdAt = offer.createdAt,
            expiresAt = offer.expiresAt,
            respondedAt = offer.respondedAt,
        )

    private fun displayName(user: User): String = user.displayName
        ?.trim { it.isWhitespace() }
        ?.takeIf { it.isNotEmpty() }
        ?: "Участник"

    private fun tracksById(teamId: String, ids: Set<String>): Map<String, TeamTrack> =
        if (ids.isEmpty()) emptyMap() else trackRepository.findByTeamIdAndIdIn(teamId, ids).associateBy { it.id }

    private fun vacanciesById(teamId: String, ids: Set<String>): Map<String, TeamVacancy> =
        if (ids.isEmpty()) emptyMap() else vacancyRepository.findByTeamIdAndIdIn(teamId, ids).associateBy { it.id }

    private fun matchesQuery(room: Room, query: String?, track: TeamTrack?, vacancy: TeamVacancy?, canReadMetadata: Boolean): Boolean {
        if (query == null) return true
        val taskMatches = room.tasks.any { task -> normalized(task.title).contains(query) || normalized(task.language).contains(query) }
        return (canReadMetadata && normalized(room.candidateName.orEmpty()).contains(query)) || normalized(room.title).contains(query) ||
            normalized(track?.name.orEmpty()).contains(query) ||
            normalized(vacancy?.title.orEmpty()).contains(query) ||
            taskMatches
    }

    private fun canonicalTitle(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..MAX_TITLE_CODE_POINTS) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_INTERVIEW_TITLE", "Название интервью должно содержать от 1 до $MAX_TITLE_CODE_POINTS символов")
        }
        return value
    }

    private fun canonicalMetadataText(raw: String?, label: String): String? {
        val value = raw?.trim()?.ifBlank { null } ?: return null
        if (value.codePointCount(0, value.length) > 200) {
            throw ApiException(HttpStatus.BAD_REQUEST, "$label не может быть длиннее 200 символов")
        }
        return value
    }

    private fun canonicalScheduledAt(raw: String?): Instant? {
        val value = raw?.trim()?.ifBlank { null } ?: return null
        return try {
            OffsetDateTime.parse(value).toInstant()
        } catch (_: DateTimeParseException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "Запланированное время должно содержать часовой пояс")
        }
    }

    private fun optionalId(raw: String?): String? = raw?.trim()?.takeIf { it.isNotBlank() }

    private fun requiredId(raw: String, code: String): String = optionalId(raw)
        ?: throw secure(HttpStatus.NOT_FOUND, code, "Ресурс не найден")

    private fun normalizedQuery(value: String?): String? = value
        ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() } }
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)

    private fun listQuery(rawQuery: String?, rawOwnership: String?): TeamInterviewListQuery {
        val ownership = rawOwnership
            ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() }.lowercase(Locale.ROOT) }
            ?.takeIf { it.isNotEmpty() }
            ?: OWNERSHIP_ALL
        if (ownership !in PUBLIC_OWNERSHIP_FILTERS) throw invalidInterviewQuery()
        return TeamInterviewListQuery(normalizedQuery(rawQuery), ownership)
    }

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim { it.isWhitespace() }
        .lowercase(Locale.ROOT)

    private fun roomStatus(room: Room): String = room.status?.takeIf { it.isNotBlank() } ?: ROOM_STATUS_ACTIVE

    private fun requestHash(
        title: String,
        taskSetId: String?,
        taskIds: List<String>,
        explicitSelectedTaskIds: List<String>?,
        trackId: String?,
        vacancyId: String?,
        programmeId: String?,
        programmeVersion: Long?,
        assignments: AssignmentRequest,
        candidateName: String?,
        position: String?,
        scheduledAt: Instant?,
    ): String {
        val canonical = listOf(
            if (explicitSelectedTaskIds == null) "team-interview-create:v1" else "team-interview-create:v2",
            "title=$title",
            "taskSetId=$taskSetId",
            "trackId=${trackId.orEmpty()}",
            "vacancyId=${vacancyId.orEmpty()}",
            "programmeId=${programmeId.orEmpty()}",
            "programmeVersion=${programmeVersion ?: ""}",
            "interviewerIds=${assignments.interviewerIds.sorted().joinToString(",")}",
            "candidateIds=${assignments.candidateIds.sorted().joinToString(",")}",
        ).let { baseParts ->
            val parts = if (assignments.hiringManagerIds.isEmpty()) baseParts else baseParts + "hiringManagerIds=${assignments.hiringManagerIds.sorted().joinToString(",")}"
            when {
                explicitSelectedTaskIds != null -> parts + "taskSelectionMode=explicit" + "selectedTaskIds=${explicitSelectedTaskIds.joinToString(",")}"
                taskIds.isNotEmpty() -> parts + "taskIds=${taskIds.joinToString(",")}"
                else -> parts
            }
        }.let { parts ->
            // Omit empty metadata so receipts made by legacy clients remain valid.
            // Length prefixes prevent user text containing newlines from joining fields.
            parts + listOfNotNull(
                candidateName?.let { "candidateName=${it.length}:$it" },
                position?.let { "position=${it.length}:$it" },
                scheduledAt?.let { "scheduledAt=$it" },
            )
        }.joinToString("\n")
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8))
        return "v1:" + digest.joinToString("") { "%02x".format(it) }
    }

    private fun ownerOfferRequestHash(interviewId: String, targetUserId: String): String {
        val canonical = "team-interview-owner-offer-create:v1\ninterviewId=$interviewId\ntargetUserId=$targetUserId"
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8))
        return "v1:" + digest.joinToString("") { "%02x".format(it) }
    }

    private fun requireActiveReceipt(receipt: CommandReceipt) {
        if (!receipt.expiresAt.isAfter(Instant.now())) throw commandNotFound()
    }

    private fun requireMatchingReceipt(receipt: CommandReceipt, requestHash: String) {
        if (receipt.requestHash != requestHash) {
            throw secure(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "Ключ уже использован для другого командного интервью")
        }
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    private fun Room.isFinishedResult(): Boolean =
        status == ROOM_STATUS_FINISHED || finishedAt != null || verdict != null

    private fun requireNotFinishedResult(room: Room) {
        if (room.isFinishedResult()) throw interviewFinished()
    }

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun commandNotFound() = secure(HttpStatus.NOT_FOUND, "COMMAND_NOT_FOUND", "Команда не найдена")
    private fun teamInterviewNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_INTERVIEW_NOT_FOUND", "Интервью не найдено")
    private fun interviewRenameForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_RENAME_FORBIDDEN", "Недостаточно прав для переименования интервью")
    private fun taskSetNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_SET_NOT_FOUND", "Набор задач не найден")
    private fun taskNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_TASK_NOT_FOUND", "Задача не найдена")
    private fun trackNotFound() = secure(HttpStatus.NOT_FOUND, "TRACK_NOT_FOUND", "Трек не найден")
    private fun vacancyNotFound() = secure(HttpStatus.NOT_FOUND, "VACANCY_NOT_FOUND", "Вакансия не найдена")
    private fun programmeArchived() = secure(HttpStatus.CONFLICT, "TEAM_PROGRAMME_ARCHIVED", "Программа интервью архивирована")
    private fun programmeDraft() = secure(HttpStatus.CONFLICT, "TEAM_PROGRAMME_NOT_PUBLISHED", "Программу интервью нужно опубликовать")
    private fun programmeVersionConflict(currentVersion: Long?) = ApiException(
        HttpStatus.CONFLICT,
        "Программа интервью изменилась; проверьте её перед созданием",
        code = "TEAM_PROGRAMME_VERSION_CONFLICT",
        currentRevision = currentVersion,
    )
    private fun teamMemberNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_MEMBER_NOT_FOUND", "Сотрудник команды не найден")
    private fun invalidInterviewQuery() = secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_INTERVIEW_QUERY", "Некорректные параметры списка интервью")
    private fun interviewQueueForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_QUEUE_FORBIDDEN", "Недостаточно прав для просмотра очереди интервью")
    private fun interviewArchiveForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_ARCHIVE_FORBIDDEN", "Недостаточно прав для архивации интервью")
    private fun interviewFreezeForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_FREEZE_FORBIDDEN", "Недостаточно прав для заморозки интервью")
    private fun interviewResumeForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_RESUME_FORBIDDEN", "Недостаточно прав для возобновления интервью")
    private fun interviewNotFrozen() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_NOT_FROZEN", "Интервью не находится в замороженном состоянии")
    private fun interviewFinished() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_FINISHED", "Интервью уже завершено")
    private fun ownerOfferForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_INTERVIEW_OWNER_OFFER_FORBIDDEN", "Недостаточно прав для предложения владельца")
    private fun ownerOfferNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_INTERVIEW_OWNER_OFFER_NOT_FOUND", "Предложение владельца не найдено")
    private fun ownerOfferAlreadyPending() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_OWNER_OFFER_ALREADY_PENDING", "Для интервью уже есть ожидающее предложение")
    private fun ownerOfferRoomActive() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_OWNER_ACTIVE", "У интервью уже есть активный владелец")
    private fun ownerOfferNotPending() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_OWNER_OFFER_NOT_PENDING", "Предложение уже обработано")
    private fun ownerOfferExpired() = secure(HttpStatus.CONFLICT, "TEAM_INTERVIEW_OWNER_OFFER_EXPIRED", "Предложение владельца истекло")

    private data class TeamAccess(
        val actorId: String,
        val team: Team,
        val membership: TeamMembership,
        val role: String,
    ) {
        val isManager: Boolean
            get() = membership.state == ACTIVE
    }

    private data class TeamInterviewListQuery(
        val normalizedText: String?,
        val ownership: String,
    )

    private data class OwnershipSnapshot(
        val ownerUserId: String?,
        val ownerDisplayName: String?,
        val state: String,
    )

    private data class AssignmentRequest(
        val interviewerIds: List<String>,
        val candidateIds: List<String>,
        val hiringManagerIds: List<String>,
    )

    private data class ResolvedAssignment(
        val user: User,
        val role: String,
    )

    private data class InterviewTaskSnapshot(
        val template: TeamTaskTemplate,
        val mandatory: Boolean,
    )

    private companion object {
        const val SCOPE_TEAM = "TEAM"
        const val TEAM_INTERVIEW_CREATE = "TEAM_INTERVIEW_CREATE"
        const val TEAM_INTERVIEW_OWNER_OFFER_CREATE = "TEAM_INTERVIEW_OWNER_OFFER_CREATE"
        const val ACTIVE = "ACTIVE"
        const val PROGRAMME_ARCHIVED = "ARCHIVED"
        const val PROGRAMME_TARGET_TRACK = "TRACK"
        const val PROGRAMME_TARGET_VACANCY = "VACANCY"
        const val SUSPENDED = "SUSPENDED"
        const val LEFT = "LEFT"
        const val REMOVED = "REMOVED"
        const val OWNER = "OWNER"
        const val ADMIN = "ADMIN"
        const val OWNERSHIP_ALL = "all"
        const val OWNERSHIP_ORPHANED = "orphaned"
        const val OWNERSHIP_ACTIVE = "ACTIVE"
        const val OWNER_SUSPENDED = "OWNER_SUSPENDED"
        const val OWNER_LEFT = "OWNER_LEFT"
        const val OWNER_REMOVED = "OWNER_REMOVED"
        const val OWNER_MISSING = "OWNER_MISSING"
        const val OWNER_OFFER_PENDING = "PENDING"
        const val OWNER_OFFER_ACCEPTED = "ACCEPTED"
        const val OWNER_OFFER_DECLINED = "DECLINED"
        const val OWNER_OFFER_EXPIRED = "EXPIRED"
        const val OWNER_OFFER_CANCELLED = "CANCELLED"
        const val OWNER_OFFER_CREATED = "OWNER_OFFER_CREATED"
        val ROOM_STATUS_ACTIVE = RoomStatus.ACTIVE.wireValue
        val ROOM_STATUS_FROZEN = RoomStatus.FROZEN.wireValue
        val ROOM_STATUS_FINISHED = RoomStatus.FINISHED.wireValue
        const val OWNER_ROOM_ROLE = "owner"
        const val INTERVIEWER = "interviewer"
        const val CANDIDATE = "candidate"
        const val MAX_TITLE_CODE_POINTS = 200
        val PUBLIC_OWNERSHIP_FILTERS = setOf(OWNERSHIP_ALL, OWNERSHIP_ORPHANED)
    }
}
