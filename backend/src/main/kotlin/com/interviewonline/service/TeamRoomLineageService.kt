package com.interviewonline.service

import com.interviewonline.model.Room
import com.interviewonline.repository.TeamRepository
import org.springframework.stereotype.Service

@Service
class TeamRoomLineageService(private val teamRepository: TeamRepository) {
    fun isCanonical(room: Room): Boolean {
        if (!room.teamInterviewCreated) return false
        val currentTeamId = room.teamId ?: return false
        val originTeamId = room.originTeamId ?: return false
        if (originTeamId == currentTeamId) return true
        val visited = mutableSetOf<String>()
        var ancestorId = originTeamId
        while (visited.add(ancestorId)) {
            val ancestor = teamRepository.findById(ancestorId).orElse(null)
                ?.takeIf { it.state == "MERGED" } ?: return false
            val next = ancestor.mergedIntoTeamId ?: return false
            if (next == currentTeamId) return true
            ancestorId = next
        }
        return false
    }
}
