## Context

See `proposal.md` for motivation and scope. Accepted `openspec/specs/candidate-activity-history/spec.md` defines complete durable history, pages bounded at 200, stable source identity, canonical ordering, serialized catch-up, and manager-only access. `hr-room-tracking` defines participant-menu assignment. The older active `group-activity-timeline-events` proposal contains recent-tail wording that is not a total retained-history limit; it is not reused or edited by this verification change.

The fixed React/TypeScript/RTK/Mantine and Kotlin/Spring persistence stack, server-authoritative SSE plus POST relay, and current Yjs collaboration remain unchanged. This document defines verification boundaries, not new application architecture. Specification ownership is confined to this change directory; the root execution owner controls test scripts, runtime, evidence, and screenshots while preserving prior uncommitted work.

## Goals / Non-Goals

**Goals:** establish reproducible real-browser evidence for ten concurrent contexts; expose loss, duplicates, privacy violations, stale views, or unusable controls; retain enough trace data to diagnose any failure.

**Non-Goals:** production fixes before a demonstrated failure and updated scope; transport or persistence redesign; new dependencies or schema changes; HR lifecycle retesting beyond the assignment used by this scenario; archival/deletion/restart durability already covered elsewhere; pixel-diff baselines; production capacity or latency certification; intentionally dropping unacknowledged activity by closing/reloading a candidate page.

## Verification constraints

1. **Fresh isolated fixture and real activity boundary.** Use existing supported account/room setup helpers. All ten browser contexts connect to the same fresh test room; establish the three-manager/seven-candidate role matrix before the counted workload. The HR context first enters through the candidate path and gains interviewer access through the existing participant menu. Setup API use is permitted, but counted activity must originate from real browser keyboard operations. Observe actual relay requests from every context starting before room interaction, since pre-assignment or incidental focus activity can also create source rows. Record all source UUIDs and acknowledgements, without dumping tokens or authentication headers. Synthetic bulk POSTs would omit the browser capture path and cannot satisfy this scenario.

2. **Two synchronized input rounds and recovery.** Use a start barrier for the seven candidate typing tasks, collecting per-context start/end times to demonstrate overlap. Produce at least 100 keyboard source events per candidate per round and at least 200 per candidate overall. Interrupt one manager SSE stream for a gap exceeding 200 accepted source actions and one candidate SSE stream while its page remains alive; restore both and verify later input. Candidate tab switching uses actual browser tabs, with real focus/visibility observations, rather than dispatching synthetic DOM lifecycle events. Allow acknowledgements to settle before final equality assertions. Explicit finite phase timeouts belong in the harness and evidence; they are test budgets, not new product response-time targets.

3. **Separate source identity, rendered projection, and exports.** Build the expected UUID set from observed valid source actions, not from an export subsequently compared to itself. Record retry attempts separately and require every unique action to settle successfully. Count keyboard events separately from all activity events. Use real history responses and manager-visible source totals/entries for the grouped timeline; do not require one DOM row per key. Download raw JSON and CSV through the UI while older history is still unloaded, parse quoted CSV correctly, compare exact UUID sets and acceptance sequences, then load all history via the UI. Include any observed incidental activity in set equality and wait for a stable boundary when the workload ends.

4. **Security and reliability remain existing contracts.** Observe candidate inbound room responses and SSE messages before and after reconnect, checking raw fields and source UUID leakage; malformed payloads cannot be silently ignored. Make direct denied history/JSON/CSV probes with a candidate's own current credential, never an owner credential. Reconnect injection must affect the real browser EventSource, not supply fabricated snapshots. Manager periodic catch-up may recover history while SSE is unavailable; the test still records the accepted gap and verifies post-reconnect completeness. Independent editing must continue and final editor contents converge across contexts.

5. **Visual evidence and measurements are bounded observations.** Record the exact desktop and narrow viewports. Assert timeline/control visibility, reachable controls, and page overflow; save screenshots and have the root inspect them for clipping or overlap. Measure named UI operations from interaction start to their visible completion condition and report values and sample counts. Collect browser page/console errors and request failures in each context, classifying deliberate stream aborts, candidate denials, and normal cleanup separately. No production SLA, saturation point, or pixel-diff claim is inferred from one local workload.

## Scope readiness and test-first policy

The requested value is concrete evidence of many-participant activity recording. There is no unresolved product choice, application architecture decision, or migration in this bounded test-only scope. `planning-review.yaml` records a consolidated scope/architecture-applicability/task-readiness assessment and downstream ownership; it must not claim separate agents have reviewed when they have not.

Author the E2E assertions before running the new coverage. This change adds coverage of existing behavior, so an initial pass is valid and a manufactured RED is prohibited. If a real product defect appears, retain the failing behavioral assertion, update the affected requirement/design and task scope, obtain the applicable production review gates, and only then implement the smallest fix. Environment or harness failures do not authorize application edits.

## Risks / Trade-offs

- Ten contexts can stress a developer machine → retain environment, workload, timings, and error evidence; report resource failures separately from proven application faults.
- Concurrent browser focus can produce additional activity → observe all context relay traffic and compare exact complete source sets after stabilization.
- Grouped activity has fewer visible rows than raw events → compare the source projection and real history UUIDs, not row count alone.
- New harness bugs can imitate product defects → preserve failing logs and distinguish selector/setup problems from a demonstrated contract violation before expanding scope.
- Existing uncommitted HR/activity changes belong to the ongoing user work → only test/evidence artifacts and an optional test script entry are modified by this change.

## Verification and migration

The root execution owner implements and runs the focused E2E, then runs `npm --prefix frontend run e2e:five-participants` and `npm --prefix frontend run e2e:yjs-multi` unchanged. Generated logs/screenshots/results go in a dedicated ignored `output/` subdirectory; a concise `verification.md` in this change links evidence, commands, exit statuses, exact counts, layout inspection, measurements, and remaining limitations. Final strict validation follows task updates. No deployment or migration is required; rollback removes only the newly added harness artifacts. There are no P0/P1/P2 open questions for verification; unavailable runtime or later discovered defects are recorded as execution findings.
