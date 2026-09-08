## Why

Candidate activity periodically stops updating or appears to be erased, and the
small recent-history window prevents an interviewer from reviewing the whole
interview. An authorized interviewer needs a continuous timeline whose displayed
history remains recoverable from durable individual source events.

## What Changes

- Make all retained activity for an interview accessible from the manager
  Activity Timeline; a bounded recent window or network page must not be a
  retention or review limit.
- Preserve previously loaded activity while newer server snapshots, reconnects,
  history pages, or transient failures are processed. Recover missing durable
  events and reconcile by stable identity and canonical order without duplicates.
- Keep live activity updating when the recent window fills and after an unrelated
  room update, step transition, manager reload, or supported transport recovery.
- Retain the activity delivery queue during retryable network/server failures;
  a stalled request must time out, and a transient failure must not permanently
  disable capture or discard pending activity after three attempts.
- Distinguish confirmed empty history from loading, partial history, and failed
  history retrieval. Older history must be discoverable and loading must not
  erase successfully loaded records.
- Keep history persistence independent from the in-memory recent window and
  preserve the existing individual JSON/CSV export and manager-only access.
- Bound history transfers and retries independently from total retained interview
  history, preserving the current SSE + POST relay and Yjs editor collaboration.

## Capabilities

### New Capabilities

- `candidate-activity-history`: Complete retained interview activity review,
  durable reconstruction, lossless client reconciliation, bounded retrieval,
  explicit retrieval states, and manager-only history access.

### Modified Capabilities

- None. `grouped-activity-timeline` exists in the active
  `group-activity-timeline-events` change rather than the accepted baseline.
  This new change explicitly supersedes that proposal's requirement to render
  only the latest 50 raw events, replacement of loaded history by a recent
  snapshot, and permanent activity-only shutdown after three `5xx` responses;
  its grouping rules, source-event identity, individual export, and bounded
  authorization recovery remain the compatibility reference. The earlier change
  is not rewritten or archived here.

## Impact

- Frontend room activity state/reconciliation, history API consumption, Activity
  Timeline presentation, and targeted browser/ordering tests.
- Backend activity history reads, room-state restoration, activity persistence
  and transport error boundaries as required by reproduced defects.
- Additive authorized history API contracts; bounded network responses and
  explicit completion/error metadata are subject to Architect detailing.
- Existing PostgreSQL-compatible activity records and indexes. Any demonstrated
  need for schema change requires an additive migration; existing versioned
  migrations and unrelated HR work are preserved.
- No new activity categories, editor protocol, analytics, role grants, raw export
  format, or recovery of events already deleted before this fix.

## Scope decision and compatibility

The request to review the whole interview removes the UI total-history cap; it
does not require an unbounded SSE payload or a new data-retention policy. Existing
durable activity is already retained until room deletion. The root task owner
approved bounded pages, durable catch-up, an additive history index/legacy
backfill, and recoverable activity retries; `design.md` records those decisions
for the architecture gate. The outgoing queue remains volatile across full page
reload/close. Production work follows strict validation, the task-quality gate,
and the applicable pre-implementation failing tests.
