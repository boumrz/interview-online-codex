package com.interviewonline.service

import com.interviewonline.dto.TeamMemberDirectoryDto
import com.interviewonline.dto.TeamMemberDirectoryItemDto
import com.interviewonline.model.Team
import com.interviewonline.model.TeamMembership
import com.interviewonline.model.User
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.UserRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.text.Normalizer
import java.util.Locale

@Service
class TeamMemberDirectoryService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val userRepository: UserRepository,
    private val processService: TeamProcessService,
    private val featureGate: TeamWorkspaceFeatureGate,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String, pageRaw: String?, sizeRaw: String?, rawQuery: String?, stateRaw: String?): TeamMemberDirectoryDto {
        featureGate.requireEnabled()
        val actorId = requireNotNull(actor.id)
        val query = parseQuery(pageRaw, sizeRaw, rawQuery, stateRaw)
        val team = teamRepository.findById(teamId).orElse(null)?.takeIf { it.state == "ACTIVE" } ?: throw teamNotFound()
        val actorMembership = membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == "ACTIVE" }
            ?: throw teamNotFound()
        if (query.state != ACTIVE && !isManager(team, actorMembership)) throw memberListForbidden()

        val memberships = membershipRepository.findByTeamIdAndState(team.id, query.state)
        val users = userRepository.findAllById(memberships.map { it.userId })
            .associateBy { requireNotNull(it.id) }
        val participants = memberships
            .mapNotNull { membership -> users[membership.userId]?.let { user -> Participant(team, membership, displayName(user)) } }
            .filter { participant -> query.normalizedName.isEmpty() || normalized(participant.displayName).contains(query.normalizedName) }
            .sortedWith(
                compareBy<Participant> { roleRank(it.role) }
                    .thenBy { normalized(it.displayName) }
                    .thenBy { it.membership.userId },
            )

        val offset = query.page.toLong() * query.size
        val pageParticipants = if (offset >= participants.size) emptyList() else participants
            .drop(offset.toInt())
            .take(query.size)
        val processLabels = if (query.state == ACTIVE) {
            processService.labelsByUser(team.id, pageParticipants.map { it.membership.userId })
        } else emptyMap()
        val items = pageParticipants
            .map {
                TeamMemberDirectoryItemDto(
                    userId = it.membership.userId,
                    displayName = it.displayName,
                    role = it.role,
                    state = it.membership.state,
                    revision = it.membership.revision,
                    processes = processLabels[it.membership.userId].orEmpty(),
                )
            }
        return TeamMemberDirectoryDto(
            items = items,
            page = query.page,
            size = query.size,
            totalElements = participants.size.toLong(),
            totalPages = if (participants.isEmpty()) 0 else (participants.size + query.size - 1) / query.size,
        )
    }

    private fun parseQuery(pageRaw: String?, sizeRaw: String?, rawQuery: String?, stateRaw: String?): DirectoryQuery {
        val page = pageRaw?.toIntOrNull() ?: if (pageRaw == null) 0 else throw invalidListQuery()
        val size = sizeRaw?.toIntOrNull() ?: if (sizeRaw == null) DEFAULT_PAGE_SIZE else throw invalidListQuery()
        val normalizedName = rawQuery?.let(::normalized).orEmpty()
        val state = stateRaw?.trim()?.uppercase(Locale.ROOT) ?: ACTIVE
        if (page < 0 || size !in 1..MAX_PAGE_SIZE || normalizedName.codePointCount(0, normalizedName.length) > MAX_QUERY_CODE_POINTS) {
            throw invalidListQuery()
        }
        if (state !in PUBLIC_STATES) throw invalidListQuery()
        return DirectoryQuery(page, size, normalizedName, state)
    }

    private fun displayName(user: User): String = user.displayName
        ?.trim { it.isWhitespace() }
        ?.takeIf { it.isNotEmpty() }
        ?: FALLBACK_DISPLAY_NAME

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .trim { it.isWhitespace() }
        .lowercase(Locale.ROOT)

    private val Participant.role: String
        get() = if (team.ownerUserId == membership.userId) "OWNER" else membership.role

    private fun roleRank(role: String): Int = when (role) {
        "OWNER" -> 0
        "ADMIN" -> 1
        else -> 2
    }

    private fun isManager(team: Team, membership: TeamMembership): Boolean =
        team.ownerUserId == membership.userId || membership.role == ADMIN

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
    private fun memberListForbidden() = secure(HttpStatus.FORBIDDEN, "TEAM_MEMBER_LIST_FORBIDDEN", "Недостаточно прав для просмотра списка")
    private fun invalidListQuery() = secure(HttpStatus.BAD_REQUEST, "INVALID_LIST_QUERY", "Некорректные параметры списка")

    private data class DirectoryQuery(val page: Int, val size: Int, val normalizedName: String, val state: String)
    private data class Participant(val team: Team, val membership: TeamMembership, val displayName: String)

    private companion object {
        const val ACTIVE = "ACTIVE"
        const val SUSPENDED = "SUSPENDED"
        const val ADMIN = "ADMIN"
        const val DEFAULT_PAGE_SIZE = 25
        const val MAX_PAGE_SIZE = 100
        const val MAX_QUERY_CODE_POINTS = 200
        const val FALLBACK_DISPLAY_NAME = "Участник"
        val PUBLIC_STATES = setOf(ACTIVE, SUSPENDED)
    }
}
