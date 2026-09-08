package com.interviewonline.service

import com.interviewonline.dto.CandidateActivityHistoryDto
import com.interviewonline.model.User
import com.interviewonline.repository.RoomKeystrokeEventRepository
import com.interviewonline.repository.RoomRepository
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class CandidateActivityHistoryService(
    private val roomRepository: RoomRepository,
    private val eventRepository: RoomKeystrokeEventRepository,
    private val roomAccessService: RoomAccessService,
    private val collaborationService: CollaborationService,
) {
    @Transactional(readOnly = true)
    fun history(
        inviteCode: String,
        user: User?,
        ownerToken: String?,
        interviewerToken: String?,
        eventToken: String?,
        limit: Int,
        beforeSequence: Long?,
        afterSequence: Long?,
        throughSequence: Long?,
    ): CandidateActivityHistoryDto {
        val room = roomRepository.findByInviteCode(inviteCode)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Комната не найдена")
        roomAccessService.requireManager(
            room, user, ownerToken, interviewerToken,
            collaborationService.resolveRoleByEventToken(inviteCode, eventToken),
        )
        if (limit !in 1..200 ||
            listOfNotNull(beforeSequence, afterSequence, throughSequence).any { it < 0L } ||
            (beforeSequence != null && afterSequence != null)
        ) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректные параметры истории активности")

        val roomId = requireNotNull(room.id)
        val committedMaximum = eventRepository
            .findFirstByRoomIdAndAcceptedSequenceIsNotNullOrderByAcceptedSequenceDesc(roomId)
            ?.acceptedSequence ?: 0L
        val frozenThrough = throughSequence?.coerceAtMost(committedMaximum) ?: committedMaximum
        val page = PageRequest.of(0, limit + 1)
        val rows = if (afterSequence != null) {
            eventRepository.findActivityAfter(roomId, afterSequence, frozenThrough, page)
        } else {
            eventRepository.findActivityBefore(roomId, beforeSequence, frozenThrough, page)
        }
        val selected = rows.take(limit)
        val hasMore = rows.size > limit
        return CandidateActivityHistoryDto(
            events = selected.map { it.toPayload() }
                .sortedWith(compareBy({ it.timestampEpochMs }, { it.acceptedSequence })),
            hasMore = hasMore,
            nextBeforeSequence = if (hasMore && afterSequence == null) selected.minOf { requireNotNull(it.acceptedSequence) } else null,
            nextAfterSequence = if (hasMore && afterSequence != null) selected.maxOf { requireNotNull(it.acceptedSequence) } else null,
            throughSequence = frozenThrough,
        )
    }
}
