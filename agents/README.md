# InterHub Agent Roles

Specialists are optional tools for a concrete question, implementation slice, or independent review. Direct implementation is the default; there is no mandatory role pipeline.

Read [AGENTS.md](../AGENTS.md) for project rules and [the specification standard](../specs/README.md) for preparation, review depth, and completion criteria. [SPEC.md](../SPEC.md) links to the current feature contracts in `specs/features/`. OpenSpec is historical background only.

Use the smallest relevant role set. Give each agent a bounded objective, the relevant feature and R/AC identifiers, owned files, and only the context needed for that assignment. Agents sharing a checkout must preserve each other's work.

## Common references

- [Shared contract](common/shared-contract.md): lightweight assignment and result format.
- [Collaboration scenarios](common/handoff-scenarios.md): optional specialist use and risk-based independent review.
- [Task status](common/orchestrator-status-model.md): compact status guidance when coordination is needed.
- [Linked Linear work](common/linear-operating-rules.md): applies only when the task uses Linear.
- [Model policy](common/model-policy.md): runtime settings and avoiding unnecessary invocations.

## Role prompts and tool adapters

[Role prompts](roles/README.md) define each specialist's responsibility. They supplement shared rules rather than repeating the complete development process.

| Tool | Entry points |
|---|---|
| Codex | `AGENTS.md` and `.codex/agents/*.toml` |
| Claude Code | `CLAUDE.md` and `.claude/agents/*.md` |
| Cursor | `.cursor/rules/00-multi-agent-system.mdc` and `.cursor/rules/agents/*.mdc` |

Adapters must use the same current feature contracts. Do not add a second specification, PRD, issue system, approval chain, or model tier solely because a specialist is invoked. Detailed verification evidence belongs in a linked report, not in the active behavior contract.
