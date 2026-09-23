package com.interviewonline.service

import com.interviewonline.model.TeamAuditAction
import com.interviewonline.model.TeamAuditEvent
import com.interviewonline.repository.TeamAuditEventRepository
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

/** Keeps production team-audit writes within the closed TeamAuditAction vocabulary. */
@Service
class TeamAuditWriter(
    private val auditRepository: TeamAuditEventRepository,
) {
    fun append(
        actorUserId: String,
        teamId: String,
        action: TeamAuditAction,
        createdAt: Instant,
        targetUserId: String? = null,
        opaqueEntityId: String? = null,
        originTeamId: String = teamId,
    ) {
        auditRepository.saveAndFlush(
            TeamAuditEvent(
                id = UUID.randomUUID().toString(),
                teamId = teamId,
                originTeamId = originTeamId,
                actorUserId = actorUserId,
                targetUserId = targetUserId,
                action = action.name,
                createdAt = createdAt,
                outcome = "SUCCESS",
                opaqueEntityId = opaqueEntityId,
            ),
        )
    }
}
