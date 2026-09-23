# interview-online OpenSpec Project Context

> Deprecated workflow note: OpenSpec is no longer the active source of truth for
> this repository. Use `SPEC.md` at the repository root for current scope,
> priorities and acceptance criteria. This file and the rest of `openspec/`
> remain as historical context only.

## Purpose

interview-online is a platform for technical interviews with realtime collaborative code editing, interview steps, interviewer notes, markdown briefings, and an internal agent workflow.

## Stack

- Frontend: React, TypeScript, RTK, RTK Query, CSS Modules, Rspack, Mantine UI, CodeMirror/Yjs for the current editor implementation.
- Backend: Kotlin, Spring Boot, PostgreSQL-compatible persistence, H2 for local tests.
- Realtime: server-authoritative room state with SSE stream plus POST event relay.
- Agent workflow: Linear-backed multi-agent pipeline with specification, product, architecture, task, implementation, review, security, QA, test coverage, UX, and acceptance stages.

## OpenSpec Workflow

- Deprecated. Do not create new OpenSpec changes for ordinary work.
- Use `SPEC.md` instead.
- Existing OpenSpec files may be read only as background evidence.

## Legacy Specification Policy

- `openspec/` itself is now legacy/historical.
- Existing agent role contracts in `agents/` and `.codex/agents/` remain operational instructions, not product specifications.
- Current requirements live in `SPEC.md`.

## Agent Orchestration

- Multi-agent orchestration is optional and should be used only when explicitly requested or when an independent review is valuable.
- Default to direct implementation from `SPEC.md`.
- Linear remains the source of task state when a Linear issue exists.

## Quality Gates

- For a user-observable behaviour change, author and run its E2E acceptance test before production code, confirming the initial failure; document a proportionate integration/unit alternative when E2E is not applicable.
- Run frontend typecheck/build and targeted E2E tests for frontend behavior changes.
- Run backend tests when backend code, contracts, persistence, security, or realtime behavior changes.
- Realtime, permissions, and security-sensitive changes require explicit reconnect/conflict/authorization coverage in the spec and tests.
