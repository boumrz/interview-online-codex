package com.interviewonline.service

import com.interviewonline.ws.NoteMessagePayload
import com.interviewonline.ws.PersonalNoteEntryPayload

/**
 * Payload-структуры для хранения заметок комнаты в БД (`Room.notesJson` /
 * `Room.privateNotesJson`).
 *
 * Раньше были `private data class` внутри [CollaborationService]. Вынесены на
 * уровень файла со статусом `internal`, чтобы:
 * - использовать их в [PrivateNotesSerialization] без копипасты,
 * - оставить инкапсуляцию в рамках сервисного пакета (наружу не торчат).
 */

internal data class NotesThreadPayload(
    val version: Int = 2,
    val chatRevision: Long = 0,
    val messages: List<NoteMessagePayload> = emptyList(),
    val receipts: List<ChatReceiptPayload> = emptyList(),
)

internal data class ChatReceiptPayload(
    val senderKey: String,
    val clientMessageId: String,
    val requestHash: String,
    val messageId: String,
    val persistedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
)

internal data class RoomPrivateNotesPayload(
    val version: Int = 1,
    val authors: Map<String, RoomPrivateNotesAuthorPayload> = emptyMap(),
)

internal data class RoomPrivateNotesAuthorPayload(
    val entries: List<PersonalNoteEntryPayload> = emptyList(),
)
