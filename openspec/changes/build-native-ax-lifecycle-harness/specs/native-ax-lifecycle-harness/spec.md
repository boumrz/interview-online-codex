# Spec Delta

## Purpose

Defines a fail-closed, local-only macOS Accessibility harness for witnessing a
test-owned browser focus lifecycle without allowing native automation to touch
an unowned application, disclose sensitive test data, or replace browser
behaviour evidence.

## ADDED Requirements

### Requirement: Explicit local-only admission precedes native AX activity

The native AX lifecycle harness SHALL be unavailable to ordinary browser E2E
commands and CI. It SHALL attempt native activity only when all of the following
are true: the host is macOS; `CI` is absent; standard input and output are both
TTYs; the named relative test ID is on the harness allowlist; all documented
local opt-in environment variables are explicitly set; an interactive display
is available; and the helper is already trusted as a macOS accessibility client.
The trust check SHALL not prompt, alter system accessibility settings, or launch
an application before admission completes.

A failed admission SHALL be reported as a test-environment (`TE`) result with
no native action, no fallback automation, no ordinary-suite success, and no
behavioural GREEN. The user must manually witness a later opted-in local attempt
before that attempt can be recorded as supporting evidence.

Before the first focus action of an admitted attempt, the launcher SHALL print
the fixed, non-secret terminal prompt
`TYPE EXACTLY: I WITNESS ONLY THE TEMPORARY BROWSER AND SINK` and require that
exact line from the interactive TTY. It SHALL convert an exact response into
the sole `manualWitness: true` receipt boolean, immediately discard the typed
line, and never accept an environment variable, command argument, file,
automation API, or default answer as a witness. An absent, changed, or failed
response is TE and prevents every AX action.

#### Scenario: Ordinary invitation suite stays native-free
- **WHEN** an engineer runs the ordinary invitation or workspace E2E command
  without every native-local opt-in
- **THEN** no native helper, focus sink, native profile, or AX action is
  created
- **AND** the command retains its established headless/default behaviour

#### Scenario: CI or noninteractive invocation is rejected safely
- **WHEN** the native command is requested with `CI` present or either standard
  stream not attached to a TTY
- **THEN** it returns a TE result before launching a browser or issuing AX work
- **AND** it neither controls a user process nor substitutes AppleScript,
  System Events, CUA, coordinates, global shortcuts, or a browser API shortcut

#### Scenario: Missing AX trust or display is not treated as a test failure or pass
- **WHEN** explicit local opt-ins are present but macOS AX trust or an
  interactive display is unavailable
- **THEN** the command produces TE/manual-witness-required evidence and does
  not issue an AX request
- **AND** it does not classify the underlying invitation behaviour as RED or
  GREEN and does not authorize product implementation

#### Scenario: Manual witness cannot be skipped or inferred
- **WHEN** all technical admission checks pass but the TTY does not return the
  exact fixed witness phrase
- **THEN** the launcher produces a TE result with `manualWitness: false`
- **AND** it launches no sink/browser, makes no AX call, and persists neither
  the entered line nor a diagnostic derived from it

### Requirement: BrowserLeaseBootstrap is the sole browser ownership path

The named local command SHALL create a fresh persistent Playwright context only
through `BrowserLeaseBootstrap`. It SHALL create an exact `0700` browser-profile
directory under the run's `mkdtemp` root, obtain the selected browser executable
only through the documented `browserType.executablePath()` API, and invoke the
documented `browserType.launchPersistentContext(profileDirectory, { executablePath:
bootstrapWrapper })` API. `bootstrapWrapper` SHALL atomically write the exact
PID that it is about to retain across `execve(selectedBrowserExecutable, argv)` to
the descriptor-anchored profile lease record, then `execve` that exact verified
realpath. The launcher SHALL subsequently prove the record's PID, kernel birth
time, executable realpath, parent-chain relation, and profile marker before it
uses the persistent context. It SHALL not read private Playwright properties,
internal modules, child-process handles, or debug logs to determine a PID.

The Playwright persistent-context transport remains the implementation-owned
launch transport. The bootstrap SHALL not enable a remote-debugging port, expose
or print a WebSocket/CDP/HTTP endpoint, call `connect`, `connectOverCDP`, or
place an endpoint in a profile record, receipt, stderr, environment variable,
argument, test artifact, or diagnostic. The existing browser test SHALL not send
CDP lifecycle commands. PID provenance SHALL not use `ps`, `pgrep`, process or
application enumeration, a bundle/display/name/title/URL selector, or scanning a
user-owned browser/profile.

#### Scenario: Persistent browser provenance is accepted only through bootstrap
- **WHEN** the local command creates a browser for a native attempt
- **THEN** the browser has a fresh profile and a PID claim from the exact
  bootstrap `execve` path which the kernel identity validation subsequently
  proves
- **AND** an absent, malformed, stale, duplicate, or non-bootstrap claim is TE
  before an AX root is created

#### Scenario: Browser transport endpoint never becomes evidence or authority
- **WHEN** the bootstrap launches the persistent context
- **THEN** no remote-debugging endpoint is enabled, read, returned, logged, or
  retained outside Playwright's implementation-owned transport
- **AND** no private Playwright field, `ps`/`pgrep`, name/title scan, or
  `connectOverCDP` fallback is used to identify the browser

### Requirement: Native actions are restricted to verified harness-owned process leases

Before **every** native AX read or action, the harness SHALL independently
validate an ownership lease for the target process: exact PID, unchanged process
birth time, canonical executable realpath, a canonical per-run temporary
profile/session directory with mode exactly `0700`, and a matching
capability-secret-derived marker. The target process and profile/session
directory SHALL be created by the same local harness run. A changed PID identity,
executable, profile canonicalization or mode, marker, process ancestry, or
target-window cardinality SHALL fail closed.

The harness SHALL use a direct macOS AX client addressed by the verified PID
only. It SHALL traverse only descendants of that target application AX root and
shall reject an element whose AX PID differs from the leased PID. It SHALL never
enumerate system-wide AX state, find an application by display name, bundle name,
title, coordinate, URL, or other fuzzy selector. The only permitted focus
transition is from a verified harness-owned focus sink to a verified
harness-owned browser window; ambiguity is TE and no action is performed.

The action protocol SHALL be a finite, single-attempt state machine:
`ADMITTED → LEASED → WITNESS_CONFIRMED → SINK_RAISED →
BROWSER_BACKGROUND_WITNESSED → BROWSER_RAISED → CLOSING`. The only AX action is
one `kAXRaiseAction` on the single leased sink window in `WITNESS_CONFIRMED`,
then one `kAXRaiseAction` on the single leased browser window after the browser
test reports its independently observed background witness. Each `AXUIElement`
creation, `kAXWindowsAttribute` read, PID read, and raise operation SHALL start
with a fresh full lease validation. There is no retry, reselection, alternate
window, alternate PID, or out-of-order transition after an error; every such
case is TE.

The implementation SHALL not create `AXUIElementCreateSystemWide`, post an AX,
CG, keyboard, mouse, scroll, clipboard, or global event, use an event tap,
read/write the pasteboard, call AppleScript/System Events/CUA/UI scripting, use
coordinates/global shortcuts, issue a browser-focus or synthetic-lifecycle
shortcut, or search any global application/window list.

#### Scenario: A recycled PID cannot receive an AX action
- **WHEN** a process retains a leased PID but its observed birth time or
  executable realpath no longer matches the lease
- **THEN** the harness rejects the lease before reading or acting on its AX tree
- **AND** it does not select another process with a similar name or terminate
  any process

#### Scenario: An unsafe profile or capability marker blocks focus control
- **WHEN** the browser or focus-sink profile/session directory is noncanonical,
  not mode `0700`, outside the run's owned temporary directory, or its marker
  does not match
- **THEN** the harness records a TE/ownership failure before an AX action
- **AND** no user browser, in-app browser, or unrelated application is queried
  or focused

#### Scenario: Only the owned focus sequence is allowed
- **WHEN** both process leases are valid and their AX subtrees each expose the
  single expected owned window
- **THEN** the harness can focus the owned sink and subsequently the owned
  browser through direct AX actions addressed by their exact PIDs
- **AND** it does not use AppleScript, System Events, CUA, synthetic browser
  lifecycle events, CDP lifecycle commands, pointer coordinates, keyboard/global
  shortcuts, event posting, or fuzzy application selection

#### Scenario: A failed AX operation cannot broaden or repeat authority
- **WHEN** a lease validation, window-cardinality read, or the first permitted
  raise action fails
- **THEN** the state machine terminates as TE without a second AX action
- **AND** it does not enumerate a replacement application/window, retry a PID,
  post an input event, or continue to the browser-focus state

### Requirement: Browser lifecycle evidence remains authoritative and receipts are privacy-safe

The native harness SHALL only attempt the physical focus transition. A positive
invitation-lifecycle conclusion SHALL require the browser test's independently
observed real lifecycle events, unmocked post-focus `GET`, and DOM/handle
assertions. Native helper output SHALL neither synthesize these observations nor
replace a missing one.

The launcher SHALL generate one 256-bit capability secret per run and retain it
only in launcher/helper memory. It SHALL derive profile markers with
`HMAC-SHA-256(secret, "native-ax/profile-marker/v1" || role || device || inode)`
and receipt MACs with
`HMAC-SHA-256(secret, "native-ax/receipt/v1" || canonicalReceiptWithoutMac)`.
The raw secret, raw marker input, and filesystem/process identity material SHALL
not be passed in an environment variable, command argument, browser page,
receipt, log, or persisted test artifact. Receipts SHALL contain no identity
digest; the MAC is verification-only and conveys no identity field.

Every readiness, action, and cleanup receipt SHALL be exactly one UTF-8 JSON
line of at most 1024 bytes, with the closed schema `{version, testId, phase,
outcome, timestampMs, checks, mac}`. `version` is exactly `1`; `testId` is the
single allowlisted relative ID; `phase` is exactly one of `ready`, `focus`, or
`cleanup`; `outcome` is exactly `TE` or `LOCAL_MANUAL_WITNESS_REQUIRED`;
`timestampMs` is a bounded integer; `checks` is the phase's closed allowlisted
boolean map; and `mac` is exactly lowercase hexadecimal HMAC-SHA-256. An unknown
field, missing field, duplicate key, noncanonical encoding, invalid MAC, extra
stdout byte, oversize line, or unexpected receipt count invalidates all helper
output as TE.

The helper's stderr SHALL be captured only in a bounded non-persisting buffer.
Any stderr byte, invalid UTF-8, or buffer overflow SHALL be converted to a fixed
closed TE code; its bytes SHALL be discarded, never printed, attached, stored,
or copied into a browser assertion. A receipt or its error channel SHALL contain
no filesystem path, process ID, process command/argument, AX tree/text, URL,
debug endpoint, invitation token, authentication value, cookie, header,
idempotency value, capability secret, raw marker, or free-form diagnostic.

#### Scenario: Native focus alone cannot pass the invitation lifecycle
- **WHEN** the native focus transition succeeds but the browser observer lacks
  the required real foreground event order or unmocked real `GET` result
- **THEN** the local attempt remains TE/manual-witness-required rather than
  behavioural GREEN
- **AND** if those browser barriers are present but a DOM/handle assertion
  fails, the browser E2E records its normal behavioural RED independently of
  the native receipt
- **AND** no production task, feature flag, API, permission, or application
  state is changed as a fallback

#### Scenario: A valid receipt contains only the allowlisted evidence shape
- **WHEN** a local native attempt emits a readiness, action, or cleanup receipt
- **THEN** it is within the fixed byte limit, has exactly the closed schema and
  phase-specific booleans, and validates its domain-separated MAC in memory
- **AND** a receipt with a path, PID, AX data, URL, token, credential,
  endpoint, identity digest, idempotency value, raw capability/marker, unknown
  field, duplicate key, stderr byte, or oversized output is rejected and not
  stored

### Requirement: Cleanup is exact, observable, and non-destructive under ambiguity

The run root SHALL be created with `mkdtemp`, immediately verified as an owned
`0700` directory, and recorded with its device and inode. Browser-profile and
sink-session directories SHALL be created beneath its opened descriptor and each
recorded with its own device and inode. The harness SHALL take two bounded,
equal snapshots of the exact browser-root descendant tree before closure. A
snapshot ledger contains in memory only each owned PID, birth time, executable
realpath, direct parent identity, and its lease role. A mismatch, new/reparented
descendant, unreadable identity, or timeout is ambiguity.

After a stable ledger is recorded, the harness SHALL first request normal
Playwright browser/context closure. It SHALL wait for the verified browser root
and every ledger descendant to exit with their exact recorded identities. It
SHALL delete only the exact recorded profile/session directory after all exits
and final marker/ownership checks succeed. It SHALL use descriptor-anchored
native cleanup: `openat` with `O_NOFOLLOW`, `fstatat(..., AT_SYMLINK_NOFOLLOW)`,
device/inode comparisons against the recorded values, and `unlinkat` for each
verified child and final directory. It SHALL never derive a cleanup target from
a path string after descriptor opening, use shell deletion, globbing, or a
recursive convenience API.

If process-tree discovery changes unexpectedly, any identity is ambiguous, an
exit times out, a descriptor/device/inode/marker check fails, an unexpected
directory entry appears, or cleanup receives an error, the harness SHALL stop
with TE/manual-witness-required evidence and retain the entire run root for
manual investigation. It SHALL not send a signal, kill a process, delete a
profile, recursively delete a broader directory, or clean a path based on a
glob, unresolved variable, fuzzy match, or unverified path.

#### Scenario: Complete owned shutdown permits exact profile cleanup
- **WHEN** Playwright closes the browser and every recorded owned root and
  descendant exits with the same verified identities
- **THEN** the harness deletes only the exact descriptor-anchored,
  device/inode-matching, marker-matching `0700` directory for that run
- **AND** its privacy-safe receipt records closed booleans and MAC without
  exposing the directory or process details

#### Scenario: Cleanup ambiguity preserves external state
- **WHEN** an owned descendant is still alive, a PID identity changes, or the
  process tree/descriptor/marker cannot be proven stable
- **THEN** the harness returns TE and leaves the profile/session directory in
  place with its run root for manual investigation
- **AND** it does not kill, signal, or delete anything beyond a normal
  Playwright close request

### Requirement: Test levels and manual acceptance boundary are explicit

The bootstrap provenance, admission/fixed-phrase witness, receipt-schema,
ownership/finite-AX-state, and cleanup-decision contracts SHALL each be authored
first as separate unit/integration RED tests and reviewed before their helper or
launcher production-for-test source is created. This is a documented
proportionate exception to browser E2E because these contracts concern local
native process identity and safe cleanup, which a product browser flow cannot
observe without unsafe control of the operating system. The final invited-team
lifecycle attempt SHALL remain a browser E2E with explicit local manual
acceptance; its browser event, network, and DOM assertions remain authoritative.

#### Scenario: Infrastructure implementation is blocked by its RED and security gates
- **WHEN** the native helper or launcher is proposed for implementation
- **THEN** bootstrap, witness/admission, receipt, finite-AX-state, and
  descriptor-cleanup tests have each first demonstrated their missing/incorrect
  contract as RED, and the task/security reviews have approved the frozen tests
- **AND** a missing display, TTY, AX trust, or manual witness is recorded as TE
  rather than transformed into a product RED/GREEN result
