package com.interviewonline.ws

import com.fasterxml.jackson.annotation.JsonInclude

data class WsOutgoingMessage(
    val type: String,
    val payload: Any,
)

data class RoomRealtimePayload(
    val inviteCode: String,
    val language: String,
    val code: String,
    val lastCodeUpdatedBySessionId: String? = null,
    /** Base64 of Y.encodeStateAsUpdate (full CRDT state) so reconnecting clients match live peers. */
    val yjsDocumentBase64: String? = null,
    val lastYjsSequence: Long = 0,
    val currentStep: Int,
    val notes: String,
    val notesMessages: List<NoteMessagePayload> = emptyList(),
    /**
     * Room-wide private notes for the requesting interviewer/owner.
     * Replaces the legacy per-step `personalNotesByStep` payload.
     */
    val personalNotes: List<PersonalNoteEntryPayload> = emptyList(),
    val briefingMarkdown: String = "",
    val participants: List<ParticipantPayload>,
    val isOwner: Boolean = false,
    val role: String = "candidate",
    val canManageRoom: Boolean = false,
    val canGrantAccess: Boolean = false,
    val eventToken: String? = null,
    val notesLockedBySessionId: String? = null,
    val notesLockedByDisplayName: String? = null,
    val notesLockedUntilEpochMs: Long? = null,
    val tasks: List<RoomTaskPayload> = emptyList(),
    val taskScores: Map<Int, Int?> = emptyMap(),
    val cursors: List<CursorPayload> = emptyList(),
    @JsonInclude(JsonInclude.Include.NON_NULL)
    val lastCandidateKey: CandidateKeyPayload? = null,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    val candidateKeyHistory: List<CandidateKeyPayload>? = null,
    val verdict: String? = null,
    val verdictComment: String? = null,
    val status: String = "active",
    val finishedAt: Long? = null,
)

data class RoomTaskPayload(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val starterCode: String,
    val language: String,
    val categoryName: String?,
    val score: Int?,
    val sourceTaskTemplateId: String? = null,
)

/**
 * Sent only to manager SSE connections that explicitly opened the same
 * inactive task. It must never be embedded in [RoomRealtimePayload].
 */
data class ManagerWorkspacePayload(
    val stepIndex: Int,
    val title: String,
    val language: String,
    val code: String,
    val briefingMarkdown: String,
    val focusMode: Boolean,
    val revision: Long,
    val yjsDocumentBase64: String? = null,
    val yjsSequence: Long = 0,
    /** True only for a rejected manager Yjs write that must be rebased and retried. */
    val recovery: Boolean = false,
)

data class NoteMessagePayload(
    val id: String,
    val sessionId: String,
    val displayName: String,
    val role: String,
    val text: String,
    val timestampEpochMs: Long,
)

data class PersonalNoteEntryPayload(
    val id: String,
    val text: String,
    val blockName: String? = null,
    /**
     * Optional pointer back to the interview step this entry "belongs to".
     * Set when the entry was authored under a step block (auto-set on step switch
     * or via `/block Шаг N`). Used by the client/export to render `Шаг N` in UI
     * and `Шаг N - <task title>` in exported markdown.
     */
    val blockStepIndex: Int? = null,
    val timestampEpochMs: Long,
)

data class ParticipantPayload(
    val sessionId: String,
    val displayName: String,
    val userId: String? = null,
    val participantId: String? = null,
    val role: String = "candidate",
    val presenceStatus: String = "active",
    val isAuthenticated: Boolean = false,
    val isHr: Boolean = false,
    val canBeGrantedInterviewerAccess: Boolean = false,
)

data class VerdictSetPayload(
    val verdict: String,
    val verdictComment: String? = null,
    val finishedAt: Long,
)

data class CursorPayload(
    val sessionId: String,
    val displayName: String,
    val userId: String? = null,
    val participantId: String? = null,
    val role: String,
    val cursorSequence: Long? = null,
    val lineNumber: Int,
    val column: Int,
    val selectionStartLineNumber: Int? = null,
    val selectionStartColumn: Int? = null,
    val selectionEndLineNumber: Int? = null,
    val selectionEndColumn: Int? = null,
)

data class CandidateKeyPayload(
    val sessionId: String,
    val displayName: String,
    val key: String,
    val keyCode: String,
    val ctrlKey: Boolean,
    val altKey: Boolean,
    val shiftKey: Boolean,
    val metaKey: Boolean,
    val timestampEpochMs: Long,
    /**
     * Категория события: `keydown` (значение по умолчанию для обратной
     * совместимости), `window_blur`, `tab_hidden`, `tab_visible`, `window_focus`.
     * Используется UI, чтобы рендерить переключение окон/вкладок отдельной
     * строкой вида «Alt+Tab — переключение окна», даже если ОС перехватила
     * сам Tab и `keydown` для него не приходит.
     */
    val eventKind: String = "keydown",
    val pasteLength: Int? = null,
    val pastePreview: String? = null,
    /** Client UUID, retained unchanged when a source action is retried. */
    val sourceEventId: String? = null,
    /** Server-assigned, room-local sequence used after timestamp for canonical order. */
    val acceptedSequence: Long? = null,
)
