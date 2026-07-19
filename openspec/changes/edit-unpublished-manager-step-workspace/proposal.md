## Why

The current manager-local step is an intentionally static preview. An interviewer can inspect an unpublished task, but cannot prepare its code, briefing, or language before showing it to the candidate. The requested workflow needs a real shared manager workspace: interviewers prepare the next step together without interrupting or exposing it to the candidate.

## What Changes

- Replace the read-only local manager preview with an editable room-level workspace for every non-published step. All authorised interviewers who open the same step collaborate in it in real time.
- Persist a manager-only workspace of each task's code, briefing, language, focus-mode state and Yjs snapshot without sending it through the published Yjs/SSE room channel.
- Apply the prepared workspace to the existing published realtime workspace only when an authorised interviewer explicitly uses `Переключить`.
- Add server-side manager-workspace authorisation, scoped realtime routing, revision/conflict handling, reconnect/error behaviour, and candidate-isolation tests.
- Keep candidate views and the published shared step server-authoritative and unchanged until publication.
- Preserve the last shared manager-workspace snapshot exactly during publication: no manager's stale client state or public-room fallback may overwrite code, briefing, language, focus mode, or the Yjs document prepared by other interviewers.
- Notify managers whose local task differs from a newly published room-wide step, so independent navigation remains intact without hiding an important room-wide transition.
- Dismiss a manager's obsolete room-wide-step notification as soon as that manager explicitly publishes any step, so the notification never describes an older active task after the manager has changed the room state.
- Dismiss a previously shown room-wide-step notification when another interviewer publishes the task the notified manager already has open, because that manager is already aligned with the current room context.
- Treat a late manager-workspace subscription or transport update for a task that has just become published as a safe no-op, rather than showing the interviewer an internal server error; candidate restrictions remain enforced.
- Add a repeatable five-participant realtime acceptance suite that validates both supported role topologies, records code-propagation latency, and keeps those collaboration guarantees from regressing.
- Protect prepared workspaces from two discovered integrity races: an editor must not emit a fallback snapshot before authoritative workspace hydration, and a task re-order must not redirect an open workspace into a different task.
- Preserve every public-step edit that the server has accepted when another interviewer publishes a different task. A room-wide publication must not race a pending public Yjs save into the new task or roll the previous task back to an earlier snapshot.
- Ensure two interviewers who reopen the same formerly published task as a manager-only workspace converge on one Yjs document: typing and deletion by either interviewer must become visible to the other, while the candidate remains on the current public task.
- Keep the local room URL recoverable during frontend development: a direct refresh of `/room/<invite>` must return the SPA shell, and a stale lazily loaded development chunk must recover by loading the current shell instead of leaving the room on an unrecoverable runtime-error screen.

## Capabilities

### New Capabilities

- `local-development-runtime`: Local browser deep links and lazy route chunks recover after a frontend development-server rebuild.

### Modified Capabilities

- `independent-interviewer-step-navigation`: A manager's local non-published workspace changes from read-only inspection to shared, manager-only realtime preparation, with explicit publication and conflict rules.

## Impact

- Backend room-task data, manager-authorised realtime APIs, persistence migration, and integration tests.
- Frontend room workspace, scoped manager editor lifecycle, shared draft save lifecycle, and E2E coverage.
- Existing public Yjs/SSE routing remains limited to the currently published step; candidates must never receive non-published workspace content, updates, or awareness data.
- Browser-level collaboration verification for `4 interviewers + 1 candidate` and `3 interviewers + 2 candidates`; this is an end-to-end concurrency check, not a capacity benchmark for production infrastructure.
- Public realtime mutation and task-publication persistence paths, including the delayed Yjs code-save path.
