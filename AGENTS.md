# Multi-Agent System — interview-online

This file is the canonical reference for Codex (OpenAI) and any agent runtime that reads `AGENTS.md`.
For Claude Code, see `.claude/agents/`. For Cursor, see `.cursor/rules/00-multi-agent-system.mdc`.

## Architecture Overview

The project uses a 12-agent hierarchy with strict handoff contracts and mandatory review gates.
All task state lives in Linear. No work is valid without a corresponding Linear issue.

Full contracts: `agents/roles/*.md`
Shared rules: `agents/common/`
Model tiers: `agents/common/model-policy.md`

---

## Agent Roster

### Planner — Opus tier

| Agent | File | Model (OpenAI equiv.) | Purpose |
|-------|------|-----------------------|---------|
| Specification (TZ) Agent | `agents/roles/specification-agent.md` | `o3` or best available | Converts raw requirements into a complete, testable specification |

> **Why Opus/o3:** This is the highest-stakes reasoning step. Every downstream agent depends on its output. Use the most capable model available. Token cost here is justified — errors here multiply across the entire system.

### Builders — Sonnet tier

| Agent | File | Model (OpenAI equiv.) | Purpose |
|-------|------|-----------------------|---------|
| Product Owner Agent | `agents/roles/product-owner-agent.md` | `o4-mini` or `gpt-4.1` | User stories, MVP scope, acceptance criteria |
| Architect Agent | `agents/roles/architect-agent.md` | `o4-mini` or `gpt-4.1` | System design, API contracts, ADRs |
| Team Lead Agent | `agents/roles/team-lead-agent.md` | `o4-mini` or `gpt-4.1` | Task decomposition, sprint sequencing |
| Developer Agent | `agents/roles/developer-agent.md` | `o4-mini` or `gpt-4.1` | Frontend/backend implementation |
| Designer Agent | `agents/roles/designer-agent.md` | `o4-mini` or `gpt-4.1` | UX flows, screen specs, component behavior |
| Solution Reviewer Agent | `agents/roles/solution-reviewer-agent.md` | `o4-mini` or `gpt-4.1` | Code/architecture correctness review |
| Security & Reliability Agent | `agents/roles/security-reliability-agent.md` | `o4-mini` or `gpt-4.1` | Auth, sandbox, session security review |

### Checklist Executors — Haiku tier

| Agent | File | Model (OpenAI equiv.) | Purpose |
|-------|------|-----------------------|---------|
| QA Agent | `agents/roles/qa-agent.md` | `gpt-4.1-mini` | Test cases, release readiness verdict |
| Prompt/Task Auditor Agent | `agents/roles/prompt-task-auditor-agent.md` | `gpt-4.1-mini` | Task definition quality gate |
| Test Reviewer Agent | `agents/roles/test-reviewer-agent.md` | `gpt-4.1-mini` | Test coverage review |
| UX Critic Agent | `agents/roles/ux-critic-agent.md` | `gpt-4.1-mini` | UX spec review against checklist |

---

## Workflow

```
[Raw Input]
    │
    ▼
specification-agent (Opus / o3)
    │  outputs: SPEC-* issue in Linear + specification document
    ▼
product-owner-agent (Sonnet / gpt-4.1)
    │  outputs: user stories, MVP scope, AC per story
    ▼
architect-agent (Sonnet / gpt-4.1)
    │  outputs: ADR, module diagram, API contracts
    ▼
team-lead-agent (Sonnet / gpt-4.1)
    │  outputs: Linear tasks with estimates, dependency map
    ▼
prompt-task-auditor-agent (Haiku / gpt-4.1-mini)  ← quality gate
    │  verdict: ready | needs-clarification
    ▼
developer-agent / designer-agent (Sonnet / gpt-4.1)  ← parallel
    │  outputs: code commits, UX specs
    ▼
solution-reviewer-agent + security-reliability-agent (Sonnet)  ← parallel review
    │  verdicts: approve | revise | reject
    ▼
qa-agent (Haiku / gpt-4.1-mini)
    │  outputs: test cases, release readiness verdict
    ▼
test-reviewer-agent + ux-critic-agent (Haiku)  ← parallel review
    │  verdicts: approve | revise | reject
    ▼
[Done — Linear issue closed]
```

---

## Task Envelope Format

Every handoff between agents uses this YAML envelope:

```yaml
task_id: PROJ-123
linear_url: https://linear.app/org/issue/PROJ-123
goal: "One sentence describing what must be produced"
context: "Background, constraints, prior decisions"
acceptance_criteria:
  - "Criterion 1 (testable)"
  - "Criterion 2 (testable)"
artifacts_in:
  - type: specification | design | code | review
    location: path/or/url
owner: specification-agent | developer-agent | ...
required_reviewers:
  - solution-reviewer-agent
  - security-reliability-agent
dependencies:
  - PROJ-100  # must be Done before this starts
```

---

## Review Gates

State transitions are blocked without required reviewer verdicts:

| Transition | Required Reviewers |
|------------|-------------------|
| in_progress → under_review | solution-reviewer-agent |
| under_review → qa_check | security-reliability-agent (auth/execution features only) |
| qa_check → accepted | test-reviewer-agent |
| accepted → done | prompt-task-auditor-agent confirmed ready |

Verdict format:
```
verdict: approve | revise | reject
findings:
  - "[CRITICAL/MAJOR/MINOR] Description"
recommendation: "What to do next"
```

---

## Environment-Specific Notes

### Codex / OpenAI API
- Pass `model` field per agent call. Do not use one model for all agents.
- Haiku-tier agents are intentionally constrained — do not upgrade them unless their checklist tasks genuinely require it.
- The `specification-agent` should always use the most capable reasoning model (`o3`, `o3-pro`, or equivalent).

### Claude Code
- Model routing is automatic via `.claude/agents/*.md` frontmatter.
- Run `claude` and invoke agents using the Agent tool with `subagent_type` matching the agent name.

### Cursor
- See `.cursor/rules/00-multi-agent-system.mdc` for inline guidance.
- Switch model manually in Cursor model selector before each agent invocation.
