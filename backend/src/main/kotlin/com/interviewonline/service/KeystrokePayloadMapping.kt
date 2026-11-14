package com.interviewonline.service

import com.interviewonline.model.RoomKeystrokeEvent
import com.interviewonline.ws.CandidateKeyPayload
import java.nio.ByteBuffer
import java.util.HexFormat

// PostgreSQL text cannot represent NUL or unmatched UTF-16 surrogates. In particular,
// a browser's length-limited paste preview can end between the two halves of an emoji.
// Reserve "~" for hex-encoded UTF-16 code units in new rows only.
private fun encodeField(value: String): String {
    if (!value.startsWith('~') && value.codePoints().noneMatch { it == 0 || it in 0xD800..0xDFFF }) return value
    val bytes = ByteBuffer.allocate(value.length * Char.SIZE_BYTES)
    bytes.asCharBuffer().put(value)
    return "~" + HexFormat.of().formatHex(bytes.array())
}

private fun RoomKeystrokeEvent.decodeField(value: String?): String? {
    if (!rawFieldsPreserved || value == null || !value.startsWith('~')) return value
    return ByteBuffer.wrap(HexFormat.of().parseHex(value, 1, value.length)).asCharBuffer().toString()
}

internal fun CandidateKeyPayload.toEntity(roomId: String): RoomKeystrokeEvent = RoomKeystrokeEvent(
    roomId = roomId,
    rawFieldsPreserved = true,
    sessionId = sessionId,
    displayName = encodeField(displayName),
    keyValue = encodeField(key),
    keyCode = encodeField(keyCode),
    ctrlKey = ctrlKey,
    altKey = altKey,
    shiftKey = shiftKey,
    metaKey = metaKey,
    eventKind = eventKind,
    pasteLength = pasteLength,
    pastePreview = pastePreview?.let(::encodeField),
    timestampEpochMs = timestampEpochMs,
    sourceEventId = sourceEventId,
    acceptedSequence = acceptedSequence,
)

internal fun RoomKeystrokeEvent.toPayload(): CandidateKeyPayload = CandidateKeyPayload(
    sessionId = sessionId,
    displayName = requireNotNull(decodeField(displayName)),
    key = decodeField(keyValue).orEmpty(),
    keyCode = decodeField(keyCode).orEmpty(),
    ctrlKey = ctrlKey,
    altKey = altKey,
    shiftKey = shiftKey,
    metaKey = metaKey,
    timestampEpochMs = timestampEpochMs,
    eventKind = eventKind,
    pasteLength = pasteLength,
    pastePreview = decodeField(pastePreview),
    sourceEventId = sourceEventId,
    acceptedSequence = acceptedSequence,
)
