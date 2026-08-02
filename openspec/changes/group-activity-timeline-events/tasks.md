## Execution map

`sourceEventId` and `acceptedSequence` are resolved architecture decisions in
`design.md`. No production task may begin until the red-test tasks that precede
it have recorded a product failure (not an unavailable environment).

**Global dependency:** Every task that authors or runs a test, changes
configuration, or changes production code in sections 1–4 and 6–9, plus 5.1,
explicitly depends on 0.1 in addition to the task-specific dependencies below.
An `environment-blocked` or `not-applicable` result is not final release evidence
until both `qa-agent` and `test-reviewer-agent` approve its entry in
`verification.md`.

## 0. OpenSpec validation preflight

**Owner:** team-lead-agent. **Output:** a green strict-validation entry in
`openspec/changes/group-activity-timeline-events/verification.md` that records
the exact command and an isolated temporary npm cache path.

- [x] 0.1 Run `openspec validate group-activity-timeline-events --strict` via
  `npx --yes @fission-ai/openspec@latest` with a newly created, isolated
  `npm_config_cache`. **Acceptance:** the command is green and its evidence is
  written to `verification.md` before any test, configuration, or production-code
  task starts. **Evidence (2026-08-01):** command returned
  `Change 'group-activity-timeline-events' is valid` with cache
  `C:\Users\excul\AppData\Local\Temp\openspec-npm-cache-52571d20-e22a-4fb8-b019-8e641c311703`.
  Re-run it after any OpenSpec artifact revision.

## 1. Test infrastructure and red baselines

**Owner:** developer-agent. **Depends on:** 0.1 plus validated proposal, design, and
delta spec. **Evidence:** recorded command and expected failing assertion.

- [x] 1.1 Add the zero-dependency frontend unit command
  `node --experimental-strip-types --test tests/unit/activityTimeline.test.ts`
  as `npm run test:activity-timeline`. The test file imports only pure `.ts`
  helpers (no JSX); its first red assertion must exit non-zero. **Acceptance:**
  no runtime dependency is added and the command is executable from `frontend/`.
- [x] 1.2 Write a red raw-capture Playwright E2E at
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`: one manager
  and one candidate create rapid printable input, a shortcut, a paste and a
  focus/tab signal. Assert manager raw JSON export contains every distinct source
  action and candidates cannot obtain raw activity. The input rate must be below
  the current 120 ms client throttle. Force one activity POST response loss then
  reconnect and assert its retry reuses one `sourceEventId`, leaving exactly one
  raw export/history record. **Depends on:** 1.1.
- [x] 1.3 Extend that E2E with a separate red grouped-presentation assertion:
  manager sees an immediately updated, readable five-second entry rather than a
  row per raw event. This assertion is intentionally expected to remain red until
  section 4; it is not a prerequisite for section 3. Reload/reconnect the
  manager after an accepted and a late source event, then assert reconciliation
  renders each source ID once in canonical order. **Depends on:** 1.2.
- [x] 1.4 Add a red frontend pure-projection test for exact five-second boundary,
  anchored (not sliding) windows, same-name/different-session separation,
  equal-time stable order, late insertion, duplicate source ID, printable text
  with spaces, shortcuts, paste length without preview, focus labels, and unknown
  input. This is the documented unit-test exception for deterministic logic.
  **Depends on:** 1.1.
- [x] 1.5 Add a red backend integration test for durable raw activity:
  source-ID retry idempotency, canonical sequence, persistence when no manager
  is connected, manager export, candidate `403`, and candidate state-sync
  omission after reconnect. This is the documented integration-test exception
  for durability and authorization.
- [x] 1.6 Run 1.2, 1.4, and 1.5 before production code. Record failures caused
  by lost rapid input, missing canonical identity/order, or leaked candidate
  activity fields; record the 1.3 presentation assertion as intentionally red.
  Repair test setup if it fails only because the local stack is unavailable.
- [x] 1.7 Have `test-reviewer-agent` verify that the red baseline covers raw
  count, retry identity, candidate isolation, boundary, and readable-summary
  assertions before production tasks begin. **Historical-evidence exception
  (2026-08-01):** the original first-red transcripts are unavailable and cannot
  be reconstructed after behavior was fixed. The formal ledger entry names every
  missing assertion, forbids manufactured red evidence, maps it to current green
  coverage, and was jointly approved by qa-agent and test-reviewer-agent.

## 2. Durable server-side raw activity contract

**Owner:** developer-agent. **Depends on:** 0.1 and 1.5 is red. **Acceptance:** every
accepted source action has exactly one durable record and candidates cannot
receive activity history.

- [x] 2.1 Add an additive V8 migration and model/DTO mapping for nullable
  rollout-compatible `source_event_id` and `accepted_sequence`, a unique
  `(room_id, source_event_id)` constraint/index, and a canonical
  `(room_id, timestamp_epoch_ms, accepted_sequence)` index.
- [x] 2.2 Extend realtime request/response and persisted event contracts with
  source ID and accepted sequence. Mint a source ID for legacy clients while
  preserving exactly-once retry semantics for clients that supply one.
- [x] 2.3 Replace the 20 ms server keydown drop with durable idempotent
  acceptance: persist before recent-history/SSE update, reuse the first accepted
  result for duplicate IDs, broadcast it only once, and append it to raw export
  even if no manager is connected.
- [x] 2.4 Construct state-sync and incremental activity payloads only for
  server-authorized managers. Keep a 50-event manager live history, omit all
  activity fields for candidates, and retain unbounded individual raw export.
- [x] 2.5 Run the backend integration test from 1.5 and affected existing backend
  tests; record the green command/result before frontend FIFO work begins.
- [x] 2.6 Add a red backend regression proving that raw acceptance commits before
  candidate-key publication and does not perform database persistence while the
  shared in-memory room-state monitor is held. Implement an independent
  acceptance transaction and two-phase (durable acceptance, then live-history)
  update; rerun the focused backend integration coverage.

## 3. Lossless client activity delivery and reconciliation

**Owner:** developer-agent. **Depends on:** 0.1, raw-capture assertions from 1.2 and
2.5 are green; the grouped presentation assertion in 1.3 remains red.
**Acceptance:** telemetry never delays Yjs and a retry preserves event identity.

- [x] 3.1 Replace the 120 ms client keydown drop with a dedicated activity FIFO
  that assigns UUID `sourceEventId` at capture, sends one source action per POST,
  keeps a single in-flight request, and is independent of the Yjs queue.
- [x] 3.2 Make every activity POST observe its response: retain/retry the FIFO
  head with its same ID after reconnectable failures, enter the existing one
  recovery then terminal 403 policy, and stop capture/queue processing after
  terminal denial. Activity 401 is excluded pending a separate specification and
  architecture decision. Do not create a direct-fetch retry storm.
- [x] 3.3 Reconcile state-sync and incremental manager activity by source ID,
  sort by `(timestampEpochMs, acceptedSequence)`, and recompute from retained
  history so reconnect, duplicate transport, and late events do not duplicate or
  reorder display data.
- [x] 3.4 Make only the raw-capture assertions from 1.2 green and run focused
  authorization/reconnect regressions. The grouped presentation assertion from
  1.3 must remain red until section 4; record both outcomes.

## 4. Grouped interviewer presentation

**Owner:** developer-agent. **Depends on:** 0.1, pure projection baseline 1.4 and raw
capture/reconciliation 3.4 are green; grouped presentation assertion 1.3 is red.
**Acceptance:** groups are immediate, anchored, readable, and presentation-only.

- [x] 4.1 Implement a pure projection over canonical retained raw events: same
  session, raw-event adjacency, inclusive first-event-plus-5,000-ms boundary,
  newest-group-first display. Recompute whole retained history rather than
  incrementally mutating stale groups.
- [x] 4.2 Implement safe Russian summaries: `Набрано: «…»`, ordered shortcut or
  special-key tokens, `Вставка: N симв.`, and state-based focus/tab labels.
  Keep paste preview/content out of the UI; collapse only adjacent identical
  non-text tokens; omit standalone modifier noise only from the summary.
- [x] 4.3 Update `ActivityTimeline` with stable test IDs, candidate identity and
  time/range context. It renders grouped non-editable entries only for managers;
  JSON/CSV remain individual raw exports and no grouped analytics/new endpoint is
  added. When groups contain different session identities with the same display
  name, append a short stable session qualifier only to those duplicate names.
- [x] 4.4 Make the pure-projection test from 1.4 and grouped presentation
  assertion from 1.3 pass. Capture a browser screenshot/artifact for the final
  visual check.

## 5. Regression, security, and handoff

**Owners:** solution-reviewer-agent, security-reliability-agent, qa-agent,
test-reviewer-agent, product-owner-agent. **Depends on:** sections 2–4 green.

- [x] 5.1 Run the grouped-activity E2E, `npm run e2e:sse-reconnect`,
  `npm run e2e:realtime-auth-recovery`, `npm run e2e:slow-network`, frontend
  typecheck/build, and targeted backend Maven tests. Record commands and results.
- [x] 5.2 `security-reliability-agent` review: verify manager-only state, raw-export
  authorization, source-ID idempotency, bounded terminal 403 behavior, and that
  rapid activity cannot block Yjs or cause a retry storm.
- [ ] 5.3 `solution-reviewer-agent`, `qa-agent`, and `test-reviewer-agent` review:
  verify raw counts, canonical ordering, group boundaries, wording/privacy,
  candidate isolation, bounded live history, and raw-export preservation.
  **Evidence (2026-08-01):** qa-agent final verdict is `ready`; test-reviewer
  verdict is `coverage-sufficient` with no current behavioral coverage gaps.
  The final solution-reviewer disposition is recorded in the 9.9 ledger below.
- [x] 5.4 `product-owner-agent` accepts the visible wording and confirms that the
  delivered timeline meets the interviewer user story without expanding scope.
- [ ] 5.5 Re-run `openspec validate group-activity-timeline-events --strict`,
  mark tasks with evidence, sync the accepted delta spec, and archive only after
  every acceptance gate is green.

## 6. Coverage ledger and known configuration red baseline

**Owners:** qa-agent for evidence; developer-agent for the package script.
**Inputs:** `frontend/package.json`, the standalone activity E2E, the active
delta spec/design, and the running test environment. **Output:** a versioned
coverage matrix/evidence ledger at
`openspec/changes/group-activity-timeline-events/verification.md` with command,
environment, result classification, logs/artifacts, and exact failure evidence.
A failed stack bootstrap is `environment-blocked`, never a product red; every
`environment-blocked` or `not-applicable` row requires written approval by both
qa-agent and test-reviewer-agent before it can close a release gate.

- [x] 6.1 Freeze the frontend manifest list matching `^(test:|e2e:|chaos:)`
  (42 scripts before this task's alias), explicitly include `e2e:all`, and extend
  the coverage matrix template at `verification.md`. Add standalone activity E2E,
  frontend typecheck and build, and full backend Maven as required non-manifest
  rows. **Acceptance:** the matrix records the working-tree/manifest fingerprint,
  scripts and commands to run, base URLs, status taxonomy (`green`, `product-red`,
  `environment-blocked`, `not-applicable`), log/artifact links, and owner. It
  must be refreshed if the manifest changes; qa-agent and test-reviewer-agent
  must jointly sign any blocked/not-applicable row. For inherited completed
  tasks, if a historical first-red or green transcript is unavailable, the ledger
  must record `historical-evidence-gap`, the missing command/assertion, and the
  required rerun or approved exception—never fabricate a red/green result. Such
  a gap cannot close a release gate without qa-agent and test-reviewer-agent
  review. **Depends on:** 0.1 and validated delta. **Evidence (2026-08-01):**
  `verification.md` now freezes all 42 matching scripts, including `e2e:all`,
  at package SHA-256
  `BA2D2FFB9233C379126992A897BCD3294ACF85D5352A8127E5722D01282EED71`,
  with the HEAD/working-tree fingerprint, required non-manifest rows, base URLs,
  outcome taxonomy, evidence locations, and approval columns.
- [x] 6.2 **KNOWN RED, test-first configuration check:** from `frontend/`, run
  `npm run e2e:activity-timeline` before modifying `package.json`; record the
  missing-script failure. This is a configuration red, not a product-behaviour
  red. **Inputs:** standalone
  `tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. **Output:**
  reproducible red transcript. **Depends on:** 0.1 and 6.1. **Evidence
  (2026-08-01):** exited 1 in 0.5 s with exact output
  `npm error Missing script: "e2e:activity-timeline"`; this is recorded in
  `verification.md` as the required configuration-red baseline, not a product
  failure.
- [x] 6.3 Register `e2e:activity-timeline` in `frontend/package.json` as the
  exact standalone activity E2E command; do not alter the E2E implementation or
  aggregate `e2e:all` scope in this task. Run the registered command and refresh
  the matrix to include it. **Acceptance:** `npm run e2e:activity-timeline`
  invokes only the standalone activity E2E and the prior 6.2 configuration red
  becomes green when the required stack is available. **Inputs:** 6.2 red
  transcript. **Outputs:** package alias and green/blocked evidence. **Depends on:**
  0.1 and 6.2. **Evidence (2026-08-01):** the sole alias is
  `node tests/e2e/interview/e2e-activity-timeline-grouping.mjs`; `e2e:all` is
  unchanged. `npm run e2e:activity-timeline` exited 0 with
  `ACTIVITY_TIMELINE_GROUPING_OK` in 12.5 s. `verification.md` refreshes the
  manifest matrix from 42 to 43 matching scripts.

## 7. Critical-gap test-first audit baselines

**Owner:** developer-agent. **Depends on:** 0.1. **Rule for 7.1–7.9:** change only the named test
coverage, run it before any matching production remediation, and classify its
first result. A green result is a coverage-only baseline. A product-caused red
is the prerequisite for the identically numbered section-8 remediation; an
environment failure is repaired or recorded in `verification.md` without
activating section 8, and needs qa-agent plus test-reviewer-agent approval to
remain blocked/not-applicable.

**Extension rule for 7.8-7.9:** these are coverage-only E2E additions to the
same shared source file. A green result is evidence only; only a recorded
product-caused red may activate its identically numbered section-8 remediation.

- [x] 7.1 Add and run a browser E2E assertion in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs` that presses
  a real Space key, captures the actual `key_press` relay body for one assigned
  `sourceEventId`, and locates that same ID in manager raw JSON export. Assert the
  relay body and the export's raw key field (`keyValue`, representing relay
  `key`) both preserve `" "`, and both preserve `keyCode: "Space"`; also assert
  readable grouped text contains typed whitespace rather than the word `Space`.
  **Test level:** E2E (browser wire and manager-visible behaviour).
  **Output:** initial green/red/blocked evidence. **Depends on:** 0.1 and 6.3.
  **Evidence (2026-08-01):** initial run is `product-red`, not environment
  blocked. Relay preserved `key: " "` and `keyCode: "Space"` for source ID
  `1916b17b-d4a0-4eb7-9512-4bfb5a0f1912`, but the matching manager raw JSON
  export returned `keyValue: "Space"`, producing exact failure
  `PHYSICAL_SPACE_EXPORT_WIRE_MISMATCH`. The grouped-whitespace assertion is
  present but was not reached after this export mismatch. Full exact export
  evidence and the narrow 8.1-only next action are in `verification.md`; no
  production remediation was made and 7.2 was not started. **Post-fix evidence
  (2026-08-01):** the exact E2E rerun with
  `E2E_BASE_URL=http://127.0.0.1:5173` exited 0 with
  `ACTIVITY_TIMELINE_GROUPING_OK` in 12.5 s. Its independent relay/raw-export,
  typed-whitespace, and literal-`Space` assertions all passed.
- [x] 7.2 Add and run an E2E case with at least 51 accepted, uniquely identified
  source events. Assert the reconnected manager's live state/timeline contains
  exactly the latest 50 canonical events while manager-authorized JSON export
  contains all accepted events, including the evicted oldest event. **Test
  level:** E2E (visible live/history boundary and export contract). **Output:**
  initial green/red/blocked evidence. **Depends on:** 0.1 and 7.1. **Evidence
  (2026-08-01):** the first coverage-only run of
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline` exited 0
  in 15.2 s with `ACTIVITY_TIMELINE_GROUPING_OK`. It captured exactly 51 new,
  distinct browser `sourceEventId` values, waited for every captured source ID
  in manager-authorized JSON export, and verified a unique accepted sequence per
  new record. After an owner-manager page reload/reconnect, the intercepted
  authoritative `state_sync` and rendered timeline each contained exactly the
  last 50 canonical source events; the complete raw export retained all tracked
  events, including the oldest newly generated event that was evicted from live
  history. This is a green coverage baseline, so 8.2 was not activated.
- [x] 7.3 Add and run a binary real-browser privacy E2E. Force an actual manager
  `EventSource` transport disconnect and reconnect (a page reload alone is not
  sufficient), then intercept its post-reconnect authoritative `state_sync` and
  assert it replaces prior local history: each expected source ID is present once,
  canonical, and no stale/duplicate source ID remains. After candidate
  reload/reconnect, intercept that candidate's actual `EventSource` messages,
  parse every post-reconnect payload, and require a nonblank current candidate
  `eventToken` in state sync. Assert that no intercepted payload contains any of
  `lastCandidateKey`, `candidateKeyHistory`, `sourceEventId`, `acceptedSequence`,
  or `pastePreview`. Use the captured valid candidate event token in
   `X-Room-Event-Token` for the candidate's direct raw-export request and assert
   server-side 403. **Test level:** E2E; pass/fail is binary, with the existing
   backend authorization test retained as complement. **Output:** initial
   green/red/blocked evidence. **Depends on:** 0.1 and 7.2. **Evidence
   (2026-08-01):** the first coverage-only run of
   `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline` exited 0
   in 17.8 s with `ACTIVITY_TIMELINE_GROUPING_OK`. It used an instrumented native
   manager `EventSource`, forced that manager context offline/online without a
   page reload, observed an SSE error followed by a new open, and accepted a
   source event while the manager transport was down. The post-reconnect manager
   `state_sync` and rendered timeline each contained exactly the canonical latest
   50 source IDs with no stale or duplicate ID. After candidate reload, the test
   parsed every captured actual candidate `EventSource` payload, found a nonblank
   state-sync event token, found none of the five forbidden activity fields, and
   used that token in `X-Room-Event-Token` for a direct raw-export request that
   returned 403. This is a green coverage baseline, so 8.3 was not activated.
- [x] 7.3a Close security finding `SEC-ACTIVITY-PRIVACY-001` with a causal,
  coverage-only candidate post-reconnect E2E. Modify only
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs` and run it
  from `frontend/` as `npm run e2e:activity-timeline`; production source,
  package scripts, APIs, and authorization behaviour are out of scope. After
  the candidate's refreshed `state_sync`, save its actual EventSource
  `openCount` and capture-message index. Generate one fresh candidate activity
  source ID through the real browser relay, then wait until manager-authorized
  raw export proves that exact ID was accepted. Only after that acceptance,
  append a unique manager-owned code marker through the owner editor; require
  the candidate editor to receive that marker and the same candidate EventSource
  connection (unchanged `openCount`) to parse an allowed `yjs_update` after the
  marker capture boundary. Inspect every parseable SSE message from the saved
  post-state-sync index through that causal marker: no message may be
  `candidate_key` or contain `lastCandidateKey`, `candidateKeyHistory`,
  `sourceEventId`, `acceptedSequence`, or `pastePreview`. Every message in this
  bounded window must parse. Missing source acceptance, a changed connection,
  or missing marker traffic must fail with a distinct diagnostic; do not label
  an absence assertion environment-blocked unless the existing `qa-agent` and
  `test-reviewer-agent` jointly approve that classification in
  `verification.md`. **Test level:** E2E (live recipient filtering and causal
  post-reconnect liveness). **Gate:** fresh `prompt-task-auditor-agent` ready
  verdict before editing the shared E2E; record the first green/product-red/
  blocked result. A product-red activates only 8.3a, and before any remediation
  requires fresh `prompt-task-auditor-agent`, `security-reliability-agent`, and
  `test-reviewer-agent` review. **Depends on:** 0.1 and 7.3. **Evidence
  (2026-08-01):** after the fresh `prompt-task-auditor-agent` `ready` verdict,
  the coverage-only E2E was extended without production changes. The first run
  from `frontend/`, `E2E_BASE_URL=http://127.0.0.1:5173 npm run
  e2e:activity-timeline`, exited 0 in 17.3 s with
  `ACTIVITY_TIMELINE_GROUPING_OK`. It accepted a fresh candidate `ArrowLeft`
  source ID through the real relay and manager raw export, then observed the
  same candidate EventSource connection receive the manager's causal Yjs code
  marker. Every message in the bounded post-state-sync-to-marker window parsed
  and contained neither `candidate_key` nor a forbidden activity field. This is
  a provisional green coverage baseline, so 8.3a was not activated. **Follow-up
  (2026-08-01):** `security-reliability-agent` found that timeout-path marker
  and connection diagnostics were not reachable, so 7.3a cannot close until
  test-only task 7.3b is green and reviewed. **Closure (2026-08-01):** 7.3b's
  targeted green rerun and security/reliability approval make the diagnostics
  reachable and close `SEC-ACTIVITY-PRIVACY-001`; 8.3a remains inactive.
- [x] 7.3b Correct only the 7.3a E2E diagnostic path identified by the
  `security-reliability-agent` `revise` verdict: in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`, catch a
  causal-marker wait timeout, inspect the real candidate transport and editor,
  and emit one stable diagnostic for (a) changed EventSource `openCount`, (b)
  marker not rendered, or (c) allowed `yjs_update` missing after the marker
  boundary. The normal positive assertion must remain unchanged: no retry may
  turn a missing liveness marker into a pass. **Scope:** test file and factual
  OpenSpec evidence only; do not change production source, APIs, dependencies,
  scripts, or authorization. **Test level:** E2E reliability-assertion
  correction. **Gate:** fresh `prompt-task-auditor-agent` ready verdict before
  editing; rerun `npm run e2e:activity-timeline` from `frontend/` and return the
  delta to `security-reliability-agent` before completing 7.3a. **Inputs:**
  `SEC-ACTIVITY-PRIVACY-001`, its security review `revise` finding, and 7.3a's
  provisional green evidence. **Depends on:** 0.1 and 7.3a. **Evidence
  (2026-08-01):** a fresh `prompt-task-auditor-agent` verdict was `ready`; only
  the shared E2E timeout diagnostic path changed. The targeted command from
  `frontend/`, `E2E_BASE_URL=http://127.0.0.1:5173 npm run
  e2e:activity-timeline`, exited 0 in 17.2 s with
  `ACTIVITY_TIMELINE_GROUPING_OK`. On a causal-marker timeout the test now
  re-inspects live candidate state and emits stable diagnostics for changed
  `openCount`, malformed payload, marker-not-rendered, or missing `yjs_update`;
  it never retries an absence into a pass. `security-reliability-agent` re-review
  approved the delta and formally closed `SEC-ACTIVITY-PRIVACY-001`.
- [x] 7.4 Add and run a routed browser E2E activity burst that makes the first
  activity POST return a synthetic 5xx without forwarding that first POST to the
  server (`route.fetch`/`continue` are forbidden for that attempt), records
  request concurrency and source IDs, then permits recovery. Assert strict FIFO
  source order, retry of the unchanged head ID, maximum one in-flight activity
  request, and one eventual raw record per accepted source event. **Test level:**
  E2E. **Output:** initial
  green/red/blocked evidence. **Depends on:** 0.1 and 7.3. **Evidence
  (2026-08-01):** the first coverage-only run of
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline` exited 0
  in 18.3 s with `ACTIVITY_TIMELINE_GROUPING_OK`. The routed browser burst held
  its first activity POST, fulfilled it locally with synthetic 503 without
  `route.fetch` or `route.continue`, and confirmed no raw record existed before
  recovery was permitted. It then observed the unchanged head source ID retry
  first, strict source order through every forwarded recovery request, one
  in-flight activity request maximum, and exactly one raw-export record for each
  accepted burst source ID. This is a green coverage baseline, so 8.4 was not
  activated.
- [x] 7.5 Add and run a routed browser E2E only for the accepted
  server-authoritative activity 403 policy. Assert one allowed recovery using the
  same source ID, terminal stop after the next 403, no post-terminal activity
  POST, and no rejected raw record. **Scope exclusion:** do not inject, assert,
  or implement activity 401 behaviour in this change; it requires a separate
  OpenSpec proposal and architecture decision. **Test level:** E2E. **Output:**
  initial green/red/blocked evidence. **Depends on:** 0.1 and 7.4. **Evidence
  (2026-08-01):** the first coverage-only run of
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline` exited 0
  in 16.5 s with `ACTIVITY_TIMELINE_GROUPING_OK`. The routed browser case
  fulfilled exactly two activity attempts locally with 403 for one unchanged,
  nonblank source ID; the first response allowed the sole recovery and the
  second visibly entered terminal room-access-denied state. A subsequent
  candidate key caused no activity POST, and the manager-authorized raw JSON
  export contained no record for the rejected source ID. This is a green coverage
  baseline, so 8.5 was not activated.
- [x] 7.6 Extend
  `backend/src/test/kotlin/com/interviewonline/controller/DurableCandidateActivityIntegrationTest.kt`
  and run the focused test: (a) absent legacy ID receives a minted UUID,
  (b) malformed nonblank ID receives a client error with zero rows/broadcasts,
  (c) concurrently submitted duplicate valid IDs result in one durable row,
  canonical sequence, and one manager `candidate_key` broadcast, and (d)
  concurrently submitted distinct valid IDs result in two durable rows with
  unique ordered `acceptedSequence` values and two broadcasts. **Test level:**
  backend integration exception—durability and broadcast cardinality are
  server-side effects. **Output:** initial green/red/blocked evidence.
  **Depends on:** 0.1 and 6.1; it may run in parallel with 7.1–7.5 only after those
   tasks no longer edit the shared E2E file.
   **Evidence (2026-08-01):** after a test-fixture-only compilation correction,
   `MAVEN_OPTS=-Duser.home=F:/FRONTEND/interview-online-codex .\mvnw.cmd -q
   -Dtest=DurableCandidateActivityIntegrationTest test` from `backend/` exited 0
   in 33 s. The 11 focused tests passed, including legacy UUID minting, malformed
   ID rejection with zero rows/broadcasts, and both concurrent broadcast-cardinality
   cases. This is a green coverage-only baseline, so 8.6 was not activated; the
   full transcript is in `verification.md`.
- [x] 7.7 Assess the Flyway V8 verification precondition without resetting any
  existing database. If an isolated repeatable PostgreSQL/Flyway environment is
  provided, add/run a V1-to-V8 migration baseline that checks deterministic
  backfill and required indexes on a disposable database; otherwise record why
  it is not available. **Test level:** conditional integration coverage. **Do
  not** use the H2 profile with Flyway disabled, a shared persistent volume, or
  production/developer data as a substitute. **Output:** green/product-red or
  `not-applicable`/`environment-blocked` evidence. A blocked/not-applicable
  outcome requires written qa-agent and test-reviewer-agent approval in
  `verification.md`. **Depends on:** 0.1 and 6.1. **Evidence (2026-08-01):**
  assessment-complete with an approved `environment-blocked` exception, not a
  green migration result. The required disposable PostgreSQL/Flyway harness is
  absent; H2 with Flyway disabled and all persistent Compose volumes were
  excluded. QA and test-reviewer written approvals, missing precondition, and
  safe next action are recorded in `verification.md`.
- [x] 7.8 Add and run a coverage-only non-owner authorization/revocation E2E
  solely in `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`,
  from `frontend/` with the exact command
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`. Use the
  existing authenticated-user fixture pattern to create a registered owner and a
  distinct registered, persisted interviewer, and join one separate guest browser
  as a candidate. The owner may use its own credentials only for prerequisite role
  grant, guest promotion, and guest revocation calls; it MUST NOT supply an owner
  token, owner credentials, or privileged raw-export request for any assertion.
  First, send a tracked source action through the guest candidate's actual browser
  `key_press` relay (request observation is allowed; routing, synthetic state
  sync, and synthetic relay success are not). In the registered non-owner
  interviewer browser, obtain a real post-acceptance `EventSource` state-sync and
  assert `role: "interviewer"`, `isOwner: false`, `canManageRoom: true`, and the
  first source ID in manager history. Send a later tracked candidate source action
  and require that same interviewer's actual SSE to receive an incremental
  `candidate_key` for it; require the visible Activity Timeline to render each
  tracked ID exactly once. From that interviewer browser context, make a direct
  `format=json` raw-export request with only that user's valid `Authorization:
  Bearer` session (explicitly no `X-Room-Owner-Token` or
  `X-Room-Event-Token`) and assert `200` plus one raw record for each tracked ID.
  Next, promote the connected guest through the real room/realtime path; capture
  the guest's actual refreshed manager state-sync and nonblank current `eventToken`.
  From the guest browser, make a direct JSON export with only that token in
  `X-Room-Event-Token` (explicitly no Bearer, interviewer, or owner credential)
  and assert `200` and the tracked raw records. Revoke that same guest, force an
  actual room reconnect, capture its new nonblank current candidate event token,
  and recursively assert that its refreshed state-sync and every successfully
  parsed post-reconnect SSE payload omit `lastCandidateKey`, `candidateKeyHistory`,
  `sourceEventId`, `acceptedSequence`, and `pastePreview`; the guest's direct
  token-only JSON raw export MUST return `403`. A malformed post-reconnect SSE
  payload MUST fail the assertion with a stable non-sensitive diagnostic; it
  MUST NOT be replaced with an opaque passable marker. Do not emit credentials or
  realtime-token values in test diagnostics/evidence. **Test level:** E2E (real
  persisted-manager Bearer authorization, guest event-token authorization,
  realtime promotion/revocation, state-sync, relay, timeline, and privacy).
  **Gate:** obtain a fresh `prompt-task-auditor-agent` ready verdict before editing
  the shared E2E; before classifying completion or authorizing remediation,
  `security-reliability-agent` and `test-reviewer-agent` must review both positive
  authorization paths and the revoked-guest candidate-denial assertions.
  **Output:** initial green/product-red/blocked evidence. A product-red activates
  only 8.8; an environment-blocked result requires qa-agent plus
  test-reviewer-agent approval in `verification.md`. **Depends on:** 0.1, 6.3,
  and 7.3b. **Evidence (2026-08-01):** a fresh
  `prompt-task-auditor-agent` verdict was `ready`. Only the shared E2E changed;
  no product source, API, runtime, or authorization rule changed. The final exact
  command from `frontend/`, `E2E_BASE_URL=http://127.0.0.1:5173 npm run
  e2e:activity-timeline`, exited 0 in 25.6 s with
  `ACTIVITY_TIMELINE_GROUPING_OK`. It created a registered non-owner interviewer
  and guest candidate in a fresh room, proved real manager state-sync/history,
  incremental activity delivery, visible Timeline IDs, and Bearer-only JSON
  export. It then promoted the guest over the real room event channel, proved the
  guest's token-only JSON export, and revoked the same guest. The test observed
  actual SSE error and new connection open, selected only that new connection's
  candidate state-sync/token, found no forbidden activity fields, rejected any
  malformed post-reconnect payload, and verified the new token-only JSON export
  returned 403. `security-reliability-agent` final re-review was `approve` and
  `test-reviewer-agent` final verdict was `coverage-sufficient`; 8.8 remains
  inactive.
- [x] 7.9 Extend only
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs` after 7.8 and
  run it from `frontend/` with the exact command
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`. In the same
  isolated fixture, generate tracked individual guest-candidate relay actions that
  include a physical Space (`key: " "`, `keyCode: "Space"`) and a paste with a
  known length, and obtain the registered non-owner interviewer's authorized JSON
  export as the raw expected set. With that interviewer's Activity Timeline open,
  click the real CSV UI control and capture both the UI-initiated
  `format=csv` response and its browser download; the positive CSV assertion MUST
  NOT call the endpoint directly. Assert successful CSV content/download and no
  owner credential, then parse the downloaded response as RFC 4180 CSV rather than
  splitting lines. Require headers `source_event_id` and `accepted_sequence`; the
  full CSV data-row count and source-ID set must exactly match the manager JSON
  export, with no duplicate source ID. Filter the tracked IDs and require their
  CSV rows to occur exactly once in the same canonical
  `(timestampEpochMs, acceptedSequence)` order as the JSON export, with the exact
  `accepted_sequence` for every ID; the Space row must preserve `key_value: " "`
  and `key_code: "Space"`, and the paste row its known `paste_length`. After 7.8
  revokes and reconnects the same guest as a candidate, use that guest's new
  nonblank current event token alone (no Bearer, interviewer, or owner credential)
  to request the CSV endpoint and assert server-side `403` with no successful raw
  CSV payload: inspect the actual response body and require it to contain neither
  the raw schema header nor any tracked source ID. **Test level:** E2E (real manager UI download/response, raw CSV
  serialization/order, and revoked candidate authorization). **Gate:** obtain a
  fresh `prompt-task-auditor-agent` ready verdict before editing the shared E2E;
  before classifying completion or authorizing remediation,
  `security-reliability-agent` and `test-reviewer-agent` must review the UI-only
  positive path, RFC 4180 parser, canonical row assertions, and candidate denial.
  **Output:** initial green/product-red/blocked evidence. A product-red activates
  only 8.9; an environment-blocked result requires qa-agent plus
  test-reviewer-agent approval in `verification.md`. **Depends on:** 0.1 and 7.8.
  **Evidence (2026-08-01):** covered by the same final exact E2E run, which
  exited 0 in 25.6 s with `ACTIVITY_TIMELINE_GROUPING_OK`. The registered
  non-owner interviewer clicked the real Timeline CSV control; the test captured
  its UI-initiated response and browser download, confirmed no owner credential,
  RFC-4180 parsed the downloaded file, and matched every row, source ID,
  canonical order, and accepted sequence to the Bearer-only JSON export. It also
  proved preservation of physical Space and paste length. The revoked guest's
  new token-only CSV export returned 403 and its actual body contained neither
  CSV raw schema nor any tracked source ID. Fresh `prompt-task-auditor-agent`
  validation was `ready`; `security-reliability-agent` re-review was `approve`;
   `test-reviewer-agent` re-review was `coverage-sufficient`; 8.9 remains
   inactive.
- [x] 7.10 Add and run a release-only browser E2E for existing baseline room
  denials. With the already running frontend on `http://127.0.0.1:5173` and API
  on `http://localhost:8080`, assert that a unique non-existent invite does not
  expose an editable room workspace or usable realtime state. In a separate
  fresh room, retain the first real event token for one session, make the same
  session reconnect until it receives a distinct replacement token, then send a
  protected room relay request with only the retained stale token. Assert the
  server returns `403` and no room action is accepted or broadcast. Do not
  change production code, token lifetime, credentials, authorization, service
  ports, or existing activity-401 policy; do not emit either token in output.
  **Test level:** E2E (actual room URL, SSE/session lifecycle, and protected
  relay). **Output:** green/product-red/environment-blocked evidence. A
  product-red opens a separate scoped remediation change; a blocked result needs
  qa-agent and test-reviewer-agent approval. **Depends on:** 0.1 and 7.9.
  **Evidence (2026-08-01):** after the new test-first task/spec definition, only
  `frontend/tests/e2e/auth/e2e-invite-token-negative.mjs` and its registered
  `e2e:auth-negative` script were added; production code was untouched. The
  exact command with the existing frontend/API exited 0 in 11.6 s with
  `AUTH_INVITE_TOKEN_NEGATIVE_OK`. It proves a unique absent invite returns
  404, emits a real SSE error, supplies neither `state_sync` nor a usable token,
  exposes no editor, and has bounded observed errors. It then proves a
  same-session reconnect replaces the token, a protected stale-token `key_press`
  returns 403, and neither manager broadcast nor raw export records the rejected
  action. Token values remained memory-only and absent from diagnostics.

## 8. Conditional red-to-green remediation tasks

**Gate:** none of these tasks is ready until its section-7 predecessor has a
recorded `product-red` result, 0.1 is green, its task definition is validated by
`prompt-task-auditor-agent`, and the task owns only the minimal affected module.
Green coverage baselines do not authorize these tasks.

- [x] 8.1 If 7.1 is product-red, correct only the activity wire/projection path
  needed to preserve physical Space as typed whitespace; rerun 7.1 before any
  broader regression. **Owner:** developer-agent. **Inputs:** 7.1 red evidence.
  **Output:** 7.1 green evidence. **Expanded test-first precondition:** before
  any production edit, add and run a focused assertion in
  `DurableCandidateActivityIntegrationTest.kt` that sends real relay values
  `key=" "`, `keyCode="Space"` and proves the persisted entity and
  manager-authorized JSON export keep the exact pair; record its initial red
  result. **Expanded audit required:** the earlier `2026-08-01`
  `prompt-task-auditor-agent` READY scope is superseded because code tracing
  proved that the primary conversion is in `CandidateKeyHistoryHelpers.kt`.
  After a fresh READY verdict, production scope is restricted to
  `CandidateKeyHistoryHelpers.kt`, `CollaborationService.kt`, and
  `KeystrokePayloadMapping.kt`; preserve only the exact raw ASCII-space pair,
  keep empty strings null, retain existing NBSP/legacy-label normalization, and
  do not alter generic normalization, schema, DTOs, or the frontend projection.
  Rerun the focused backend assertion, `npm run test:activity-timeline`, and
  the unchanged 7.1 E2E before marking this task complete. **Audit evidence:**
  `2026-08-01` `prompt-task-auditor-agent` verdict `ready` after scope
  correction; no production edit is authorized until the new focused backend
  assertion has produced a recorded product-red result. **Completion evidence
  (2026-08-01):** following the scoped backend fix and fresh 8.1a audit, the
  exact 7.1 E2E rerun is green with `ACTIVITY_TIMELINE_GROUPING_OK` in 12.5 s
  against frontend `http://127.0.0.1:5173` and the restarted API at port 8080.
  No broader regression was run in this task. **Final focused regressions
  (2026-08-01):** `.\\mvnw.cmd -q
  -Dtest=DurableCandidateActivityIntegrationTest test` passed all 7 focused
  integration tests after the fix; `npm run test:activity-timeline` passed all
  7 projection unit tests. Both results are recorded in `verification.md`.
- [x] 8.1a If the post-fix 7.1 E2E's dedicated raw-space assertions are green
  but its pre-existing grouped-summary token still expects `Набрано: «abc»`,
  correct only that stale test expectation to the exact required
  `Набрано: «abc »`. Keep the independent whitespace and literal-`Space`
  assertions; do not weaken or remove them. **Owner:** developer-agent.
  **Inputs:** post-fix transcript proving the raw export contains
  `keyValue=" "`, `keyCode="Space"` and fails only on the obsolete token.
  **Scope:** `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`
  and factual group evidence only. **Gate:** obtain a new
  `prompt-task-auditor-agent` ready verdict before editing the E2E, then rerun
  that exact E2E. **Audit evidence:** `2026-08-01`
  `prompt-task-auditor-agent` verdict `ready`; the only permitted E2E change
  is the one literal token. **Output:** an unambiguous green 7.1/8.1 transcript.
  **Completion evidence (2026-08-01):** changed only the stale grouped token
  from `Набрано: «abc»` to `Набрано: «abc »`; raw/export/typed-whitespace and
  literal-`Space` assertions and their control flow were retained unchanged.
  The exact E2E rerun exited 0 with `ACTIVITY_TIMELINE_GROUPING_OK` in 12.5 s.
- [ ] 8.2 If 7.2 is product-red, correct only live-history truncation/export
  separation or canonical selection; rerun 7.2. **Owner:** developer-agent.
  **Inputs:** 7.2 red evidence. **Output:** 7.2 green evidence.
- [ ] 8.3 If 7.3 is product-red, correct only manager/candidate reconnect or
  server-side activity visibility/authorization; rerun 7.3 and the affected
  backend authorization test. **Owner:** developer-agent. **Inputs:** 7.3 red
  evidence. **Output:** privacy regression green evidence.
- [ ] 8.3a If 7.3a is product-red, correct only the manager/candidate realtime
  recipient-filtering, reconnect, or server-side activity-visibility path that
  caused the causal post-reconnect leak; rerun 7.3a and the affected backend
  authorization test. **Owner:** developer-agent. **Inputs:** 7.3a red
  evidence and fresh `prompt-task-auditor-agent`,
  `security-reliability-agent`, and `test-reviewer-agent` review. **Output:**
  live privacy regression green evidence. Do not broaden raw-export, Yjs, or
  unrelated authorization behaviour.
- [ ] 8.4 If 7.4 is product-red, correct only the activity FIFO retry/concurrency
  behaviour without changing the Yjs queue; rerun 7.4. **Owner:** developer-agent.
  **Inputs:** 7.4 red evidence. **Output:** FIFO regression green evidence.
- [ ] 8.5 If 7.5 is product-red, correct only the accepted bounded 403 activity
  recovery; rerun 7.5. Activity 401 remains excluded pending a separate
  specification/architecture change. **Owner:** developer-agent. **Inputs:** 7.5 red evidence.
  **Output:** authorization recovery regression green evidence.
- [ ] 8.6 If 7.6 is product-red, correct only source-ID validation, legacy minting,
  idempotent acceptance, or broadcast cardinality; rerun 7.6. **Owner:**
  developer-agent. **Inputs:** 7.6 red evidence. **Output:** backend integration
  green evidence.
- [ ] 8.7 If the conditional V8 baseline in 7.7 is product-red, stop and obtain
  `architect-agent`/database-review guidance before altering an existing versioned
  migration. **Owner:** architect-agent. **Inputs:** reproducible disposable-DB
  failure. **Output:** approved migration-safe remediation plan; no in-place V8
  edit is assumed by this task.
- [ ] 8.8 If 7.8 is product-red, correct only the demonstrated persisted
  interviewer Bearer path, non-owner state-sync/history/incremental activity
  receipt/timeline, guest realtime promotion or revocation/reconnect transition,
  or the current guest event-token JSON export path. Do not add an owner-token
  fallback, persist a guest merely to make the assertion pass, alter the candidate
  role, weaken candidate JSON or CSV export denial, or broaden unrelated room/Yjs
  authorization. **Owner:** developer-agent. **Inputs:** 7.8 product-red
  evidence. **Gate:** 0.1 green plus fresh `prompt-task-auditor-agent`,
  `security-reliability-agent`, and `test-reviewer-agent` approval before
  production edits; if the evidence requires a changed role or protocol contract
  rather than a localized repair, stop for `architect-agent` guidance. **Output:**
  rerun the exact 7.8 command green and record the affected backend authorization
  regression; then run 7.9 once its coverage exists. This task is inactive for a
  green or environment-blocked 7.8.
- [ ] 8.9 If 7.9 is product-red, correct only the demonstrated Activity Timeline
  CSV UI-download/response, raw CSV serialization/header, individual-row/count or
  canonical-order preservation, Space/paste field preservation, or manager
  authorization defect. Preserve raw JSON behavior, the persisted non-owner and
  guest-manager paths, `sourceEventId`/`acceptedSequence` values, and revoked
  candidate CSV and JSON denial; do not silently make the assertion pass by
  supplying an owner credential. **Owner:** developer-agent. **Inputs:** 7.9
  product-red evidence. **Gate:** 0.1 green plus fresh
  `prompt-task-auditor-agent`, `security-reliability-agent`, and
  `test-reviewer-agent` approval before production edits; obtain `architect-agent`
  guidance if fixing the failure would change the raw-export authorization
  contract. **Output:** rerun the exact 7.9 command green and record the affected
  backend export/authorization regression. This task is inactive for a green or
  environment-blocked 7.9.

## 10. Persisted-room activity recovery defect

**Owner:** team-lead-agent. **Inputs:** the persisted-room / persistent-`5xx`
addendum in `design.md`; the `Room transitions preserve activity persistence and
persistent server failures are traffic-bounded` requirement and its scenarios in
`specs/grouped-activity-timeline/spec.md`; the existing routed transient-`5xx`
7.4 harness in `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`;
`DurableCandidateActivityIntegrationTest`; and the observed browser failure
`Room activity state has no persisted room ID`. No related Linear issue is
currently linked to this local defect.

- [x] 10.0 Rerun `npx --yes @fission-ai/openspec@latest validate
  group-activity-timeline-events --strict` after this section is amended and
  record its green result before authoring either red test. **Owner:**
  team-lead-agent. **Gate for:** 10.1.

- [x] 10.1 **Test first — browser and durable-server regressions.** Extend
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs` with (a) a
  real persisted-room published-step transition followed by one candidate source
  action and (b) a route that returns synthetic persistent `5xx` responses for
  one tracked activity source action without forwarding it. The first assertion
  must require one successful post-step relay, one matching manager raw-export
  record, at most one manager broadcast, and no repeated successful source ID;
  the second must require initial red evidence under the current implementation
  by observing more than three attempts or continued automatic traffic for the
  unchanged source ID. Add a focused backend integration regression in
  `backend/src/test/kotlin/com/interviewonline/controller/DurableCandidateActivityIntegrationTest.kt`
  that creates a persisted two-task room, sends the normal authorized manager
  `set_step` relay, then sends candidate `key_press`, asserting initial red
  `500` evidence before production changes and, after remediation, one durable
  row tied to the persisted room and one manager broadcast. **Test levels:** E2E
  plus backend-integration exception because the rendered browser cannot prove
  database Room-ID association. **Owner:** developer-agent.
  The persistent-`5xx` E2E MUST capture timestamps and assert exactly three
  attempts for one unchanged `sourceEventId`: record `t1`, `t2`, and `t3` and
  assert the +1 s/+2 s policy with no earlier than 850 ms and 1,850 ms delays,
  respectively (the documented 150 ms clock tolerance). It MUST keep one-in-flight
  POST maximum and start the
  fixed 2.5-second no-activity-POST observation window immediately after the
  third synthetic `5xx` response. It MUST observe the exact
  visible candidate text `Запись активности временно недоступна. Вы можете
  продолжать редактирование; обновите комнату, чтобы повторить.` and assert
  that the raw `Room activity state has no persisted room ID` message is absent.
  It MUST also prove unchanged connected/access state and EventSource open count,
   plus a post-terminal Yjs edit visible to another room participant and a normal
   main-queue room event that receives a successful response. The existing
   one-transient-`5xx` scenario remains an independent regression.
- [x] 10.1a **Test first — security-gate retry-fence E2E expansion.** Change
  only `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`.
  Extend the synthetic persistent-`5xx` route to return a unique raw error-body
  sentinel which is never forwarded to the server. During the first pending
  window, after the first `5xx` and before its +1 s due time, force both (1) a
  repeated real `state_sync` and (2) a real, non-activity EventSource reconnect;
  use existing transport instrumentation to prove each event occurred. During
  the second pending window, after the second `5xx` and before its +2 s due
  time, force a further real `state_sync`. Record the first, second, and third
  activity attempt timestamps as `t1`, `t2`, and `t3`, respectively, plus
  every request's `sourceEventId` and in-flight count. The assertion MUST prove
  that none of those callbacks produces an early POST or duplicate timer:
  `t2 - t1 >= 850 ms` and `t3 - t2 >= 1,850 ms` (the +1 s/+2 s policy with
  the documented 150 ms clock tolerance), with one unchanged source ID and one
  POST in flight. After the third synthetic response, first trigger and observe
  a real post-terminal `state_sync`, then trigger and observe a real unrelated
  EventSource reconnect, before dispatching physical Space. After each terminal
  lifecycle callback, the generic recording-unavailable notice MUST remain
  visibly present exactly once and the activity ledger MUST still contain only
  the same three POSTs/source ID. Only then dispatch a real physical Space key,
  keep the existing 2.5-second no-traffic window, and assert exactly three total
  activity POSTs (no fourth POST and no new source ID) across the full
  post-terminal sequence. The unique raw `5xx` sentinel, raw status detail,
  and `Room activity state has no persisted room ID` text are absent from
  candidate-visible errors. Keep the existing post-terminal Yjs/main-queue
  assertions. **Test level:** E2E; the retry
  scheduling and visible error boundary are browser-observable. **Owner:**
  developer-agent. **Inputs:** Section-10 design/spec addendum and existing 10.1
  harness. **Output:** committed red-first assertion without production changes.
  **Depends on:** 10.0.
- [x] 10.1b **Test first — unsaved-room factory guard.** Change only
  `backend/src/test/kotlin/com/interviewonline/controller/DurableCandidateActivityIntegrationTest.kt`.
  Add a focused backend integration assertion using a manually constructed
  unsaved Room with null and blank IDs through the public
  `bootstrapRoom`/`syncFromRoom` factory ingress. It MUST prove that each
  call rejects the missing persisted Room ID before it can add or replace a
  `roomState` entry; it must not use a later `key_press` failure as its
  oracle. Keep the existing persisted two-step relay test independent. **Test
  level exception:** backend integration is proportionate because the
  in-memory-state factory and no-registration invariant are not rendered in the
  browser. **Owner:** developer-agent. **Inputs:** Section-10 design/spec
  addendum and existing durable integration fixture/reflection helpers.
  **Output:** committed red-first guard assertion without production changes.
  **Depends on:** 10.0.
- [x] 10.2 Run the new E2E before production changes from `frontend/` with
  `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_URL=http://127.0.0.1:8080/api
  npm run e2e:activity-timeline`, then run from `backend/`
  `.\\mvnw.cmd -q -Dtest=DurableCandidateActivityIntegrationTest test`.
   Record the observed red evidence in `verification.md`. The browser test must
   close its fixture promptly after proving the pre-fix loop so it does not leave
   background activity traffic running. **Owner:** developer-agent. **Depends
   on:** 10.0 and 10.1.
- [x] 10.2a **Execute the security-gate red-first additions.** Before any
  further Section-10 production change, run
  `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_URL=http://127.0.0.1:8080/api npm
  run e2e:activity-timeline` from `frontend/` and the focused
  `DurableCandidateActivityIntegrationTest` Maven command from `backend/`.
  Record separate result/evidence for the retry-pending/due-at fence
  (`t2 - t1 >= 850 ms`, `t3 - t2 >= 1,850 ms`), the terminal
  state-sync-then-unrelated-reconnect sequence before physical Space, the
  no-fourth-POST/no-new-source-ID result, generic notice visibly present exactly
  once, generic-only error presentation, and unsaved-room factory guard. A
  product-red is the required predecessor for the matching repair; if an
  assertion is already green, record it as coverage-only green and do not
  manufacture a red result. **Owner:**
  developer-agent. **Inputs:** 10.1a and 10.1b. **Output:** token-safe red/green
  evidence in `verification.md`. **Depends on:** 10.1a and 10.1b.
- [x] 10.3 Obtain a fresh `prompt-task-auditor-agent` ready verdict for the
   red evidence and constrained implementation scope, then obtain
   `security-reliability-agent` approval that the activity-only terminal state
   preserves authorization isolation and does not disable room editing. **Depends
   on:** 10.2 and 10.2a. **Owner:** team-lead-agent. **Required reviewers:**
   prompt-task-auditor-agent and security-reliability-agent.
- [ ] 10.4 **Conditional red-to-green remediation.** If 10.2 is product-red,
  change only `backend/src/main/kotlin/com/interviewonline/service/CollaborationService.kt`
  and `frontend/src/features/room/useRoomSocket.ts` (plus the tests/evidence from
  10.1). Make persisted `roomId` a required `RealtimeState` invariant and pass
  the loaded room ID during published-step reconstruction. For the activity FIFO
  only, preserve transient retry identity/order but allow no more than three
  total HTTP `5xx` attempts for one head (initial, +1 second, +2 seconds); after
  the third failure, clear the volatile activity queue and disable activity
  capture for the current page-room session without clearing tokens, invoking
   authorization recovery, closing SSE, changing the main queue, or disabling
   editor/Yjs collaboration. Emit the specified generic recording-unavailable
   notice rather than a raw server error. The frontend repair MUST keep
   failed-`5xx` count, `retryPending`, and `retryDueAt` on the same FIFO
   head, enforce that gate from every activity-drain entry point, and preserve it
   across repeated `state_sync` and unrelated reconnect callbacks; it must
   schedule at most one timer for the head. Its activity-only terminal flag and
   the single generic notice state MUST survive a post-terminal `state_sync`
   and unrelated EventSource reconnect without re-enabling capture, scheduling a
   POST, creating a new source ID, hiding/repeating the notice, affecting
   authorization state, or changing the main queue. The backend repair MUST
   reject null/blank persisted Room IDs at
   realtime-state factory ingress before `roomState` mutation, including
   bootstrap/sync construction and direct published-step reconstruction. Do not
   alter 401, 403, generic main queue, task switching, raw export, or role
   behavior. **Owner:** developer-agent. **Depends on:** 10.3.
- [ ] 10.5 Run and record the red-to-green regressions: the new activity E2E,
  `npm run e2e:activity-timeline`, `npm run e2e:public-step-preservation`,
  `npm run typecheck`, and from `backend/`,
  `.\\mvnw.cmd -q -Dtest=DurableCandidateActivityIntegrationTest test`.
   Confirm that a post-step action persists exactly once, transient `5xx` remains
   retryable, retry-pending/due-at survives state-sync and unrelated reconnect,
   persistent `5xx` stops after three activity-only attempts including after a
   post-terminal physical Space key, raw `5xx` error text is never rendered,
   unsaved rooms cannot form realtime state, and normal code collaboration still
   works. **Depends on:** 10.4 and 10.2a.
- [ ] 10.6 Have `solution-reviewer-agent`, `security-reliability-agent`,
  `qa-agent`, and `test-reviewer-agent` review the implementation and evidence;
  update `verification.md` and rerun strict OpenSpec validation before marking
  the defect remediation complete. **Owner:** qa-agent. **Required reviewers:**
  solution-reviewer-agent, security-reliability-agent, and test-reviewer-agent.
  **Depends on:** 10.5.

## 9. Full regression execution and release evidence

**Owner:** qa-agent. **Inputs:** 0.1, 6.3, all applicable section-7 outcomes, and all
activated section-8 remediations green. **Output:** completed coverage matrix at
`openspec/changes/group-activity-timeline-events/verification.md`;
each command is run explicitly and `e2e:all` is never used to claim omitted
individual coverage. Record a product failure as a new scoped defect rather than
silently changing this change's scope.

- [x] 9.1 Run and record frontend account/dashboard/unit/contract commands:
  `test:activity-timeline`, `test:analytics-contract`, `e2e:smoke`,
  `e2e:dashboard`, `e2e:dashboard-redesign`, `e2e:auth`, `e2e:auth-negative`,
  `e2e:candidate-modal`, `e2e:roles`, `e2e:account-binding`,
  `e2e:account-switch`, and `e2e:presence`. **Depends on:** 6.3 and 7.10.
  **Evidence (2026-08-01):** each command was invoked individually during the
  final 44-script sweep; every invocation exited 0. Unit results were 7/7 for
  `test:activity-timeline` and 2/2 for `test:analytics-contract`; the new
  `e2e:auth-negative` printed `AUTH_INVITE_TOKEN_NEGATIVE_OK`.
- [x] 9.2 Run and record frontend interview/authoring commands: `e2e:room`,
  `e2e:step-publication`, `e2e:room-language`, `e2e:join-race`, `e2e:demo`,
  `e2e:briefing-focus`, `e2e:markdown`, `e2e:private-notes`,
  `e2e:plaintext-lang`, `e2e:task-lang-default`, and `e2e:pdf-progress`.
  **Depends on:** 9.1. **Evidence (2026-08-01):** every listed command was
  invoked individually and exited 0 in the final 44-script sweep; the final
  `e2e:task-lang-default` run was green after its earlier nonreproducing batch
  timeout had already been verified by four consecutive isolated reruns.
- [x] 9.3 Run and record frontend platform/aggregate commands:
  `e2e:legacy-domain`, `e2e:metrika-hosts`, `e2e:local-runtime-chunks`, and
  `e2e:all`. **Depends on:** 9.2. **Evidence (2026-08-01):** all four commands
  were explicitly invoked and exited 0. `e2e:all` is recorded as supplemental
  aggregate evidence only; it did not replace any individual command.
- [x] 9.4 Run and record frontend realtime commands: `e2e:code-sync`,
  `e2e:five-participants`, `e2e:manager-workspace-integrity`,
  `e2e:late-published-manager-workspace`, `e2e:public-step-preservation`,
  `e2e:sse-reconnect`, `e2e:realtime-auth-recovery`, `e2e:hidden-tab`,
  `e2e:refresh-sync`, `e2e:cursor`, and `e2e:slow-network`. **Depends on:**
  9.3. **Evidence (2026-08-01):** every listed command exited 0 individually.
  Five-participant collaboration delivered all 48 candidate and 6 manager
  actions; slow-network and reconnect scenarios passed their bounded assertions.
- [x] 9.5 Run and record remaining realtime/chaos commands: `e2e:yjs-multi`,
  `e2e:yjs-refresh-api`, `e2e:yjs-abc-refresh-join`, `chaos:test`, and
  `chaos:faults`. **Depends on:** 9.4. **Evidence (2026-08-01):** each command
  exited 0 individually; the chaos harness measured 437 ms propagation and
  290 ms reconnect in its final run.
- [x] 9.6 Run and record the standalone activity E2E directly and through its
  registered alias: `node tests/e2e/interview/e2e-activity-timeline-grouping.mjs`
  and `npm run e2e:activity-timeline`. **Depends on:** 7.1–7.9 and all activated
  8.1–8.6, 8.8, and 8.9 tasks green.
  **Evidence (2026-08-01):** the direct standalone activity command exited 0 in
  27.6 s with `ACTIVITY_TIMELINE_GROUPING_OK`; its registered alias also exited
  0 during the final individual manifest sweep.
- [x] 9.7 Run and record `npm run typecheck` and `npm run build` from `frontend/`.
  **Depends on:** 9.6. **Evidence (2026-08-01):** `npm run typecheck` exited 0
  in 7.4 s. `npm run build` exited 0 in 8.1 s; it emitted only the recorded
  asset-size warnings and completed distribution compression.
- [x] 9.8 Run and record the full backend Maven suite, `mvn -q test`, from
  `backend/`; do not substitute a focused test for this command. **Depends on:**
  7.6 and all activated 8.3/8.6 tasks green. **Evidence (2026-08-01):** the
  full `mvn -q test` suite exited 0 in 40.9 s. This used the normal H2 profile;
  it does not replace the separately approved PostgreSQL/Flyway V1-to-V8
  environment-blocked exception.
- [ ] 9.9 Finalize `verification.md`, attach all command evidence and conditional
  V8 status, then have `prompt-task-auditor-agent`, `solution-reviewer-agent`,
  `security-reliability-agent`, `qa-agent`, and `test-reviewer-agent` review the
  applicable results before 5.5/archival. **Acceptance:** every required row is
  green, or each `environment-blocked`/`not-applicable` exception has written
  joint qa-agent and test-reviewer-agent approval; no `product-red` remains
  unresolved. **Depends on:** 0.1 and 9.1–9.8.
