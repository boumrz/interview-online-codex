# Multi-Agent Prompts (English)

This folder contains the English, split-by-role version of the agent contracts used by the `interview-online` project.

## Structure

- `common/shared-contract.md` — rules and shared input/output formats for all agents
- `common/handoff-scenarios.md` — required handoff flows between roles
- `common/orchestrator-status-model.md` — minimum task-state model for orchestrators
- `common/linear-operating-rules.md` — mandatory Linear operating rules and comment template
- `roles/*.md` — one file per agent role

## Why this exists

The previous role definitions were concentrated in a single large document.  
This folder keeps the same logic in a cleaner, English-first layout so each role is easier to read and maintain.
