## 1. Acceptance tests and safety contract

- [x] 1.1 Replace the static-preview assertion in the three-browser interviewer-step E2E with a red test for a shared editable inactive-task workspace: two managers see each other's code, briefing, language and focus-mode edits while the candidate remains on the published task and raw candidate SSE never contains the unpublished markers.
- [x] 1.2 Extend the E2E coverage with explicit publication of the prepared task, A → B → A document isolation, manager reconnect/reload recovery, candidate POST event-relay attempts to subscribe/write/relay awareness that return `403` without any SSE leak, and manager-subscription cleanup when another manager publishes the selected task.
- [x] 1.3 Add backend integration tests for manager-only workspace authorisation, subscription-scoped Yjs/awareness routing, `403` relay failures without SSE disclosure, stale non-CRDT revision rejection, persistence recovery, and atomic publication handoff.
- [x] 1.4 Run the new acceptance and backend tests to document the expected red failure before production implementation.

## 2. Durable manager workspace backend

- [x] 2.1 Add the additive Flyway V7 migration and `RoomTask` mappings for a per-task Yjs snapshot, sequence, non-CRDT workspace revision, and durable focus-mode representation with backwards-compatible empty-state fallbacks.
- [x] 2.2 Introduce a lazily hydrated task workspace realtime state keyed by room and step, persist accepted workspace changes and the canonical focus-mode representation to `RoomTask`, and recover it after reconnect or process restart.
- [x] 2.3 Extend the websocket/SSE message contract with manager-workspace open/close/sync, code/Yjs, briefing, language, focus-mode and scoped awareness events.
- [x] 2.4 Enforce manager role, valid inactive-step scope and connection subscription on every manager-workspace event; route state only to managers subscribed to that task and return a resync payload for stale revisions.
- [x] 2.5 Make authorised `Переключить` publish the selected workspace atomically, retaining its Yjs sequence and snapshot while leaving other managers' selected task scopes intact.

## 3. Editable scoped manager workspace frontend

- [x] 3.1 Replace `ManagerWorkspacePreview` with a manager-shared workspace controller that opens/closes the task subscription, hydrates before edits, resyncs rejected revisions, and flushes pending updates before publication.
- [x] 3.2 Refactor or add the scoped code editor lifecycle so every manager task/language scope has an isolated Yjs document and awareness provider and cannot emit through the published-task channel.
- [x] 3.3 Connect briefing, language and focus-mode controls to the scoped manager transport; retain the existing public room controls for the published task and remove personal-draft/preview wording.
- [x] 3.4 Preserve local task selection across reloads and correctly transition managers between a scoped inactive workspace and the public workspace when another interviewer changes the published step.

## 4. Verification and completion

- [x] 4.1 Make the red acceptance and backend tests pass, then run `npm run e2e:step-publication`, code-sync regression coverage, backend tests, typecheck, production build, and strict OpenSpec validation.
- [ ] 4.2 Mark completed tasks with evidence, review server-side candidate isolation and realtime reconnect behaviour, and archive the validated change when all checks pass.

## 5. Publication-preservation regression fix

- [x] 5.1 Extend the three-browser E2E with a red regression: two managers update the same inactive task, one publishes it, and the candidate plus both managers receive the last accepted code, briefing, language, focus mode, and Yjs-backed document without reset.
- [x] 5.2 Reject stale-base manager Yjs snapshots without advancing or corrupting the durable task state, resynchronise the sender, advance peer sequence knowledge, and queue a current editor snapshot before publication so the server-side handoff uses one acknowledged task-scoped Yjs snapshot and sequence.
- [x] 5.3 Run the regression test red before the fix, then verify it passes with code-sync, targeted backend tests, typecheck, build, and strict OpenSpec validation.

## 6. Manager notification for room-wide publication

- [x] 6.1 Add a red three-browser E2E assertion that, when one interviewer publishes a different step, another interviewer keeps their local workspace and sees the new active task title in a manager-only top notification while the candidate does not.
- [x] 6.2 Derive a dismissible, accessible manager notification from a server-authoritative `currentStep` transition without changing local selection or adding a new server event.
- [x] 6.3 Verify the new E2E, existing step-publication coverage, typecheck, build, and strict OpenSpec validation.

## 7. Five-participant realtime reliability acceptance

- [x] 7.1 Add a Playwright acceptance suite with isolated browser sessions for `4 interviewers + 1 candidate` and `3 interviewers + 2 candidates`; cover collaboration, candidate isolation, and the independent-manager room-wide publication notification. The suite is test-only and does not require a product-code red phase because the requested observable behaviour is already implemented; its first run establishes a baseline.
- [x] 7.2 Record every recipient's editor-propagation delay across rotating manager edits, calculate p50/p95/max, and fail the local suite when the documented latency thresholds are exceeded.
- [x] 7.3 Make the five-participant suite pass, run it repeatedly with the local app, and perform a complementary manual check through the in-app browser automation surface.
- [x] 7.4 Run relevant existing realtime regressions, typecheck, build, strict OpenSpec validation, and review results/limitations as a local concurrency verification rather than a production capacity claim.

## 8. Manager workspace integrity-race regressions

- [x] 8.1 Add red automated regressions for delayed authoritative manager-workspace hydration and task deletion/reindex while another manager has the affected inactive workspace open.
- [x] 8.2 Prevent scoped editor/awareness/Yjs snapshot emission before authoritative manager-workspace hydration, with an explicit loading state instead of a starter-code fallback.
- [x] 8.3 Key manager workspace state and subscriptions by immutable room-task identity; reject or rehydrate stale selections after task-list reindexing rather than persisting into the new numeric slot.
- [x] 8.4 Make the integrity regressions pass, then rerun five-participant collaboration, publication, reconnect, backend authorization, typecheck, build, and strict validation.

## 9. Public-step publication data-integrity regression

- [x] 9.1 Add a red Playwright regression with two interviewers and one candidate: accepted edits on the active public task immediately precede another interviewer's publication of a prepared task; verify the prior task remains durable and the new task is never overwritten after the legacy debounce interval.
- [x] 9.2 Add a deterministic delayed old-step Yjs transport case and backend coverage for task-bound delayed persistence; verify an old-scope event cannot modify the new active task.
- [x] 9.3 Serialize public code, Yjs, language, briefing, and publication operations under one per-room transition boundary; bind immediate and debounced persistence to the immutable source task.
- [x] 9.3a Route the manager-authorised legacy REST next-step endpoint through the same public-transition boundary and cover it in the publication-preservation E2E.
- [x] 9.3b Preserve the full manager-workspace Yjs document through a language-scoped editor remount, so an empty periodic snapshot cannot replace prepared code.
- [x] 9.4 Make the new regressions pass and rerun publication, public Yjs multi-participant, reconnect, five-participant, backend realtime, typecheck, build, and strict OpenSpec validation.

## 10. Converge a reopened former public task

- [x] 10.1 Add a red three-browser Playwright regression: publish task 2, have two managers reopen task 1, then verify manager-to-manager insertion and deletion convergence, persisted task-1 state, and candidate isolation.
- [x] 10.2 Make manager Yjs base sequences acknowledged-server values, reject both stale and future bases on the server, and always deliver the canonical manager snapshot to subscribed managers after accepted persistence.
- [x] 10.3 Apply canonical manager recovery snapshots despite optimistic local state, merge/resubmit unsent local changes, and keep candidates isolated.
- [x] 10.4 Run the reopened-task regression together with manager-workspace integrity, step publication, public Yjs multi-participant, typecheck, build, backend realtime tests, and strict OpenSpec validation.

## 11. Recover local frontend navigation after a stale development chunk

- [x] 11.1 Add a red browser regression that opens a direct local `/room/<invite>` URL and aborts its first lazy room chunk; document that the focused browser scenario verifies the stale-chunk recovery because a development-server restart is not a stable production E2E fixture.
- [x] 11.2 Preserve browser-compatible local SPA history fallback and add one-time client recovery for lazy chunk-load failures without masking unrelated runtime errors.
- [x] 11.3 Verify fresh deep-link navigation, the focused stale-chunk recovery scenario, room smoke coverage, typecheck, build, and strict OpenSpec validation.

## 12. Clear obsolete active-step notifications on self-publication

- [x] 12.1 Extend the three-browser publication E2E with a red scenario: a manager keeps a notification about another manager's publication, then publishes a different local step and must have no stale notification.
- [x] 12.2 Clear the manager's existing step-change notification when that manager initiates publication, without changing candidate behavior or server-authoritative room switching.
- [x] 12.3 Run the notification regression, step-publication coverage, typecheck, build, and strict OpenSpec validation.

## 13. Clear an obsolete notification when the local task becomes active remotely

- [x] 13.1 Add a red three-browser publication E2E where a notified manager remains on task 2 and another interviewer publishes task 2; assert that the manager's old notification disappears and no redirect to the former active task is offered.
- [x] 13.2 Dismiss an outstanding manager step-change notification when the authoritative active step equals that manager's local selection.
- [x] 13.3 Run the notification regressions, step-publication coverage, typecheck, build, and strict OpenSpec validation.

## 14. Ignore late manager-workspace opening after publication

- [x] 14.1 Add a red realtime regression with an authorised manager's late `manager_workspace_open` and transport update for the already published task; assert success/no error while preserving candidate `403` coverage.
- [x] 14.2 Make the server clear the obsolete manager subscription and treat those authorised late events as no-ops without returning the internal shared-channel message.
- [x] 14.3 Run the realtime/publication regression, backend tests, typecheck, build, and strict OpenSpec validation.
