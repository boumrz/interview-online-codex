## 1. Product-metric contract and analytics hardening

- [x] 1.1 Add a typed, versioned browser event registry with a strict safe payload allowlist and focused unit coverage.
- [x] 1.2 Redact invite-bearing paths, query strings, redirect targets, and free-text errors from page-view, visit, and event reporting; disable Webvisor for interview content.
- [x] 1.3 Emit only safe v1 client lifecycle signals after their confirmed UI transitions and add focused analytics tests.

## 2. Authoritative interview lifecycle metrics

- [x] 2.1 Add the `room_product_metrics` migration, entity, and repository with idempotent first-fact fields and privacy-safe schema constraints.
- [x] 2.2 Project room creation and preparation, effective participant joins, bounded meaningful candidate activity, and first/latest verdict facts from authoritative backend transitions.
- [x] 2.3 Implement aggregate product-metrics calculations for the defined funnel, decision-ready outcomes, interviewer activation/repeat use, and safe reliability metadata.
- [x] 2.4 Add an administrator-authorised, bounded aggregate-only product-metrics endpoint and Kotlin tests for authorisation, range validation, idempotency, and privacy.

## 3. Metrika conversion-goal migration

- [x] 3.1 Capture a private pre-change goal snapshot and verify counter write permission without exposing credentials.
- [x] 3.2 Create and read-back verify the approved versioned Metrika goals while preserving all legacy goals.
- [x] 3.3 Add the non-secret verified goal manifest used by the local dashboard and document forward-only rollback behaviour.

## 4. Separate product metrics dashboard

- [x] 4.1 Extend the local dashboard data loader with a fixed server-side goal catalogue resolver, bounded Reporting API goal queries, caching, normalisation, and safe unavailable states.
- [x] 4.2 Add source-labelled product event funnel and realtime-health panels, interpretation guide, and responsive styling ahead of the audience section.
- [x] 4.3 Extend Node dashboard tests for goal mapping, aggregate calculations, cache/concurrency, safe response boundaries, and UI source/unavailable states.
- [x] 4.4 Add a fixed server-resolved catalogue for curated active legacy action goals, with group metadata, bounded reporting, and unavailable-not-zero handling.
- [x] 4.5 Add grouped acquisition, interview-launch, room-activity, and realtime-diagnostic goal panels plus an accessible collapsed diagnostics catalogue to the local dashboard.
- [x] 4.6 Extend dashboard tests for legacy-goal mapping, safe public payloads, partial availability, and catalogue UI states.

## 5. Verification and completion

- [x] 5.1 Run backend tests, frontend typecheck/build and analytics tests, and Node dashboard tests; fix all in-scope failures.
- [ ] 5.2 Perform a nonsensitive live Metrika smoke check, verify new goal delivery after processing delay, and confirm no credentials or sensitive data appear in dashboard output.
- [ ] 5.3 Strictly validate the OpenSpec change, mark completed tasks, and archive it when all verification evidence is complete.
