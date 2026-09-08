## Why

Existing browser verification does not establish how candidate activity behaves with many simultaneously connected room participants. A reproducible ten-context browser scenario and recorded evidence are needed to answer whether activity remains complete, private, and usable during concurrent editing and reconnects.

## What Changes

- Add a test-only browser verification scenario with one owner, two non-owner interviewers (one assigned from a joined HR account), and seven candidates in independent browser contexts.
- Exercise two concurrent typing rounds with at least 200 real-browser key source events per candidate, candidate and manager SSE reconnects, tab changes, complete history paging, and raw JSON/CSV downloads.
- Verify source UUID set equality and uniqueness, manager-visible activity, candidate isolation, editor convergence, and desktop/narrow visual usability.
- Record screenshots, observable errors, failed requests, and measured interaction durations with the actual workload and environment; rerun the existing five-participant and Yjs multi-participant regressions unchanged.

## Capabilities

### New Capabilities

- `multi-participant-activity-verification`: Observable behavior and evidence contract for a new ten-context E2E verification harness. This is test tooling, not a new product feature or a change to activity semantics.

### Modified Capabilities

None. Accepted `candidate-activity-history`, `hr-room-tracking`, and realtime room requirements remain the product source of truth.

## Impact

Scope is limited to OpenSpec artifacts, a focused browser test and its test command if needed, and generated verification evidence. No application code, API, schema, dependency, permissions, SSE/POST transport, Yjs algorithm, retention policy, or product performance target changes are authorized by this change. Existing uncommitted HR/activity implementation must be preserved.

If the new test exposes a product defect, record its failing assertion and update the relevant specification/design and production task scope before any minimal remediation. A passing first coverage run is valid; do not manufacture a RED result for already implemented behavior.
