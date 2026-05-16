# interview-online — Agent System

This file defines the multi-agent development system for the `interview-online` project.
It is compatible with OpenAI Codex, Claude Code, and Cursor.

---

## Project

Platform for technical interviews with real-time collaborative code editing.

Fixed stack:
- Frontend: React + TypeScript + RTK + RTK Query + CSS Modules + Rspack + Monaco Editor
- Backend: Kotlin + Spring Boot + PostgreSQL + Redis
- Realtime: WebSocket (server-authoritative)
- Code execution: isolated sandbox service

Full specification: `TECHNICAL_SPECIFICATION.md`
Architecture: `docs/adr/`
Agent contracts: `agents/`

---

## Agent roster

| Agent | Role | Model tier | Description |
|-------|------|------------|-------------|
| `specification-agent` | Planner | **Opus** | Converts raw requirements into a complete, testable specification |
| `product-owner-agent` | Planner | Sonnet | Defines MVP scope, user stories, and acceptance criteria |
| `architect-agent` | Designer | Sonnet | Designs system architecture, ADRs, API contracts |
| `team-lead-agent` | Planner | Sonnet | Decomposes architecture into executable tasks |
| `developer-agent` | Executor | Sonnet | Implements frontend and backend tasks |
| `designer-agent` | Executor | Sonnet | Produces UX flows and screen specs |
| `solution-reviewer-agent` | Reviewer | Sonnet | Reviews engineering decisions; returns approve/revise/reject |
| `security-reliability-agent` | Reviewer | Sonnet | Security and reliability gate; can block release |
| `qa-agent` | Executor | Haiku | Creates test strategy and test cases; gives readiness verdict |
| `prompt-task-auditor-agent` | Gate | Haiku | Validates task quality before execution begins |
| `test-reviewer-agent` | Reviewer | Haiku | Reviews test coverage completeness |
| `ux-critic-agent` | Reviewer | Haiku | Reviews UX flows and screen specs |

---

## Model policy

**Opus** — Specification Agent only.
This agent converts ambiguous requirements into the master spec that all other agents depend on.
It requires the deepest reasoning capacity. Using a cheaper model here propagates errors downstream.

**Sonnet** — All design, implementation, and structured review agents.
These agents write code, design architecture, and reason about correctness.
They need strong reasoning but not the full depth of Opus.

**Haiku** — All checklist-based agents (QA, Auditor, Test Reviewer, UX Critic).
These agents run structured checklists against existing artifacts.
The task is pattern-matching and verification, not deep reasoning.

Full policy: `agents/common/model-policy.md`

---

## Orchestration flow

```
User input / feature request
  → specification-agent   [Opus]   — master spec
  → product-owner-agent   [Sonnet] — stories + AC
  → architect-agent       [Sonnet] — architecture
  → team-lead-agent       [Sonnet] — task decomposition
  → prompt-task-auditor   [Haiku]  — task quality gate
  → developer-agent       [Sonnet] — implementation
     or designer-agent    [Sonnet] — UX design
  → solution-reviewer     [Sonnet] — review
  → security-agent        [Sonnet] — security gate (if applicable)
  → qa-agent              [Haiku]  — testing
  → test-reviewer         [Haiku]  — coverage review
  → ux-critic             [Haiku]  — UX review (design work only)
  → product-owner-agent   [Sonnet] — final acceptance
```

---

## Agent role files

Detailed contracts for each agent are in `agents/roles/`:

- `agents/roles/specification-agent.md`
- `agents/roles/architect-agent.md`
- `agents/roles/product-owner-agent.md`
- `agents/roles/team-lead-agent.md`
- `agents/roles/developer-agent.md`
- `agents/roles/designer-agent.md`
- `agents/roles/solution-reviewer-agent.md`
- `agents/roles/security-reliability-agent.md`
- `agents/roles/qa-agent.md`
- `agents/roles/prompt-task-auditor-agent.md`
- `agents/roles/test-reviewer-agent.md`
- `agents/roles/ux-critic-agent.md`

Shared contracts (input/output formats, handoff rules): `agents/common/`

---

## Shared rules for all agents

1. Work only within your defined responsibility area
2. Use Linear as the single source of task state
3. Return structured YAML output, not free-form reasoning
4. Escalate conflicts — do not silently resolve them
5. Every handoff must include: input summary, output summary, risks, next owner
6. No task enters execution without a Linear issue in `Ready` state
7. Backend permissions must be enforced server-side regardless of UI restrictions
8. Realtime features must handle reconnect and conflict scenarios explicitly

---

## How to invoke agents (Codex API)

When calling agents via the OpenAI Responses API, pass the agent role file as the system prompt
and the task envelope (from `agents/common/shared-contract.md`) as the user message.

Example:
```python
response = client.responses.create(
    model="o3",          # use for specification-agent (Opus equivalent)
    instructions=open("agents/roles/specification-agent.md").read(),
    input=task_envelope_yaml,
)
```

For executor agents (developer, designer, QA):
```python
response = client.responses.create(
    model="o4-mini",     # Haiku/Sonnet equivalent for checklist agents
    instructions=open("agents/roles/qa-agent.md").read(),
    input=task_envelope_yaml,
)
```

Adapt model strings to current OpenAI model availability.
The tier mapping (deep reasoning / structured work / checklist) is what matters, not the exact string.
