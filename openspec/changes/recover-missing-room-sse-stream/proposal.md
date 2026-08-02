## Why

After a local backend restart, a room that was already open in a browser can no
longer exist. Its SSE endpoint returns `404`, but the browser treats that as a
generic transport failure and repeatedly reconnects, flooding room stream and
event endpoints while leaving the user without a clear terminal outcome.

## What Changes

- Classify a backend-confirmed missing-room SSE result as a terminal,
  non-editable room-unavailable state rather than a transient outage.
- Stop scheduled and future retry-generated SSE and room-event traffic for that
  page-room session once room absence is confirmed, including stale asynchronous
  reconnect callbacks.
- Preserve normal reconnect behavior for transient SSE failures and the existing
  bounded stale-event-token (`403`) recovery behavior when the room still exists.
- Present safe, understandable unavailable-state copy without exposing raw HTTP
  status codes or backend response bodies.
- Add test-first browser coverage for the missing-room retry flood and the
  stale-token recovery race, plus proportionate backend coverage for the
  missing-room stream contract.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `realtime-room-access`: distinguish a confirmed missing room from transient
  realtime transport loss and terminate only the former safely.

## Impact

- Frontend room realtime lifecycle and terminal room-page presentation.
- Existing same-origin backend realtime stream error contract and its regression
  coverage; no additional port, new authority, or authorization relaxation is
  permitted.
- Realtime browser E2E and focused backend integration tests. The active
  `group-activity-timeline-events` change remains out of scope: its persisted
  Room-ID and activity-`5xx` behavior is not changed here.
