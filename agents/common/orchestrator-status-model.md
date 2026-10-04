# Task Status Guidance

Do not create an orchestrator for a single direct task. [SPEC.md](../../SPEC.md) keeps the brief feature status; the feature contract contains its current scope and acceptance state.

When multiple assignments need coordination, use a few plain states such as `planned`, `in progress`, `in review`, `accepted`, and `blocked`. Keep them consistent with the actual work and any linked issue system.

- `blocked` requires a concrete unresolved dependency or decision and a next action.
- Implementation complete does not imply product acceptance.
- Acceptance requires the scoped criteria and proportional verification, including independent security/reliability review when required.
- State transitions do not require a different agent owner or a separate report.

An explicitly named application runtime may require an existing state/schema contract. Preserve that contract for that integration; this guidance does not migrate application data or APIs.
