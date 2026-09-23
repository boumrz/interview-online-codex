package com.interviewonline.service

import com.interviewonline.config.TeamInvitationLinkCipher
import com.interviewonline.dto.TeamInvitationAcceptDto
import com.interviewonline.dto.TeamInvitationDto
import com.interviewonline.dto.TeamInvitationLinkDto
import com.interviewonline.dto.TeamInvitationListDto
import com.interviewonline.dto.TeamInvitationPreviewDto
import com.interviewonline.model.CommandReceipt
import com.interviewonline.model.CommandReceiptId
import com.interviewonline.model.Team
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamInvitation
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.User
import com.interviewonline.repository.CommandReceiptRepository
import com.interviewonline.repository.TeamInvitationRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID

@Service
class TeamInvitationService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val invitationRepository: TeamInvitationRepository,
    private val teamAuditWriter: TeamAuditWriter,
    private val receiptRepository: CommandReceiptRepository,
    private val featureGate: TeamWorkspaceFeatureGate,
    private val databaseTime: DatabaseTimeSource,
    private val transactionGuard: InvitationTransactionGuard,
    private val linkCipher: TeamInvitationLinkCipher,
    private val lifecycleBarrier: InvitationLifecycleBarrier,
) {
    companion object {
        private const val SCOPE_TEAM = "TEAM"
        private const val INVITATION_CREATE = "INVITATION_CREATE"
        private const val INVITATION_ACCEPT = "INVITATION_ACCEPT"
        private const val INVITATION_REVOKE = "INVITATION_REVOKE"
        private const val INVITATION_REISSUE = "INVITATION_REISSUE"
        private const val DEFAULT_PAGE_SIZE = 25
        private const val MAX_PAGE_SIZE = 100
        private val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
        private val secureRandom = SecureRandom()
    }

    data class InvitationCommandResult(
        val invitation: TeamInvitationDto,
        val location: String,
    )

    @Transactional
    fun create(actor: User, teamId: String, key: UUID): InvitationCommandResult {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockManagedTeam(actorId, teamId)
        val receiptId = receiptId(actorId, team.id, INVITATION_CREATE, key)
        val requestHash = requestHash("invitation-create:v1")
        receiptRepository.findById(receiptId).orElse(null)?.let { receipt ->
            requireActiveReceipt(receipt)
            requireMatchingReceipt(receipt, requestHash)
            val invitation = invitationRepository.lockByIdAndTeamId(receipt.resourceId, team.id)
                ?: throw teamNotFound()
            terminalizeExpired(invitation, now())
            return commandResult(invitation, actorId)
        }

        val now = now()
        val previous = invitationRepository.findByTeamIdOrderByCreatedAtDescIdDesc(team.id)
        val invitation = previous.firstOrNull()?.let { candidate ->
            invitationRepository.lockByIdAndTeamId(candidate.id, team.id)
        } ?: TeamInvitation(id = UUID.randomUUID().toString(), teamId = team.id, revision = -1, createdAt = now)
        previous.drop(1).forEach { candidate ->
            if (candidate.state == "PENDING") {
                candidate.state = "REVOKED"
                candidate.revision += 1
                candidate.updatedAt = now
                clearRecovery(candidate)
                invitationRepository.saveAndFlush(candidate)
            }
        }
        rotate(invitation, actorId, now)
        invitationRepository.saveAndFlush(invitation)
        bumpMergeRevision(team, now)
        audit(actorId, team.id, if (previous.isEmpty()) TeamAuditAction.INVITATION_CREATED else TeamAuditAction.INVITATION_REISSUED, invitation.id, now = now)
        receipt(receiptId, requestHash, "created", 201, invitation.id, now)
        return commandResult(invitation, actorId)
    }

    @Transactional
    fun preview(rawToken: String, clientIp: String, actorUserId: String? = null): TeamInvitationPreviewDto {
        featureGate.requireEnabled()
        val tokenHash = tokenHash(rawToken)
        val teamId = invitationRepository.findTeamIdByTokenHash(tokenHash) ?: throw invitationUnavailable()
        transactionGuard.applyLockTimeout()
        val team = teamRepository.lockById(teamId)?.takeIf { it.state == "ACTIVE" } ?: throw invitationUnavailable()
        lifecycleBarrier.afterTeamLockBeforeInvitationLock()
        val invitation = invitationRepository.lockByTokenHash(tokenHash) ?: throw invitationUnavailable()
        if (invitation.teamId != team.id) throw invitationUnavailable()
        terminalizeExpired(invitation, now())
        if (!isUsable(invitation, team)) throw invitationUnavailable()
        return TeamInvitationPreviewDto(team.name, invitation.role, invitation.expiresAt)
    }

    @Transactional
    fun accept(actor: User, rawToken: String, key: UUID, clientIp: String): TeamInvitationAcceptDto {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        val tokenHash = tokenHash(rawToken)
        val teamId = invitationRepository.findTeamIdByTokenHash(tokenHash) ?: throw invitationUnavailable()
        transactionGuard.applyLockTimeout()
        val team = teamRepository.lockById(teamId)?.takeIf { it.state == "ACTIVE" }
            ?: throw invitationUnavailable()
        lifecycleBarrier.afterTeamLockBeforeInvitationLock()
        val invitation = invitationRepository.lockByTokenHash(tokenHash) ?: throw invitationUnavailable()
        if (invitation.teamId != team.id) throw invitationUnavailable()

        val requestHash = requestHash("invitation-accept:v1\ntokenHash=$tokenHash")
        val receiptId = receiptId(actorId, team.id, INVITATION_ACCEPT, key)
        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            membershipRepository.findByTeamIdAndUserId(team.id, actorId)
                ?.takeIf { it.state == "ACTIVE" }
                ?: throw invitationUnavailable()
            if (existing.resourceId != invitation.id) throw invitationUnavailable()
            return TeamInvitationAcceptDto(team.id, existing.outcome)
        }

        terminalizeExpired(invitation, now())
        if (!isUsable(invitation, team)) throw invitationUnavailable()

        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
        var membershipChanged = false
        when (membership?.state) {
            "ACTIVE" -> return TeamInvitationAcceptDto(team.id, "alreadyMember")
            "SUSPENDED" -> throw invitationUnavailable()
            "LEFT", "REMOVED" -> {
                membership.state = "ACTIVE"
                membership.role = "MEMBER"
                membership.epoch += 1
                membership.revision += 1
                membership.updatedAt = now()
                membershipRepository.saveAndFlush(membership)
                membershipChanged = true
            }
            null -> {
                membershipRepository.saveAndFlush(
                    TeamMembership(
                        id = UUID.randomUUID().toString(),
                        teamId = team.id,
                        userId = actorId,
                        role = "MEMBER",
                        state = "ACTIVE",
                        epoch = 0,
                        revision = 0,
                        createdAt = now(),
                        updatedAt = now(),
                    ),
                )
                membershipChanged = true
            }
            else -> throw invitationUnavailable()
        }

        val acceptedAt = now()
        if (membershipChanged) bumpMembershipRevisions(team, acceptedAt)
        audit(actorId, team.id, TeamAuditAction.INVITATION_ACCEPTED, invitation.id, targetUserId = actorId, now = acceptedAt)
        receipt(receiptId, requestHash, "joined", 200, invitation.id, acceptedAt)
        return TeamInvitationAcceptDto(team.id, "joined")
    }

    @Transactional
    fun revoke(actor: User, teamId: String, invitationId: String, revision: Long, key: UUID): InvitationCommandResult {
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockManagedTeam(actorId, teamId)
        val requestHash = requestHash("invitation-revoke:v1\nid=$invitationId\nrevision=$revision")
        val receiptId = receiptId(actorId, team.id, INVITATION_REVOKE, key)
        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            if (existing.resourceId != invitationId) throw idempotencyConflict()
            val invitation = invitationRepository.lockByIdAndTeamId(invitationId, team.id)
                ?: throw teamNotFound()
            terminalizeExpired(invitation, now())
            return commandResult(invitation, actorId)
        }
        val invitation = invitationRepository.lockByIdAndTeamId(invitationId, team.id) ?: throw teamNotFound()
        val current = now()
        if (terminalizeExpired(invitation, current) || !isUsable(invitation, team)) {
            throw invitationUnavailable()
        }
        requireRevision(invitation, revision)

        val now = now()
        invitation.state = "REVOKED"
        clearRecovery(invitation)
        invitation.revision += 1
        invitation.updatedAt = now
        invitationRepository.saveAndFlush(invitation)
        bumpMergeRevision(team, now)
        audit(actorId, team.id, TeamAuditAction.INVITATION_REVOKED, invitation.id, now = now)
        receipt(receiptId, requestHash, "revoked", 200, invitation.id, now)
        return commandResult(invitation, actorId)
    }

    @Transactional
    fun reissue(actor: User, teamId: String, invitationId: String, revision: Long, key: UUID): InvitationCommandResult {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockManagedTeam(actorId, teamId)
        val requestHash = requestHash("invitation-reissue:v1\nid=$invitationId\nrevision=$revision")
        val receiptId = receiptId(actorId, team.id, INVITATION_REISSUE, key)
        receiptRepository.findById(receiptId).orElse(null)?.let { existing ->
            requireActiveReceipt(existing)
            requireMatchingReceipt(existing, requestHash)
            val replacement = invitationRepository.lockByIdAndTeamId(existing.resourceId, team.id)
                ?: throw teamNotFound()
            terminalizeExpired(replacement, now())
            return commandResult(replacement, actorId)
        }
        val original = invitationRepository.lockByIdAndTeamId(invitationId, team.id) ?: throw teamNotFound()
        val current = now()
        if (terminalizeExpired(original, current) || !isUsable(original, team)) {
            throw invitationUnavailable()
        }
        requireRevision(original, revision)

        val now = now()
        rotate(original, actorId, now)
        val replacement = invitationRepository.saveAndFlush(original)
        bumpMergeRevision(team, now)
        audit(actorId, team.id, TeamAuditAction.INVITATION_REISSUED, replacement.id, now = now)
        receipt(receiptId, requestHash, "reissued", 201, replacement.id, now)
        return commandResult(replacement, actorId)
    }

    @Transactional
    fun list(actor: User, teamId: String, pageRaw: String?, sizeRaw: String?): TeamInvitationListDto {
        featureGate.requireEnabled()
        val (page, size) = parsePage(pageRaw, sizeRaw)
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockManagedTeam(actorId, teamId)
        val current = now()
        invitationRepository.findByTeamIdOrderByCreatedAtDescIdDesc(team.id).forEach { invitation ->
            val locked = invitationRepository.lockByIdAndTeamId(invitation.id, team.id) ?: return@forEach
            terminalizeExpired(locked, current)
        }
        val invitations = invitationRepository.findByTeamIdOrderByCreatedAtDescIdDesc(team.id).take(1)
        val total = invitations.size
        val offset = page.toLong() * size
        val items = if (offset >= total) emptyList() else invitations
            .drop(offset.toInt())
            .take(size)
            .map { invitationMetadata(it, actorId) }
        return TeamInvitationListDto(
            items = items,
            page = page,
            size = size,
            totalElements = total.toLong(),
            totalPages = pages(total, size),
        )
    }

    @Transactional
    fun reveal(actor: User, teamId: String, invitationId: String): TeamInvitationLinkDto {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        transactionGuard.applyLockTimeout()
        val team = lockManagedTeam(actorId, teamId)
        val invitation = invitationRepository.lockByIdAndTeamId(invitationId, team.id) ?: throw invitationLinkUnavailable()
        terminalizeExpired(invitation, now())
        if (!isUsable(invitation, team) || !hasRecoveryPair(invitation)) {
            throw invitationLinkUnavailable()
        }
        val token = try {
            val envelope = requireNotNull(invitation.recoverableTokenEnvelope)
            val keyVersion = requireNotNull(invitation.recoveryKeyVersion)
            linkCipher.decrypt(keyVersion, envelope, recoveryAad(invitation.id, team.id, invitation.creatorUserId))
        } catch (_: Exception) {
            throw invitationRecoveryUnavailable()
        }
        val validHash = MessageDigest.isEqual(
            sha256(token).toByteArray(StandardCharsets.US_ASCII),
            invitation.tokenHash.toByteArray(StandardCharsets.US_ASCII),
        )
        if (!validHash) throw invitationRecoveryUnavailable()
        return TeamInvitationLinkDto("/join/team#token=$token")
    }

    fun validateToken(rawToken: String) {
        tokenHash(rawToken)
    }

    private fun lockManagedTeam(actorId: String, teamId: String): Team {
        val team = teamRepository.lockById(teamId)?.takeIf { it.state == "ACTIVE" } ?: throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == "ACTIVE" }
            ?: throw teamNotFound()
        if (team.ownerUserId != actorId && membership.role != "ADMIN") {
            throw secure(HttpStatus.FORBIDDEN, "INVITATION_MANAGEMENT_FORBIDDEN", "Недостаточно прав")
        }
        lifecycleBarrier.afterTeamLockBeforeInvitationLock()
        return team
    }

    private fun isUsable(invitation: TeamInvitation, team: Team): Boolean {
        val creator = membershipRepository.findByTeamIdAndUserId(team.id, invitation.creatorUserId)
        return team.state == "ACTIVE" && invitation.state == "PENDING" && invitation.expiresAt.isAfter(now()) &&
            creator?.state == "ACTIVE" && (team.ownerUserId == invitation.creatorUserId || creator.role == "ADMIN") &&
            invitationRepository.findByTeamIdOrderByCreatedAtDescIdDesc(team.id).firstOrNull()?.id == invitation.id
    }

    private fun rotate(invitation: TeamInvitation, actorId: String, current: Instant) {
        val token = newToken()
        invitation.tokenHash = sha256(token)
        invitation.creatorUserId = actorId
        invitation.role = "MEMBER"
        invitation.state = "PENDING"
        invitation.acceptedBy = null
        invitation.acceptedAt = null
        invitation.expiresAt = current.plus(7, ChronoUnit.DAYS)
        invitation.updatedAt = current
        invitation.revision += 1
        invitation.recoverableTokenEnvelope = linkCipher.encrypt(token, recoveryAad(invitation.id, invitation.teamId, actorId))
        invitation.recoveryKeyVersion = linkCipher.activeKeyId()
    }

    private fun terminalizeExpired(invitation: TeamInvitation, current: Instant): Boolean {
        if (invitation.state != "PENDING" || invitation.expiresAt.isAfter(current)) return false
        val changed = hasRecoveryPair(invitation)
        if (changed) {
            clearRecovery(invitation)
            invitation.revision += 1
            invitation.updatedAt = current
            invitationRepository.saveAndFlush(invitation)
        }
        return true
    }

    private fun clearRecovery(invitation: TeamInvitation) {
        invitation.recoverableTokenEnvelope = null
        invitation.recoveryKeyVersion = null
    }

    private fun hasRecoveryPair(invitation: TeamInvitation): Boolean =
        invitation.recoverableTokenEnvelope != null && invitation.recoveryKeyVersion != null

    private fun invitationMetadata(invitation: TeamInvitation, actorId: String): TeamInvitationDto {
        val expired = invitation.state == "PENDING" && !invitation.expiresAt.isAfter(now())
        val state = if (expired) "EXPIRED" else invitation.state
        val recoverability = when {
            state != "PENDING" -> "NOT_APPLICABLE"
            hasRecoveryPair(invitation) -> "RECOVERABLE"
            else -> "UNRECOVERABLE_LEGACY"
        }
        return TeamInvitationDto(
            id = invitation.id,
            state = state,
            role = invitation.role,
            expiresAt = invitation.expiresAt,
            revision = invitation.revision,
            canReveal = state == "PENDING" && recoverability == "RECOVERABLE",
            linkRecoverability = recoverability,
        )
    }

    private fun commandResult(invitation: TeamInvitation, actorId: String) = InvitationCommandResult(
        invitation = invitationMetadata(invitation, actorId),
        location = "/api/teams/${invitation.teamId}/invitations/${invitation.id}",
    )

    private fun parsePage(pageRaw: String?, sizeRaw: String?): Pair<Int, Int> {
        val page = pageRaw?.toIntOrNull() ?: if (pageRaw == null) 0 else throw invalidListQuery()
        val size = sizeRaw?.toIntOrNull() ?: if (sizeRaw == null) DEFAULT_PAGE_SIZE else throw invalidListQuery()
        if (page < 0 || size !in 1..MAX_PAGE_SIZE) throw invalidListQuery()
        return page to size
    }

    private fun pages(total: Int, size: Int): Int = if (total == 0) 0 else (total + size - 1) / size

    private fun requireRevision(invitation: TeamInvitation, revision: Long) {
        if (invitation.revision != revision) {
            throw secure(HttpStatus.CONFLICT, "REVISION_CONFLICT", "Приглашение изменилось")
        }
    }

    private fun receiptId(actorId: String, teamId: String, operation: String, key: UUID) =
        CommandReceiptId(actorId, SCOPE_TEAM, teamId, operation, key.toString())

    private fun receipt(id: CommandReceiptId, requestHash: String, outcome: String, status: Int, resourceId: String, now: Instant) {
        val receiptNow = databaseTime.now().truncatedTo(ChronoUnit.MICROS)
        receiptRepository.saveAndFlush(
            CommandReceipt(
                id = id,
                requestHash = requestHash,
                outcome = outcome,
                status = status,
                resourceId = resourceId,
                createdAt = receiptNow,
                expiresAt = receiptNow.plus(24, ChronoUnit.HOURS),
            ),
        )
    }

    private fun audit(actorId: String, teamId: String, action: TeamAuditAction, invitationId: String, targetUserId: String? = null, now: Instant) {
        teamAuditWriter.append(
            actorUserId = actorId,
            teamId = teamId,
            action = action,
            createdAt = now,
            targetUserId = targetUserId,
            opaqueEntityId = invitationId,
        )
    }

    private fun newToken(): String = ByteArray(32).also(secureRandom::nextBytes).let(Base64.getUrlEncoder().withoutPadding()::encodeToString)

    private fun tokenHash(rawToken: String): String {
        if (!TOKEN_PATTERN.matches(rawToken)) throw secure(HttpStatus.BAD_REQUEST, "INVALID_INVITATION_TOKEN", "Некорректное приглашение")
        return sha256(rawToken)
    }

    private fun recoveryAad(invitationId: String, teamId: String, creatorUserId: String): String =
        "team-invitation-recovery:v1:$invitationId:$teamId:$creatorUserId"

    private fun requestHash(canonical: String): String = "v1:${sha256(canonical)}"

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }

    private fun requireMatchingReceipt(receipt: CommandReceipt, requestHash: String) {
        if (receipt.requestHash != requestHash) throw idempotencyConflict()
    }

    private fun requireActiveReceipt(receipt: CommandReceipt) {
        if (!databaseTime.isReceiptActive(receipt.id)) throw commandNotFound()
    }

    private fun bumpMergeRevision(team: Team, changedAt: Instant) {
        team.mergeRevision += 1
        team.updatedAt = changedAt
        teamRepository.saveAndFlush(team)
    }

    private fun bumpMembershipRevisions(team: Team, changedAt: Instant) {
        team.securityRevision += 1
        team.mergeRevision += 1
        team.updatedAt = changedAt
        teamRepository.saveAndFlush(team)
    }

    private fun now(): Instant = databaseTime.now().truncatedTo(ChronoUnit.MICROS)

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun invitationUnavailable() = secure(HttpStatus.GONE, "INVITATION_UNAVAILABLE", "Приглашение недоступно")
    private fun invitationLinkUnavailable() = secure(HttpStatus.GONE, "INVITATION_LINK_UNAVAILABLE", "Ссылка недоступна")
    private fun invitationRecoveryUnavailable() = ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "Восстановление ссылки временно недоступно",
        HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, "5") },
        "INVITATION_LINK_RECOVERY_UNAVAILABLE",
    )
    private fun invalidListQuery() = secure(HttpStatus.BAD_REQUEST, "INVALID_LIST_QUERY", "Некорректные параметры списка")
    private fun commandNotFound() = secure(HttpStatus.NOT_FOUND, "COMMAND_NOT_FOUND", "Команда не найдена")
    private fun idempotencyConflict() = secure(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "Ключ уже использован")
}
