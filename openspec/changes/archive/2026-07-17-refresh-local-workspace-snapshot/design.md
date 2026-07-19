## Context

The manager-only workspace endpoint correctly returns persisted task state, but its RTK Query result stays cached after the preview is temporarily skipped while that task is globally active. No write is allowed from the preview; this change concerns freshness only.

## Decision

Configure the workspace query to refetch whenever the non-published preview subscription is re-entered. The request remains skipped for candidates and for the published task, so the SSE/Yjs boundary remains unchanged.

The E2E edits a task while it is the published shared workspace, publishes another task, then verifies that a manager retaining the first local selection sees the saved edit in the restored read-only preview.

The active marker's aria-label includes the exact task title. Visible compact copy remains `Активен`.

## Risks

- A re-entered preview makes one additional authorised GET request; this is bounded to manager navigation and preferable to stale code/briefing.
- The E2E must wait for the existing persisted task snapshot boundary rather than assuming an immediate Yjs write.
