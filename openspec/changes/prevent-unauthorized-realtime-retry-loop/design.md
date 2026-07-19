# Design: bounded realtime authorization recovery

## Problem

The client currently interprets every `403` from the event relay as a stale event
token. It retains the rejected queue entry and reconnects forever. A `403` can also
mean that there is no active SSE connection for the session, in which case retrying
cannot establish authorization without a new successful server state sync.

## Decision

Each queued event receives one authorization-recovery attempt. The first `403`
clears the event token and reconnects so a replaced SSE connection can supply a new
token. If the same queue entry is rejected with `403` again, the client:

1. closes the SSE transport;
2. aborts any in-flight relay request;
3. drops queued messages;
4. stops reconnect scheduling; and
5. reports a terminal access-confirmation error to the room page.

This keeps the existing recovery path for a stale token while bounding failed relay
traffic to at most two requests for a queue entry.

The room page distinguishes a public room preview from an approved realtime
session. It may use the public room payload for the page shell, but it renders the
interactive editor and controls only after receiving `state_sync`. If access cannot
be confirmed, it replaces the workspace with a non-editable error state.

## Authorization boundary

Anonymous candidates may still join by invite link and display name. They receive a
server-generated event token only through `state_sync`, and remain candidates unless
the server grants another role. The frontend is not an authorization boundary: the
server continues enforcing event tokens and room roles for every event.

## Verification choice

A browser E2E test is needed to observe the rendered access state and prove that
requests do not continue after repeated `403` responses. A focused backend test
continues to cover the server's `403` authorization policy.
