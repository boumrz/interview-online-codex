# Multi-Agent System — Agent Contracts

This folder contains the universal agent contracts for the `interview-online` project.
These contracts are tool-agnostic: the same roles and rules apply in Claude Code, Cursor, and Codex.

## Common files

- `common/shared-contract.md` — shared input/output formats for all agents
- `common/handoff-scenarios.md` — required handoff flows between roles
- `common/orchestrator-status-model.md` — task state model for orchestrators
- `common/linear-operating-rules.md` — Linear operating rules and comment template
- `common/model-policy.md` — model tier assignments per agent (Opus / Sonnet / Haiku)

## Role files

- `roles/*.md` — one file per agent role (system prompt + scope + decision rules)

## Tool-specific entry points

| Tool | File |
|------|------|
| Claude Code | `CLAUDE.md` + `.claude/agents/*.md` |
| Cursor | `.cursor/rules/00-multi-agent-system.mdc` + `.cursor/rules/agents/*.mdc` |
| Codex (OpenAI) | `AGENTS.md` |

## Model assignments (summary)

| Agent | Tier |
|-------|------|
| Specification (TZ) Agent | **Opus** |
| Product Owner, Architect, Team Lead, Developer, Designer | Sonnet |
| Solution Reviewer, Security & Reliability Agent | Sonnet |
| QA, Prompt/Task Auditor, Test Reviewer, UX Critic | Haiku |

Full rationale: `common/model-policy.md`
