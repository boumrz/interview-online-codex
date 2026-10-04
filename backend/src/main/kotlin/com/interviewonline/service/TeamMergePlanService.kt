package com.interviewonline.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.interviewonline.dto.TeamMergePlanCreateRequest
import com.interviewonline.dto.TeamMergePlanDto
import com.interviewonline.dto.TeamMergePlanListDto
import com.interviewonline.dto.TeamMergePlanResponse
import com.interviewonline.dto.TeamMergeCommitResponse
import com.interviewonline.dto.TeamMergeRedirectDto
import com.interviewonline.dto.TeamMergeMemberPreviewDto
import com.interviewonline.dto.TeamMergeMaterialPreviewDto
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMergePlan
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.User
import com.interviewonline.repository.TeamMergePlanRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.lockById
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.security.MessageDigest
import java.sql.Timestamp
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import java.util.UUID

@Service
class TeamMergePlanService(
    private val teamRepository: TeamRepository,
    private val planRepository: TeamMergePlanRepository,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val commitGate: TeamMergeCommitFeatureGate,
    private val collaborationService: CollaborationService,
    private val teamAuditWriter: TeamAuditWriter,
) {
    @Transactional
    fun create(actor: User, sourceTeamId: String, request: TeamMergePlanCreateRequest): TeamMergePlanResponse {
        val actorId = requireNotNull(actor.id)
        val source = activeOwnedTeam(sourceTeamId, actorId)
        val targetId = request.targetTeamId.trim()
        if (targetId == source.id) throw invalidPlan()
        val target = teamRepository.findById(targetId).orElse(null)
            ?.takeIf { it.state == ACTIVE } ?: throw teamNotFound()
        val destinationId = request.destinationTeamId.trim()
        if (destinationId != source.id && destinationId != target.id) throw invalidPlan()
        val name = Normalizer.normalize(request.destinationName, Normalizer.Form.NFKC).trim()
        if (name.isBlank() || name.codePointCount(0, name.length) > 100) throw invalidPlan()
        validateRenames("team_tracks", request.trackRenames, source.id, target.id)
        validateRenames("team_task_sets", request.setRenames, source.id, target.id)
        request.adminPromotions.forEach { userId ->
            val count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM team_memberships WHERE user_id=? AND team_id IN (?, ?) AND state='ACTIVE'",
                Long::class.java, userId, source.id, target.id,
            ) ?: 0L
            if (count == 0L) throw invalidPlan()
        }
        val now = Instant.now()
        planRepository.findAllBySourceTeamIdOrTargetTeamIdOrderByCreatedAtDesc(source.id, source.id)
            .filter { it.targetTeamId == target.id && it.state != COMMITTED && it.state != STALE }
            .forEach { previous ->
                previous.state = STALE
                previous.updatedAt = now
                planRepository.save(previous)
            }
        val plan = TeamMergePlan(
            id = UUID.randomUUID().toString(),
            sourceTeamId = source.id,
            targetTeamId = target.id,
            destinationTeamId = destinationId,
            destinationName = name,
            sourceMergeRevision = source.mergeRevision,
            targetMergeRevision = target.mergeRevision,
            sourceSnapshotHash = snapshotHash(source.id),
            targetSnapshotHash = snapshotHash(target.id),
            trackRenamesJson = mapper.writeValueAsString(request.trackRenames),
            setRenamesJson = mapper.writeValueAsString(request.setRenames),
            adminPromotionsJson = mapper.writeValueAsString(request.adminPromotions.distinct()),
            createdAt = now,
            updatedAt = now,
        )
        planRepository.saveAndFlush(plan)
        return TeamMergePlanResponse(toDto(plan, actorId))
    }

    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String): TeamMergePlanListDto {
        val actorId = requireNotNull(actor.id)
        activeOwnedTeam(teamId, actorId)
        return TeamMergePlanListDto(
            planRepository.findAllBySourceTeamIdOrTargetTeamIdOrderByCreatedAtDesc(teamId, teamId)
                .map { toDto(it, actorId) },
        )
    }

    @Transactional(readOnly = true)
    fun detail(actor: User, teamId: String, planId: String): TeamMergePlanResponse {
        val actorId = requireNotNull(actor.id)
        val plan = requirePlanForOwner(teamId, planId, actorId)
        return TeamMergePlanResponse(toDto(plan, actorId))
    }

    @Transactional
    fun review(actor: User, teamId: String, planId: String): TeamMergePlanResponse {
        val actorId = requireNotNull(actor.id)
        val plan = requireLockedPlanForOwner(teamId, planId, actorId)
        if (plan.state == STALE || plan.state == COMMITTED) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_PLAN_STALE", "План больше не действует")
        if (plan.targetTeamId != teamId) throw ownerRequired()
        requireFresh(plan)
        if (plan.reviewedAt == null) {
            plan.reviewedAt = Instant.now()
            plan.state = REVIEWING
            plan.updatedAt = Instant.now()
            planRepository.saveAndFlush(plan)
        }
        return TeamMergePlanResponse(toDto(plan, actorId))
    }

    @Transactional
    fun approve(actor: User, teamId: String, planId: String): TeamMergePlanResponse {
        val actorId = requireNotNull(actor.id)
        val plan = requireLockedPlanForOwner(teamId, planId, actorId)
        if (plan.state == STALE || plan.state == COMMITTED) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_PLAN_STALE", "План больше не действует")
        requireFresh(plan)
        if (plan.reviewedAt == null) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_REVIEW_REQUIRED", "Сначала откройте план")
        if (collisions(plan).isNotEmpty()) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_COLLISIONS", "Разрешите конфликты названий")
        if (membershipConflicts(plan).isNotEmpty()) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_MEMBERSHIP_CONFLICT", "Разрешите конфликт участия")
        val now = Instant.now()
        if (teamId == plan.sourceTeamId && plan.sourceApprovedAt == null) plan.sourceApprovedAt = now
        if (teamId == plan.targetTeamId && plan.targetApprovedAt == null) plan.targetApprovedAt = now
        plan.state = if (plan.sourceApprovedAt != null && plan.targetApprovedAt != null) READY else REVIEWING
        plan.updatedAt = now
        planRepository.saveAndFlush(plan)
        return TeamMergePlanResponse(toDto(plan, actorId))
    }

    @Transactional
    fun commit(actor: User, destinationTeamId: String, planId: String, key: UUID): TeamMergeCommitResponse {
        commitGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        val initialPlan = planRepository.findById(planId).orElse(null)
            ?.takeIf { it.destinationTeamId == destinationTeamId } ?: throw planNotFound()
        val lockedTeams = listOf(initialPlan.sourceTeamId, initialPlan.targetTeamId).sorted()
            .associateWith { id -> teamRepository.lockById(id) ?: throw teamNotFound() }
        val plan = planRepository.lockById(planId) ?: throw planNotFound()
        if (plan.destinationTeamId != destinationTeamId) throw planNotFound()
        val destination = lockedTeams[destinationTeamId] ?: throw teamNotFound()
        if (destination.ownerUserId != actorId || destination.state != ACTIVE) throw teamNotFound()
        if (plan.state == COMMITTED) {
            if (plan.commitKey == key.toString() && plan.commitActorUserId == actorId) {
                return TeamMergeCommitResponse(plan.sourceTeamId, destinationTeamId, recovered = true)
            }
            throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_ALREADY_COMMITTED", "Объединение уже завершено")
        }
        if (plan.state != READY || plan.sourceApprovedAt == null || plan.targetApprovedAt == null) {
            throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_NOT_APPROVED", "Нужны согласия обоих владельцев")
        }
        requireFresh(plan)
        if (collisions(plan).isNotEmpty()) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_COLLISIONS", "Разрешите конфликты названий")
        if (membershipConflicts(plan).isNotEmpty()) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_MEMBERSHIP_CONFLICT", "Разрешите конфликт участия")
        val roomCodes = jdbc.queryForList(
            "SELECT invite_code FROM rooms WHERE team_id IN (?, ?)",
            String::class.java, plan.sourceTeamId, plan.targetTeamId,
        )
        // SSE admission locks the room row. Hold those locks through commit so a
        // new local admission cannot race the activity check and team transfer.
        jdbc.queryForList(
            "SELECT id FROM rooms WHERE team_id IN (?, ?) ORDER BY id FOR UPDATE",
            String::class.java, plan.sourceTeamId, plan.targetTeamId,
        )
        requireFresh(plan)
        val remoteOrLocalLeaseCount = jdbc.queryForObject(
            """SELECT COUNT(*) FROM room_realtime_activity activity
               JOIN rooms room ON room.invite_code = activity.room_code
               WHERE room.team_id IN (?, ?) AND activity.expires_at > CURRENT_TIMESTAMP""",
            Long::class.java, plan.sourceTeamId, plan.targetTeamId,
        ) ?: 0L
        if (remoteOrLocalLeaseCount > 0 || collaborationService.hasMergeBlockingRoomActivity(roomCodes)) {
            throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_LIVE_SESSION", "Завершите активные сессии и повторите запуск")
        }
        val pendingOffers = jdbc.queryForObject(
            "SELECT COUNT(*) FROM team_interview_owner_offers WHERE team_id IN (?, ?) AND status='PENDING' AND expires_at > CURRENT_TIMESTAMP",
            Long::class.java, plan.sourceTeamId, plan.targetTeamId,
        ) ?: 0L
        if (pendingOffers > 0) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_OWNER_RECOVERY_PENDING", "Завершите предложение восстановления владельца")

        val sourceTeamId = if (destinationTeamId == plan.sourceTeamId) plan.targetTeamId else plan.sourceTeamId
        val now = Instant.now()
        val dbNow = Timestamp.from(now)
        val normalizedName = normalized(plan.destinationName)
        stageRenames("team_tracks", "name", plan, readMap(plan.trackRenamesJson))
        stageRenames("team_task_sets", "name", plan, readMap(plan.setRenamesJson))

        jdbc.update(
            "UPDATE team_invitations SET state='REVOKED', recoverable_token_envelope=NULL, recovery_key_version=NULL, revision=revision+1, updated_at=? WHERE team_id IN (?, ?) AND state='PENDING'",
            dbNow, plan.sourceTeamId, plan.targetTeamId,
        )
        val sourceMembers = jdbc.queryForList(
            "SELECT user_id FROM team_memberships WHERE team_id=? AND state='ACTIVE' ORDER BY user_id",
            String::class.java, sourceTeamId,
        )
        sourceMembers.forEach { userId ->
            val existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM team_memberships WHERE team_id=? AND user_id=?",
                Long::class.java, destinationTeamId, userId,
            ) ?: 0L
            if (existing == 0L) jdbc.update(
                "INSERT INTO team_memberships (id, team_id, user_id, role, state, epoch, revision, created_at, updated_at) VALUES (?, ?, ?, 'MEMBER', 'ACTIVE', 0, 0, ?, ?)",
                UUID.randomUUID().toString(), destinationTeamId, userId, dbNow, dbNow,
            )
        }
        val promotions = readList(plan.adminPromotionsJson)
        promotions.forEach { userId ->
            val updated = jdbc.update(
                "UPDATE team_memberships SET role='ADMIN', revision=revision+1, updated_at=? WHERE team_id=? AND user_id=? AND state='ACTIVE'",
                dbNow, destinationTeamId, userId,
            )
            if (updated != 1) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_PLAN_STALE", "План устарел. Создайте новый план")
        }

        listOf("team_tracks", "team_vacancies", "team_task_templates", "team_task_sets", "team_interview_programmes", "rooms", "team_interview_owner_offers", "team_audit_events")
            .forEach { table -> jdbc.update("UPDATE $table SET team_id=? WHERE team_id=?", destinationTeamId, sourceTeamId) }
        finalizeRenames("team_tracks", "name", readMap(plan.trackRenamesJson))
        finalizeRenames("team_task_sets", "name", readMap(plan.setRenamesJson))
        jdbc.update(
            "UPDATE team_memberships SET state='MERGED', epoch=epoch+1, revision=revision+1, updated_at=? WHERE team_id=? AND state='ACTIVE'",
            dbNow, sourceTeamId,
        )
        jdbc.update(
            "UPDATE teams SET name=?, normalized_name=?, revision=revision+1, merge_revision=merge_revision+1, updated_at=? WHERE id=?",
            plan.destinationName, normalizedName, dbNow, destinationTeamId,
        )
        jdbc.update(
            "UPDATE teams SET state='MERGED', merged_into_team_id=?, merged_at=?, revision=revision+1, security_revision=security_revision+1, merge_revision=merge_revision+1, updated_at=? WHERE id=?",
            destinationTeamId, dbNow, dbNow, sourceTeamId,
        )
        teamAuditWriter.append(
            actorUserId = actorId,
            teamId = destinationTeamId,
            action = TeamAuditAction.TEAM_MERGED,
            createdAt = now,
            opaqueEntityId = plan.id,
            originTeamId = sourceTeamId,
        )
        plan.state = COMMITTED
        plan.committedAt = now
        plan.commitKey = key.toString()
        plan.commitActorUserId = actorId
        plan.updatedAt = now
        planRepository.saveAndFlush(plan)
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() {
                roomCodes.forEach(collaborationService::closeRoom)
            }
        })
        return TeamMergeCommitResponse(sourceTeamId, destinationTeamId, recovered = false)
    }

    @Transactional(readOnly = true)
    fun redirect(actor: User, sourceTeamId: String): TeamMergeRedirectDto {
        val source = teamRepository.findById(sourceTeamId).orElse(null)
            ?.takeIf { it.state == COMMITTED_TEAM_STATE } ?: throw teamNotFound()
        val visited = mutableSetOf(source.id)
        var destinationId = source.mergedIntoTeamId ?: throw teamNotFound()
        var destination: Team
        while (true) {
            if (!visited.add(destinationId)) throw teamNotFound()
            destination = teamRepository.findById(destinationId).orElse(null) ?: throw teamNotFound()
            if (destination.state == ACTIVE) break
            if (destination.state != COMMITTED_TEAM_STATE) throw teamNotFound()
            destinationId = destination.mergedIntoTeamId ?: throw teamNotFound()
        }
        val actorId = requireNotNull(actor.id)
        val membership = jdbc.queryForObject(
            "SELECT COUNT(*) FROM team_memberships WHERE team_id=? AND user_id=? AND state='ACTIVE'",
            Long::class.java, destination.id, actorId,
        ) ?: 0L
        if (membership != 1L) throw teamNotFound()
        return TeamMergeRedirectDto(destination.id)
    }

    private fun stageRenames(table: String, nameColumn: String, plan: TeamMergePlan, renames: Map<String, String>) {
        renames.forEach { (id, name) ->
            val canonical = Normalizer.normalize(name, Normalizer.Form.NFKC).trim()
            if (canonical.isBlank() || canonical.codePointCount(0, canonical.length) > 100) throw invalidPlan()
            val staged = "merge-${UUID.randomUUID()}"
            val updated = jdbc.update(
                "UPDATE $table SET $nameColumn=?, normalized_name=?, revision=revision+1 WHERE id=? AND team_id IN (?, ?)",
                staged, staged, id, plan.sourceTeamId, plan.targetTeamId,
            )
            if (updated != 1) throw invalidPlan()
        }
    }

    private fun validateRenames(table: String, renames: Map<String, String>, sourceTeamId: String, targetTeamId: String) {
        renames.forEach { (id, name) ->
            val canonical = Normalizer.normalize(name, Normalizer.Form.NFKC).trim()
            if (canonical.isBlank() || canonical.codePointCount(0, canonical.length) > 100) throw invalidPlan()
            val count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM $table WHERE id=? AND team_id IN (?, ?) AND status='ACTIVE'",
                Long::class.java, id, sourceTeamId, targetTeamId,
            ) ?: 0L
            if (count != 1L) throw invalidPlan()
        }
    }

    private fun finalizeRenames(table: String, nameColumn: String, renames: Map<String, String>) {
        renames.forEach { (id, name) ->
            val canonical = Normalizer.normalize(name, Normalizer.Form.NFKC).trim()
            jdbc.update("UPDATE $table SET $nameColumn=?, normalized_name=? WHERE id=?", canonical, normalized(canonical), id)
        }
    }

    internal fun requireFresh(plan: TeamMergePlan) {
        val source = teamRepository.findById(plan.sourceTeamId).orElse(null)
        val target = teamRepository.findById(plan.targetTeamId).orElse(null)
        if (source?.state != ACTIVE || target?.state != ACTIVE ||
            source.mergeRevision != plan.sourceMergeRevision || target.mergeRevision != plan.targetMergeRevision ||
            snapshotHash(plan.sourceTeamId) != plan.sourceSnapshotHash ||
            snapshotHash(plan.targetTeamId) != plan.targetSnapshotHash
        ) throw secure(HttpStatus.CONFLICT, "TEAM_MERGE_PLAN_STALE", "План устарел. Создайте новый план")
    }

    internal fun collisions(plan: TeamMergePlan): List<String> {
        val trackRenames = readMap(plan.trackRenamesJson)
        val setRenames = readMap(plan.setRenamesJson)
        return listOf(
            collisionNames("TRACK", "team_tracks", "name", plan, trackRenames),
            collisionNames("SET", "team_task_sets", "name", plan, setRenames),
        ).flatten()
    }

    internal fun membershipConflicts(plan: TeamMergePlan): List<String> {
        val rows = jdbc.queryForList(
            "SELECT user_id, team_id, state FROM team_memberships WHERE team_id IN (?, ?)",
            plan.sourceTeamId, plan.targetTeamId,
        )
        return rows.groupBy { it["user_id"].toString() }
            .filterValues { memberships ->
                memberships.size == 2 && memberships.any { it["state"] == ACTIVE } && memberships.any { it["state"] != ACTIVE }
            }.keys.sorted()
    }

    internal fun readMap(json: String): Map<String, String> = mapper.readTree(json).fields().asSequence()
        .associate { it.key to it.value.asText() }

    internal fun readList(json: String): List<String> = mapper.readTree(json).map { it.asText() }

    private fun collisionNames(
        kind: String,
        table: String,
        nameColumn: String,
        plan: TeamMergePlan,
        renames: Map<String, String>,
    ): List<String> {
        val rows = jdbc.queryForList(
            "SELECT id, $nameColumn AS name FROM $table WHERE team_id IN (?, ?) AND status = 'ACTIVE'",
            plan.sourceTeamId, plan.targetTeamId,
        )
        return rows.groupBy { row -> normalized(renames[row["id"].toString()] ?: row["name"].toString()) }
            .filterValues { it.size > 1 }
            .keys.sorted().map { "$kind:$it" }
    }

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim().lowercase(Locale.ROOT)

    private fun requirePlanForOwner(teamId: String, planId: String, actorId: String): TeamMergePlan {
        activeOwnedTeam(teamId, actorId)
        return planRepository.findById(planId).orElse(null)
            ?.takeIf { teamId == it.sourceTeamId || teamId == it.targetTeamId } ?: throw planNotFound()
    }

    private fun requireLockedPlanForOwner(teamId: String, planId: String, actorId: String): TeamMergePlan {
        activeOwnedTeam(teamId, actorId)
        return planRepository.lockById(planId)
            ?.takeIf { teamId == it.sourceTeamId || teamId == it.targetTeamId } ?: throw planNotFound()
    }

    private fun activeOwnedTeam(teamId: String, actorId: String): Team =
        teamRepository.findById(teamId).orElse(null)
            ?.takeIf { it.state == ACTIVE && it.ownerUserId == actorId } ?: throw teamNotFound()

    private fun toDto(plan: TeamMergePlan, actorId: String): TeamMergePlanDto {
        val source = teamRepository.findById(plan.sourceTeamId).orElse(null)
        val target = teamRepository.findById(plan.targetTeamId).orElse(null)
        val reviewed = plan.reviewedAt != null
        val stale = runCatching { requireFresh(plan) }.isFailure
        val disclosed = reviewed && !stale && plan.state != STALE && plan.state != COMMITTED
        val sourceCanSee = disclosed || source?.ownerUserId == actorId
        val targetCanSee = disclosed || target?.ownerUserId == actorId
        return TeamMergePlanDto(
            id = plan.id,
            sourceTeamId = plan.sourceTeamId,
            targetTeamId = plan.targetTeamId,
            destinationTeamId = plan.destinationTeamId,
            destinationName = plan.destinationName,
            sourceName = if (sourceCanSee) source?.name else null,
            targetName = if (targetCanSee) target?.name else null,
            state = if (stale && plan.state != COMMITTED) STALE else plan.state,
            sourceApproved = !stale && plan.sourceApprovedAt != null,
            targetApproved = !stale && plan.targetApprovedAt != null,
            reviewed = reviewed,
            trackRenames = if (disclosed) readMap(plan.trackRenamesJson) else emptyMap(),
            setRenames = if (disclosed) readMap(plan.setRenamesJson) else emptyMap(),
            adminPromotions = if (disclosed) readList(plan.adminPromotionsJson) else emptyList(),
            collisions = if (disclosed) collisions(plan) else emptyList(),
            membershipConflicts = if (disclosed) membershipConflicts(plan) else emptyList(),
            members = if (disclosed) previewMembers(plan) else emptyList(),
            materials = if (disclosed) previewMaterials(plan) else emptyList(),
        )
    }

    private fun previewMembers(plan: TeamMergePlan): List<TeamMergeMemberPreviewDto> {
        val destinationOwner = teamRepository.findById(plan.destinationTeamId).orElse(null)?.ownerUserId
        val sourceOwner = teamRepository.findById(plan.sourceTeamId).orElse(null)?.ownerUserId
        val targetOwner = teamRepository.findById(plan.targetTeamId).orElse(null)?.ownerUserId
        val promotions = readList(plan.adminPromotionsJson).toSet()
        return jdbc.queryForList(
            "SELECT m.user_id, m.team_id, m.role, u.display_name FROM team_memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id IN (?, ?) AND m.state='ACTIVE' ORDER BY m.team_id, m.user_id",
            plan.sourceTeamId, plan.targetTeamId,
        ).map { row ->
            val userId = row["user_id"].toString()
            val teamId = row["team_id"].toString()
            val role = if (userId == sourceOwner || userId == targetOwner) "OWNER" else row["role"].toString()
            val result = when {
                userId == destinationOwner -> "OWNER"
                userId in promotions || (teamId == plan.destinationTeamId && role == "ADMIN") -> "ADMIN"
                else -> "MEMBER"
            }
            TeamMergeMemberPreviewDto(userId, row["display_name"]?.toString()?.ifBlank { "Участник" } ?: "Участник", teamId, role, result)
        }
    }

    private fun previewMaterials(plan: TeamMergePlan): List<TeamMergeMaterialPreviewDto> {
        val tables = listOf(
            Triple("team_tracks", "TRACK", "name"),
            Triple("team_vacancies", "VACANCY", "title"),
            Triple("team_task_templates", "TASK", "title"),
            Triple("team_task_sets", "SET", "name"),
        )
        val materials = tables.flatMap { (table, kind, nameColumn) ->
            jdbc.queryForList(
                "SELECT id, team_id, $nameColumn AS name, status FROM $table WHERE team_id IN (?, ?) ORDER BY team_id, id",
                plan.sourceTeamId, plan.targetTeamId,
            ).map { row ->
                TeamMergeMaterialPreviewDto(
                    row["id"].toString(), row["team_id"].toString(), kind,
                    row["name"].toString(), row["status"].toString(),
                )
            }
        }
        val programmes = jdbc.queryForList(
            "SELECT id, team_id, target_type, version, status FROM team_interview_programmes WHERE team_id IN (?, ?) ORDER BY team_id, id",
            plan.sourceTeamId, plan.targetTeamId,
        ).map { row ->
            TeamMergeMaterialPreviewDto(
                row["id"].toString(), row["team_id"].toString(), "PROGRAMME",
                "${row["target_type"]} · v${row["version"]}", row["status"].toString(),
            )
        }
        return materials + programmes
    }

    private fun snapshotHash(teamId: String): String {
        val statements = listOf(
            "SELECT id, name, owner_user_id, state, revision, security_revision, merge_revision FROM teams WHERE id=?",
            "SELECT id, user_id, role, state, epoch, revision FROM team_memberships WHERE team_id=? ORDER BY id",
            "SELECT id, name, status, revision FROM team_tracks WHERE team_id=? ORDER BY id",
            "SELECT id, title, status, revision, track_id FROM team_vacancies WHERE team_id=? ORDER BY id",
            "SELECT id, title, status, revision FROM team_task_templates WHERE team_id=? ORDER BY id",
            "SELECT id, name, status, revision FROM team_task_sets WHERE team_id=? ORDER BY id",
            "SELECT id, target_type, target_id, status, version, revision FROM team_interview_programmes WHERE team_id=? ORDER BY id",
            "SELECT id, state, revision FROM team_invitations WHERE team_id=? ORDER BY id",
            "SELECT id, status, archived_at, team_track_id, team_vacancy_id FROM rooms WHERE team_id=? ORDER BY id",
            "SELECT id, status, room_id FROM team_interview_owner_offers WHERE team_id=? ORDER BY id",
        )
        val canonical = statements.joinToString("\n") { sql ->
            jdbc.queryForList(sql, teamId).joinToString("|") { row ->
                row.toSortedMap().entries.joinToString(",") { (key, value) -> "$key=${value ?: ""}" }
            }
        }
        return MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun planNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_MERGE_PLAN_NOT_FOUND", "План не найден")
    private fun ownerRequired() = secure(HttpStatus.FORBIDDEN, "TEAM_MERGE_OWNER_REQUIRED", "Требуется владелец команды")
    private fun invalidPlan() = secure(HttpStatus.BAD_REQUEST, "TEAM_MERGE_PLAN_INVALID", "Проверьте параметры объединения")

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val REVIEWING = "REVIEWING"
        const val READY = "READY"
        const val STALE = "STALE"
        const val COMMITTED = "COMMITTED"
        const val COMMITTED_TEAM_STATE = "MERGED"
    }
}
