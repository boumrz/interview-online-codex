# interview-online - Agent System

This file defines the default development workflow for the `interview-online` project.
It is compatible with OpenAI Codex, Claude Code, and Cursor.

## Project

Platform for technical interviews with realtime collaborative code editing, task steps, room briefings, interviewer notes, and an internal agent workflow.

Fixed stack:
- Frontend: React + TypeScript + RTK + RTK Query + CSS Modules + Rspack + Mantine UI
- Backend: Kotlin + Spring Boot + PostgreSQL-compatible persistence
- Realtime: server-authoritative room state via SSE stream + POST event relay
- Collaboration: Yjs-backed editor sync in the current implementation

## Specification Source Of Truth

OpenSpec is the only active specification system.

- Project context: `openspec/project.md`
- Current accepted requirements: `openspec/specs/`
- Proposed changes: `openspec/changes/<change-id>/`
- OpenSpec CLI: `npx --yes @fission-ai/openspec@latest ...`

Legacy specification files such as `TECHNICAL_SPECIFICATION.md`, `docs/specs/`, and `docs/adr/` are not active sources and must not be recreated for new work.

## Mandatory SDD Rule

Every bug fix, feature, or behavior-changing refactor starts with an OpenSpec change.

Required order:
1. Create or update `openspec/changes/<change-id>/proposal.md`.
2. Add or modify capability specs under `openspec/changes/<change-id>/specs/**/spec.md`.
3. Add `design.md` when architecture, dependencies, security, migration, or cross-module behavior changes.
4. Add `tasks.md`.
5. Run `openspec validate <change-id> --strict`.
6. Implement the tasks.
7. Update task checkboxes as work completes.
8. Verify with tests and archive completed specs with `openspec archive <change-id>` when appropriate.

No production code work begins before steps 1-5 are done.

## Agent Roster

| Agent | Role | Model tier | Description |
|-------|------|------------|-------------|
| `specification-agent` | Planner | Opus | Converts raw requirements into OpenSpec change artifacts |
| `product-owner-agent` | Planner | Sonnet | Defines scope, user stories, and acceptance criteria |
| `architect-agent` | Designer | Sonnet | Designs architecture, API contracts, and technical decisions |
| `team-lead-agent` | Planner | Sonnet | Decomposes validated specs into executable tasks |
| `developer-agent` | Executor | Sonnet | Implements frontend and backend tasks from ready OpenSpec tasks |
| `designer-agent` | Executor | Sonnet | Produces UX flows and screen specs |
| `solution-reviewer-agent` | Reviewer | Sonnet | Reviews engineering decisions and implementation risk |
| `security-reliability-agent` | Reviewer | Sonnet | Security and reliability gate; can block release |
| `qa-agent` | Executor | Haiku | Creates and runs test strategy, then gives readiness verdict |
| `prompt-task-auditor-agent` | Gate | Haiku | Validates task quality before execution begins |
| `test-reviewer-agent` | Reviewer | Haiku | Reviews test coverage completeness |
| `ux-critic-agent` | Reviewer | Haiku | Reviews UX flows and screen specs |

## Default Orchestration

The multi-agent system is implicit. Users do not need to mention it.

```
User request
  -> specification-agent       [OpenSpec proposal/specs/design/tasks]
  -> product-owner-agent       [scope + acceptance criteria]
  -> architect-agent           [technical decisions when needed]
  -> team-lead-agent           [task decomposition]
  -> prompt-task-auditor-agent [task quality gate]
  -> developer-agent
     or designer-agent
  -> solution-reviewer-agent
  -> security-reliability-agent when applicable
  -> qa-agent
  -> test-reviewer-agent
  -> ux-critic-agent for design work
  -> product-owner-agent final acceptance
```

## Shared Rules For All Agents

1. Work only within your defined responsibility area.
2. Use OpenSpec as the source of requirement truth.
3. Use Linear as the source of task state when a Linear issue exists.
4. Return structured YAML output for agent handoffs, not free-form reasoning.
5. Escalate conflicts; do not silently resolve them.
6. Every handoff must include input summary, output summary, risks, and next owner.
7. No task enters implementation without a validated OpenSpec change and ready task list.
8. Backend permissions must be enforced server-side regardless of UI restrictions.
9. Realtime features must handle reconnect and conflict scenarios explicitly.

## Agent Role Files

Detailed contracts are in `agents/roles/`; shared contracts are in `agents/common/`.
Codex-local agent entries live in `.codex/agents/`.
OpenSpec Codex skills live in `.codex/skills/`.

## Codex API Invocation

When calling agents via the OpenAI Responses API, pass the relevant agent role file as instructions and include the OpenSpec change/task envelope as the user input.

Example:

```python
response = client.responses.create(
    model="o3",
    instructions=open("agents/roles/specification-agent.md", encoding="utf-8").read(),
    input=task_envelope_yaml,
)
```

Adapt model strings to current OpenAI model availability. The tier mapping matters more than the exact model name.
