package com.interviewonline.service

import com.interviewonline.dto.PersonalInterviewListTaskDto
import com.interviewonline.dto.RoomSummaryDto
import com.interviewonline.model.Room
import com.interviewonline.repository.RoomParticipantRepository
import com.interviewonline.repository.RoomRepository
import com.interviewonline.repository.RoomTaskRepository
import org.springframework.stereotype.Service

@Service
class PersonalInterviewSummaryProjector(
    private val tasks: RoomTaskRepository,
    private val rooms: RoomRepository,
    private val participants: RoomParticipantRepository,
) {
    fun project(entries: List<Pair<Room, String>>): List<RoomSummaryDto> {
        if (entries.isEmpty()) return emptyList()
        val roomIds = entries.map { requireNotNull(it.first.id) }
        val taskRows = tasks.findPersonalSummaryTaskRows(roomIds).groupBy { it.roomId }
        val managerRoomIds = entries.filter { it.second in setOf("owner", "interviewer") }.map { requireNotNull(it.first.id) }
        val managerNames = if (managerRoomIds.isEmpty()) emptyMap() else {
            (rooms.findPersonalSummaryOwnerNames(managerRoomIds) + participants.findPersonalSummaryInterviewerNames(managerRoomIds))
                .groupBy { it.roomId }.mapValues { (_, rows) ->
                    rows.distinctBy { it.userId }.mapNotNull { it.displayName?.trim()?.takeIf(String::isNotEmpty) }
                }
        }
        return entries.map { (room, accessRole) ->
            val compactTasks = taskRows[room.id].orEmpty().map {
                PersonalInterviewListTaskDto(it.stepIndex, it.title, LanguageNormalizer.normalize(it.language), it.mandatory)
            }
            RoomSummaryDto(
                id = requireNotNull(room.id), title = room.title, inviteCode = room.inviteCode, language = room.language,
                accessRole = accessRole, createdAt = room.createdAt.toString(),
                ownerToken = if (accessRole == "owner" && room.ownerUser == null) room.ownerSessionToken else null,
                interviewerToken = null, verdict = room.verdict, status = room.status ?: "active",
                taskCount = compactTasks.size, tasks = compactTasks, finishedAt = room.finishedAt?.toString(),
                interviewerDisplayNames = managerNames[room.id].orEmpty(),
            )
        }
    }
}
