package com.interviewonline.service

import com.interviewonline.dto.CommandOutcomeDto
import com.interviewonline.dto.TeamCreateResponse
import com.interviewonline.dto.TeamDetailDto
import com.interviewonline.dto.TeamMembershipDto
import com.interviewonline.dto.TeamSummaryDto
import com.interviewonline.dto.WorkspaceDto
import com.interviewonline.model.CommandReceipt
import com.interviewonline.model.CommandReceiptId
import com.interviewonline.model.Team
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.User
import com.interviewonline.repository.CommandReceiptRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.Normalizer
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

@Service
class WorkspaceService(
    private val userRepository: UserRepository,
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val teamAuditWriter: TeamAuditWriter,
    private val receiptRepository: CommandReceiptRepository,
    private val featureGate: TeamWorkspaceFeatureGate,
) {
    companion object {
        private const val SCOPE_PERSONAL = "PERSONAL"
        private const val TEAM_CREATE = "TEAM_CREATE"
        private val TEAM_CAPABILITIES = listOf("INTERVIEWS", "LIBRARY", "TRACKS", "MEMBERS", "TEAM_SETTINGS")
        private val PERSONAL_CAPABILITIES = listOf("INTERVIEWS", "LIBRARY")
    }

    @Transactional
    fun createTeam(actor: User, rawName: String, key: UUID): TeamCreateResponse {
        val actorId = requireNotNull(actor.id)
        val storedActor = userRepository.lockById(actorId)
            ?: throw secure(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "Требуется авторизация")
        featureGate.requireEnabled()

        val name = canonicalName(rawName)
        val requestHash = requestHash(name)
        val receiptId = CommandReceiptId(actorId, SCOPE_PERSONAL, actorId, TEAM_CREATE, key.toString())
        val existing = receiptRepository.findById(receiptId).orElse(null)
        if (existing != null) {
            val team = currentlyAccessibleTeam(existing, storedActor)
                ?: throw commandNotFound()
            if (!existing.expiresAt.isAfter(Instant.now())) {
                throw commandNotFound()
            }
            if (existing.requestHash != requestHash) {
                throw secure(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "Ключ уже использован для другой команды")
            }
            val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
                ?: throw commandNotFound()
            return createResponse(team, membership)
        }

        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val teamId = UUID.randomUUID().toString()
        try {
            val team = teamRepository.saveAndFlush(
                Team(
                    id = teamId,
                    name = name,
                    normalizedName = name.lowercase(Locale.ROOT),
                    ownerUserId = actorId,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
            val membership = membershipRepository.saveAndFlush(
                TeamMembership(
                    id = UUID.randomUUID().toString(),
                    teamId = teamId,
                    userId = actorId,
                    role = "ADMIN",
                    state = "ACTIVE",
                    createdAt = now,
                    updatedAt = now,
                ),
            )
            teamAuditWriter.append(
                actorUserId = actorId,
                teamId = teamId,
                action = TeamAuditAction.TEAM_CREATE,
                createdAt = now,
                opaqueEntityId = teamId,
            )
            receiptRepository.saveAndFlush(
                CommandReceipt(
                    id = receiptId,
                    requestHash = requestHash,
                    outcome = "CREATED",
                    status = 201,
                    resourceId = teamId,
                    createdAt = now,
                    expiresAt = now.plus(24, ChronoUnit.HOURS),
                ),
            )
            return createResponse(team, membership)
        } catch (ex: DataAccessException) {
            throw secure(HttpStatus.SERVICE_UNAVAILABLE, "TEAM_CREATE_UNAVAILABLE", "Команду не удалось создать")
        }
    }

    @Transactional(readOnly = true)
    fun listWorkspaces(actor: User): List<WorkspaceDto> {
        val actorId = requireNotNull(actor.id)
        val teamWorkspaces = membershipRepository.findActiveForUser(actorId).mapNotNull { membership ->
            val team = teamRepository.findById(membership.teamId).orElse(null) ?: return@mapNotNull null
            WorkspaceDto(
                id = team.id,
                name = team.name,
                role = effectiveRole(team, membership),
                epoch = membership.epoch,
                capabilities = TEAM_CAPABILITIES,
            )
        }
        return listOf(
            WorkspaceDto(
                id = "personal",
                name = "Личное пространство",
                role = "OWNER",
                epoch = 0,
                capabilities = PERSONAL_CAPABILITIES,
            ),
        ) + teamWorkspaces
    }

    @Transactional(readOnly = true)
    fun teamDetail(actor: User, teamId: String): TeamDetailDto {
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(teamId).orElse(null)?.takeIf { it.state == "ACTIVE" }
            ?: throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(teamId, actorId)
            ?.takeIf { it.state == "ACTIVE" }
            ?: throw teamNotFound()
        return TeamDetailDto(
            id = team.id,
            name = team.name,
            role = effectiveRole(team, membership),
            epoch = membership.epoch,
            capabilities = TEAM_CAPABILITIES,
            revision = team.revision,
        )
    }

    @Transactional(readOnly = true)
    fun commandOutcome(actor: User, rawKey: String, scope: String?, operation: String?): CommandOutcomeDto {
        val actorId = requireNotNull(actor.id)
        if (!scope.equals("personal", ignoreCase = true) || operation != TEAM_CREATE) throw commandNotFound()
        val key = canonicalUuid(rawKey) ?: throw commandNotFound()
        val receipt = receiptRepository.findById(CommandReceiptId(actorId, SCOPE_PERSONAL, actorId, TEAM_CREATE, key.toString()))
            .orElse(null) ?: throw commandNotFound()
        if (!receipt.expiresAt.isAfter(Instant.now())) throw commandNotFound()
        currentlyAccessibleTeam(receipt, actor) ?: throw commandNotFound()
        return CommandOutcomeDto(receipt.outcome, receipt.status, receipt.resourceId)
    }

    private fun currentlyAccessibleTeam(receipt: CommandReceipt, actor: User): Team? {
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(receipt.resourceId).orElse(null)?.takeIf { it.state == "ACTIVE" } ?: return null
        return team.takeIf { membershipRepository.existsByTeamIdAndUserIdAndState(team.id, actorId, "ACTIVE") }
    }

    private fun createResponse(team: Team, membership: TeamMembership) = TeamCreateResponse(
        team = TeamSummaryDto(team.id, team.name),
        membership = TeamMembershipDto(effectiveRole(team, membership), membership.state, membership.epoch),
        capabilities = TEAM_CAPABILITIES,
    )

    private fun effectiveRole(team: Team, membership: TeamMembership): String =
        if (team.ownerUserId == membership.userId && membership.state == "ACTIVE") "OWNER" else membership.role

    private fun canonicalName(raw: String): String {
        val value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim { it.isWhitespace() }
        val codePoints = value.codePointCount(0, value.length)
        if (codePoints !in 1..100) {
            throw secure(HttpStatus.BAD_REQUEST, "INVALID_TEAM_NAME", "Название команды должно содержать от 1 до 100 символов")
        }
        return value
    }

    private fun requestHash(name: String): String {
        val canonical = "team-create:v1\nname=$name"
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(StandardCharsets.UTF_8))
        return "v1:" + digest.joinToString("") { "%02x".format(it) }
    }

    private fun canonicalUuid(raw: String): UUID? {
        val parsed = runCatching { UUID.fromString(raw) }.getOrNull() ?: return null
        return parsed.takeIf { it.toString().equals(raw, ignoreCase = true) }
    }

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun commandNotFound() = secure(HttpStatus.NOT_FOUND, "COMMAND_NOT_FOUND", "Команда не найдена")
}

fun secure(status: HttpStatus, code: String, message: String): ApiException =
    ApiException(status, message, code = code)
