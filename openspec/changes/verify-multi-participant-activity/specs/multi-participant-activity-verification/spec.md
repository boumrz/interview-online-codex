## Purpose

Provide reproducible browser evidence that existing room activity remains complete, private, and usable with ten concurrent participants, without claiming a production load benchmark.

## ADDED Requirements

### Requirement: Verification uses ten independent room participants and real concurrent input

The verification harness SHALL establish ten independent browser contexts in one fresh room: one owner, two non-owner interviewers, and seven candidates. One interviewer SHALL be an authenticated HR-eligible account that first joins as a candidate and is then assigned through the actual participant menu. Each of the seven final candidates SHALL generate at least 200 distinct keyboard source events by real browser keyboard input across at least two rounds, with all seven candidate typing tasks started together in each round. Direct bulk activity API submissions, editor state injection, and mocked activity/history/export responses SHALL NOT count toward this workload. The evidence SHALL record actual source counts by participant, round start/end times, and overlapping input intervals.

Pre-implementation acceptance-test level: **E2E**. The browser keyboard-to-POST-to-SSE path and visible roles are the subject of the verification; no integration/unit substitution applies.

#### Scenario: A joined HR becomes the third manager in a ten-context room
- **WHEN** the owner assigns the eligible joined HR through its participant menu
- **THEN** the room has the specified one owner, two non-owner interviewers, and seven candidates
- **AND** each manager has visible activity access while candidates have no activity panel or raw download controls
- **AND** HR assignment does not grant owner status

#### Scenario: Seven candidates type during two overlapping rounds
- **WHEN** all seven candidates perform real keyboard input concurrently in each round
- **THEN** at least 1,400 distinct candidate keyboard source UUIDs are observed, including at least 200 from each candidate
- **AND** manager activity continues updating and all participants' shared editors eventually converge after delivery settles

### Requirement: Complete history and downloads reconcile every captured source identity

The harness SHALL observe source-event UUIDs from actual browser activity relay requests and acknowledgements, keeping retry attempts separate from unique actions. Once the workload settles, every captured valid source action for the isolated room SHALL be acknowledged and SHALL occur exactly once in complete authorized history and in each raw JSON/CSV export. Set equality SHALL cover all observed activity types, including incidental focus/visibility actions, with keyboard-only counts used for the minimum workload. The evidence SHALL compare UUID sets, per-participant counts, and unique acceptance sequences; equal totals alone SHALL NOT establish completeness. History responses SHALL contain at most 200 events. The manager SHALL traverse all older-history pages through the UI, and grouping SHALL preserve the underlying source count and identities available at the browser/history boundary without requiring a row per source action. Downloads SHALL be triggered through the manager UI before complete older-history traversal, proving their independence from loaded pages.

Pre-implementation acceptance-test level: **E2E**, including inspection of real browser network traffic and actual downloaded files. This observes the running contract and does not replace it with a fixture oracle.

#### Scenario: A partial timeline exports the complete multi-candidate workload
- **WHEN** the workload has settled and a manager downloads raw JSON and CSV before loading all older pages
- **THEN** the parsed JSON and CSV UUID sets each equal the complete observed acknowledged source UUID set
- **AND** neither export contains duplicate UUIDs or duplicate acceptance sequences
- **AND** matching UUIDs retain the same acceptance sequences and canonical timestamp/sequence order

#### Scenario: UI traversal recovers every older page
- **WHEN** a manager repeatedly uses the older-history action until exhausted
- **THEN** the observed history traversal contains the complete source UUID set exactly once after identity reconciliation
- **AND** each response contains at most 200 individual events, the rendered source total matches the reconciled history, and no older-history action remains enabled after exhaustion

### Requirement: Reconnect and tab changes preserve completeness and candidate isolation

The scenario SHALL interrupt and restore an actual candidate SSE connection and a manager SSE connection while the pages and room sessions remain valid. At least 201 further source actions SHALL be accepted after the manager's last confirmed history boundary while its SSE stream is unavailable. On recovery, complete history SHALL contain every earlier and gap event exactly once, and later real input SHALL still appear. Candidate tab changes SHALL exercise actual browser focus/visibility behavior and preserve subsequent capture. Candidate room responses, state-sync, and incremental SSE traffic SHALL contain neither raw activity nor grouped summaries; direct history and raw JSON/CSV requests made with a candidate's own current credentials SHALL be denied without leaking source records. The harness SHALL fail on unparseable observed room payloads rather than treat them as evidence of privacy.

Pre-implementation acceptance-test level: **E2E** with controlled transport interruptions, browser tab operations, real response inspection, and direct denial probes using browser-established credentials.

#### Scenario: Manager and candidate streams recover during the workload
- **WHEN** the candidate and manager transports reconnect, including the manager gap exceeding one page
- **THEN** the candidate's queued source actions eventually appear exactly once in durable history
- **AND** all pre-gap and gap source actions remain available after manager catch-up
- **AND** further candidate typing reaches the manager without a manual room reload

#### Scenario: A candidate changes browser tabs and returns
- **WHEN** a candidate activates another browser tab and returns to the room before typing again
- **THEN** supported focus/visibility actions and later typed actions are observed on the real relay and reconcile with complete exports
- **AND** the candidate remains unable to view activity controls or receive raw manager activity after reconnect

#### Scenario: A candidate attempts direct activity reads
- **WHEN** a candidate uses its own valid current session credentials to request history and raw JSON/CSV downloads
- **THEN** the server denies each request
- **AND** no observed denial response contains a tracked source UUID or raw export schema

### Requirement: Visual and runtime evidence states the actual verification bounds

The harness SHALL assert visible and usable manager timeline controls at a recorded desktop viewport and a recorded narrow viewport, including reachable older-history/download controls and no horizontal page overflow or overlapping critical controls. It SHALL save screenshots of manager activity at both widths and a candidate view without activity controls, and the evidence SHALL distinguish automated DOM assertions from human/agent screenshot inspection. Screenshots alone SHALL NOT be described as pixel-baseline visual regression tests. Runtime evidence SHALL include commands, exit status, environment/base URLs without credentials, browser version, viewport sizes, source counts, round timing, reconnect observations, page errors, console errors, failed requests, and measured durations for named UI interactions. Expected transport aborts and deliberate authorization denials SHALL be classified explicitly; unexplained errors SHALL prevent a clean-pass claim. The existing five-participant and Yjs multi-participant regression commands SHALL run unchanged and their separate results SHALL be retained.

Pre-implementation acceptance-test level: **E2E** for DOM/layout, real interactions, downloads, and error collection; screenshot inspection is supplemental evidence, not a replacement test level. Documentation records require no separate automated test.

#### Scenario: Manager inspects activity at desktop and narrow widths
- **WHEN** manager history and download controls are exercised at both recorded widths
- **THEN** controls remain visible/reachable and the layout assertions pass
- **AND** saved screenshots and inspection notes identify what was actually checked
- **AND** named interaction durations are reported as observations of this run, without inventing an SLA or extrapolating production capacity

#### Scenario: A run encounters a fault or an existing implementation passes immediately
- **WHEN** a runtime error, failed request, timeout, or assertion failure occurs
- **THEN** evidence records its phase and distinguishes deliberate injection, harness/environment failure, and demonstrated product defect
- **AND** a clean result is not claimed while an unexplained error remains
- **WHEN** the new coverage passes against existing production behavior on its first valid run
- **THEN** evidence records a coverage-only first-run pass without fabricating historical RED evidence
