## Context

The native browser EventSource error callback used by the room client does not
provide a reliable HTTP response status. The current lifecycle therefore treats
the backend's missing-room stream response the same as a temporary outage and
reconnects after its normal interval. See `proposal.md` and the realtime-room-
access delta for the required user-visible behavior.

## Goals / Non-Goals

**Goals:**

- Provide a server-authoritative, status-aware missing-room signal to the
  existing same-origin room client.
- Make terminal teardown idempotent so timers, EventSource callbacks, queued
  relays, activity delivery, and focus/visibility handlers cannot revive it.
- Retain existing transient reconnect and bounded `403` token-recovery behavior.

**Non-Goals:**

- Adding a port, changing the SSE/POST transport model, altering room roles or
  invitation permissions, or changing activity-specific `5xx` handling.
- Treating arbitrary client/network errors as proof that a room was deleted.

## Approved Architecture Decision

Native `EventSource` does not expose an HTTP status to the browser. The client
therefore closes a failed stream and performs one same-origin status probe:
`GET /api/realtime/rooms/{inviteCode}/stream-status`. The endpoint resolves the
same user and room-admission inputs as the stream, but is deliberately
side-effect-free: it creates no SSE connection, participant, event token,
metric, or state payload. It returns `204` when a stream could be opened and an
empty `404` only when the room cannot be found. A network failure or any other
status remains a transient transport failure and follows the existing reconnect
path.

The status probe is non-cacheable and bounded: the server emits `Cache-Control:
private, no-store` and the browser requests it with `cache: "no-store"`. If it
does not resolve within the short client deadline, it is a transient transport
failure and normal reconnect resumes. While a probe is in flight,
focus/visibility control messages stay queued; they cannot spend the
stale-token recovery budget without a current stream lease.

Each EventSource connection owns a monotonically increasing client lease. A
stream error revokes its lease before the status probe, clears the current event
token, and aborts both relay lanes. A `state_sync`, queued relay, delayed retry,
or fetch response may act only while its captured lease is current. This fences
the automatic EventSource reconnect race where an old token can otherwise send
a `403` after a replacement stream has evicted it.

## Implementation Constraints

- Terminalization must be a single idempotent transition shared by a confirmed
  missing-room result and all later callbacks. It must clear timers, close the
  active transport, abort in-flight relay work, clear queued work, and suppress
  subsequent sends for the current page-room session.
- A `404` from an unverified transport failure MUST NOT be inferred as room
  absence; the client acts only on the `stream-status` server contract.
- A stale-token recovery timer that observes terminalization MUST become a
  no-op. Conversely, a successful authoritative state sync for an existing room
  retains the established recovery flow.
- A pending status probe MUST have a bounded lifetime. Timeout, abort, or a
  non-`404` result returns to transient reconnect, and focus/visibility work
  MUST NOT drain before a current stream is available.
- The page needs a distinct room-unavailable state from the existing
  access-denied state so it can render safe, action-oriented copy without raw
  error details.

## Risks / Trade-offs

- [A status probe bypasses existing authorization] → Require backend reuse of
  the stream's room/access checks and focused integration coverage for no
  token, state payload, or mutation on a missing room.
- [A late callback restarts traffic after terminalization] → Use one terminal
  guard at every reconnect and relay entry point; exercise the 403/404 race in
  browser E2E.
- [A broad 404 classification masks deployment failure] → Accept only the
  documented, server-authoritative missing-room result, not generic EventSource
  errors or arbitrary proxy responses.

## Migration Plan

1. Agree the status-aware server contract with the Architect and add red browser
   and backend tests.
2. Deliver the client classification and idempotent terminal UI/teardown.
3. Verify transient reconnect and existing `403` recovery regressions.
4. Rollback restores the prior transient reconnect path; it does not change
   server-side authorization or require a data migration.
