package com.interviewonline.service

import com.interviewonline.model.RoomKeystrokeEvent
import com.interviewonline.ws.CandidateKeyPayload

internal fun CandidateKeyPayload.toEntity(roomId: String): RoomKeystrokeEvent = RoomKeystrokeEvent(
    roomId = roomId,
    sessionId = sessionId,
    displayName = displayName,
    keyValue = key.ifEmpty { null },
    keyCode = keyCode.ifBlank { null },
    ctrlKey = ctrlKey,
    altKey = altKey,
    shiftKey = shiftKey,
    metaKey = metaKey,
    eventKind = eventKind,
    pasteLength = pasteLength,
    pastePreview = pastePreview,
    timestampEpochMs = timestampEpochMs,
    sourceEventId = sourceEventId,
    acceptedSequence = acceptedSequence,
)

internal fun RoomKeystrokeEvent.toPayload(): CandidateKeyPayload = CandidateKeyPayload(
    sessionId = sessionId,
    displayName = displayName,
    key = keyValue.orEmpty(),
    keyCode = keyCode.orEmpty(),
    ctrlKey = ctrlKey,
    altKey = altKey,
    shiftKey = shiftKey,
    metaKey = metaKey,
    timestampEpochMs = timestampEpochMs,
    eventKind = eventKind,
    pasteLength = pasteLength,
    pastePreview = pastePreview,
    sourceEventId = sourceEventId,
    acceptedSequence = acceptedSequence,
)
