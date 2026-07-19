## Context

The room has one published `currentStep`. Its code, language, briefing and Yjs state are currently room-global, and the client intentionally renders a static `ManagerWorkspacePreview` for a manager-selected non-published task. That satisfies independent navigation but prevents interviewers from preparing a later task.

The selected task remains an independent browser choice, but its draft content is not personal. It belongs to the room and task: two owners or interviewers who open the same non-published task must see and edit the same preparation workspace. A candidate stays on the published task and must not receive the prepared content, Yjs document, cursors, or update events before an authorised interviewer uses `Переключить`.

The production schema is Flyway-managed and validated by Hibernate. Existing `RoomTask.solutionCode`, `solutionLanguage`, and `briefingMarkdown` retain the text representation of a task workspace. Yjs state is currently retained only in memory for the published room step, so an additional durable task-level snapshot is needed to restore collaborative documents after reconnect or restart.

## Goals / Non-Goals

**Goals:**

- Provide one editable, real-time, manager-only workspace for each non-published room task.
- Keep code collaboration CRDT-based; scope briefing, language, focus mode, Yjs updates, and awareness to the selected task.
- Persist prepared task state and make an explicit publication atomically expose that exact state as the public room workspace.
- Enforce roles and event scope on the server, preventing data leakage through SSE as well as through the UI.
- Recover a selected manager workspace after reconnect, page reload, and server restart.

**Non-Goals:**

- Personal per-interviewer drafts or a draft-merge user interface.
- Editing immutable task-definition metadata such as title, description, or starter template.
- Changing candidate permission rules or the current public-room collaboration protocol beyond loading a published prepared task.
- Adding a history/audit UI for preparation edits.

## Decisions

### Room-task workspace is manager-shared, not manager-personal

`TaskWorkspaceRealtimeState` will be keyed by `(roomId, stepIndex)` and built lazily from the corresponding `RoomTask`. It contains code, effective language, briefing/focus-mode content, a Yjs snapshot and sequence/revision data. A manager explicitly subscribes when opening an inactive step; state and broadcasts are sent only to manager connections subscribed to that same workspace.

This resolves concurrent preparation naturally: Yjs merges code edits, while briefing, language and focus-mode updates use a server revision and reject stale writes with a resync response. Personal drafts were rejected because they conflict with the requested live collaboration and make publication ownership ambiguous.

### Persist each task workspace, including its Yjs snapshot

Flyway V7 will add task-level snapshot and revision columns. Text state continues to be written to the existing room-task workspace fields, and accepted Yjs updates update the encoded snapshot and monotonic sequence. The persisted task record is the recovery source on reconnect and restart.

This is chosen over keeping drafts only in the in-memory room state because the latter loses work on restart and cannot give a newly connected interviewer the same CRDT document. It is also chosen over publishing inactive drafts into `Room` because that would overwrite the active candidate workspace.

### Separate manager-workspace realtime protocol and routing

The transport gains open/close, sync, Yjs, awareness, briefing, language and focus-mode events with an explicit `stepIndex` and revision where relevant. The server validates that the target exists and differs from the published `currentStep`, and that the sender has `canManageRoom`. It records a connection's subscribed workspace and routes its payload only to manager connections subscribed to that same room/task scope.

Public `state_sync`, public Yjs and awareness remain scoped to `currentStep`. A candidate never receives a manager-workspace payload, even if they forge a client event. Client filtering is insufficient and is not used as the protection boundary.

### Isolate the frontend document lifecycle by task scope

The static preview becomes an editable manager workspace. Its code editor creates and disposes a dedicated Yjs document for `manager:<inviteCode>:<stepIndex>:<language>` and uses only the manager-workspace callbacks. The document is recreated on a task or language scope change so Yjs updates cannot merge across tasks. Briefing, language and focus-mode controls likewise call the scoped transport and wait for the initial server snapshot before enabling edits.

The published step continues to use the existing room-global editor and controls. The UI may show that a task is prepared, but it MUST NOT call the inactive workspace a personal or local draft.

### Publish as a guarded handoff to the public workspace

When an authorised interviewer uses `Переключить`, the server flushes/loads the selected task workspace under the room lock, persists its latest text and Yjs snapshot, makes that task the room's `currentStep`, and hydrates the public collaboration state from the same snapshot. It then broadcasts only the new published public state. The prepared Yjs sequence is retained, avoiding loss of CRDT edits.

The handoff source is the server-owned manager workspace keyed by the selected task, with the durable `RoomTask` snapshot as its recovery fallback. It must never be reconstructed from a particular publisher's in-browser snapshot or from the room-global state of the previously published task. This prevents a stale manager client from clearing edits made by other managers immediately before publication.

For a stale Yjs base sequence, the server MUST not increment the task sequence or persist a mismatched code/snapshot pair. It returns the current task-scoped sync to the stale sender. The manager editor retains its merged local Y.Doc, advances its known server sequence from that sync or a peer update, and sends one current full snapshot before queuing publication. The realtime queue preserves that snapshot-before-publication order. This creates a server acknowledgement barrier without exposing any inactive-task state to candidates.

Manager selections remain browser-local: managers on another selected task stay there; a manager selecting the newly published task transitions from the scoped manager editor to the public editor. A manager client flushes queued scoped updates before asking to publish and reports a failed handoff rather than silently publishing stale content.

### Make room-wide transitions visible to independently navigating managers

The client observes the server-authoritative `currentStep` transition. When a manager's existing local selection differs from the incoming published step, it preserves that selection and shows one dismissible `aria-live` top notification: `Активный шаг изменён` and `В комнате сейчас: «<task title>». Откройте его в списке, когда будете готовы.` The notification is derived from the transition, not a new realtime message, so it cannot affect candidates or alter server state. Managers already on the new published step receive no notification.

Starting an explicit publication is a local acknowledgement that the manager is intentionally changing the room-wide context. The client therefore clears any existing step-change notification before queuing `set_step`, regardless of whether that notification named the selected step. The normal server-authoritative transition then cannot recreate the notification for the publishing manager because their local selection already matches the step they published.

The same acknowledgement applies when a remote room transition reaches a manager's existing local selection. After every authoritative `currentStep` update, the client removes an existing notification if the local selection is now the published step, even if that notification describes a different, earlier transition. This keeps a notification from offering to navigate a manager back to an obsolete step.

### Ignore a late manager-workspace event after publication

The frontend may enqueue `manager_workspace_open` or a final task-scoped Yjs, awareness, briefing, language, or focus-mode update while a manager has an inactive task selected, then receive a room-wide publication before that relay request reaches the server. When the requested task is now `currentStep`, the server must treat that manager request as obsolete control-plane traffic: remove any old manager-workspace subscription and return successfully without applying the payload or sending a manager-only snapshot. The manager's next room state already drives the public shared editor. This exception applies only to authorised managers; candidate manager-workspace requests remain forbidden before this no-op branch.

### Verify a five-person room with isolated browser sessions

The acceptance suite creates one Chromium browser and one isolated `BrowserContext` per participant. This models separate authenticated browser sessions without shared cookies or local storage. It runs two sequential, independent rooms: four managers with one candidate, then three managers with two candidates. A fresh room, users, and task are created per topology so role data and collaborative state cannot cross scenarios.

For each topology the suite establishes the regular browser realtime connection for every participant, sends distinct Yjs editor updates from rotating managers, and records elapsed time from local dispatch to visible presence in every other participant's editor. It reports recipient-level samples and p50/p95/max aggregates. It treats a local delivery p95 above 2.5 seconds or a maximum above 3.5 seconds as a regression by default; environment variables may override those limits for a constrained CI runner. These are explicit test SLOs for the local browser-level scenario, not a claim about deployed-network latency or backend capacity.

The suite also asserts role behaviour under concurrency: all managers can edit and receive changes, each candidate receives only the active public workspace, candidates do not see manager-only step controls, and a manager publication moves candidates to the new active task while a manager on another local step receives the room-wide-change notification and retains their local workspace. The two topologies run sequentially because one local API database must not let unrelated room setup collide with the category-registration path.

### Guard manager workspace hydration and stable task identity

An inactive manager workspace has no client-authoritative fallback. When a manager changes to an inactive task, the UI shows a loading state and MUST NOT mount an editor, briefing control, awareness provider, or snapshot emitter until a manager-only workspace response for that selected task has arrived. This prevents a starter-code fallback from being sent as a full Yjs snapshot during a delayed SSE or REST response.

The server keys an in-memory manager workspace and its subscription by the immutable `RoomTask` identifier, while the wire protocol continues to use the current numeric step index. Each inbound scoped event resolves the current room task for its supplied step index and verifies that its immutable identifier still matches the connection subscription. If another manager deletes or reorders tasks, stale selected clients cannot write a cached workspace into the task now occupying the old index. They receive a conflict/resynchronisation result and must open the current task scope again. The local UI detects a selected-task/workspace mismatch, discards the obsolete editor state and hydrates the newly selected task before enabling work.

When a manager edit changes the editor language and therefore remounts the task-scoped document, the client first captures the current full Yjs document into the manager workspace state. The new editor must bootstrap from that document; it must never interpret a positive Yjs sequence without a local snapshot as permission to start an empty document and overwrite the prepared task.

### Converge a formerly published task when managers reopen it

After publication moves the room to another task, the former public task becomes a manager-only workspace. Its stored Yjs document is authoritative, including deletions made while it was public. When two managers open that same former task, their scope key and Yjs sequence must identify the same task-scoped document. The client must apply manager-scoped Yjs updates and recovery snapshots to the active scoped editor without replacing them with an unrelated public document. A stale update may be rejected, but the recovery snapshot must converge the sender and recipient; it must not leave a locally divergent document that ignores later deletion.

The verification fixture uses three isolated browser sessions: one candidate on the new public task and two managers on the former public task. It verifies both a distinct insertion and a subsequent deletion through the two manager editors, then confirms candidate isolation. This distinguishes the intentional task separation in the UI from a real manager-manager synchronization failure.

Manager Yjs sequence is server-authoritative. A client keeps its last acknowledged server sequence separately from any local edit count and sends a full snapshot only against that acknowledged sequence. The server accepts a full task-scoped snapshot only when its declared base equals the canonical sequence. For a stale or future base, it sends the canonical task-scoped snapshot and sequence to the requesting manager without applying the mismatched document. The client always applies that recovery snapshot, even if its local UI has an optimistic larger number, merges its unsent local Yjs changes, and submits one resulting full snapshot against the recovered sequence.

After an accepted manager snapshot, the canonical manager workspace sync (including its Yjs document and sequence) is delivered to every subscribed manager, including the sender. Incremental messages remain useful for low-latency collaboration, but an empty heartbeat delta cannot be the only recovery mechanism because a receiver correctly ignores empty updates. This establishes a convergence barrier for concurrent insertion and deletion without exposing manager-only content to candidates.

### Recover local development navigation after a frontend rebuild

The development server must apply history fallback to every browser document request so a direct `/room/<invite>` refresh returns `index.html`; this is a server routing concern rather than a backend room API call. The frontend will recognise only lazy-import failures matching the browser's chunk-load error shapes, store a one-time recovery guard in `sessionStorage`, and reload the document. The guard is removed after the fresh shell boots and prevents a malformed deployment or unrelated error from causing a reload loop. This recovery is deliberately limited to the local development experience and does not mask normal application errors.

### Serialize public mutations with publication and bind persistence to the source task

The published public workspace has a separate transition boundary from manager-only preparation. A single per-room public-transition lock serializes `set_step`/`next_step` with every public code, Yjs, language, and briefing mutation. Each operation resolves the current published `RoomTask` while holding that lock and mutates its associated realtime state before releasing it. Publication snapshots that same state under the same lock before replacing the room's published realtime state. Therefore an edit already accepted by the server is either included in the outgoing task snapshot or, if it arrives after the transition, rejected as an old-scope event; it can never mutate the newly active task or an orphaned state object.

Debounced persistence is bound to the immutable source `RoomTask` ID and the accepted state, rather than looking up `room.currentStep` when its timer fires. A transition may cancel obsolete work as an optimisation, but the task-identity guard remains mandatory because an already-running timer cannot be cancelled safely. Immediate legacy code, language, and briefing persistence uses the same source-task binding. This preserves the target task's prepared code, briefing, language, focus mode, and Yjs state even if an earlier task's delayed Yjs save completes after publication.

Every server-authorised publication entry point, including the legacy REST `next-step` endpoint, delegates to this same transition boundary. No controller or room-management service may independently snapshot the active task and call `syncFromRoom`, because that would bypass the ordering guarantee for connected editors.

Late public updates whose explicit sync key names the formerly active step are not replayed into the new active document. The server drops them and the normal state-sync recovery path lets the client rejoin the current scope. This protects the room from cross-step writes; the durability guarantee applies to edits accepted by the server before the publication transition.

## Risks / Trade-offs

- **A scoped awareness payload could leak cursors or Yjs content to candidates** → include the scope in the message, perform role/subscription checks before relay, and verify raw SSE traffic in three-browser E2E coverage.
- **Changing task scope can merge two CRDT documents** → dispose and remount the Yjs document/awareness provider on every scope change and test A → B → A isolation.
- **Concurrent non-CRDT briefing writes may overwrite one another** → attach a revision to every manager-workspace text update, reject stale revisions, and resync the client.
- **A server restart can discard unpersisted in-memory state** → persist accepted updates to `RoomTask` and rebuild scoped state from its snapshot.
- **Publication can race with a delayed browser debounce** → flush before publication and perform the server-side handoff under the room lock.

- **A stale manager client can overwrite the prepared workspace during publication** → the server selects the latest task-scoped state by revision/Yjs sequence, and an E2E test edits the same inactive task from two manager sessions before a third publication handoff.

## Migration Plan

1. Add the Flyway task-workspace columns and entity mapping; existing tasks receive empty snapshots and revision zero and fall back to stored task code/briefing/language.
2. Deploy the server routing and persistence support before the frontend. Existing clients remain on the published protocol and therefore retain current behaviour.
3. Deploy the scoped frontend editor and E2E/authorization coverage. Rollback leaves the persisted task text intact; the new snapshot columns are additive and can be ignored by the previous application version.

## Open Questions

None. The room-level manager-shared model, candidate isolation, and explicit publication semantics are fixed by this change.
