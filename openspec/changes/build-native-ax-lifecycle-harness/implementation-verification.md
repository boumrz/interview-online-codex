# Implementation verification

## TASK-1.1 — bounded local authority accepted

Date: 2026-09-20

The product-owner and architect independently reviewed the proposal, capability
specification, design, task graph, and the blocked parent invitation change.
Neither review changed implementation files.

| Gate | Verdict | Result |
| --- | --- | --- |
| Product scope | accepted | This is an optional local/manual test facility only. It cannot yield behavioural or release GREEN, nor release the parent invitation production task. |
| Architecture | approve | The fail-closed design may proceed only to test-only RED contracts. No P0 or P1 architecture finding remains in TASK-1.1. |

Both gates confirmed the fixed boundary:

- The only accepted test ID is `teams/invitation-native-ax-lifecycle`.
- All four explicit native opt-ins, macOS/Xcode prerequisites, interactive TTY,
  display and AX trust are required before any target can launch.
- The exact same-TTY phrase is `I WITNESS ONLY THE TEMPORARY BROWSER AND SINK`;
  only the resulting boolean may appear in a closed receipt.
- The ordinary invitation suite, CI, the user's `:8080/:5173` runtime, user
  Chrome and the in-app browser remain out of scope.
- Browser lifecycle order, the unmocked detail GET and DOM/handle assertions
  remain the only behavioural authority.
- Private Playwright access, process discovery, endpoints, global/system-wide
  AX, synthetic input, AppleScript/System Events/CUA, coordinates, global
  shortcuts and forceful cleanup are prohibited.
- The threat model explicitly excludes a hostile same-UID or compromised host;
  this is not a shared-machine safety boundary.

Validation:

~~~sh
npx --yes @fission-ai/openspec@latest validate build-native-ax-lifecycle-harness --strict
~~~

Result: GREEN. No native process, focus action, profile, browser or user runtime
was created by this review.

## TASK-1.2 — BrowserLeaseBootstrap RED contract

Only test files, a test fixture and a Swift test-package declaration were added.
No bootstrap, helper, sink, launcher, browser or native AX source exists.

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-bootstrap-contract.test.mjs)
~~~

Result after TASK-1.8 revision: RED, 0 passed and 5 failed with the expected
`NATIVE_AX_BOOTSTRAP_CONTRACT_SOURCE_MISSING` and
`NATIVE_AX_BOOTSTRAP_SOURCE_MISSING` markers. The revised executable Node
contract now requires a future public persistent-context launch plan and a
single fresh lease-claim validator before the static source policy checks. It
freezes rejection of unsafe profile metadata, duplicate/stale/malformed lease
claims, endpoint-bearing claims, private Playwright authority and process
discovery. The failure is caused solely by intentionally absent bootstrap
contract/source; no browser or AX process was launched.

## TASK-1.3 — admission and manual-witness RED contract

Only a Node contract test and a non-sensitive fixture were added. No protocol,
launcher, helper, browser, profile or AX source exists.

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-admission-contract.test.mjs)
~~~

Result after TASK-1.8 revision: RED, 0 passed and 5 failed with the expected
`NATIVE_AX_PROTOCOL_SOURCE_MISSING` marker. The independently named checks
freeze fail-closed local admission, all four exact opt-ins, exact same-TTY
witness handling, non-TTY witness-substitute rejection and no-launch
side-effect sentinels for failed admission/witness. This is an
infrastructure-source RED: a rejected condition will later produce a closed TE
outcome, never a product RED or GREEN. The command created no browser, profile,
sink or native AX process.

## TASK-1.4 — capability and receipt-privacy RED contract

Only a Node contract test and a closed, non-sensitive receipt fixture were
added. No protocol, launcher, helper, browser, profile or AX source exists.

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-receipt-contract.test.mjs)
~~~

Result after TASK-1.8 revision: RED, 0 passed and 4 failed with the expected
`NATIVE_AX_PROTOCOL_SOURCE_MISSING` marker. The contract freezes 256-bit
memory-only capability creation, separated profile-marker and receipt-MAC
domains, profile-marker role substitution failure, closed phase-specific
receipt maps, enum/type/timestamp rejection, duplicate-key and invalid UTF-8
rejection, stderr overflow discard and no print/persist/attach sinks for
rejected bytes. It records no token, credential, path, PID, marker, capability
or endpoint, and launches no browser or native process.

## TASK-1.5 — lease validation and finite-AX-state RED contracts

Only Swift test sources under the declared test target were added. No
`Sources/**` implementation, AX query, browser, sink or profile exists.

~~~sh
swift test --package-path frontend/tests/e2e/native-ax
~~~

Result after TASK-1.8 revision: RED after successful test compilation: 0
passed and 14 failed across the Swift native package. The new behaviour
contracts fail with `NATIVE_AX_BOOTSTRAP_MODULE_MISSING`,
`NATIVE_AX_HELPER_MODULE_MISSING`, `NATIVE_AX_CLEANUP_MODULE_MISSING`, and the
existing source-missing policy markers. The named tests now require future
compiled modules for bootstrap, lease validation, finite state transitions and
cleanup decisions, with fake kernel/AX/filesystem adapters. The static policy
checks remain secondary. No AX API was called and no browser was launched.

## TASK-1.6 — descriptor-cleanup RED contract

Only the declared Swift cleanup test was added. No cleanup implementation or
run-root directory was created by the test.

~~~sh
swift test --package-path frontend/tests/e2e/native-ax
~~~

The revised Swift run above includes TASK-1.6. Cleanup now has behaviour
contracts for two matching snapshots, normal Playwright close before waits,
exact descriptor-anchored `unlinkat` cleanup only after verified exit, and
retain-entire-root with zero signal/kill/delete on every ambiguity. The current
RED is caused by absent cleanup module/source only. No filesystem deletion, AX
query or browser launch occurred.

## TASK-1.7 — browser-authoritative seam RED contract

The ordinary invitation suite remains native-free. A separately named test is
registered but skipped unless all four native-local opt-ins and the sole
allowlisted test ID are present. The test does not invoke a launcher, open an
application page, request a team, or execute an AX action.

~~~sh
(cd frontend && \
  E2E_TEAM_INVITATIONS_NATIVE_AX=1 \
  E2E_NATIVE_AX_LOCAL_ONLY=1 \
  E2E_NATIVE_AX_ALLOW_OS_FOCUS=1 \
  E2E_NATIVE_AX_TEST_ID=teams/invitation-native-ax-lifecycle \
  node --test --test-name-pattern='teams/invitation-native-ax-lifecycle' \
  tests/e2e/teams/e2e-team-invitation-management.mjs)
~~~

Result after TASK-1.8 revision: RED, 0 passed and 1 failed with
`NATIVE_AX_LAUNCHER_SOURCE_MISSING`. The focused test now imports a future
launcher contract instead of reading source text. It requires a valid native
receipt to remain `LOCAL_MANUAL_WITNESS_REQUIRED` and not a product result,
requires foreground lifecycle, exact unmocked detail GET, old-handle
detachment and current DOM action, and requires every missing browser barrier
or witness/native TE to remain TE. It also rejects synthetic lifecycle,
visibility mutation, browser focus, reload, route fulfilment, CDP lifecycle,
`foregroundForTeamRevalidation`, and `bringToFront` shortcuts in the invoked
native path. The shared headless test fixture opened and closed its own
temporary browser only; no API request, backend, user browser, user runtime,
native helper, profile, sink or AX action was touched.

## TASK-1.8 — first RED-contract gate returned revise

Date: 2026-09-20

The prompt-task-auditor, test-reviewer and security/reliability reviewers
audited the original TASK-1.2 through TASK-1.7 RED contracts. They found no P0
blocker, but returned `revise` because several tests could have been satisfied
by inert source strings or comments.

The revision above keeps implementation blocked and strengthens only
test/evidence files. It adds executable future-module contracts for bootstrap
planning and lease claims, admission side effects, witness substitution,
receipt privacy, Swift bootstrap/lease/state/cleanup decisions and the browser
authoritative native acceptance seam. Static forbidden-token scans now remain
secondary policy guards.

Implementation of `Sources/**`, `native-ax-protocol.mjs`,
`run-native-ax-lifecycle.mjs`, browser bootstrap, sink or helper source is
still blocked until a repeated TASK-1.8 gate returns `ready`.

## TASK-1.8 — second RED-contract gate returned revise

Date: 2026-09-20

The repeated prompt-task-auditor, test-reviewer and security/reliability gates
accepted the strengthened Node admission, receipt and browser-barrier contract
direction, but returned `revise` on four remaining scope/coverage issues:

- Swift negative matrices for bootstrap, lease/state and cleanup were still
  represented as future implementation-owned `allCases`/fixture lists.
- `Package.swift` did not yet have an explicit implementation-task owner for
  source target declarations/dependencies needed by future Swift module tests.
- `native-ax-bootstrap-protocol.mjs` was required by the revised RED contract
  but was not explicitly owned by a future implementation task.
- The browser seam needed a test-owned fake page/evidence collector proving
  observer/request/response/handle/DOM collection is armed before native focus,
  not only a pure supplied-evidence object evaluator.

The follow-up revision keeps implementation blocked and changes only tests and
task/evidence artifacts:

- Swift bootstrap, lease, state-machine and cleanup negative cases are now
  enumerated directly in the test files, with test-owned fake adapters.
- TASK-2.1 explicitly owns `Package.swift` bootstrap/sink target declarations
  and `native-ax-bootstrap-protocol.mjs`.
- TASK-2.2 explicitly owns `Package.swift` helper target
  declarations/dependencies.
- The native browser seam now requires a future `collectNativeBrowserEvidence`
  contract with a test-owned fake page that pre-arms lifecycle, request,
  response and element-handle observers before native focus and derives the
  barrier booleans from that collector. A missing lifecycle observer must
  produce `foregroundLifecycleObserved: false` rather than a synthesized pass.

No `Sources/**`, `native-ax-protocol.mjs`, `native-ax-bootstrap-protocol.mjs`,
`run-native-ax-lifecycle.mjs`, browser, sink or helper implementation exists
after this revision.

Revised RED evidence after the second gate remediation:

| Contract | Command result |
| --- | --- |
| Bootstrap | RED, 0 passed / 5 failed with `NATIVE_AX_BOOTSTRAP_CONTRACT_SOURCE_MISSING` and `NATIVE_AX_BOOTSTRAP_SOURCE_MISSING`. |
| Admission/witness | RED, 0 passed / 5 failed with `NATIVE_AX_PROTOCOL_SOURCE_MISSING`. |
| Capability/receipt | RED, 0 passed / 4 failed with `NATIVE_AX_PROTOCOL_SOURCE_MISSING`. |
| Swift bootstrap/lease/state/cleanup | RED after successful test compilation, 0 passed / 14 failed with only module/source-missing markers. |
| Browser seam | RED, 0 passed / 1 failed with `NATIVE_AX_LAUNCHER_SOURCE_MISSING`. |

After the Swift RED run, generated SwiftPM `.build` files/symlinks/directories
under `frontend/tests/e2e/native-ax/` were removed and are not evidence.

Architecture follow-up then found two remaining TASK-1.2/TASK-1.7 P1 issues,
both fixed test-only:

- The browser seam fake request/response now uses the exact existing team
  detail route `${api}/teams/team-1` rather than a non-existent `/detail`
  suffix.
- The bootstrap RED contract now requires a test-owned fake public
  `browserType`: exactly one `executablePath()` call and one
  `launchPersistentContext(profileDirectory, { executablePath:
  bootstrapWrapper })` call. The fake exposes `connectOverCDP` but fails if it
  is invoked, so the contract rejects the prohibited action rather than the
  mere presence of a real Playwright public method; private-field, endpoint and
  remote-debugging paths remain rejected.

Final TASK-1.8 gate result:

| Role | Verdict |
| --- | --- |
| Prompt/task auditor | ready |
| Test reviewer | ready |
| Security/reliability | ready |
| Architect | ready |

Implementation remained blocked until these four verdicts were collected. No
native implementation source existed before the final `ready` set. TASK-2.1 is
now permitted to start, scoped only to the files named in `tasks.md`.

## TASK-2.1 — BrowserLeaseBootstrap and focus sink GREEN

Date: 2026-09-20

Implemented only the scoped native test-infrastructure files:

- `Package.swift` source target declarations for `BrowserLeaseBootstrap` and
  `NativeAXFocusSink`.
- `Sources/BrowserLeaseBootstrap/**` with lease claim model, validator and
  injectable exec boundary.
- `Sources/NativeAXFocusSink/main.swift` as a standalone owned sink window.
- `native-ax-bootstrap-protocol.mjs` as the test-owned public Playwright
  launch-plan/lease-claim adapter.

Verification:

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-bootstrap-contract.test.mjs)
swift test --package-path frontend/tests/e2e/native-ax --filter BrowserLeaseBootstrapTests
npx --yes @fission-ai/openspec@latest validate build-native-ax-lifecycle-harness --strict
git diff --check
~~~

Result: GREEN. Node bootstrap contract passed 5/5; Swift
`BrowserLeaseBootstrapTests` passed 2/2; strict OpenSpec validation and diff
whitespace checks passed. No AX action, manual witness prompt, user browser,
user `:5173/:8080` runtime or product code was touched. Generated SwiftPM
`.build` files were removed after the run and are not evidence.

## TASK-2.2 — lease validation and finite state helper GREEN

Date: 2026-09-20

Implemented only the scoped `NativeAXLifecycleHelper` target declarations and
source under `frontend/tests/e2e/native-ax/Sources/NativeAXLifecycleHelper/**`.
The helper remains adapter-driven test infrastructure: no real AX operation,
system-wide AX root, event/input posting, pasteboard, AppleScript/System
Events/CUA, coordinate/global shortcut, browser focus shortcut or user process
selection was introduced.

Verification:

~~~sh
swift test --package-path frontend/tests/e2e/native-ax --filter 'LeaseValidationTests|AXStateMachineTests|AXForbiddenApiPolicyTests'
~~~

Result: GREEN, 8 passed / 0 failed. The suite covers lease rejection, fresh
validation event ordering, one-shot sink/browser order, terminal TE after
invalid/failing commands, and forbidden API policy. Generated SwiftPM `.build`
files were removed after the run and are not evidence.

## TASK-2.3 — closed Node admission/capability/receipt protocol GREEN

Date: 2026-09-20

Implemented `frontend/tests/e2e/native-ax/native-ax-protocol.mjs` only. The
protocol remains pure local test logic: it does not create a browser, profile,
sink, helper process, AX client, endpoint, or product state. Failed admission
and failed witness paths do not call the target-creation spies.

Verification:

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-admission-contract.test.mjs)
(cd frontend && node --test tests/e2e/native-ax/native-ax-receipt-contract.test.mjs)
~~~

Result: GREEN. Admission/witness suite passed 5/5 and capability/receipt suite
passed 4/4. Strict OpenSpec validation and `git diff --check` passed after the
change; no generated `.build` directory remained.

## TASK-2.4 — separate launcher path GREEN

Date: 2026-09-20

Implemented `frontend/tests/e2e/native-ax/run-native-ax-lifecycle.mjs` and one
explicit `frontend/package.json` script entry:
`e2e:team-invitations:native-ax`. The ordinary `e2e:team-invitations` command
is unchanged. The launcher module exposes the browser-authoritative collector
and barrier policy used by the named local test, while the command entrypoint
fails closed with a TE receipt when prerequisites are absent.

Verification:

~~~sh
(cd frontend && E2E_TEAM_INVITATIONS_NATIVE_AX=1 E2E_NATIVE_AX_LOCAL_ONLY=1 E2E_NATIVE_AX_ALLOW_OS_FOCUS=1 E2E_NATIVE_AX_TEST_ID=teams/invitation-native-ax-lifecycle node --test --test-name-pattern='teams/invitation-native-ax-lifecycle' tests/e2e/teams/e2e-team-invitation-management.mjs)
(cd frontend && npm run e2e:team-invitations:native-ax)
(cd frontend && node --test tests/e2e/native-ax/native-ax-bootstrap-contract.test.mjs tests/e2e/native-ax/native-ax-admission-contract.test.mjs tests/e2e/native-ax/native-ax-receipt-contract.test.mjs)
~~~

Result: GREEN. The named browser seam passed 1/1; the separate native-AX script
returned `{"outcome":"TE"}` without prerequisites and did not create a
browser/profile/sink/helper; native Node contracts passed 14/14. Strict
OpenSpec validation, `git diff --check`, and no-`.build` checks passed.

## TASK-2.5 — descriptor cleanup decision GREEN

Date: 2026-09-20

Completed the cleanup decision surface inside
`Sources/NativeAXLifecycleHelper/**`. The implementation remains adapter-based
test infrastructure; it does not delete real files during the tests and does
not signal or kill any process.

Verification:

~~~sh
swift test --package-path frontend/tests/e2e/native-ax --filter DescriptorCleanupTests
~~~

Result: GREEN, 4 passed / 0 failed. The suite covers stable snapshot cleanup,
normal Playwright-close request ordering, exact cleanup leaves, retain on every
ambiguity, zero signal and zero partial delete. Generated SwiftPM `.build`
files were removed after the run and are not evidence.

## TASK-2.6 — browser-barrier integration GREEN

Date: 2026-09-20

The named local test fixture in
`frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` now imports the
separate native launcher module and verifies browser-authoritative barriers:
lifecycle observer pre-arm, exact unmocked team detail GET, old-handle
detachment and current DOM action. A valid native receipt cannot replace any
missing browser barrier, and the result remains
`LOCAL_MANUAL_WITNESS_REQUIRED` rather than product GREEN.

Verification:

~~~sh
(cd frontend && E2E_TEAM_INVITATIONS_NATIVE_AX=1 E2E_NATIVE_AX_LOCAL_ONLY=1 E2E_NATIVE_AX_ALLOW_OS_FOCUS=1 E2E_NATIVE_AX_TEST_ID=teams/invitation-native-ax-lifecycle node --test --test-name-pattern='teams/invitation-native-ax-lifecycle' tests/e2e/teams/e2e-team-invitation-management.mjs)
npx --yes @fission-ai/openspec@latest validate build-native-ax-lifecycle-harness --strict
git diff --check
~~~

Result: GREEN, 1 passed / 0 failed for the named seam. Strict validation and
diff whitespace checks passed, and no `.build` directory remained. No
application/product/API/backend/feature-flag/default-runner code was changed.

## TASK-3.1 / TASK-3.2 — manual gate not permitted; noninteractive boundary checks

Date: 2026-09-20

TASK-3.1 was not executed because explicit human presence and the exact TTY
witness phrase were not provided in this turn. No OS-focus action, native
helper, sink window, temporary browser, user browser, in-app browser, user
`:5173/:8080` runtime, capability, marker, profile or receipt was created.
The manual step remains `manual witness required`/TE and cannot be counted as
behavioural or release GREEN.

Safe noninteractive verification was still run for TASK-3.2:

~~~sh
(cd frontend && node --test tests/e2e/native-ax/native-ax-bootstrap-contract.test.mjs tests/e2e/native-ax/native-ax-admission-contract.test.mjs tests/e2e/native-ax/native-ax-receipt-contract.test.mjs)
swift test --package-path frontend/tests/e2e/native-ax
(cd frontend && npm run typecheck)
(cd frontend && npm run build)
(cd frontend && npm run e2e:team-invitations)
~~~

Result:

- Native Node contracts: GREEN, 14 passed / 0 failed.
- Swift native package: GREEN, 14 passed / 0 failed.
- Frontend typecheck: GREEN.
- Frontend build: GREEN with only the existing Rspack asset-size warnings.
- Unchanged native-free invitation regression: membership suite GREEN 8/8;
  management suite 11 passed / 2 failed / 1 skipped. The two failures are the
  existing short-viewport contracts
  `BUG_AC03_QA_001_1280x720_TO_640x360_TASK_1_3_BEHAVIOURAL_CONTRACT_FAILED`
  and
  `BUG_AC03_QA_002_768x1024_TO_384x512_TASK_1_3_BEHAVIOURAL_CONTRACT_FAILED`.
  The native lifecycle test remained skipped because native opt-ins were not
  present.

The ordinary invitation runner used isolated `127.0.0.1:18080` and
`127.0.0.1:15173` ports with its own temporary database schema and shut them
down after the run. It did not use or restart the user's local `8080/5173`
runtime. No raw receipt, stderr payload, profile/root path, endpoint,
capability, marker or identity value is recorded here.
