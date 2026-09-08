## Why

The personal room-creation preview repeats the longer “нанимающий менеджер” phrase in a compact, per-UUID interface. Shortening the preview copy makes the form easier to scan while retaining its privacy-safe meaning and all existing assignment behavior.

## What Changes

- Replace only the specified visible room-creation manager-preview and creation-error strings with the supplied compact Russian copy.
- Apply the exact strings to the authenticated dashboard form's label, placeholder, pending state, local incomplete-ID error, unavailable preview error, retryable preview error, and post-submit invalid-identifier error.
- Preserve the preview's existing eligibility, privacy, retry, draft-retention, accessibility, and server-authoritative creation behavior.
- Do not rename technical endpoint/type names or alter role/cabinet terminology outside the room-creation preview and post-submit error in scope.

## Capabilities

### New Capabilities

- `hiring-manager-preview-copy`: Exact compact Russian product copy for the hiring-manager invitation preview in authenticated room creation.

### Modified Capabilities

None.

## Impact

- The authenticated dashboard room-creation form and its local feedback mapping require copy-only updates.
- Focused browser acceptance and a bounded static copy audit verify the exact visible messages, including the post-submit error path.
- No backend contract, persistence, realtime behavior, endpoint, type name, role, cabinet, or public/guest form behavior changes.
