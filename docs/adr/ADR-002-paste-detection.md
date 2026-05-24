# ADR-002: Paste Detection (Feature #19)

**Date:** 2026-05-23  
**Status:** Accepted  
**Author:** architect-agent

---

## Context

The interviewer needs to see when the candidate pastes text into the editor. Currently
only `keydown`, `window_blur`, `tab_hidden`, `tab_visible`, `window_focus` events are
tracked. The `eventKind` discrimination exists on both client and server but does not
include `paste`.

A paste event carries different semantics from a keydown: there is no meaningful
`key`/`keyCode`, but there is a `pasteLength` (number of characters pasted) and a
`pastePreview` (first N characters, for context).

This feature is a prerequisite for Feature #5 (keystroke timeline) because #5 will
store the full event payload including the new paste fields.

---

## Decision

### 1. Payload extension — `CandidateKeyPayload` (WsMessages.kt)

Add two optional fields:

```kotlin
data class CandidateKeyPayload(
    // ... existing fields ...
    val pasteLength: Int? = null,       // number of chars pasted; null for non-paste events
    val pastePreview: String? = null,   // first 50 chars of pasted content; null for non-paste
)
```

Null defaults preserve backward compatibility: existing serialized events in
`candidateKeyHistory` JSON will deserialize correctly because Jackson's
`@JsonSerdDeserialize` tolerates absent fields on data classes with defaults.

The `pastePreview` is capped at 50 characters server-side in
`CandidateKeyHistoryHelpers` (see section 4 below) to prevent payload inflation.

### 2. RealtimeEventRequest extension — `RealtimeEventRequest.kt`

Add two optional fields to the existing data class:

```kotlin
val pasteLength: Int? = null,
val pastePreview: String? = null,
```

These fields are passed through the existing `key_press` event routing in
`CollaborationService`. No new event type is needed.

### 3. normalizeEventKind — `CandidateKeyHistoryHelpers.kt`

Add `"paste"` to the allowed set in `normalizeEventKind()`:

```kotlin
fun normalizeEventKind(rawKind: String?): String {
    return when (normalized) {
        "window_blur", "window_focus",
        "tab_hidden", "tab_visible",
        "paste" -> normalized          // <-- added
        else -> "keydown"
    }
}
```

Also add a sanitize helper for paste fields:

```kotlin
fun sanitizePastePreview(raw: String?): String? {
    if (raw == null) return null
    return raw.take(50)
}

fun sanitizePasteLength(raw: Int?): Int? {
    if (raw == null) return null
    return raw.coerceIn(0, 1_000_000)
}
```

### 4. CollaborationService — key_press handler

In the `key_press` branch of `handleRealtimeEvent`, where a `CandidateKeyPayload` is
constructed, thread through the new fields:

```kotlin
val payload = CandidateKeyPayload(
    sessionId = ...,
    displayName = ...,
    key = CandidateKeyHistoryHelpers.normalizeIncomingKey(req.key),
    keyCode = CandidateKeyHistoryHelpers.normalizeIncomingKeyCode(req.keyCode),
    ctrlKey = req.ctrlKey ?: false,
    altKey = req.altKey ?: false,
    shiftKey = req.shiftKey ?: false,
    metaKey = req.metaKey ?: false,
    timestampEpochMs = ...,
    eventKind = CandidateKeyHistoryHelpers.normalizeEventKind(req.eventKind),
    pasteLength = CandidateKeyHistoryHelpers.sanitizePasteLength(req.pasteLength),
    pastePreview = CandidateKeyHistoryHelpers.sanitizePastePreview(req.pastePreview),
)
```

No other changes to the routing or broadcast logic are needed. The paste event flows
through the same `candidate_key` SSE broadcast and history ring-buffer as all other
key events.

### 5. Dedupe key in merge() — `CandidateKeyHistoryHelpers.kt`

The existing dedupe key in `merge()` does not include `pasteLength` or `pastePreview`.
This is acceptable: paste events are distinguished by `eventKind = "paste"` combined
with the timestamp, which makes collisions essentially impossible in practice. No
change to the dedupe key is needed.

### 6. Frontend — CodeMirror paste interception

**New file: `frontend/src/features/room/pasteDetection.ts`**

A CodeMirror 6 `EditorView.domEventHandlers` or `ViewPlugin` that intercepts the DOM
`paste` event on the editor's content element. This is the correct approach for
CodeMirror 6; there is no built-in paste extension in y-codemirror.next.

Design:
- Listen on the `paste` DOM event via `EditorView.domEventHandlers({ paste: ... })`.
- In the handler read `event.clipboardData?.getData('text/plain')` to get the pasted
  text. This is available synchronously inside the paste handler.
- Compute `pasteLength = pastedText.length` and
  `pastePreview = pastedText.slice(0, 50)`.
- Call a provided `onPaste(payload: KeyPressPayload & { pasteLength: number; pastePreview: string })` callback.
- Return `false` (do not prevent default — the paste must still happen in the editor).

The extension is created with a factory function that takes the callback:

```typescript
export function pasteDetectionExtension(
  onPaste: (payload: PastePayload) => void
): Extension { ... }
```

**Changes to `RoomCodeEditor.tsx`**:
- Accept a new optional prop `onPaste?: (payload: PastePayload) => void`.
- Conditionally include `pasteDetectionExtension(onPaste)` in the extensions array
  when `onPaste` is provided and the editor is not `readOnly`.
- Only candidate sessions get a non-null `onPaste` (same active-only pattern as
  keydown tracking).

**Changes to `RoomPage.tsx`**:
- In the `sendKeyEvent` callback (or equivalent), extend the `key_press` message to
  include `pasteLength` and `pastePreview` when present.
- In `useRoomSocket.ts`, extend the `CandidateKeyPayload` type and
  `onCandidateKey` callback to include the new fields.

**New UI: paste indicator**

In the candidate key history panel (already rendered for interviewer/owner in
`RoomPage.tsx`), paste events should render differently from keydowns. The display
rule:

- If `eventKind === 'paste'`: render "Вставка: {pasteLength} символов"
  (example: "Вставка: 243 символа").
- Optionally show `pastePreview` in a tooltip or inline in dimmed text.

This is purely a rendering concern in the existing history list. No new component is
strictly required — it can be a branch in `formatCandidateKey()` in `candidateKeys.ts`:

```typescript
case "paste":
  return `Вставка: ${event.pasteLength ?? 0} символов`;
```

And extend `CandidateKeyInfo` type:

```typescript
export type CandidateKeyInfo = {
  // ... existing fields ...
  pasteLength?: number;
  pastePreview?: string;
};
```

### 7. Application order

1. `WsMessages.kt` — add `pasteLength`, `pastePreview` to `CandidateKeyPayload`
   (backward-compatible defaults).
2. `RealtimeEventRequest.kt` — add `pasteLength`, `pastePreview`.
3. `CandidateKeyHistoryHelpers.kt` — add `"paste"` to `normalizeEventKind()`,
   add sanitize helpers.
4. `CollaborationService.kt` — thread new fields through `key_press` handler.
5. Frontend: `candidateKeys.ts` type extensions, `pasteDetection.ts` new file,
   `RoomCodeEditor.tsx` prop + extension wiring, `RoomPage.tsx` send + display.

Note: steps 1-4 can be deployed to backend independently of frontend changes.
Old clients without paste support will simply never send `eventKind="paste"` events —
the server handles this gracefully via `normalizeEventKind` fallback.

---

## Risks

**R1 — Clipboard API availability.** `event.clipboardData?.getData('text/plain')` is
available in all modern browsers inside a synchronous paste handler. However, in some
browser configurations (Firefox private mode, sandboxed iframes) it may return an
empty string. Design must handle empty string gracefully: if `pastedText.length === 0`,
still send the paste event with `pasteLength = 0` and `pastePreview = null`. The
interviewer will see "Вставка: 0 символов" which is still a signal that a paste
occurred, even if the content was not readable.

**R2 — Large paste payloads.** A candidate could paste 100,000 characters.
`pastePreview.slice(0, 50)` is safe, but `pasteLength` is just an integer. The server
`sanitizePasteLength` caps at 1,000,000 to prevent integer overflow in display logic.

**R3 — pastePreview in candidateKeyHistory JSON.** The `candidateKeyHistory` column
stores up to 50 events. With `pastePreview` (up to 50 chars each), the JSON size
increases by at most 50 * 50 = 2,500 characters. This is negligible relative to the
existing TEXT column with no size limit. No change to `MAX_HISTORY_SIZE` is needed.

**R4 — paste event before Yjs applies the change.** The paste DOM event fires before
CodeMirror/Yjs processes the pasted text. The `pasteLength` and `pastePreview` are
read directly from `ClipboardData`, not from the resulting editor state — so timing
is not an issue.

**R5 — Double firing.** In some browsers, paste events can fire twice if the editor
has multiple DOM listeners. CodeMirror 6's `domEventHandlers` on the `cm-content`
element is the single canonical paste listener; no deduplication is needed at the
application level. However the server's idempotency check (appliedOperationIds) does
not cover key_press events today. For MVP this is acceptable — a duplicate paste
notification is a minor UX issue, not a correctness issue.

---

## Tradeoffs

| Decision | Alternative | Reason chosen |
|---|---|---|
| Reuse `key_press` event type | New `paste_event` type | Avoids new event routing; paste is conceptually a key activity |
| `pastePreview` capped at 50 chars server-side | Client-side cap only | Defense in depth; clients are untrusted |
| DOM `paste` event handler | CodeMirror transaction filter | DOM event is synchronous and provides ClipboardData; transactions don't |
| null fields for non-paste events | Always-present fields with defaults | Minimizes JSON size for the 99% of events that are keydowns |
