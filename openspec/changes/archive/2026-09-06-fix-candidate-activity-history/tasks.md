## 1. Specification and readiness

- [x] 1.1 **Owner: team-lead-agent.** Validate proposal/spec/design/tasks with
  `npx --yes @fission-ai/openspec@latest validate fix-candidate-activity-history --strict`;
  obtain Product Owner scope alignment, Architect API/security/pool-transaction
  confirmation, and Prompt/Task Auditor ready verdict. Record results in this
  change; no implementation starts without the matching product-red evidence.
  Documentation-only gate: no automated behavioral test applies.

## 2. Acceptance tests before production changes

- [x] 2.1 **Owner: developer-agent, frontend tests only; depends on 1.1.** Author
  and run an activity-history browser E2E covering 451 events, initial latest page,
  older-page exhaustion, grouping across page boundaries, JSON/CSV full exports,
  subset/empty state sync, reload/published-step continuity, a reconnect gap of
  201 events with concurrent live arrival, and missed-broadcast periodic catch-up.
  Replace obsolete exact-50 assertions in the existing activity E2E with these
  stronger expectations. Verify a product-caused failure before production edits;
  record command, failing assertion, and fixture cleanup in `verification.md`.
- [x] 2.2 **Owner: developer-agent, frontend tests only; depends on 1.1.** Author
  and run browser assertions for pending/empty/partial/error history, failed older
  page preserving live history and successful retry, room/role change during a
  delayed response, and candidate raw-history exclusion. Replace old terminal
  three-`5xx` assertions with three failures then successful same-ID recovery,
  queued new capture, generic feedback clearing, hung POST timeout, and continued
  Yjs/normal room events. Verify product-red evidence before production edits;
  retain the existing bounded `401`/`403`/`410` expectations.
- [x] 2.3 **Owner: developer-agent, backend tests only; depends on 1.1.** Author
  and run focused integration tests for authorized <=200-event latest/older/after
  pages, fixed upper-bound traversal, equal/backward timestamps, concurrent append,
  invalid/cross-room cursor inputs, owner/non-owner/promoted guest authorization,
  candidate/revoked denial and archive/missing-room results. Cover null-only
  migration backfill, preserved existing IDs/sequences, stale-JSON/volatile-state
  reconstruction, no-manager recording, and future `Long.MAX_VALUE` upper-bound
  clamping with complete subsequent traversal. Integration exception: cursor,
  database, and direct security invariants are not reliably visible in UI.
  Record missing-endpoint/persistence product-red evidence before implementation.
- [x] 2.4 **Owner: developer-agent, backend tests only; depends on 1.1.** Author
  and run a one-connection-pool integration regression: normal authorized
  candidate `key_press` and same-ID retry each finish within five seconds, persist
  one row, emit one manager broadcast, and leave snapshots/metrics functional.
  Include unauthorized activity denial and durable-before-broadcast assertions.
  Integration exception: this proves a resource/transaction boundary. Record the
  pre-fix stall/failure and dispose the test context before production edits.
- [x] 2.5 **Owner: developer-agent, frontend tests only; depends on 1.1.** Author
  and run focused deterministic merge/backoff tests plus real-browser transport regressions: ID deduplication and canonical
  order across arbitrary page/SSE permutations, confirmed durable cursor not
  advanced by a future SSE event, complete 1/2/4/8/16/30-second retry schedule,
  ten-second abort, one in-flight request/timer, retry fences across reconnect,
  stale completion/context cancellation, and capture during temporary SSE outage.
  Unit exception: pure backoff values and exhaustive ordering permutations are proportionate; the browser harness verifies timed scheduling, cancellation and reconnect behavior against the running app.
  Record product-red assertions before modifying their implementation.

## 3. Narrow red-to-green implementation

- [x] 3.1 **Owner: developer-agent, backend history API/repository/migration;
  depends on 2.3 red.** Implement the authorized sequence-cursor contract in
  `design.md`, additive V10 null-only backfill/index, and durable recent-tail
  reconstruction with JSON fallback only when raw history is absent. Preserve
  existing export/room authorization and V9 HR changes. Verify 2.3 green and raw
  export compatibility; record actual migration environment and results.
- [x] 3.2 **Owner: developer-agent, backend activity dispatch only; depends on
  2.4 red.** Avoid the enclosing permission transaction for validated activity
  dispatch while retaining committed acceptance, authorization, locking, and
  idempotency; ordinary room mutations keep their existing path. Verify the
  one-connection and existing durable activity tests green.
- [x] 3.3 **Owner: developer-agent, frontend history state/API/timeline;
  depends on 2.1, history portions of 2.2/2.5 red and 3.1.** Add scoped serialized
  latest/older/catch-up reads, immutable-ID merging, independent completed API
  cursor, five-second open-panel reconciliation, ten-second read abort, explicit
  visible states, and late-response/revocation fences. Remove the 50-event total
  render/history-state cap (the RoomPage/SSE feed remains bounded independently) while preserving bounded SSE, grouping, and exports. Use
  `Показать более ранние события` and `Повторить загрузку` actions. Verify matching
  browser and deterministic tests green.
- [x] 3.4 **Owner: developer-agent, frontend activity lane only; depends on retry
  portions of 2.2/2.5 red.** Replace the three-`5xx` queue-drop terminal state with
  ten-second abort and capped recoverable retry for network/timeout/429/5xx, keep
  FIFO IDs/capture during SSE outage, generic delayed feedback, and existing
  terminal authorization/archive rules. Verify retry, abort, reconnect-fence,
  and independent Yjs/normal-room event assertions green.

## 4. Verification and handoff

- [x] 4.1 **Owner: qa-agent; depends on 3.1–3.4.** Run the new targeted history
  E2E and integration/unit commands plus frontend `npm run e2e:activity-timeline`,
  `npm run e2e:public-step-preservation`, `npm run e2e:sse-reconnect`,
  `npm run e2e:realtime-auth-recovery`, `npm run test:activity-timeline`,
  `npm run typecheck`, `npm run build`, and the backend test suite. Record separate
  initial-red/final-green evidence, command outcomes, actual migration coverage,
  and any unrelated baseline failures in `verification.md`; do not claim omitted
  commands passed or rewrite unrelated HR work to hide failures.
- [x] 4.2 **Owner: team-lead-agent; depends on 4.1.** Obtain Solution Reviewer,
  Security/Reliability, QA, Test Reviewer, and final Product Owner verdicts on the
  changed history/retry/privacy boundaries; resolve blockers. Revalidate this
  change strictly, reconcile all checkboxes with evidence, and hand off completed
  artifacts with input/output/risks/next owner. Archive only this change when
  implementation acceptance is complete; do not archive the earlier active
  grouped-timeline change. Documentation/review gate: no new automated test applies.

## Agent handoff list

| Next owner | Input | Required output |
| --- | --- | --- |
| Product Owner Agent | User whole-interview review goal and this proposal/spec | Scope/value alignment, explicit acceptance of superseded render/retry bounds. |
| Architect Agent | Design, confirmed diagnostics, API/persistence/transaction constraints | Technical approval of cursor clamping, persistence, and transaction behavior. |
| Team Lead Agent | Validated change, architecture and product verdicts | Ordered ownership, red-test-to-production dependencies, execution evidence. |
| Prompt/Task Auditor Agent | These 12 tasks and prerequisite verdicts | Ready or exact missing acceptance/inputs before execution. |

No Linear issue is linked; this file and local review evidence track this change.
