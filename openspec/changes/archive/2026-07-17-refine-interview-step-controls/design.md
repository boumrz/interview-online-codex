## Context

The manager task panel currently adds a dedicated bordered preview card above the task list. It repeats the selected task name, explains the implementation detail of a local preview, and hosts a disabled `Показать этот шаг всем` button. The room-wide marker is also verbose and outlined. The feature remains correct but the UI gives technical state more prominence than the interview task list.

Public HR-platform guidance consistently uses the compact hierarchy of plan → stage → action: Greenhouse uses interview plans and stages, Workable uses a current stage with direct move-to-stage actions, and Ashby uses active stages. The room is a real-time collaboration view, so it needs the same concise hierarchy while preserving its additional local/global distinction.

## Goals / Non-Goals

**Goals:**

- Make the globally published task immediately recognisable without repeating an explanation in the panel.
- Let an interviewer see their selected row and intentionally publish it with a concise action.
- Remove the added local-preview card and border treatments that compete with the task list.
- Preserve existing local-selection, candidate restriction, and server-authoritative publication behaviour.

**Non-Goals:**

- Change task-selection persistence, realtime events, permission checks, or shared editor binding.
- Add another confirmation dialog or alter task action menus.
- Rename existing room/task terminology outside this focused panel.

## Decisions

### Use concise stage language

The task-list context becomes `Шаг N из M`; the one global row displays a filled, borderless `Активен` badge. This mirrors the concise active/current-stage convention in HR platforms and avoids repeating “для всех” next to every row. The badge receives an accessible label that retains the fuller meaning for assistive technology.

### Keep selection in the list and publish from the selected row

The local-preview card is removed. A local selection remains visible through its existing row background only; no new outline or border colour is added. When the selected row is not globally active, it exposes the compact `Сделать активным` action next to the row contents. The action’s accessible label names the selected task and explains that it becomes current for all participants. It is not shown for the already-active row.

This location keeps the action attached to the object it affects and avoids an extra toolbar row or an ambiguous detached button. A header-level action was rejected because the selected task can be missed on a narrow sidebar.

### Keep shared-workspace context compact

The extra `Активно для всех: <task>` line below the list is removed. The active marker in the list and `Активный шаг · N из M` header already communicate the shared state. Labels for ratings continue to identify that they apply to the active step.

## Risks / Trade-offs

- [A user may not realise a row selection is private.] → The selected-row background remains visually distinct and the publish action is only attached to a non-active selected row, making the next intentional action clear without permanent instructional copy.
- [Long task titles may compete with the publish action.] → Preserve truncation and flex shrink; the action remains compact and renders only on the selected non-active row.
- [Shortening the badge can obscure its room-wide scope for screen-reader users.] → Keep the full room-wide context in the accessible label.
