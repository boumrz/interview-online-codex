package com.interviewonline.service

import com.interviewonline.dto.TeamAuditEventDto
import com.interviewonline.dto.TeamAuditIdentityDto
import com.interviewonline.dto.TeamAuditPageDto
import com.interviewonline.model.Team
import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamAuditEvent
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.User
import com.interviewonline.repository.TeamAuditEventRepository
import com.interviewonline.repository.TeamInvitationRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.util.MultiValueMap
import java.text.Normalizer

/**
 * Publicly safe, read-only projection of append-only team audit storage.
 * The storage model intentionally remains private: this service is the only
 * boundary that maps historic actions, outcomes, and identities for clients.
 */
@Service
class TeamAuditReadService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val userRepository: UserRepository,
    private val auditRepository: TeamAuditEventRepository,
    private val invitationRepository: TeamInvitationRepository,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String, rawParams: MultiValueMap<String, String>): TeamAuditPageDto {
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(teamId).orElse(null)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        val membership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == ACTIVE }
            ?: throw teamNotFound()
        if (!isManager(team, membership)) throw auditForbidden()

        val query = parseQuery(rawParams)
        val events = auditRepository.findByTeamId(
            team.id,
            PageRequest.of(query.page, query.size, AUDIT_SORT),
        )
        val activeMemberships = membershipRepository.findByTeamIdAndState(team.id, ACTIVE)
            .associateBy { it.userId }
        val activeUsers = userRepository.findAllById(activeMemberships.keys)
            .mapNotNull { user -> user.id?.let { it to user } }
            .toMap()

        return TeamAuditPageDto(
            items = events.content.map { event -> project(event, team.id, activeMemberships, activeUsers) },
            page = query.page,
            size = query.size,
            totalElements = events.totalElements,
            totalPages = events.totalPages,
        )
    }

    private fun project(
        event: TeamAuditEvent,
        teamId: String,
        activeMemberships: Map<String, TeamMembership>,
        activeUsers: Map<String, User>,
    ): TeamAuditEventDto {
        val knownAction = TeamAuditAction.fromStorageValue(event.action)
        return TeamAuditEventDto(
            id = event.id,
            action = knownAction?.name ?: LEGACY_UNCLASSIFIED,
            createdAt = event.createdAt,
            outcome = SUCCESS,
            actor = identity(event.actorUserId, activeMemberships, activeUsers),
            target = event.targetUserId?.let { identity(it, activeMemberships, activeUsers) },
            entityId = event.opaqueEntityId
                ?.takeIf { knownAction?.isInvitationAction == true }
                ?.takeIf { invitationRepository.existsByIdAndTeamId(it, teamId) },
        )
    }

    private fun identity(
        userId: String,
        activeMemberships: Map<String, TeamMembership>,
        activeUsers: Map<String, User>,
    ): TeamAuditIdentityDto? {
        if (activeMemberships[userId] == null) return null
        val user = activeUsers[userId] ?: return null
        return TeamAuditIdentityDto(userId, safeDisplayName(user.displayName))
    }

    private fun safeDisplayName(raw: String?): String {
        val normalized = raw
            ?.let { Normalizer.normalize(it, Normalizer.Form.NFKC) }
            ?.trim { it.isWhitespace() }
            .orEmpty()
        return normalized.takeIf { value ->
            value.isNotEmpty() && value.codePoints().noneMatch { codePoint ->
                Character.isISOControl(codePoint) || Character.getType(codePoint) == Character.FORMAT.toInt()
            }
        } ?: FALLBACK_DISPLAY_NAME
    }

    private fun parseQuery(rawParams: MultiValueMap<String, String>): AuditQuery {
        if (rawParams.keys.any { it !in QUERY_KEYS } || rawParams.values.any { it.size != 1 }) {
            throw invalidAuditQuery()
        }
        val page = parseNonNegativeInt(rawParams.getFirst("page"), 0)
        val size = parseNonNegativeInt(rawParams.getFirst("size"), DEFAULT_PAGE_SIZE)
        if (page !in 0..MAX_PAGE_NUMBER || size !in 1..MAX_PAGE_SIZE) throw invalidAuditQuery()
        return AuditQuery(page, size)
    }

    private fun parseNonNegativeInt(raw: String?, default: Int): Int {
        if (raw == null) return default
        if (!NON_NEGATIVE_DECIMAL.matches(raw)) throw invalidAuditQuery()
        return raw.toIntOrNull() ?: throw invalidAuditQuery()
    }

    private fun isManager(team: Team, membership: TeamMembership): Boolean =
        team.ownerUserId == membership.userId || membership.role == ADMIN

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun auditForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_AUDIT_FORBIDDEN", "Недостаточно прав для просмотра аудита")
    private fun invalidAuditQuery() = secure(HttpStatus.BAD_REQUEST, "INVALID_AUDIT_QUERY", "Некорректные параметры аудита")

    private data class AuditQuery(val page: Int, val size: Int)

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val ADMIN = "ADMIN"
        const val SUCCESS = "SUCCESS"
        const val LEGACY_UNCLASSIFIED = "LEGACY_UNCLASSIFIED"
        const val DEFAULT_PAGE_SIZE = 25
        const val MAX_PAGE_SIZE = 100
        const val MAX_PAGE_NUMBER = 10_000
        const val FALLBACK_DISPLAY_NAME = "Участник"
        val NON_NEGATIVE_DECIMAL = Regex("(?:0|[1-9][0-9]*)")
        val QUERY_KEYS = setOf("page", "size")
        val AUDIT_SORT = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))
    }
}
