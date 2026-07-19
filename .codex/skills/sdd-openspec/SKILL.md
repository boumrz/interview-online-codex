---
name: sdd-openspec
description: Enforce specification-driven development with OpenSpec for every task in the interview-online project. Use for any request that inspects, plans, changes, tests, configures, documents, or reviews this repository so work begins with an OpenSpec change and follows its validated tasks.
---

# SDD with OpenSpec

Treat OpenSpec as the source of truth for every project task. Read `AGENTS.md` and `openspec/project.md` before deciding scope.

## Required workflow

1. Inspect `openspec list --json` and determine whether an active change already covers the request. Do not reuse an unrelated change.
2. For a new task, create `openspec/changes/<change-id>/` with `openspec new change <change-id>`.
3. Before modifying application, deployment, test, or product documentation files, create or update `proposal.md`, capability specs under `specs/**/spec.md`, `design.md` for architectural, dependency, security, data, or cross-module choices, and `tasks.md`.
4. Run `openspec validate <change-id> --strict`; fix every validation error before implementation.
5. Before production implementation of executable behaviour, author the planned acceptance test: use E2E for a user-observable flow unless a documented integration/unit alternative is more proportionate or applicable. Run it and confirm that it fails because the requested behaviour is missing or incorrect.
6. Implement only the validated, in-scope tasks needed to make the prewritten test pass. Mark each completed checkbox in `tasks.md` as work is finished.
7. Run the relevant regression verification required by the change and project context, then validate strictly again. Archive the change when the requested work is complete and archival is appropriate.

## Decision rules

- Preserve the established multi-agent sequence when agents are available: specification, product, architecture, task-quality gate, implementation, review, security/reliability when applicable, QA, and acceptance.
- Keep research and exploratory findings in the proposal or design; convert any decision that affects behavior into a requirement and a task before coding.
- Treat external APIs, secrets, authorisation, personal data, realtime behavior, and migrations as design decisions. Specify server-side permission enforcement, error behavior, and tests explicitly.
- For every behavioural task, task decomposition must expose a test-first task before the production task and state the E2E choice or a documented exception. Documentation-only, comment-only, formatting-only, and non-executable configuration work may omit a test only with a recorded reason.
- If the request is read-only, use existing OpenSpec artifacts as context and do not alter code. If it can lead to a change, capture the investigation and proposed next work in a new or relevant OpenSpec change first.
- Report handoffs in YAML with `input_summary`, `output_summary`, `risks`, and `next_owner`.

## Completion gate

Do not declare a project task complete unless its OpenSpec artifacts, task states, evidence of the initial red test (or documented non-executable exception), strict validation, and proportionate final verification agree with the delivered behavior.
