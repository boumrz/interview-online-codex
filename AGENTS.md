# InterHub - Agent Rules

## Project

Platform for technical interviews with realtime collaborative code editing,
task steps, room briefings, interviewer notes, team workspaces, invitations,
team task libraries, interview programmes and internal collaboration tools.

Fixed stack:

- Frontend: React + TypeScript + RTK + RTK Query + CSS Modules + Rspack + Ant Design v6
- Backend: Kotlin + Spring Boot + PostgreSQL-compatible persistence
- Realtime: server-authoritative room state via SSE stream + POST event relay
- Collaboration: Yjs-backed editor sync in the current implementation

## Specification Source Of Truth

`SPEC.md` is the feature index, work order and brief delivery status.
The relevant file in `specs/features/` is the editable current contract for
product behavior. Use [specs/README.md](specs/README.md) when authoring or
reviewing specifications and [the template](specs/templates/feature.md) for
a new feature. Existing files are normalized when touched, not all at once.

Read only the relevant feature and its explicitly applicable dependencies.
Keep current decisions in their owning section; replace superseded rules
instead of appending dated overrides. Preserve important rationale. Detailed
run reports and previous contracts belong in `specs/references/`; consult
them only for a specific investigation. Git preserves edit history.

`openspec/` is historical. OpenSpec/BMAD artifacts, CLIs, PRDs and separate
design/task documents are not prerequisites for ordinary development.
Maintain historical OpenSpec only when explicitly requested. New explicit
user decisions take precedence; record them in the current feature contract.

## Lightweight Development Rule

For every feature, bug fix or behavior-changing refactor:

1. Find the owning feature, scope the requested result and select depth by risk.
   A small fix needs only the affected requirement; an ordinary feature needs
   a short contract; sensitive changes also need applicable role/state tables
   and negative/concurrent scenarios.
2. Update changed requirements in place. Give new requirements stable local
   IDs (`R-01`) and acceptance scenarios IDs (`AC-01`). Keep unaffected IDs.
   Link shared rules instead of duplicating them across features.
3. Before implementation, make a brief completeness pass: actor, trigger,
   observable result, scope, applicable failure/recovery states, rights and
   data lifecycle. Check that shortening preserved every material requirement.
   Resolve questions that change product behavior or security before dependent
   work. Separate assumptions from decisions; ask only what evidence cannot settle.
4. Write or update the most relevant behavioral test first when executable.
   Prefer E2E for user-visible flows; use PostgreSQL backend integration tests
   for permissions, persistence, migrations, concurrency and security boundaries.
   Use a focused unit/component test for isolated logic/interaction when it
   proves the requirement; briefly explain the choice when it replaces a flow E2E.
   Confirm failure for the missing behavior when practical; setup errors are not RED.
5. Implement the smallest coherent change, then run targeted verification.
   Broaden checks only for changed dependencies, failures or an unresolved risk.
   Mutation testing, full suites and every test layer are not universal gates.
6. Report requirement coverage, checks actually run and material limitations.
   Distinguish implemented, technically verified and product-accepted states.
   Update feature status and `SPEC.md` when delivery scope or remaining work changes.

Documentation/planning-only changes need link/format/consistency checks, not
application tests. Existing user authorization covers routine steps; ask again
only for unresolved material choices or actions outside the authorized scope.

## Quality Gates

- Backend permissions must be enforced server-side regardless of UI restrictions.
- Realtime features must handle reconnect, stale events, revocation and conflict
  scenarios explicitly.
- Invitation links, auth tokens, idempotency keys and private candidate data
  must never be persisted or logged through UI recovery state.
- Feature flags must remain off by default until their release gate is accepted.
- Do not touch the user's running local app unless the user explicitly asks for
  restart/stop/start.
- Follow the active role matrix. Do not invent owner-only restrictions, token
  expiry rules or additional infrastructure absent from the product contract.
- Significant changes to auth, ownership, invitation links, private data,
  realtime authority, data migrations or execution isolation require an
  independent scoped security/reliability review before release. Unresolved
  blocking findings stop release; ordinary polish does not trigger this gate.

## Agent Use

Default to direct implementation from the owning feature. There is no required
sequence of Specification → Product Owner → Architect → QA or per-task role audit.
Use specialists when the user requests delegation or the task needs an independent
review. Give each collaborator a concrete question, bounded ownership and only
the context it needs. A review checks outcomes and evidence, not document count.

Linear is optional: update an issue only when the task is linked to one. Plain
human-readable results are the default; structured handoffs are needed only
when a real consumer requires them. Preserve configured model choices; do not
impose role-specific model tiers.

## Skills And Context Cost

Use user-scoped skills from `$CODEX_HOME/skills` (default `~/.codex/skills`) as
the primary source. Choose the smallest relevant set; prefer `fallow` for JS/TS
codebase health. Apply skill guidance within this project workflow and the
user's authorization, without adding unrelated approval loops or artifacts.
Use available code discovery tools for focused questions, falling back to
targeted source searches when unavailable or insufficient. Do not load the
entire archive, every role prompt or every specification for a routine change.

## Legacy Material

Older files such as `openspec/project.md`, `openspec/specs/` and
`openspec/changes/` can help reconstruct why a decision was made, but they are
not the active workflow. Do not recreate new OpenSpec artifacts for ordinary
development.
