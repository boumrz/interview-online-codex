# interview-online - Agent Rules

## Project

Platform for technical interviews with realtime collaborative code editing,
task steps, room briefings, interviewer notes, team workspaces, invitations,
team task libraries, interview programmes and internal collaboration tools.

Fixed stack:

- Frontend: React + TypeScript + RTK + RTK Query + CSS Modules + Rspack + Mantine UI
- Backend: Kotlin + Spring Boot + PostgreSQL-compatible persistence
- Realtime: server-authoritative room state via SSE stream + POST event relay
- Collaboration: Yjs-backed editor sync in the current implementation

## Specification Source Of Truth

`SPEC.md` is the index and work order. Each feature's active product and
implementation source of truth is its file in `specs/features/`.

Use it for:

- remaining redesign and feature scope;
- priorities and acceptance criteria;
- task ordering;
- deciding whether a new request is in scope.

The `openspec/` directory is now a historical archive only. It may be read for
background evidence or detailed previous decisions, but new work does not
require creating OpenSpec changes, OpenSpec capability specs or running the
OpenSpec CLI.

## Lightweight Development Rule

For every feature, bug fix or behavior-changing refactor:

1. Find the relevant feature specification through `SPEC.md`.
2. If the requested behavior is missing or has changed, update that feature's
   specification directly and briefly.
3. Write or update the most relevant test first when the behavior is executable.
   Prefer E2E for user-visible flows; use backend integration tests for
   permissions, persistence, migrations, concurrency and security boundaries.
4. Confirm the test fails for the missing/incorrect behavior when practical.
5. Implement the smallest scoped change.
6. Run targeted verification proportional to the risk.
7. Update the feature specification and the status in `SPEC.md` if the delivered
   scope or remaining work changed.

Documentation-only and planning-only changes do not need automated tests.

## Quality Gates

- Backend permissions must be enforced server-side regardless of UI restrictions.
- Realtime features must handle reconnect, stale events, revocation and conflict
  scenarios explicitly.
- Invitation links, auth tokens, idempotency keys and private candidate data
  must never be persisted or logged through UI recovery state.
- Feature flags must remain off by default until their release gate is accepted.
- Do not touch the user's running local app unless the user explicitly asks for
  restart/stop/start.

## Agent Use

Use specialist agents only when the user asks for delegation or when a task
explicitly needs an independent review. Default to local, direct implementation
from the relevant feature specification linked by `SPEC.md`.

## Legacy Material

Older files such as `openspec/project.md`, `openspec/specs/` and
`openspec/changes/` can help reconstruct why a decision was made, but they are
not the active workflow. Do not recreate new OpenSpec artifacts for ordinary
development.
