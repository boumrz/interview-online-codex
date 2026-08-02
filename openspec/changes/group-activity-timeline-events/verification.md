# Verification ledger

This is the canonical evidence ledger for
`group-activity-timeline-events`. Task 6.1 expands the matrix before command
execution. Each row records the working-tree/manifest fingerprint, command,
environment/base URLs, result, elapsed time, log or artifact location, owner,
and reviewer decision.

## 0.1 OpenSpec validation preflight

- Status: green.
- Command: `npx --yes @fission-ai/openspec@latest validate group-activity-timeline-events --strict`
- npm cache: `C:\Users\excul\AppData\Local\Temp\openspec-npm-cache-52571d20-e22a-4fb8-b019-8e641c311703`
- Result: `Change 'group-activity-timeline-events' is valid`.
- Owner: team-lead-agent
- Section-10 preflight revalidation (2026-08-02):
  `$env:npm_config_cache = "$env:TEMP\\codex-npm-cache"; npx --yes
  @fission-ai/openspec@latest validate group-activity-timeline-events --strict`
  returned `Change 'group-activity-timeline-events' is valid` in 2.7 s.
  The isolated npm cache resolved to
  `C:\Users\excul\AppData\Local\Temp\codex-npm-cache`.
- Post-7.2 revalidation (2026-08-01):
  `npx --yes --cache C:\Users\excul\AppData\Local\Temp\codex-openspec-cli-7-2-final @fission-ai/openspec@latest validate group-activity-timeline-events --strict`
  returned `Change 'group-activity-timeline-events' is valid` in 9.2 s.
- Post-7.3 revalidation (2026-08-01):
  `npx --yes --cache C:\Users\excul\AppData\Local\Temp\codex-openspec-cli-7-2-final @fission-ai/openspec@latest validate group-activity-timeline-events --strict`
  returned `Change 'group-activity-timeline-events' is valid` in 2.7 s.

## Approval policy

`green` and `product-red` rows require their command evidence. Every
`environment-blocked` or `not-applicable` row must state the exact missing
precondition, the safe next action, and written approval from both qa-agent and
test-reviewer-agent. It cannot satisfy a release gate without both approvals.
For an inherited completed task with no retained red/green transcript, record
`historical-evidence-gap` in Evidence availability, name the missing assertion,
and require a rerun or the same joint approval; never infer green from a checked
task box.

### Historical-evidence-gap: original 1.2–1.6 red baselines

- Classification: **historical-evidence-gap**, not `green`, `product-red`, or an
  environment result. The exact first-red stdout/stderr transcripts for the
  original raw-count/retry/candidate-isolation E2E (1.2), intentionally-red
  grouped presentation E2E (1.3), pure-projection unit baseline (1.4), durable
  backend integration baseline (1.5), and the combined pre-production run (1.6)
  were not retained in the current working tree or ledger.
- The missing evidence cannot be reconstructed honestly: the production behavior
  was subsequently corrected, and rerunning those original assertions now would
  only produce green evidence. Reverting working code to manufacture a red result
  is prohibited. No prior result is inferred from its checked task box.
- Current named replacement evidence is green and remains independently runnable:
  raw count/retry identity and FIFO behavior are exercised by Activity Timeline
  E2E sections 7.4–7.5; candidate isolation/reconnect by sections 7.3, 7.8, and
  7.10; five-second boundaries and readable summaries by the 7/7
  `test:activity-timeline` suite plus the rendered Activity Timeline E2E; durable
  source-ID acceptance by the full Maven suite and focused integration coverage.
  All of those commands passed again in the final 44-command sweep below.
- This exception is limited strictly to historical test-first proof for 1.2–1.6.
  It is not evidence that the behavior was always correct, does not waive current
  green behavior, does not affect the independent V8 PostgreSQL/Flyway exception,
  and grants no exemption to future test-first work.
- Safe next action/owner: retain the current runnable tests and their final
  transcript; any future behavior change must create and preserve its own red
  acceptance result before production edits. Owner: team-lead-agent.
- Joint disposition (2026-08-01): qa-agent **approved** and
  test-reviewer-agent **approved conditionally** the narrowly scoped exception.
  Both confirm it does not manufacture or prove the missing red transcripts, and
  its non-fabrication statement, current green mapping, and future test-first
  requirement must remain in this ledger.

## Coverage matrix

### 6.1 Frozen frontend manifest baseline (2026-08-01T11:09:56+03:00)

- Git HEAD / branch: `5b52da8a2b03efbea0ae8f4e98d084c15d729d50` / `main`.
- Working-tree status fingerprint: SHA-256
  `da09e9cc62293c867adaec513484410e5a00aa3934f1a07100b98f028979e580`
  from `git status --porcelain=v1 -uall` (37 entries). The shared worktree was
  already dirty; this fingerprint is evidence, not an assertion of sole ownership.
- Frozen manifest: `frontend/package.json`, SHA-256
  `BA2D2FFB9233C379126992A897BCD3294ACF85D5352A8127E5722D01282EED71`.
- Frozen matching-script count: **42** names matching `^(test:|e2e:|chaos:)`,
  before registration of `e2e:activity-timeline`. The count includes
  `test:activity-timeline`, which was already present in the shared manifest.
- Post-registration refresh (6.3): manifest SHA-256
  `4FB13A96EDEB0FA892E1F7C0A2E082BFAC8A82ECC3324E8EE7213FF8F7027BED`;
  **43** matching scripts. The only added matching entry at that time was
  `e2e:activity-timeline = node tests/e2e/interview/e2e-activity-timeline-grouping.mjs`.
- Final release refresh (7.10): manifest SHA-256
  `7BEC75E328F4299D8DD346EB9A164D2E48DDE6626097852E45669336E6AB0FB4`;
  **44** matching scripts. The only entry added after the 6.3 refresh is
  `e2e:auth-negative = node tests/e2e/auth/e2e-invite-token-negative.mjs`.
  `e2e:all` remains byte-for-byte the frozen aggregate command shown below and
  does not stand in for the added individual command.
- Browser commands use the existing stack at frontend `http://localhost:5173`
  and API `http://localhost:8080`, unless a command records a different explicit
  `E2E_BASE_URL`; this task does not start or stop services.
- Outcome taxonomy: `green`, `product-red`, `environment-blocked`, and
  `not-applicable`. `pending` means the command has not yet been executed and is
  not release evidence. `historical-evidence-gap` belongs only in the evidence
  column and requires a rerun or joint QA/test-reviewer exception.
- For a completed run, replace `pending` with an outcome and append the exact
  stdout/stderr transcript and any Playwright artifact link in this ledger. A
  blocked or not-applicable row must also name its missing precondition, safe next
  action, and written QA plus test-reviewer approvals.

| Frozen manifest script | Resolved manifest command | Required invocation | Environment / base URLs | Result | Evidence availability / link | Owner | QA approval | Test-reviewer approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `e2e:auth-negative` | `node tests/e2e/auth/e2e-invite-token-negative.mjs` | `npm run e2e:auth-negative` | existing frontend `http://127.0.0.1:5173`, API `http://127.0.0.1:8080/api` | green | Section 7.10 and 9.1; final individual run `AUTH_INVITE_TOKEN_NEGATIVE_OK` | qa-agent | pending final QA re-review | pending final test-review |
| `chaos:faults` | `node tests/e2e/chaos/e2e-chaos-fault-injection.mjs` | `npm run chaos:faults` | existing frontend/API | green | § 9.5 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `chaos:test` | `node tests/e2e/chaos/e2e-chaos-harness.mjs` | `npm run chaos:test` | existing frontend/API | green | § 9.5 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:account-binding` | `node tests/e2e/account/e2e-account-room-binding.mjs` | `npm run e2e:account-binding` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:account-switch` | `node tests/e2e/account/e2e-account-switch-fresh-data.mjs` | `npm run e2e:account-switch` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:all` | `npm run e2e:smoke && npm run e2e:dashboard && npm run e2e:dashboard-redesign && npm run e2e:auth && npm run e2e:legacy-domain && npm run e2e:metrika-hosts && npm run e2e:candidate-modal && npm run e2e:room && npm run e2e:roles && npm run e2e:account-binding && npm run e2e:account-switch && npm run e2e:markdown && npm run e2e:presence && npm run e2e:sse-reconnect && npm run e2e:refresh-sync && npm run e2e:yjs-abc-refresh-join && npm run e2e:room-language && npm run e2e:private-notes && npm run e2e:join-race && npm run e2e:cursor && npm run e2e:code-sync && npm run e2e:yjs-multi && npm run e2e:hidden-tab` | `npm run e2e:all` | existing frontend/API | green | § 9.3 aggregate run, exit 0 in 177.5 s; supplemental only | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:activity-timeline` (post-6.3 refresh) | `node tests/e2e/interview/e2e-activity-timeline-grouping.mjs` | `npm run e2e:activity-timeline` | existing frontend/API | green | § 7.8–7.9 and § 9.6; latest alias exit 0 in 25.6 s | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:auth` | `node tests/e2e/account/e2e-auth-navigation.mjs` | `npm run e2e:auth` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:briefing-focus` | `node tests/e2e/interview/e2e-briefing-focus-mode.mjs` | `npm run e2e:briefing-focus` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:candidate-modal` | `node tests/e2e/account/e2e-candidate-modal-smoke.mjs` | `npm run e2e:candidate-modal` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:code-sync` | `node tests/e2e/realtime/e2e-code-sync-regression.mjs` | `npm run e2e:code-sync` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:cursor` | `node tests/e2e/realtime/e2e-cursor-no-dot.mjs` | `npm run e2e:cursor` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:dashboard` | `node tests/e2e/dashboard/e2e-dashboard-smoke.mjs` | `npm run e2e:dashboard` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:dashboard-redesign` | `node tests/e2e/dashboard/e2e-dashboard-redesign.mjs` | `npm run e2e:dashboard-redesign` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:demo` | `node tests/e2e/interview/e2e-demo-interview-scenario.mjs` | `npm run e2e:demo` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:five-participants` | `node tests/e2e/realtime/e2e-five-participant-collaboration.mjs` | `npm run e2e:five-participants` | existing frontend/API | green | § 9.4 individual run, exit 0; 48 candidate + 6 manager actions delivered | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:hidden-tab` | `node tests/e2e/realtime/e2e-hidden-tab-sync.mjs` | `npm run e2e:hidden-tab` | existing frontend/API | green | § 9.4 individual run, exit 0; existing visibility warning only | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:join-race` | `node tests/e2e/interview/e2e-join-race-sync.mjs` | `npm run e2e:join-race` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:late-published-manager-workspace` | `node tests/e2e/realtime/e2e-late-published-manager-workspace-event.mjs` | `npm run e2e:late-published-manager-workspace` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:legacy-domain` | `node tests/e2e/platform/e2e-legacy-domain-notice.mjs` | `npm run e2e:legacy-domain` | existing frontend/API | green | § 9.3 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:local-runtime-chunks` | `node tests/e2e/platform/e2e-local-runtime-chunk-recovery.mjs` | `npm run e2e:local-runtime-chunks` | existing frontend/API | green | § 9.3 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:manager-workspace-integrity` | `node tests/e2e/realtime/e2e-manager-workspace-integrity.mjs` | `npm run e2e:manager-workspace-integrity` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:markdown` | `node tests/e2e/authoring/e2e-markdown-explainer-smoke.mjs` | `npm run e2e:markdown` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:metrika-hosts` | `node tests/e2e/platform/e2e-metrika-hosts.mjs` | `npm run e2e:metrika-hosts` | existing frontend/API | green | § 9.3 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:pdf-progress` | `node tests/e2e/authoring/e2e-pdf-export-progress.mjs` | `npm run e2e:pdf-progress` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:plaintext-lang` | `node tests/e2e/authoring/e2e-plaintext-language.mjs` | `npm run e2e:plaintext-lang` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:presence` | `node tests/e2e/account/e2e-participants-presence.mjs` | `npm run e2e:presence` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:private-notes` | `node tests/e2e/authoring/e2e-private-notes-slash-export.mjs` | `npm run e2e:private-notes` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:public-step-preservation` | `node tests/e2e/realtime/e2e-public-step-publication-preserves-edits.mjs` | `npm run e2e:public-step-preservation` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:realtime-auth-recovery` | `node tests/e2e/realtime/e2e-realtime-authorization-recovery.mjs` | `npm run e2e:realtime-auth-recovery` | existing frontend/API | green | § 9.4 individual run, exit 0; two rejected event requests recovered | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:refresh-sync` | `node tests/e2e/realtime/e2e-refresh-server-source-sync.mjs` | `npm run e2e:refresh-sync` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:roles` | `node tests/e2e/account/e2e-interviewer-role-notes-lock.mjs` | `npm run e2e:roles` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:room` | `node tests/e2e/interview/e2e-room-step-smoke.mjs` | `npm run e2e:room` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:room-language` | `node tests/e2e/interview/e2e-room-language-behavior-api.mjs` | `npm run e2e:room-language` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:slow-network` | `node tests/e2e/realtime/e2e-slow-network-sync.mjs` | `npm run e2e:slow-network` | existing frontend/API | green | § 9.4 individual run, exit 0; 3G propagation bound passed | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:smoke` | `node tests/e2e/interview/e2e-smoke.mjs` | `npm run e2e:smoke` | existing frontend/API | green | § 9.1 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:sse-reconnect` | `node tests/e2e/realtime/e2e-sse-reconnect-sync.mjs` | `npm run e2e:sse-reconnect` | existing frontend/API | green | § 9.4 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:step-publication` | `node tests/e2e/interview/e2e-interviewer-step-publication.mjs` | `npm run e2e:step-publication` | existing frontend/API | green | § 9.2 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:task-lang-default` | `node tests/e2e/authoring/e2e-task-create-language-default.mjs` | `npm run e2e:task-lang-default` | existing frontend/API | green | § 9.2 individual run; one nonreproducing batch timeout, then four green reruns | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:yjs-abc-refresh-join` | `node tests/e2e/realtime/e2e-yjs-abc-refresh-join-api.mjs` | `npm run e2e:yjs-abc-refresh-join` | existing frontend/API | green | § 9.5 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:yjs-multi` | `node tests/e2e/realtime/e2e-yjs-multi-participant-sync.mjs` | `npm run e2e:yjs-multi` | existing frontend/API | green | § 9.5 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `e2e:yjs-refresh-api` | `node tests/e2e/realtime/e2e-yjs-refresh-stale-snapshot-api.mjs` | `npm run e2e:yjs-refresh-api` | existing frontend/API | green | § 9.5 individual run, exit 0 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `test:activity-timeline` | `node --experimental-strip-types --test tests/unit/activityTimeline.test.ts` | `npm run test:activity-timeline` | frontend only | green | § 9.1 individual run, 7/7 passed | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| `test:analytics-contract` | `node tests/contract/analytics-contract.test.mjs` | `npm run test:analytics-contract` | frontend only | green | § 9.1 individual run, 2/2 passed | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |

| Required non-manifest work item | Command | Environment / base URLs | Result | Evidence availability / link | Owner | QA approval | Test-reviewer approval |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Standalone activity timeline E2E | `node tests/e2e/interview/e2e-activity-timeline-grouping.mjs` | existing frontend `http://127.0.0.1:5173`, API `http://localhost:8080` | green | final direct run: `ACTIVITY_TIMELINE_GROUPING_OK`, exit 0 in 27.6 s; see 9.6 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| Registered activity timeline alias | `npm run e2e:activity-timeline` | frontend `http://127.0.0.1:5173`, API port 8080 | green | final alias run: `ACTIVITY_TIMELINE_GROUPING_OK`, exit 0; see 7.8–7.9 and 9.6 | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| Frontend typecheck | `npm run typecheck` | frontend only | green | exit 0 in 7.4 s; `tsc --noEmit` | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| Frontend build | `npm run build` | frontend only | green | exit 0 in 8.1 s; known bundle-size warnings only | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |
| Full backend Maven suite | `mvn -q test` (from `backend/`) | backend test environment | green | exit 0 in 40.9 s; full suite passed on H2 profile | qa-agent | pending final QA re-review | coverage-sufficient (2026-08-01) |

| Work item | Command | Environment / base URLs | Result | Evidence availability / link | Owner | QA approval | Test-reviewer approval |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenSpec strict validation | `npx --yes @fission-ai/openspec@latest validate group-activity-timeline-events --strict` | isolated temporary cache | green | command result in 0.1 preflight above | team-lead-agent | n/a | n/a |

### 6.2 Known configuration-red baseline (2026-08-01)

- Command (from `frontend/`): `npm run e2e:activity-timeline`.
- Environment: no service interaction; the command failed before it could start
  Playwright (0.5 s).
- Result: **configuration-red**, explicitly **not** `product-red`.
- Exact failure: `npm error Missing script: "e2e:activity-timeline"`.
- npm's only suggestion was the unrelated existing
  `test:activity-timeline` script. Debug log:
  `C:\Users\excul\AppData\Local\npm-cache\_logs\2026-08-01T08_12_04_857Z-debug-0.log`.
- Safe next action: register exactly the standalone activity E2E alias in
  `frontend/package.json`, without changing `e2e:all`, then run the alias.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this expected
  configuration baseline is not a blocked/not-applicable release exception.

### 6.3 Registered standalone alias (2026-08-01)

- Manifest change: added the single script
  `e2e:activity-timeline = node tests/e2e/interview/e2e-activity-timeline-grouping.mjs`.
  `e2e:all` was not changed.
- Command (from `frontend/`): `npm run e2e:activity-timeline`.
- Environment: existing frontend `http://localhost:5173` and API
  `http://localhost:8080`; no services were started or stopped.
- Result: **green** (12.5 s). Exact test stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The manifest matrix is refreshed above to 43 matching scripts with the new
  alias as its only delta from the frozen 42-script baseline.
- Owner: developer-agent. QA/test-reviewer approval: n/a.

### 7.1 Physical Space browser wire/export baseline (2026-08-01)

- Coverage added only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`: a real
  `candidatePage.keyboard.press("Space")`, actual routed `key_press` relay-body
  capture, raw JSON export lookup by its assigned `sourceEventId`, and grouped
  summary assertions for typed whitespace versus the literal word `Space`.
- Command (from `frontend/`): `npm run e2e:activity-timeline`.
- Environment: existing frontend `http://localhost:5173` and API
  `http://localhost:8080`; the command reached the browser/product boundary and
  ran for 12.6 s, so this is not an environment blocker.
- Initial result: **product-red**. The actual intercepted relay body passed the
  browser-wire check for source ID
  `1916b17b-d4a0-4eb7-9512-4bfb5a0f1912` with `key === " "` and
  `keyCode === "Space"`. The manager-authorized raw JSON export for that same
  source ID instead returned:

  ```json
  {"id":"27ac4207-d28c-4ba1-8d52-51a8b1fe56fb","sessionId":"s-d3a74a74-3efa-4dcd-8605-8cd25dca80fb","displayName":"Activity candidate","keyValue":"Space","keyCode":"Space","ctrlKey":false,"altKey":false,"shiftKey":false,"metaKey":false,"eventKind":"keydown","pasteLength":null,"pastePreview":null,"timestampEpochMs":1785572193682,"sourceEventId":"1916b17b-d4a0-4eb7-9512-4bfb5a0f1912","acceptedSequence":4}
  ```

- Exact failure label: `PHYSICAL_SPACE_EXPORT_WIRE_MISMATCH`. The grouped-text
  assertion is present but was not reached after the export assertion failed;
  no grouped-result claim is fabricated.
- Classification: product normalization changed physical typed whitespace to the
  literal `Space` in the raw export. No production code was changed. The only
  in-scope next action is the separately gated 8.1 remediation after its task
  audit; do not advance to 7.2 from this baseline.
- Owner: developer-agent. QA/test-reviewer approval: not applicable to this
  observed product-red (it is not a blocked/not-applicable exception).

### 8.1 Focused physical-Space backend RED precondition (2026-08-01)

- Coverage added before any production edit in
  `backend/src/test/kotlin/com/interviewonline/controller/DurableCandidateActivityIntegrationTest.kt`.
  It posts a real `key_press` with `key: " "` and `keyCode: "Space"`, then
  asserts the durable entity and manager-authorized JSON export preserve that
  exact pair.
- Command (from `backend/`): `.\\mvnw.cmd -q -Dtest=DurableCandidateActivityIntegrationTest test`.
  The system `mvn` executable was unavailable, so the checked-in Maven wrapper
  was used; Spring Boot/H2 started its isolated test context and no external
  services were started or stopped.
- Initial result: **product-red**. Seven tests ran and one failed. The exact
  persistence assertion was
  `expected: < > but was: <Space>` at
  `DurableCandidateActivityIntegrationTest.kt:106`. The relay request body in
  the test output retained `"key": " "` and `"keyCode": "Space"`; the
  failure proves server-side conversion before the entity/export assertions can
  complete.
- This is the required focused red predecessor for 8.1. The approved next
  action is limited to preserving the exact ASCII-space/`Space` pair in
  `CandidateKeyHistoryHelpers.kt`, `CollaborationService.kt`, and
  `KeystrokePayloadMapping.kt`; no schema, DTO, generic normalization, or
  frontend-projection change is authorized.

### 8.1 / 8.1a post-fix browser verification (2026-08-01)

- 8.1a changed only the stale grouped-summary token in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs` from
  `Набрано: «abc»` to the required `Набрано: «abc »`. The independent relay,
  raw-export, typed-whitespace, and literal-`Space` assertions and their
  control flow were left unchanged.
- Exact command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and the newly
  restarted backend on port 8080. This task did not start or stop either service.
- Result: **green** (12.5 s). Exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- Classification: 7.1 is now green after the scoped 8.1 remediation; the
  post-fix E2E exercised and passed the independent physical-Space relay/raw
  export pair, grouped typed whitespace, and no-literal-`Space` assertions.
- Scope boundary: no work from 7.2 or later was started.

### 7.2 Live-history 50-event boundary and raw-export baseline (2026-08-01)

- Coverage added only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. The new
  browser sequence produces exactly 51 additional `keydown` source actions and
  records every routed browser `sourceEventId`; the assertion requires all 51
  IDs to be present and distinct and each resulting raw record to have a unique
  `acceptedSequence`.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and API at
  `http://localhost:8080`; no service was started, stopped, reset, or otherwise
  mutated by this task.
- Initial result: **green** (15.2 s). Exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The test waits for manager-authorized JSON export to contain every tracked
  source ID, derives the authoritative `(timestampEpochMs, acceptedSequence)`
  order from that complete export, and requires its oldest newly generated event
  to be absent from the computed live last-50 set while still remaining present
  in export.
- It then reloads the owner-manager page, captures the post-reconnect
  authoritative SSE `state_sync`, and requires its `candidateKeyHistory` to be
  exactly the 50 newest canonical IDs. The rendered manager timeline must also
  contain exactly that same set of 50 raw source IDs, with no duplicate, unknown,
  or evicted-oldest ID.
- Classification: a green coverage-only baseline. No 8.2 remediation is
  authorized or activated.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this is not a
  blocked/not-applicable exception.

### 7.3 Manager transport reconnect and candidate privacy baseline (2026-08-01)

- Coverage added only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. The manager
  wrapper remains a native `EventSource` subclass; the test switches only its
  browser context offline and back online, observes the transport error and later
  open, and never reloads the manager page for this assertion.
- While that manager transport is offline, the candidate sends a distinct source
  event. The test confirms it was accepted through manager-authorized raw export,
  derives the newest 50 source IDs in canonical
  `(timestampEpochMs, acceptedSequence)` order, and proves the disconnected
  manager's earlier 50-ID rendered set is stale.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and API at
  `http://localhost:8080`; no service was started, stopped, reset, or otherwise
  mutated by this task.
- Initial result: **green** (17.8 s). Exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The manager's post-reconnect authoritative `state_sync` contained exactly the
  expected newest 50 canonical source IDs once each; the rendered timeline had
  exactly the same source-ID set with no stale or duplicate ID.
- The candidate then reloaded. The test captured every actual post-reload
  `EventSource` payload, parsed each one, required a nonblank current state-sync
  `eventToken`, and found none of `lastCandidateKey`, `candidateKeyHistory`,
  `sourceEventId`, `acceptedSequence`, or `pastePreview` anywhere in those
  payloads. A direct raw-export request bearing that valid token in
  `X-Room-Event-Token` returned 403.
- Classification: a green coverage-only baseline. No 8.3 remediation is
  authorized or activated.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this is not a
  blocked/not-applicable exception.

### 7.4 Activity FIFO synthetic-5xx burst baseline (2026-08-01)

- Coverage added only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. The route
  holds the first `key_press` while the browser generates `fifo`, so an
  accidental fire-and-forget implementation is observable as concurrent routed
  activity requests before the synthetic response.
- The first activity POST is fulfilled locally with HTTP 503 after the burst is
  captured; that branch contains no `route.fetch` or `route.continue`. The test
  requires zero raw-export records for that head source ID before it releases the
  retry route to the existing API.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and API at
  `http://localhost:8080`; no service was started, stopped, reset, or otherwise
  mutated by this task.
- Initial result: **green** (18.3 s). Exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The synthetic 5xx caused a retry of the unchanged head source ID before later
  source IDs. The routed forwarding order and canonical raw-export order were
  both strict FIFO; observed activity-request concurrency never exceeded one;
  and each accepted burst source ID had exactly one eventual raw-export record.
- Classification: a green coverage-only baseline. No 8.4 remediation is
  authorized or activated.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this is not a
  blocked/not-applicable exception.

### 7.5 Activity 403 bounded-recovery baseline (2026-08-01)

- Coverage added only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. The routed
  browser case fulfills exactly two candidate `key_press` attempts locally with
  HTTP 403 for one nonblank source ID, without forwarding either rejected
  attempt.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and API at
  `http://localhost:8080`; no service was started, stopped, reset, or otherwise
  mutated by this task.
- Initial full-scope result: **green** (16.5 s). Exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The second routed 403 followed one recovery with the unchanged source ID. Once
  it was returned, the candidate reached the terminal room-access-denied state;
  a further candidate key produced no activity POST, and the owner raw JSON
  export contained no record for the rejected source ID.
- Classification: a green coverage-only baseline. No 8.5 remediation is
  authorized or activated.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this is not a
  blocked/not-applicable exception.

### 7.6 Source-ID legacy, validation, and concurrent-acceptance baseline (2026-08-01)

- Coverage added only in
  `backend/src/test/kotlin/com/interviewonline/controller/DurableCandidateActivityIntegrationTest.kt`.
  A direct manager `SseEmitter` join leaves Spring's test transport uninitialized,
  so the test reads only its buffered JSON SSE chunks to count actual manager
  `candidate_key` messages; no test-only production hook was added.
- The first invocation stopped during test compilation before any product
  assertion because the new test helper passed Spring's
  `ResponseBodyEmitter.DataWithMediaType` wrapper directly to
  `ObjectMapper.readTree`. The fixture was corrected to extract the buffered
  string data first. This was a test-setup error, not product-red or an
  environment blocker.
- Command (from `backend/`):
  `MAVEN_OPTS=-Duser.home=F:/FRONTEND/interview-online-codex .\mvnw.cmd -q -Dtest=DurableCandidateActivityIntegrationTest test`.
- Environment: the existing Maven H2 `create-drop` test profile; no externally
  managed service was started, stopped, reset, or otherwise mutated by this task.
- First product-assertion result: **green** (33 s, exit 0). Surefire recorded:
  `Tests run: 11, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 8.065 s -- in com.interviewonline.controller.DurableCandidateActivityIntegrationTest`.
- A missing `sourceEventId` persisted a nonblank canonical UUID with accepted
  sequence 1. A nonblank malformed ID returned HTTP 400 and created neither a raw
  row nor a manager `candidate_key` message. Two concurrent posts with the same
  valid ID both returned HTTP 204 while creating one row and one manager message,
  each carrying sequence 1. Two concurrent posts with distinct valid IDs both
  returned HTTP 204, created two rows with ordered unique sequences 1 and 2, and
  produced exactly two manager messages with those two IDs/sequences.
- Classification: a green coverage-only baseline. No 8.6 remediation is
  authorized or activated.
- Owner: developer-agent. QA/test-reviewer approval: n/a; this is not a
  blocked/not-applicable exception.

### 8.1 Final focused regressions after the physical-Space fix (2026-08-01)

- Command (from `backend/`):
  `.\mvnw.cmd -q -Dtest=DurableCandidateActivityIntegrationTest test` with
  `MAVEN_OPTS=-Duser.home=F:/FRONTEND/interview-online-codex`.
- Result: **green** (36 s). All 7 focused integration tests passed after the
  scope-limited fix, including the real relay-to-persistence-to-manager-export
  physical-Space assertion.
- Command (from `frontend/`): `npm run test:activity-timeline`.
- Result: **green**. All 7 pure-projection unit tests passed, including group
  boundaries, canonical reconciliation, readable summaries, and no paste-preview
  disclosure.
- Together with the green 7.1 browser rerun above, these are the final focused
  backend, projection, and user-visible evidence required by 8.1.
- Owner: root/developer-agent. The source-code scope was reviewed independently;
  a follow-up solution-review decision is required before a release claim.

### 7.7 Flyway V8 PostgreSQL migration baseline (2026-08-01)

- Result: **environment-blocked**, not `not-applicable` and not `product-red`.
  V8 is applicable, but no safe disposable PostgreSQL/Flyway V1-to-V8 test
  harness is available locally.
- QA evidence: the checked-in test profile is H2 `create-drop` with Flyway
  disabled; local and development Compose configurations use a fixed port 5432,
  fixed container identity, and a named persistent developer volume. No
  Testcontainers dependency, PostgreSQL migration-test profile, or controlled
  V1-to-V7 seed/V8 runner exists. The QA preflight ran only
  `docker compose -f docker-compose.dev.yml config`; it did not start, stop,
  query, reset, create, or delete a container or database.
- Explicitly excluded substitutes: H2 with Flyway disabled, the persistent
  `interview_online_pgdata` development volume, any developer/shared/production
  database, and a latest-schema startup that does not seed pre-V8 rows.
- Missing precondition: a separately provisioned disposable PostgreSQL/Flyway
  database plus credentials or an approved create/dispose harness capable of
  applying V1--V7, seeding legacy equal-timestamp rows, applying V8, and checking
  deterministic backfill plus both required indexes.
- Safe next action: add that isolated test harness in a separately scoped change,
  then run the V1-to-V8 migration baseline. **QA approval:** `qa-agent`
  environment-blocked verdict recorded. **Test-reviewer approval:**
  `test-reviewer-agent` approved this exact `environment-blocked` exception on
  `2026-08-01`, conditional on retaining this status (never green), the stated
  exclusions, and the safe next action. This makes the assessment complete but
  leaves PostgreSQL migration coverage incomplete.

### 7.3a Candidate post-reconnect incremental-stream privacy (2026-08-01)

- Security input: `SEC-ACTIVITY-PRIVACY-001` identified that the prior candidate
  reload/reconnect check did not force a new accepted candidate action while its
  real EventSource capture remained active, so it could not prove recipient
  filtering on the live incremental lane.
- Task-definition gate: a fresh `prompt-task-auditor-agent` verdict was
  **ready** after the task specified the exact E2E, real source acceptance,
  same-connection `openCount`, causal Yjs liveness marker, bounded parse window,
  distinct diagnostics, and 8.3a remediation route.
- Coverage changed only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`; no product
  source, package script, API, or authorization policy changed.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Environment: existing frontend at `http://127.0.0.1:5173` and API at
  `http://localhost:8080`; no new listener, service, database, or port was
  created or changed.
- Initial coverage-only result: **green** (17.3 s), exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- The candidate generated a fresh `ArrowLeft` source action through the actual
  browser relay. Its specific source ID appeared in the manager-authorized raw
  export before the liveness marker was initiated. The manager then appended a
  unique code marker. The candidate's editor received that marker and the same
  EventSource connection (unchanged `openCount`) received an allowed
  `yjs_update` after the marker boundary.
- Every captured payload from the candidate's saved refreshed `state_sync`
  through that causal marker parsed successfully. No payload was
  `candidate_key` and none contained `lastCandidateKey`,
  `candidateKeyHistory`, `sourceEventId`, `acceptedSequence`, or
  `pastePreview`.
- Classification: green coverage baseline; 8.3a is not activated. A future
  product-red requires fresh prompt-task, security/reliability, and test-review
  gates before any remediation.

### 7.3b Candidate SSE liveness diagnostic hardening (2026-08-01)

- Security review of 7.3a initially returned **revise**, not because it found a
  privacy leak, but because a timed-out causal marker wait would have surfaced
  only Playwright's generic timeout. The required connection and liveness
  diagnostics were therefore unreachable on that failure path.
- A fresh `prompt-task-auditor-agent` verdict was **ready** for the test-only
  correction. No production source, realtime API, server policy, dependency,
  or package script changed.
- Coverage changed only in
  `frontend/tests/e2e/interview/e2e-activity-timeline-grouping.mjs`. On timeout
  the E2E re-reads the actual candidate EventSource and editor and now emits a
  stable specific error for a changed `openCount`, malformed payload,
  missing rendered marker, or missing post-boundary `yjs_update`. The positive
  assertion remains a single wait with no retry-based fallback.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Result: **green** (17.2 s), exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- `security-reliability-agent` re-review: **approve**. It confirmed that the
  positive causal privacy assertion remains intact and that timeout failures
  now diagnose the required cause. `SEC-ACTIVITY-PRIVACY-001` and task 7.3a are
  formally closed; no product remediation is activated.

### 7.8 Non-owner manager authorization and revoked-guest privacy (2026-08-01)

- Task-definition gate: fresh `prompt-task-auditor-agent` verdict **ready**.
  The task is coverage-only; production source, API contracts, runtime ports, and
  authorization policy were deliberately out of scope.
- The shared E2E now creates a fresh registered owner, distinct persisted
  non-owner interviewer, and unauthenticated guest candidate. The owner uses its
  credential only to set prerequisite roles; no owner credential is supplied to a
  raw-export assertion.
- The registered interviewer receives real SSE `state_sync` with
  `role=interviewer`, `isOwner=false`, `canManageRoom=true`, and accepted
  candidate history; a later real candidate action reaches that same browser as
  incremental `candidate_key`. Its visible Timeline renders each tracked source
  ID once, and a direct JSON export with only its Bearer session succeeds.
- The guest is promoted through the real room event endpoint and exports tracked
  rows only with its own current realtime event token. After revocation, the test
  observes an SSE error, forces a reconnect, and selects only the state-sync
  delivered on the new connection cycle. That fresh candidate state contains a
  nonblank current token but no activity fields; any malformed post-reconnect SSE
  payload is now an explicit non-sensitive assertion failure, never an opaque
  pass. Token-only JSON export returns 403.
- Command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e:activity-timeline`.
- Final result: **green** (25.6 s), exact stdout:
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- `security-reliability-agent` final re-review: **approve**.
  `test-reviewer-agent` final verdict: **coverage-sufficient**. Classification:
  green coverage baseline; 8.8 is not activated.

### 7.9 Manager CSV UI export and revoked-token denial (2026-08-01)

- In the same isolated E2E fixture, the non-owner interviewer triggers the CSV
  download through the actual Timeline UI. The test waits for both the
  UI-initiated `format=csv` response and browser download; it does not call the
  positive CSV endpoint directly.
- The downloaded file is parsed as RFC 4180. Its raw data-row count, source-ID
  set, canonical order, and accepted sequences exactly match the Bearer-only JSON
  export. Each tracked source ID occurs once, physical Space preserves
  `key_value=" "` and `key_code="Space"`, and the paste action preserves its
  known length.
- The UI request contains no owner-token header. After guest revocation and
  fresh reconnect, the guest's current token-only CSV request returns 403. The
  test reads the actual denial body and rejects `text/csv`, the raw schema header,
  or any tracked source ID, preventing a false-green status-only check.
- Command/result: same final E2E command as 7.8, **green** in 25.6 s with
  `ACTIVITY_TIMELINE_GROUPING_OK`.
- `prompt-task-auditor-agent`: **ready**; `security-reliability-agent`:
  **approve**; `test-reviewer-agent`: **coverage-sufficient**. Classification:
  green coverage baseline; 8.9 is not activated.

### 7.10 Invalid-invite and stale-token release E2E (2026-08-01)

- Command: `E2E_BASE_URL=http://127.0.0.1:5173
  E2E_API_URL=http://127.0.0.1:8080/api npm run e2e:auth-negative`.
- Result: **green**, `AUTH_INVITE_TOKEN_NEGATIVE_OK` (initial final run 11.6 s;
  independent validator rerun 9.3 s; final 44-command sweep also green).
- A unique non-existent invite returned a real HTTP 404 and generated a real SSE
  error; no `state_sync`, usable event token, or editable workspace appeared, and
  observed SSE errors stayed bounded during the fixed window.
- A same-session offline/online reconnect issued a distinct replacement token. A
  protected `key_press` request carrying only the retained stale token returned
  403; manager SSE and owner raw export both proved that no rejected action was
  broadcast or persisted. Token values remained memory-only and were not printed.

### 10.2 Persisted-room and persistent-5xx product-red evidence (2026-08-02)

- Classification: **product-red**. These tests were authored and run before any
  production change for the Section-10 defect remediation.
- Browser command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_URL=http://127.0.0.1:8080/api
  npm run e2e:activity-timeline`. Result: exit `1`; syntax preflight
  `node --check tests/e2e/interview/e2e-activity-timeline-grouping.mjs` was
  green. The real UI published a second step, then its candidate activity relay
  returned `500`, reported as `POST_STEP_ACTIVITY_RELAY_INVALID`. The isolated
  synthetic persistent-`503` fixture observed a fourth POST for the same source
  ID at approximately 207 ms, 202 ms, and 196 ms intervals and reported
  `PERSISTENT_5XX_ACTIVITY_RETRY_STORM`. Its `finally` block closed both test
  contexts, so the intentionally failing route left no active retry traffic.
- Backend command (from `backend/`):
  `$env:MAVEN_OPTS='-Duser.home=F:/FRONTEND/interview-online-codex'; .\\mvnw.cmd
  -q -Dtest=DurableCandidateActivityIntegrationTest test`. Result: exit `1`,
  12 tests with one failure. The normal manager `set_step` relay returned `204`;
  the immediately following valid candidate UUID `key_press` returned `500`
  with `{"error":"Room activity state has no persisted room ID"}`. The new
  integration assertion at line 106 expected `204` and observed `500`.
- Scope activated: only task 10.4. The confirmed defects are the missing
  `RealtimeState.roomId` after a published-step transition and the unbounded
  activity-only retry of a persistent `5xx`; no authorization, 401, 403, Yjs,
  or generic room-event retry behavior is inferred from this red evidence.

### 10.2a Security-gate retry-fence product-red evidence (2026-08-02)

- Syntax preflight for the expanded browser fixture passed:
  `node --check tests/e2e/interview/e2e-activity-timeline-grouping.mjs`.
- Browser command (from `frontend/`):
  `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_URL=http://127.0.0.1:8080/api
  npm run e2e:activity-timeline`. Result: **product-red**, exit `1` (32.8 s).
  The real two-step path again produced
  `POST_STEP_ACTIVITY_RELAY_INVALID` because the candidate activity relay
  returned `500` after manager publication. In the isolated synthetic-`503`
  path, the new first-window real `state_sync` plus unrelated reconnect and
  second-window real `state_sync` still allowed the same FIFO head to post at
  about 213 ms and 204 ms: the test reported
  `PERSISTENT_5XX_RETRY_FENCE_FIRST_WINDOW_EARLY_POST`,
  `PERSISTENT_5XX_RETRY_FENCE_SECOND_WINDOW_EARLY_POST`, and
  `PERSISTENT_5XX_RETRY_DELAY_TOO_SHORT` instead of the required 850 ms / 1,850
  ms minimums. It also observed no generic terminal notice, continued activity
  traffic after terminal callbacks and physical Space, and the raw synthetic
  `503` sentinel in candidate-visible DOM mutations. The fixture closed both
  isolated contexts in `finally`.
- Backend command (from `backend/`):
  `$env:MAVEN_OPTS='-Duser.home=F:/FRONTEND/interview-online-codex'; .\\mvnw.cmd
  -q -Dtest=DurableCandidateActivityIntegrationTest test`. Result:
  **product-red**, exit `1`; 13 tests ran and 2 failed. The published-step
  candidate relay expected `204` and received `500`. The new factory guard
  reported `UNSAVED_ROOM_*_ACCEPTED_AND_STATE_MUTATED` for null, empty, and
  whitespace IDs through both `bootstrapRoom` and `syncFromRoom`, proving that
  invalid rooms currently enter or replace `roomState` before rejection.
- Scope activated: only the constrained 10.4 remediation. These results do not
  authorize changes to authentication, 401/403 handling, SSE authorization,
  Yjs, or the generic room-event queue.

### 10.3 Implementation gate (2026-08-02)

- `prompt-task-auditor-agent`: **ready**. It confirmed the red-first ordering,
  exact browser and backend boundaries, retry timestamps, terminal lifecycle
  checks, and limited production file scope.
- `security-reliability-agent`: **approve** for the constrained 10.4 repair.
  Required conditions: validate the Room ID at the start of both realtime-state
  construction paths; make it immutable/non-default; keep retry metadata on the
  FIFO head; do not reconnect, clear tokens, recover authorization, or render a
  raw server `5xx` error from the activity lane; preserve the generic notice and
  terminal disable across `state_sync`/reconnect; and check activity disablement
  before `crypto.randomUUID()` creates a new source ID. It explicitly excludes
  401/403, permission, Yjs, editor, and main-queue changes.

### Final regression evidence for this coverage pass (2026-08-01)

- The final manifest fingerprint is
  `7BEC75E328F4299D8DD346EB9A164D2E48DDE6626097852E45669336E6AB0FB4` and
  contains **44** matching `test:`/`e2e:`/`chaos:` scripts. Each was invoked
  explicitly and sequentially against the existing frontend at port 5173 and API
  at port 8080. The first complete sweep exited 0 in **561.4 s**; the retained
  per-command measurement sweep below also exited 0 in **558.7 s**. Each printed
  a successful sentinel, including
  `AUTH_INVITE_TOKEN_NEGATIVE_OK`, `INTERVIEWER_STEP_PUBLICATION_OK`,
  `FIVE_PARTICIPANT_COLLABORATION_OK`, `YJS_MULTI_PARTICIPANT_SYNC_OK`,
  `SLOW_NETWORK_SYNC_OK`, and `ACTIVITY_TIMELINE_GROUPING_OK`.
- The supplemental aggregate command `npm run e2e:all` also exited 0 during that
  sweep. It remains explicitly supplemental and does not claim the individual
  `e2e:auth-negative` result.
- Five-participant collaboration delivered all 48 candidate and 6 manager
  workspace actions. Its final latency results were p95 18.6 ms for published
  candidate actions and p95 30.7 ms for manager-workspace actions. The slow
  network scenario completed with its watcher marker in 1,639 ms. The chaos
  harness measured 437 ms propagation and 290 ms reconnect.
- The hidden-tab check passed as `HIDDEN_TAB_SYNC_OK`; Chromium retained its known
  warning that `visibilityState` did not switch to `hidden` in this environment.
  That warning is not a failed assertion.
- The direct standalone Activity Timeline E2E exited 0 in 27.6 s. The registered
  alias passed in the final sweep. Frontend typecheck passed in 7.4 s; build
  passed in 8.1 s with only known bundle-size warnings; the complete backend
  Maven suite passed in 40.9 s.
- OpenSpec strict validation passed after the 7.10 addition. The only retained
  exception is the separately approved **environment-blocked** PostgreSQL/Flyway
  V1-to-V8 migration baseline in 7.7; it is not represented as a green migration
  test and requires a disposable PostgreSQL/Flyway environment for closure.

### Retained per-command final sweep transcript (2026-08-01)

The following is the retained token-safe command/result transcript from the
second sequential 44-script sweep. Every command exited 0. `ms` is wall-clock
duration measured by the runner; the `stdout` field retains each command's final
success sentinel. The only retained non-failing diagnostic was the existing
hidden-tab visibility warning described above; no command exited non-zero.

```text
RESULT|test:activity-timeline|exit=0|ms=501|stdout=# pass 7
RESULT|test:analytics-contract|exit=0|ms=831|stdout=# pass 2
RESULT|e2e:smoke|exit=0|ms=2635|stdout=E2E_OK http://127.0.0.1:5173/room/r-ccc4da94-e61a-4fa6-8b62-49af4a83d0cf
RESULT|e2e:dashboard|exit=0|ms=2720|stdout=DASHBOARD_UI_OK
RESULT|e2e:dashboard-redesign|exit=0|ms=3159|stdout=DASHBOARD_REDESIGN_OK
RESULT|e2e:auth|exit=0|ms=2893|stdout=AUTH_NAVIGATION_OK
RESULT|e2e:auth-negative|exit=0|ms=9668|stdout=AUTH_INVITE_TOKEN_NEGATIVE_OK
RESULT|e2e:candidate-modal|exit=0|ms=5720|stdout=CANDIDATE_MODAL_OK
RESULT|e2e:roles|exit=0|ms=5544|stdout=INTERVIEWER_ROLE_NOTES_CHAT_OK
RESULT|e2e:account-binding|exit=0|ms=13472|stdout=ACCOUNT_ROOM_BINDING_OK
RESULT|e2e:account-switch|exit=0|ms=5505|stdout=ACCOUNT_SWITCH_FRESH_DATA_OK
RESULT|e2e:presence|exit=0|ms=5585|stdout=PARTICIPANTS_PRESENCE_OK
RESULT|e2e:room|exit=0|ms=3247|stdout=ROOM_STEP_OK
RESULT|e2e:step-publication|exit=0|ms=9902|stdout=INTERVIEWER_STEP_PUBLICATION_OK
RESULT|e2e:room-language|exit=0|ms=688|stdout=ROOM_LANGUAGE_BEHAVIOR_OK
RESULT|e2e:join-race|exit=0|ms=10683|stdout=JOIN_RACE_SYNC_OK r-11183f75-ae09-4093-a86f-24b3ca22dc47
RESULT|e2e:demo|exit=0|ms=22576|stdout=DEMO_INTERVIEW_SCENARIO_OK
RESULT|e2e:briefing-focus|exit=0|ms=4338|stdout=BRIEFING_FOCUS_MODE_OK r-ef57f9da-d143-4e52-aa4d-cc98b47901ed
RESULT|e2e:markdown|exit=0|ms=4075|stdout=MARKDOWN_EXPLAINER_SMOKE_OK r-2230a721-72a6-4c8c-9b14-af84cdfc8d1f
RESULT|e2e:private-notes|exit=0|ms=34531|stdout=PRIVATE_NOTES_SLASH_EXPORT_OK
RESULT|e2e:plaintext-lang|exit=0|ms=9019|stdout=PLAINTEXT_LANGUAGE_OK r-6d02e792-c359-4068-a61d-6b48dc6b3207
RESULT|e2e:task-lang-default|exit=0|ms=3005|stdout=TASK_CREATE_LANGUAGE_DEFAULT_OK
RESULT|e2e:pdf-progress|exit=0|ms=17058|stdout=PDF_EXPORT_PROGRESS_OK PDF export room 1785586752850.pdf
RESULT|e2e:legacy-domain|exit=0|ms=2044|stdout=LEGACY_DOMAIN_NOTICE_OK
RESULT|e2e:metrika-hosts|exit=0|ms=4881|stdout=METRIKA_HOSTS_OK
RESULT|e2e:local-runtime-chunks|exit=0|ms=2918|stdout=LOCAL_RUNTIME_CHUNK_RECOVERY_OK
RESULT|e2e:all|exit=0|ms=183177|stdout=HIDDEN_TAB_SYNC_OK r-b88c60c8-c612-4f51-b39b-f6aed43e3afa
RESULT|e2e:code-sync|exit=0|ms=5024|stdout=CODE_SYNC_REGRESSION_OK r-1b7ce2ff-a207-489b-b51e-ec077793dc0e
RESULT|e2e:five-participants|exit=0|ms=13643|stdout=FIVE_PARTICIPANT_COLLABORATION_OK
RESULT|e2e:manager-workspace-integrity|exit=0|ms=15484|stdout=MANAGER_WORKSPACE_INTEGRITY_OK
RESULT|e2e:late-published-manager-workspace|exit=0|ms=592|stdout=LATE_PUBLISHED_MANAGER_WORKSPACE_EVENT_OK
RESULT|e2e:public-step-preservation|exit=0|ms=13438|stdout=PUBLIC_STEP_PUBLICATION_PRESERVATION_OK
RESULT|e2e:sse-reconnect|exit=0|ms=12598|stdout=SSE_RECONNECT_SYNC_OK r-4ce7878b-b988-4b8b-972f-16ef33f4c58a
RESULT|e2e:realtime-auth-recovery|exit=0|ms=4115|stdout=REALTIME_AUTHORIZATION_RECOVERY_OK r-d20f2134-cad6-4b17-acb8-b5b341a34be9 { rejectedEventRequests: 2 }
RESULT|e2e:hidden-tab|exit=0|ms=15344|stdout=HIDDEN_TAB_SYNC_OK r-9dc461ea-3d8e-4df3-96ca-6f2c81a70281
RESULT|e2e:refresh-sync|exit=0|ms=4258|stdout=REFRESH_SERVER_SOURCE_SYNC_OK r-03225101-ced3-49a5-b459-bb75a209722b
RESULT|e2e:cursor|exit=0|ms=4011|stdout=CURSOR_NO_DOT_OK r-87e841d8-3641-420b-bf38-2ab4141c47ce
RESULT|e2e:slow-network|exit=0|ms=22205|stdout=SLOW_NETWORK_SYNC_OK r-55954463-694f-4e28-835b-5d40483ea083
RESULT|e2e:yjs-multi|exit=0|ms=34928|stdout=YJS_MULTI_PARTICIPANT_SYNC_OK r-357ac428-1993-4131-802b-87f317fe0eba
RESULT|e2e:yjs-refresh-api|exit=0|ms=708|stdout=YJS_REFRESH_GUARD_OK r-23c9809a-98a0-41b6-90b7-232520f63c66
RESULT|e2e:yjs-abc-refresh-join|exit=0|ms=623|stdout=YJS_ABC_REFRESH_JOIN_OK r-988889d1-0c0d-40d1-9fb5-27b0ccf03b53
RESULT|chaos:test|exit=0|ms=10188|stdout=CHAOS_HARNESS_OK {"baseUrl":"http://127.0.0.1:5173","propagationMs":579,"reconnectMs":190,"permissionCheck":"PASSED"}
RESULT|chaos:faults|exit=0|ms=8239|stdout=CHAOS_FAULT_INJECTION_OK r-bd225c41-665e-4b31-a0b3-c23b89162be9
RESULT|e2e:activity-timeline|exit=0|ms=22654|stdout=ACTIVITY_TIMELINE_GROUPING_OK
```

### 9.9 Final review dispositions (2026-08-01) — release blocked

- `prompt-task-auditor-agent`: the current test/task scope, manifest refresh,
  7.10 assertions, and 9.1–9.8 evidence are ready. It required retained
  per-command evidence and final reviewer decisions; both are now recorded here.
- `qa-agent`: **ready**. It independently reran `e2e:auth-negative`, revalidated
  OpenSpec, checked the 44-script matrix, and manually confirmed a registered
  user's room history appears on the dashboard. It also approved the narrowly
  scoped historical 1.2–1.6 evidence exception.
- `test-reviewer-agent`: **coverage-sufficient**, conditionally approved the
  historical-evidence exception. It found no current behavioral coverage gap;
  its approval is limited to missing historical first-red transcripts and does
  not treat them as proven.
- `solution-reviewer-agent`: **revise / blocking**. The activity FIFO treats
  relay HTTP 401 exactly like the accepted 403 policy: it clears the event token,
  reconnects, and then makes another rejection terminal. This contradicts the
  active specification's explicit exclusion of activity-401 behavior. A 401 can
  therefore deny a valid candidate and discard queued activity. The repair must
  remove that unapproved coupling or define a new 401 policy through a separately
  validated OpenSpec change; it must not be smuggled into the 403 coverage.
- `security-reliability-agent`: **block / revise**. The following existing
  architecture risks are outside a test-only completion and prevent release
  approval: long-lived user/owner credentials have no expiry or revocation and
  are passed in the SSE query string; invites have no server-enforced expiry,
  revocation, rotation, or completed-room guest denial; public room creation,
  room lookup, and SSE connection paths have no identified server-side rate or
  connection limits. Current green E2E coverage does not mitigate credential-log
  leakage, invite replay, or resource exhaustion.
- Required next owners: a developer under a separately validated SDD change must
  remove or explicitly design the forbidden activity-401 lifecycle; an
  `architect-agent` must define credential lifetime, revocation/rotation, safe
  SSE authentication transport, invite lifecycle, and server/edge abuse
  boundaries in a separate OpenSpec change. Both changes need red/green
  integration and E2E coverage before any release approval.
- Result: task 9.9 and task 5.5 remain **open**; do not archive this change or
  represent it as release-ready. The prior V8 PostgreSQL/Flyway
  `environment-blocked` exception remains separate and explicitly non-green.
