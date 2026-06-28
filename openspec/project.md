# interview-online OpenSpec Project Context

## Purpose

interview-online is a platform for technical interviews with realtime collaborative code editing, interview steps, interviewer notes, markdown briefings, and an internal agent workflow.

## Stack

- Frontend: React, TypeScript, RTK, RTK Query, CSS Modules, Rspack, Mantine UI, CodeMirror/Yjs for the current editor implementation.
- Backend: Kotlin, Spring Boot, PostgreSQL-compatible persistence, H2 for local tests.
- Realtime: server-authoritative room state with SSE stream plus POST event relay.
- Agent workflow: Linear-backed multi-agent pipeline with specification, product, architecture, task, implementation, review, security, QA, test coverage, UX, and acceptance stages.

## OpenSpec Workflow

- OpenSpec is the source of truth for product and technical specifications.
- Every bug fix, feature, or behavior-changing refactor MUST start with an OpenSpec change under `openspec/changes/<change-id>/`.
- A change MUST include at least `proposal.md`, capability specs under `specs/**/spec.md`, `design.md` when architecture or dependencies change, and `tasks.md` before implementation.
- Implementation MUST follow the active OpenSpec change and update task checkboxes as work is completed.
- Completed changes SHOULD be archived with `openspec archive <change-id>` so `openspec/specs/` remains the current baseline.

## Legacy Specification Policy

- `TECHNICAL_SPECIFICATION.md`, `docs/specs/`, and `docs/adr/` are legacy specification locations and MUST NOT be used for new specification work.
- Existing agent role contracts in `agents/` and `.codex/agents/` remain operational instructions, not product specifications.
- Current requirements live in `openspec/specs/`; proposed deltas live in `openspec/changes/`.

## Agent Orchestration

- Multi-agent orchestration is the default delivery path, even when the user does not explicitly mention agents.
- The first owner for any new change is `specification-agent`; implementation cannot begin until the OpenSpec artifacts and task-quality gate are ready.
- The default route is: specification-agent -> product-owner-agent -> architect-agent -> team-lead-agent -> prompt-task-auditor-agent -> developer-agent/designer-agent -> solution-reviewer-agent -> security-reliability-agent when applicable -> qa-agent -> test-reviewer-agent -> ux-critic-agent for design work -> product-owner-agent acceptance.
- Linear remains the single source of task state when a Linear issue exists; OpenSpec remains the single source of specification state.

## Quality Gates

- Run `openspec validate --strict` for changed OpenSpec artifacts before implementation and before final handoff.
- Run frontend typecheck/build and targeted E2E tests for frontend behavior changes.
- Run backend tests when backend code, contracts, persistence, security, or realtime behavior changes.
- Realtime, permissions, and security-sensitive changes require explicit reconnect/conflict/authorization coverage in the spec and tests.
