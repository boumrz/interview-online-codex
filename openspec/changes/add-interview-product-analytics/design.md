## Context

The platform is a two-sided realtime technical-interview tool. Its current Metrika implementation records browser goals, while the standalone loopback dashboard reads only traffic aggregates. Browser goals are useful for acquisition and diagnostics but cannot prove an ordered, room-level interview funnel: an interviewer and a candidate use different visits, client delivery can fail, and detailed room content is sensitive. The backend already owns room creation, task state, participant roles, verdicts, and realtime presence, but it has no analytics projection.

## Goals / Non-Goals

**Goals:**

- Make product outcomes room- and interviewer-based, privacy-safe, and reproducible from backend data.
- Give the existing separate HTML dashboard an immediately useful Metrika event-signal funnel while clearly separating it from authoritative product outcomes.
- Create a compact, versioned Metrika conversion catalogue without deleting the existing diagnostic goals.
- Stop sending invite-bearing URLs, free-text errors, and interview content through analytics.

**Non-Goals:**

- Do not expose a public product-metrics endpoint or a browser-side production credential.
- Do not export code, keystrokes, paste previews, notes, verdict comments, names, invite codes, session identifiers, or raw errors for analytics.
- Do not reinterpret historical client events as completed rooms or silently replace existing goal history.
- Do not score candidate ability or infer hiring quality from a verdict.

## Decisions

### 1. Use a one-row-per-room lifecycle projection as the product source of truth

Add `room_product_metrics`, keyed by the internal room ID. It records only safe timestamps and bounded counters: creation source, initial task count, first interviewer/candidate join, first meaningful candidate activity, first and latest verdict save, task/preparation flags, and deduplicated recovery counters. First timestamps are written once; later updates never overwrite the first fact.

This is selected over an unbounded event log because the dashboard needs stable lifecycle aggregates, the product has sensitive realtime input, and a one-row projection provides simple idempotency. The existing raw keystroke table remains operational data and is never used as a dashboard payload.

### 2. Derive lifecycle facts at server-authoritative transitions

Room creation and task preparation are recorded by `RoomService`; effective realtime participant roles are recorded from `CollaborationService`; bounded candidate editor activity is projected from accepted server-side realtime input without copying its content; verdict facts are written in the same transaction as the verdict. Repeated SSE connections, retries, and verdict edits update neither first-fact timestamp nor room count.

The canonical north-star metric is **decision-ready technical interviews**: unique rooms with candidate attendance, meaningful technical activity, and a first persisted verdict. It is calculated from the projection in the selected completed Moscow-day range.

### 3. Keep backend aggregates behind existing administrator authorisation

`GET /api/admin/product-metrics?start=YYYY-MM-DD&end=YYYY-MM-DD` returns only aggregate DTOs for a bounded, completed Moscow-day range. It uses the project’s existing administrative authorisation pattern and never returns room IDs, user IDs, names, content, or raw diagnostics. A localhost page must not make this endpoint public merely to display metrics.

The endpoint is intentionally separate from the loopback Metrika dashboard until a dedicated server-to-server dashboard credential is deployed. The dashboard labels unavailable backend data rather than deriving fake room metrics from browser goals.

### 4. Treat Metrika as a compact browser-signal and acquisition layer

Preserve all 55 existing goals and their historical conditions. Create versioned action goals for candidate joined, meaningful candidate activity, and verdict saved. Interview start and productive completion are server-only facts; existing realtime goals remain diagnostics. The local Node process resolves non-secret goal IDs server-side, queries fixed Reporting API metrics, and returns only normalised aggregates.

The dashboard labels these values “signal Metrika / browser event”: goal reaches or users must not be presented as unique rooms, people, or ordered cross-role conversion. Server-confirmed outcomes may later be mirrored via Measurement Protocol only after a separate protocol credential and ClientID retention contract are provisioned.

### 5. Make the browser analytics interface allowlisted and route-safe

Replace free-form client event payload emission with an event registry containing fixed targets and low-cardinality fields. Routes are converted to templates (`/room/:invite`), query strings and navigation targets are excluded, and error events use stable error codes. Webvisor is disabled on the interview application rather than attempting incomplete masking of editor, task, note, and form content. Mutable role state is sent only as event/visit context; no direct identifying data is sent as a user parameter.

### 6. Roll out goal changes forward-only

Before a Management API write, save a private counter-goal snapshot and verify write permission. Create new `v1` goals, read them back, and record only numeric IDs/names in the source-controlled dashboard manifest. Do not update, retarget, or delete an existing goal. If a new goal condition is wrong after live traffic, create a new version rather than rewriting history.

### 7. Show a curated legacy-goal catalogue rather than a raw Metrika report

The local dashboard resolves a fixed set of active, exact-action legacy goals alongside the versioned v1 goals. It shows acquisition and access (`mkt_landing_view`, `mkt_login_view`, successful login and registration), interview launch (guest/account room creation, room opened, second participant joined), and reliability signals. A collapsed diagnostics catalogue adds bounded supporting signals for task preparation, activity in the room, and realtime failures.

The browser receives only stable dashboard keys, Russian labels, group names, availability state, goal reaches, and data-quality metadata. It never receives numeric goal IDs, action target strings, a Management API response, or an arbitrary selectable Metrika metric. A missing or ambiguous legacy goal is shown as unavailable, never as zero. Goal reaches remain browser-event occurrences, not unique users, rooms, participants, or a cross-device funnel.

## Risks / Trade-offs

- [Browser goals are lost or duplicated] → Use backend projection for canonical outcomes and clearly label Metrika panels as signals.
- [A public aggregate endpoint leaks interview volume or outcomes] → Require administrator authorisation and return aggregate-only DTOs.
- [Historical rooms predate the projection] → Return unavailable/partial source metadata rather than zeroes; start authoritative trends at collection start.
- [Invite codes or content reach third-party analytics] → Redact routes, remove free-text payloads, disable Webvisor, and test the no-sensitive-data contract.
- [Counter goal mutation cannot be undone historically] → Preserve legacy goals, snapshot before writing, verify each new goal, and use versioned successors.
- [The dashboard has no deployed backend credential] → Deliver Metrika signal panels now; keep backend outcome panels explicitly unavailable until a secure bridge is configured.

## Migration Plan

1. Add and strictly validate the OpenSpec change, then introduce analytics hardening before new event emission.
2. Add the lifecycle projection migration, server hooks, aggregate service, administrator-only endpoint, and tests; deployed history starts at migration time.
3. Create and verify the new Metrika goals without deleting legacy goals; deploy the matching browser event registry.
4. Extend the loopback dashboard with goal-signal panels, source badges, glossary entries, and safe unavailable states.
5. Smoke-test a nonsensitive room flow, wait for Metrika processing, compare goal delivery with backend facts, and monitor legacy/v1 deltas for at least 28 days.

Rollback disables new event emission and rolls back the application release while retaining the new Metrika goals for audit. A wrong goal after it receives traffic is replaced by a new target version; it is not deleted or retargeted.

## Open Questions

- A dedicated deployed credential for the loopback dashboard to consume the authenticated backend aggregate endpoint is not available in this request. Until it is provisioned, the standalone page shows Metrika signals and marks authoritative room metrics as unavailable.
- Measurement Protocol requires a separate token and explicit ClientID retention policy; it is designed for a follow-up once that credential is authorised.
