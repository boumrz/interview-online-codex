# Model Policy — Multi-Agent System

This document defines which AI model each agent runs on.
It applies to all three supported environments: **Claude Code**, **Cursor**, and **Codex (OpenAI)**.

## Philosophy

Token budget is a finite resource.
Only the Specification Agent runs on the most capable (and expensive) model because it performs the highest-stakes reasoning work: converting ambiguous requirements into a complete, internally consistent specification that the entire downstream team depends on.

All other agents run on progressively cheaper models matched to the cognitive complexity of their tasks.

---

## Model Tiers

| Tier | Model | When to use |
|------|-------|-------------|
| **Opus** | `claude-opus-4-5` | Deep reasoning, ambiguity resolution, full-spec authoring |
| **Sonnet** | `claude-sonnet-4-6` | Architecture design, implementation, structured reviews |
| **Haiku** | `claude-haiku-4-5-20251001` | Checklist verification, formatting, audit tasks |

> **Note:** Model strings above reflect the last known versions. Update to the latest available equivalents if newer versions exist. The tier assignments (Opus / Sonnet / Haiku) must stay the same even if exact version strings change.

---

## Agent-to-Model Assignments

### Opus tier — Planner only

| Agent | Model | Reason |
|-------|-------|--------|
| `Specification (TZ) Agent` | **Opus** | Produces the master specification; all other agents depend on its output. Requires maximum reasoning depth to detect conflicts, ambiguities and missing NFRs before they propagate. |

### Sonnet tier — Designers and builders

| Agent | Model | Reason |
|-------|-------|--------|
| `Product Owner Agent` | Sonnet | Needs strong understanding of business context and acceptance criteria writing |
| `Architect Agent` | Sonnet | Designs system modules, data model, realtime strategy, API contracts |
| `Team Lead Agent` | Sonnet | Decomposes architecture into executable tasks with correct sequencing |
| `Developer Agent` | Sonnet | Writes frontend/backend code in a constrained stack |
| `Designer Agent` | Sonnet | Produces detailed UX flows, screen specs, and component behavior |
| `Solution Reviewer Agent` | Sonnet | Needs to evaluate correctness and architectural fit of implementations |
| `Security & Reliability Agent` | Sonnet | Security review requires careful, context-aware analysis |

### Haiku tier — Checklist executors

| Agent | Model | Reason |
|-------|-------|--------|
| `QA Agent` | Haiku | Generates test matrices from structured acceptance criteria |
| `Prompt/Task Auditor Agent` | Haiku | Runs a fixed checklist against task definitions |
| `Test Reviewer Agent` | Haiku | Checks test coverage against a known pattern list |
| `UX Critic Agent` | Haiku | Evaluates UI specs against a fixed UX checklist |

---

## How each environment uses this policy

### Claude Code
Model is set in the `model:` frontmatter of each `.claude/agents/*.md` file.
Claude Code automatically routes each subagent invocation to the specified model.

### Cursor
Cursor does not natively support per-agent model routing.
Use this document as a manual guide:
- When invoking `@specification-agent` → set model to Opus in Cursor settings before calling.
- When invoking any Sonnet-tier agent → use Sonnet.
- When invoking Haiku-tier agents → use Haiku or the default model.

A Cursor rule in `.cursor/rules/00-multi-agent-system.mdc` surfaces these instructions inline.

### Codex (OpenAI)
Codex does not support model-per-agent routing.
The `AGENTS.md` file documents the intended model tier for each agent role.
When using the OpenAI API directly, pass the appropriate model string in the `model` field for each agent call.
