# Prevent unverified realtime room access and retry storms

## Why

An expired or missing realtime session causes the room client to keep the rejected
event at the head of its queue. Every `403` schedules another SSE connection after
180 ms, then resends the same event. This creates thousands of failed `/events`
requests and leaves a visitor looking as though they can use the room despite the
server not confirming the session.

## Scope

- Stop unbounded retries after realtime `403` responses.
- Keep one recovery attempt for a genuinely stale event token, then terminate the
  failed realtime attempt, discard its queued events, and show a clear access error.
- Do not render an editable room workspace until the server has delivered a
  realtime `state_sync` for this browser session.
- Preserve anonymous candidate access by invitation link: the invite link remains
  the candidate credential; it is not an interviewer or room-owner credential.

## Out of scope

- Requiring every candidate to create an account.
- Changing owner, interviewer, or candidate authorization rules on the server.
- Retrying a session that the server has explicitly rejected indefinitely.
