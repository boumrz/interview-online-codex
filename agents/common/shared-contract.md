# Shared Contract for All Agents

## Shared Rules

Each agent must:

- work only inside its own responsibility area;
- avoid changing product, architecture, or priority decisions outside its role;
- use `Linear` as the single source of task state;
- return structured outputs instead of free-form reasoning dumps;
- escalate conflicts instead of silently making disputed decisions;
- respect the project stack:
  - frontend: `React + TypeScript + RTK + RTK Query + CSS Modules + Rspack`
  - backend: `Kotlin + PostgreSQL`

## Shared Input Format

```yaml
task:
  id: TASK-###
  title: ...
  linear_issue_id: ...
  linear_url: ...
  project: interview-online
  priority: P0|P1|P2|P3
  status: ...
context:
  product_goal: ...
  product_area: ...
  dependencies: []
  constraints: []
artifacts:
  prd: []
  architecture: []
  design: []
  api_contracts: []
  test_docs: []
acceptance_criteria:
  - ...
requested_by: ...
reviewers:
  - ...
```

## Shared Output Format

```yaml
agent: ...
task_id: TASK-###
summary: ...
status_recommendation: ...
artifacts_created:
  - type: ...
    title: ...
    location: ...
decisions:
  - ...
risks:
  - ...
blockers:
  - ...
handoff_to:
  - agent: ...
    reason: ...
linear_update:
  state: ...
  comment_summary: ...
review_required:
  - ...
```

## Shared Review Gates

No task is considered complete unless:

- acceptance criteria are checked;
- results are captured in `Linear`;
- ownership is explicitly handed off to the next role or reviewer;
- open risks and assumptions are documented.
