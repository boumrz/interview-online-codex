package com.interviewonline.service

import com.interviewonline.dto.TeamProcessLabelDto
import com.interviewonline.dto.TeamProcessListDto
import com.interviewonline.model.User
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.TeamMembershipRepository
import com.interviewonline.repository.TeamRepository
import com.interviewonline.repository.TeamTrackRepository
import com.interviewonline.repository.TeamVacancyRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class TeamProcessService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val participantRepository: RoomParticipantRepository,
    private val trackRepository: TeamTrackRepository,
    private val vacancyRepository: TeamVacancyRepository,
) {
    @Transactional(readOnly = true)
    fun list(actor: User, teamId: String): TeamProcessListDto {
        val actorId = requireNotNull(actor.id)
        val team = teamRepository.findById(teamId).orElse(null)
            ?.takeIf { it.state == "ACTIVE" } ?: throw teamNotFound()
        membershipRepository.findByTeamIdAndUserId(team.id, actorId)
            ?.takeIf { it.state == "ACTIVE" } ?: throw teamNotFound()
        return TeamProcessListDto(labelsByUser(team.id, listOf(actorId))[actorId].orEmpty())
    }

    @Transactional(readOnly = true)
    fun labelsByUser(teamId: String, userIds: Collection<String>): Map<String, List<TeamProcessLabelDto>> {
        if (userIds.isEmpty()) return emptyMap()
        val roomsByUser = userIds.associateWith { userId ->
            participantRepository.findAllByUserId(userId)
                .mapNotNull { it.room }
                .filter { room -> room.teamId == teamId && room.archivedAt == null && room.teamTrackId != null }
        }
        val trackIds = roomsByUser.values.flatten().mapNotNull { it.teamTrackId }.toSet()
        if (trackIds.isEmpty()) return emptyMap()
        val tracks = trackRepository.findByTeamIdAndIdIn(teamId, trackIds).associateBy { requireNotNull(it.id) }
        val vacancyIds = roomsByUser.values.flatten().mapNotNull { it.teamVacancyId }.toSet()
        val vacancies = if (vacancyIds.isEmpty()) emptyMap() else
            vacancyRepository.findByTeamIdAndIdIn(teamId, vacancyIds).associateBy { requireNotNull(it.id) }
        return roomsByUser.mapValues { (_, rooms) ->
            rooms.mapNotNull { room ->
                val trackId = room.teamTrackId ?: return@mapNotNull null
                val track = tracks[trackId] ?: return@mapNotNull null
                val vacancy = room.teamVacancyId?.let(vacancies::get)
                TeamProcessLabelDto(trackId, track.name, vacancy?.id, vacancy?.title)
            }.distinctBy { it.trackId to it.vacancyId }
                .sortedWith(compareBy<TeamProcessLabelDto> { it.trackName }.thenBy { it.vacancyTitle.orEmpty() }.thenBy { it.trackId })
        }
    }

    private fun teamNotFound() = secure(HttpStatus.NOT_FOUND, "TEAM_NOT_FOUND", "Команда не найдена")
}
