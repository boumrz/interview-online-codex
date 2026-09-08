package com.interviewonline.dto

import com.interviewonline.ws.CandidateKeyPayload

data class CandidateActivityHistoryDto(
    val events: List<CandidateKeyPayload>,
    val hasMore: Boolean,
    val nextBeforeSequence: Long?,
    val nextAfterSequence: Long?,
    val throughSequence: Long,
)
