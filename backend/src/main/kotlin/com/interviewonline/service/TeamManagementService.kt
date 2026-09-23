package com.interviewonline.service

import com.interviewonline.dto.TeamManagementMemberDto
import com.interviewonline.dto.TeamManagementTeamDto
import com.interviewonline.dto.TeamMemberLifecycleResponse
import com.interviewonline.dto.TeamMemberRoleResponse
import com.interviewonline.dto.TeamOwnershipTransferResponse
import com.interviewonline.dto.TeamRenameResponse
import com.interviewonline.model.CommandReceipt
import com.interviewonline.model.CommandReceiptId
import com.interviewonline.model.Team
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.User
import com.interviewonline.repository.CommandReceiptRepository
import com.interviewonline.repository.RoomHrAssignmentRepository
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.Normalizer
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

/**
 * The server-authoritative boundary for the three P1 team management commands.
 * A team row is always locked before authority, CAS, receipt or member state is
 * evaluated, so the terminal receipt and its domain/audit mutation share one
 * transaction and no intermediate outcome can be persisted.
 */
@Service
class TeamManagementService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val userRepository: UserRepository,
    private val receiptRepository: CommandReceiptRepository,
    private val roomParticipantRepository: RoomParticipantRepository,
    private val roomHrAssignmentRepository: RoomHrAssignmentRepository,
    private val teamAuditWriter: TeamAuditWriter,
    private val featureGate: TeamWorkspaceFeatureGate,
    private val databaseTime: DatabaseTimeSource,
    private val transactionGuard: TeamManagementTransactionGuard,
    private val collaborationService: CollaborationService,
) {
    @Transactional
    fun rename(actor: User, teamId: String, rawName: String, revision: Long, key: UUID): TeamRenameResponse {
        featureGate.requireEnabled()
        val name = canonicalName(rawName)
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        val actorMembership = lockManagedActor(team, actorId)
        val requestHash = hash("team-rename:v1\nname=$name\nrevision=$revision")
        val receiptId = receiptId(actorId, team.id, TEAM_RENAME, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            return TeamRenameResponse(existing.outcome, true, safeTeam(team, actorMembership))
        }

        if (team.revision != revision) throw teamRevisionConflict(team.revision)
        val now = now()
        val outcome = if (team.name == name) {
            UNCHANGED
        } else {
            team.name = name
            team.normalizedName = name.lowercase(Locale.ROOT)
            bumpTeamRevision(team, now)
            teamAuditWriter.append(actorId, team.id, TeamAuditAction.TEAM_RENAMED, now)
            RENAMED
        }
        saveReceipt(receiptId, requestHash, outcome, team.id, now)
        return TeamRenameResponse(outcome, false, safeTeam(team, actorMembership))
    }

    @Transactional
    fun updateRole(actor: User, teamId: String, targetUserId: String, role: String, revision: Long, key: UUID): TeamMemberRoleResponse {
        featureGate.requireEnabled()
        requireStoredRole(role)
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        lockCurrentOwner(team)
        lockActiveMembership(team.id, actorId)
        if (team.ownerUserId != actorId) throw teamOwnerRequired()
        val requestHash = hash("team-member-role-update:v1\ntargetUserId=$targetUserId\nrole=$role\nrevision=$revision")
        val receiptId = receiptId(actorId, team.id, TEAM_MEMBER_ROLE_UPDATE, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val member = currentActiveMember(team.id, existing.resourceId)
            return TeamMemberRoleResponse(existing.outcome, true, safeMember(team, member))
        }

        if (targetUserId == team.ownerUserId) throw ownerRoleImmutable()
        val target = lockActiveMemberTarget(team.id, targetUserId)
        if (target.revision != revision) throw memberRevisionConflict(target.revision)
        val now = now()
        val outcome = if (target.role == role) {
            UNCHANGED
        } else {
            target.role = role
            target.revision += 1
            target.updatedAt = now
            membershipRepository.saveAndFlush(target)
            bumpTeamRevision(team, now)
            teamAuditWriter.append(actorId, team.id, TeamAuditAction.MEMBER_ROLE_UPDATED, now, targetUserId = target.userId)
            ROLE_UPDATED
        }
        saveReceipt(receiptId, requestHash, outcome, target.userId, now)
        return TeamMemberRoleResponse(outcome, false, safeMember(team, target))
    }

    @Transactional
    fun transferOwnership(
        actor: User,
        teamId: String,
        targetUserId: String,
        revision: Long,
        key: UUID,
    ): TeamOwnershipTransferResponse {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)

        // A former owner must not recover an old transfer result. A different
        // concurrent command with a stale revision, however, is reported as the
        // documented CAS conflict after the team-lock wait.
        val initialActor = activeMembership(team.id, actorId) ?: throw teamNotFound()
        val requestHash = hash("team-ownership-transfer:v1\ntargetUserId=$targetUserId\nrevision=$revision")
        val receiptId = receiptId(actorId, team.id, TEAM_OWNERSHIP_TRANSFER, key)
        val existingReceipt = receiptRepository.findById(receiptId).orElse(null)
        if (team.ownerUserId != actorId || initialActor.state != ACTIVE) {
            if (existingReceipt != null || team.revision == revision) throw teamOwnerRequired()
            throw teamRevisionConflict(team.revision)
        }
        val initialOwner = activeMembership(team.id, team.ownerUserId) ?: throw teamNotFound()
        if (initialOwner.state != ACTIVE) throw teamNotFound()

        existingReceipt?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val target = currentActiveMember(team.id, existing.resourceId)
            return TeamOwnershipTransferResponse(
                existing.outcome,
                true,
                safeTeam(team, initialActor),
                listOf(safeMember(team, initialActor), safeMember(team, target)),
            )
        }

        if (targetUserId == actorId) throw ownershipTransferTargetInvalid()
        if (team.revision != revision) throw teamRevisionConflict(team.revision)

        // The two membership locks follow the team lock and are obtained in a
        // stable order. All state is checked again after a possible lock wait.
        val locked = lockMembersInOrder(team.id, actorId, targetUserId)
        val previousOwner = locked[actorId] ?: throw teamNotFound()
        val target = locked[targetUserId] ?: throw ownershipTransferTargetInvalid()
        if (team.ownerUserId != actorId || previousOwner.state != ACTIVE) throw teamOwnerRequired()
        if (target.state != ACTIVE) throw ownershipTransferTargetInvalid()
        if (team.revision != revision) throw teamRevisionConflict(team.revision)

        val now = now()
        if (previousOwner.role != ADMIN) {
            previousOwner.role = ADMIN
            previousOwner.revision += 1
            previousOwner.updatedAt = now
            membershipRepository.saveAndFlush(previousOwner)
        }
        if (target.role != ADMIN) {
            target.role = ADMIN
            target.revision += 1
            target.updatedAt = now
            membershipRepository.saveAndFlush(target)
        }
        team.ownerUserId = targetUserId
        bumpTeamRevision(team, now)
        teamAuditWriter.append(actorId, team.id, TeamAuditAction.TEAM_OWNERSHIP_TRANSFERRED, now, targetUserId = targetUserId)
        saveReceipt(receiptId, requestHash, OWNERSHIP_TRANSFERRED, targetUserId, now)

        return TeamOwnershipTransferResponse(
            OWNERSHIP_TRANSFERRED,
            false,
            safeTeam(team, previousOwner),
            listOf(safeMember(team, previousOwner), safeMember(team, target)),
        )
    }

    @Transactional
    fun leave(actor: User, teamId: String, key: UUID): TeamMemberLifecycleResponse {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        val requestHash = hash("team-member-leave:v1\nuserId=$actorId")
        val receiptId = receiptId(actorId, team.id, TEAM_MEMBER_LEAVE, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val member = currentMember(team.id, existing.resourceId)
            return TeamMemberLifecycleResponse(existing.outcome, true, safeMemberAnyState(team, member))
        }

        val member = lockActiveMembership(team.id, actorId)
        if (team.ownerUserId == actorId) throw lastOwnerTransferRequired()

        val now = now()
        transitionMembership(team, member, LEFT, now)
        clearTeamRoomGrants(team.id, member.userId)
        teamAuditWriter.append(actorId, team.id, TeamAuditAction.MEMBER_LEFT, now, targetUserId = actorId)
        saveReceipt(receiptId, requestHash, MEMBER_LEFT, member.userId, now)
        syncTeamMemberAfterCommit(team.id, member.userId)

        return TeamMemberLifecycleResponse(MEMBER_LEFT, false, safeMemberAnyState(team, member))
    }

    @Transactional
    fun removeMember(actor: User, teamId: String, targetUserId: String, key: UUID): TeamMemberLifecycleResponse {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        val actorMembership = lockManagedActor(team, actorId)
        val requestHash = hash("team-member-remove:v1\ntargetUserId=$targetUserId")
        val receiptId = receiptId(actorId, team.id, TEAM_MEMBER_REMOVE, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val member = currentMember(team.id, existing.resourceId)
            return TeamMemberLifecycleResponse(existing.outcome, true, safeMemberAnyState(team, member))
        }

        if (targetUserId == team.ownerUserId) throw lastOwnerTransferRequired()
        if (targetUserId == actorMembership.userId) throw selfRemoveRequiresLeave()
        val target = lockActiveMemberTarget(team.id, targetUserId)

        val now = now()
        transitionMembership(team, target, REMOVED, now)
        clearTeamRoomGrants(team.id, target.userId)
        teamAuditWriter.append(actorId, team.id, TeamAuditAction.MEMBER_REMOVED, now, targetUserId = target.userId)
        saveReceipt(receiptId, requestHash, MEMBER_REMOVED, target.userId, now)
        syncTeamMemberAfterCommit(team.id, target.userId)

        return TeamMemberLifecycleResponse(MEMBER_REMOVED, false, safeMemberAnyState(team, target))
    }

    @Transactional
    fun suspendMember(actor: User, teamId: String, targetUserId: String, key: UUID): TeamMemberLifecycleResponse {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        val actorMembership = lockManagedActor(team, actorId)
        val requestHash = hash("team-member-suspend:v1\ntargetUserId=$targetUserId")
        val receiptId = receiptId(actorId, team.id, TEAM_MEMBER_SUSPEND, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val member = currentMember(team.id, existing.resourceId)
            return TeamMemberLifecycleResponse(existing.outcome, true, safeMemberAnyState(team, member))
        }

        if (targetUserId == team.ownerUserId) throw lastOwnerTransferRequired()
        if (targetUserId == actorMembership.userId) throw selfRemoveRequiresLeave()
        val target = lockActiveMemberTarget(team.id, targetUserId)

        val now = now()
        transitionMembership(team, target, SUSPENDED, now)
        clearTeamRoomGrants(team.id, target.userId)
        teamAuditWriter.append(actorId, team.id, TeamAuditAction.MEMBER_SUSPENDED, now, targetUserId = target.userId)
        saveReceipt(receiptId, requestHash, MEMBER_SUSPENDED, target.userId, now)
        syncTeamMemberAfterCommit(team.id, target.userId)

        return TeamMemberLifecycleResponse(MEMBER_SUSPENDED, false, safeMemberAnyState(team, target))
    }

    @Transactional
    fun resumeMember(actor: User, teamId: String, targetUserId: String, key: UUID): TeamMemberLifecycleResponse {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockActiveTeam(teamId)
        lockManagedActor(team, actorId)
        val requestHash = hash("team-member-resume:v1\ntargetUserId=$targetUserId")
        val receiptId = receiptId(actorId, team.id, TEAM_MEMBER_RESUME, key)

        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val member = currentMember(team.id, existing.resourceId)
            return TeamMemberLifecycleResponse(existing.outcome, true, safeMemberAnyState(team, member))
        }

        if (targetUserId == team.ownerUserId) throw lastOwnerTransferRequired()
        val target = lockSuspendedMemberTarget(team.id, targetUserId)

        val now = now()
        transitionMembership(team, target, ACTIVE, now)
        teamAuditWriter.append(actorId, team.id, TeamAuditAction.MEMBER_RESUMED, now, targetUserId = target.userId)
        saveReceipt(receiptId, requestHash, MEMBER_RESUMED, target.userId, now)
        syncTeamMemberAfterCommit(team.id, target.userId)

        return TeamMemberLifecycleResponse(MEMBER_RESUMED, false, safeMemberAnyState(team, target))
    }

    private fun lockActiveTeam(teamId: String): Team =
        teamRepository.lockById(teamId)?.takeIf { it.state == ACTIVE } ?: throw teamNotFound()

    private fun lockManagedActor(team: Team, actorId: String): TeamMembership {
        lockCurrentOwner(team)
        val actor = lockActiveMembership(team.id, actorId)
        if (team.ownerUserId == actorId || actor.role == ADMIN) return actor
        throw teamManagerRequired()
    }

    private fun lockCurrentOwner(team: Team): TeamMembership =
        lockActiveMembership(team.id, team.ownerUserId)

    private fun lockActiveMembership(teamId: String, userId: String): TeamMembership =
        membershipRepository.lockByTeamIdAndUserId(teamId, userId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()

    private fun lockActiveMemberTarget(teamId: String, userId: String): TeamMembership =
        membershipRepository.lockByTeamIdAndUserId(teamId, userId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw memberNotFound()

    private fun lockSuspendedMemberTarget(teamId: String, userId: String): TeamMembership =
        membershipRepository.lockByTeamIdAndUserId(teamId, userId)
            ?.takeIf { it.state == SUSPENDED }
            ?: throw memberNotFound()

    private fun activeMembership(teamId: String, userId: String): TeamMembership? =
        membershipRepository.findByTeamIdAndUserId(teamId, userId)?.takeIf { it.state == ACTIVE }

    private fun currentActiveMember(teamId: String, userId: String): TeamMembership =
        activeMembership(teamId, userId) ?: throw memberNotFound()

    private fun currentMember(teamId: String, userId: String): TeamMembership =
        membershipRepository.findByTeamIdAndUserId(teamId, userId) ?: throw memberNotFound()

    private fun lockMembersInOrder(teamId: String, firstUserId: String, secondUserId: String): Map<String, TeamMembership> {
        val locked = linkedMapOf<String, TeamMembership>()
        listOf(firstUserId, secondUserId).distinct().sorted().forEach { userId ->
            membershipRepository.lockByTeamIdAndUserId(teamId, userId)?.let { locked[userId] = it }
        }
        return locked
    }

    private fun bumpTeamRevision(team: Team, now: Instant) {
        team.revision += 1
        team.mergeRevision += 1
        team.updatedAt = now
        teamRepository.saveAndFlush(team)
    }

    private fun bumpTeamSecurityRevision(team: Team, now: Instant) {
        team.revision += 1
        team.securityRevision += 1
        team.mergeRevision += 1
        team.updatedAt = now
        teamRepository.saveAndFlush(team)
    }

    private fun transitionMembership(team: Team, membership: TeamMembership, state: String, now: Instant) {
        membership.state = state
        membership.epoch += 1
        membership.revision += 1
        membership.updatedAt = now
        membershipRepository.saveAndFlush(membership)
        bumpTeamSecurityRevision(team, now)
    }

    private fun clearTeamRoomGrants(teamId: String, userId: String) {
        roomParticipantRepository.deleteAllByTeamIdAndUserId(teamId, userId)
        roomHrAssignmentRepository.deleteAllByTeamIdAndUserId(teamId, userId)
    }

    private fun syncTeamMemberAfterCommit(teamId: String, userId: String) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCommit() = collaborationService.syncTeamMemberRoomPermissions(teamId, userId)
            })
        } else {
            collaborationService.syncTeamMemberRoomPermissions(teamId, userId)
        }
    }

    private fun saveReceipt(
        id: CommandReceiptId,
        requestHash: String,
        outcome: String,
        resourceId: String,
        now: Instant,
    ) {
        receiptRepository.saveAndFlush(
            CommandReceipt(
                id = id,
                requestHash = requestHash,
                outcome = outcome,
                status = 200,
                resourceId = resourceId,
                createdAt = now,
                expiresAt = now.plus(24, ChronoUnit.HOURS),
            ),
        )
    }

    private fun safeTeam(team: Team, membership: TeamMembership): TeamManagementTeamDto = TeamManagementTeamDto(
        id = team.id,
        name = team.name,
        role = if (team.ownerUserId == membership.userId) OWNER else membership.role,
        revision = team.revision,
    )

    private fun safeMember(team: Team, membership: TeamMembership): TeamManagementMemberDto {
        check(membership.state == ACTIVE) { "Only active memberships are safe management resources" }
        return safeMemberAnyState(team, membership)
    }

    private fun safeMemberAnyState(team: Team, membership: TeamMembership): TeamManagementMemberDto {
        val user = userRepository.findById(membership.userId).orElse(null)
        return TeamManagementMemberDto(
            userId = membership.userId,
            displayName = safeDisplayName(user),
            role = if (team.ownerUserId == membership.userId) OWNER else membership.role,
            state = membership.state,
            revision = membership.revision,
        )
    }

    private fun safeDisplayName(user: User?): String {
        val value = user?.displayName
            ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC).trim { character -> character.isWhitespace() } }
            ?.takeIf { it.isNotEmpty() }
            ?: return FALLBACK_DISPLAY_NAME
        if (value.codePoints().anyMatch { point ->
                Character.getType(point) == Character.CONTROL.toInt() || Character.getType(point) == Character.FORMAT.toInt()
            }
        ) return FALLBACK_DISPLAY_NAME
        return value
    }

    private fun canonicalName(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..100) throw invalidTeamName()
        return value
    }

    private fun requireStoredRole(role: String) {
        if (role !in setOf(ADMIN, MEMBER)) throw invalidMemberRole()
    }

    private fun receiptId(actorId: String, teamId: String, operation: String, key: UUID) =
        CommandReceiptId(actorId, SCOPE_TEAM, teamId, operation, key.toString())

    private fun requireActiveReceipt(receipt: CommandReceipt) {
        if (!databaseTime.isReceiptActive(receipt.id)) throw commandNotFound()
    }

    private fun requireMatchingReceipt(receipt: CommandReceipt, requestHash: String) {
        if (receipt.requestHash != requestHash) throw idempotencyConflict()
    }

    private fun hash(value: String): String = "v1:" + MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }

    private fun now(): Instant = databaseTime.now().truncatedTo(ChronoUnit.MICROS)

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun memberNotFound() = secure(HttpStatus.NOT_FOUND, "MEMBER_NOT_FOUND", "Участник не найден")
    private fun commandNotFound() = secure(HttpStatus.NOT_FOUND, "COMMAND_NOT_FOUND", "Команда не найдена")
    private fun teamManagerRequired() = secure(HttpStatus.FORBIDDEN, "TEAM_MANAGER_REQUIRED", "Недостаточно прав")
    private fun teamOwnerRequired() = secure(HttpStatus.FORBIDDEN, "TEAM_OWNER_REQUIRED", "Недостаточно прав")
    private fun invalidTeamName() = secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_NAME", "Название команды должно содержать от 1 до 100 символов")
    private fun invalidMemberRole() = secure(HttpStatus.BAD_REQUEST, "INVALID_MEMBER_ROLE", "Роль участника должна быть ADMIN или MEMBER")
    private fun ownerRoleImmutable() = secure(HttpStatus.CONFLICT, "OWNER_ROLE_IMMUTABLE", "Роль владельца команды нельзя изменить")
    private fun ownershipTransferTargetInvalid() = secure(HttpStatus.CONFLICT, "OWNERSHIP_TRANSFER_TARGET_INVALID", "Нельзя передать владение выбранному участнику")
    private fun lastOwnerTransferRequired() = secure(HttpStatus.CONFLICT, "LAST_OWNER_TRANSFER_REQUIRED", "Сначала передайте владение командой")
    private fun selfRemoveRequiresLeave() = secure(HttpStatus.CONFLICT, "SELF_REMOVE_REQUIRES_LEAVE", "Используйте выход из команды")
    private fun idempotencyConflict() = secure(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "Ключ уже использован для другой команды")
    private fun teamRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Команда уже изменилась",
        code = "TEAM_REVISION_CONFLICT",
        currentRevision = current,
    )
    private fun memberRevisionConflict(current: Long) = ApiException(
        HttpStatus.CONFLICT,
        "Участник уже изменился",
        code = "MEMBER_REVISION_CONFLICT",
        currentRevision = current,
    )

    private companion object {
        const val SCOPE_TEAM = "TEAM"
        const val TEAM_RENAME = "TEAM_RENAME"
        const val TEAM_MEMBER_ROLE_UPDATE = "TEAM_MEMBER_ROLE_UPDATE"
        const val TEAM_OWNERSHIP_TRANSFER = "TEAM_OWNERSHIP_TRANSFER"
        const val TEAM_MEMBER_LEAVE = "TEAM_MEMBER_LEAVE"
        const val TEAM_MEMBER_REMOVE = "TEAM_MEMBER_REMOVE"
        const val TEAM_MEMBER_SUSPEND = "TEAM_MEMBER_SUSPEND"
        const val TEAM_MEMBER_RESUME = "TEAM_MEMBER_RESUME"
        const val ACTIVE = "ACTIVE"
        const val LEFT = "LEFT"
        const val REMOVED = "REMOVED"
        const val SUSPENDED = "SUSPENDED"
        const val OWNER = "OWNER"
        const val ADMIN = "ADMIN"
        const val MEMBER = "MEMBER"
        const val RENAMED = "RENAMED"
        const val ROLE_UPDATED = "ROLE_UPDATED"
        const val OWNERSHIP_TRANSFERRED = "OWNERSHIP_TRANSFERRED"
        const val MEMBER_LEFT = "MEMBER_LEFT"
        const val MEMBER_REMOVED = "MEMBER_REMOVED"
        const val MEMBER_SUSPENDED = "MEMBER_SUSPENDED"
        const val MEMBER_RESUMED = "MEMBER_RESUMED"
        const val UNCHANGED = "UNCHANGED"
        const val FALLBACK_DISPLAY_NAME = "Участник"
    }
}
