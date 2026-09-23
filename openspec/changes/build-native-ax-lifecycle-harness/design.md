# Design

## Context

See [proposal.md](proposal.md) for the motivation. The current headed
Playwright experiment is a test-environment failure because it cannot reliably
cause and witness the needed real tab lifecycle on this macOS host. The existing
invitation change correctly prohibits substituting AppleScript, CUA, coordinate
input, global shortcuts, browser internals, or the user/in-app browser.

macOS directly exposes an AX client only after the current process is trusted;
Apple documents `AXIsProcessTrustedWithOptions` as the trust check and
`AXUIElementCreateApplication(pid_t)` as the PID-addressed application root.
The design uses those direct primitives, but deliberately excludes the
system-wide AX root. [Apple: AX trust](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)
and [Apple: AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement)
also establish that AX access can fail, which is why every uncertain condition
is a fail-closed test-environment result.

## Goals / Non-Goals

**Goals:**

- Create a narrowly scoped, direct macOS AX path that can only transfer focus
  between a test-created sink window and a test-created browser window.
- Bind every AX operation to a fresh ownership lease and emit privacy-safe,
  machine-validated receipts.
- Preserve browser E2E event, network, and DOM/handle evidence as the sole
  authority for the invitation lifecycle conclusion.
- Make incomplete local prerequisites deterministic TE outcomes and make a
  human witness mandatory supporting evidence for every opted-in attempt.

**Non-Goals:**

- No product behavior, production build artifact, browser extension, browser
  accessibility feature, `TeamWorkspacePage` change, API change, server-side
  authority, feature flag change, persistence, mobile support, or CI support.
- No access to user Chrome, the in-app browser, a pre-existing browser profile,
  OS-global AX hierarchy, coordinate system, or app selected by a name/title.
- No automatic remediation for an unavailable display/trust grant and no
  native-pass status that can release the parent invitation change.

## Decisions

### 1. Use one public-API BrowserLeaseBootstrap path, not browser discovery

The future implementation lives only under
`frontend/tests/e2e/native-ax/`:

- `Package.swift`, a Swift package with a direct `ApplicationServices`/
  `AppKit` helper target, a minimal owned focus-sink target, a
  `BrowserLeaseBootstrap` executable wrapper, descriptor-cleanup support, and
  Swift unit tests;
- `native-ax-protocol.mjs` plus Node tests for runner admission and receipt
  validation;
- `run-native-ax-lifecycle.mjs`, the separate opt-in launcher; and
- test-only integration with
  `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs`, gated behind
  the explicit native-local environment contract.

The helper may use a small Objective-C/C bridge only for stable `libproc`
identity queries (`proc_pidinfo`/`proc_pidpath`) and descriptor APIs
(`mkdtemp`, `openat`, `fstatat`, and `unlinkat`); it otherwise remains Swift.
No third-party automation dependency, Apple Event, shell UI script, process
listing command, or browser-internal implementation API is introduced. A
missing Xcode Command Line Tools/Swift compiler is a TE preflight, not an
attempt to install software or to use a fallback.

The existing ordinary invitation launcher and `e2e:team-invitations` command
remain native-free. A distinct package command such as
`e2e:team-invitations:native-ax` is the sole entry point. It must require all
of these exact values in addition to the normal isolated explicit port pair:

```
E2E_TEAM_INVITATIONS_NATIVE_AX=1
E2E_NATIVE_AX_LOCAL_ONLY=1
E2E_NATIVE_AX_ALLOW_OS_FOCUS=1
E2E_NATIVE_AX_TEST_ID=teams/invitation-native-ax-lifecycle
E2E_TEAM_INVITATIONS_PORT=<unused>
E2E_TEAM_INVITATIONS_WEB_PORT=<unused>
```

The Node launcher rejects a non-darwin host, any nonempty `CI`, non-TTY input
or output, missing/wrong opt-in, an unallowlisted/non-relative test ID, missing
native toolchain, absent AX trust, or no interactive display. It does so before
browser/profile/sink creation. The helper checks AX trust without requesting a
system prompt. The launcher then prints exactly
`TYPE EXACTLY: I WITNESS ONLY THE TEMPORARY BROWSER AND SINK`; it can launch a
visible browser only after that literal line is typed in the same TTY. The line
is discarded after comparing it, and only a `manualWitness` boolean may be
included in the closed receipt.

`BrowserLeaseBootstrap` is the one exact browser launch protocol:

1. A native setup routine creates the `mkdtemp` run root and browser-profile
   child (both checked `0700`, device/inode recorded) before Playwright starts.
2. Node obtains the intended Chromium path exclusively through the documented
   `chromium.executablePath()` API, resolves it to an expected realpath, and
   calls the documented `chromium.launchPersistentContext(profilePath, {
   executablePath: bootstrapWrapperPath })` API. No private Playwright field,
   internal module, child handle, or launch log is read.
3. Playwright starts the wrapper with its ordinary persistent-context arguments.
   The wrapper verifies that the exact `--user-data-dir` is the descriptor-owned
   profile, atomically creates a fixed lease-record file relative to the opened
   profile descriptor, records only its own PID and protocol version, then
   `execve`s the exact selected browser realpath with Playwright's original
   argument vector. `execve` preserves the reported PID.
4. Node reads the lease record only through the profile descriptor. The helper
   then proves from kernel APIs that this exact PID still has the expected birth
   time and executable realpath, belongs to the recorded Playwright-owned parent
   chain, and owns the fresh marked profile. An absent, duplicated, malformed,
   stale, or mismatched record is TE.

This keeps Playwright's normal persistent-context transport internal. The
bootstrap never enables a remote-debugging port or pipe intended for external
connection; no CDP/HTTP/WebSocket endpoint exists in the protocol, environment,
record, receipt, log, or error. The test never uses `connect`,
`connectOverCDP`, or a CDP lifecycle command. It does not use `ps`, `pgrep`,
application enumeration, an executable/process name, a bundle ID, title, URL,
or a user-browser/profile scan to find the browser.

**Alternatives rejected:** scraping a Playwright private process field has no
stable contract; `ps`/`pgrep`/name or title matching can select a user process;
an external debug endpoint expands the local attack surface and can leak into
diagnostics. Adding a branch to the default team-invitation runner would make
the sensitive capability too easy to invoke. AppleScript/System Events, CUA,
CDP lifecycle controls, browser-focus APIs, coordinate clicks, or global
shortcuts create a broader/unverifiable authority path. A remote or CI runner
cannot meet the direct local display and human-witness boundary.

### 2. Authenticate both target processes with memory-only capability material

After local admission, the launcher creates one 256-bit random capability
secret `K`. `K` lives only in the launcher's and helper's memory and travels
between them over the inherited one-run pipe; it is never a file, environment
value, command argument, browser value, test title, receipt, stderr, log, or
saved artifact. The browser bootstrap never needs `K`.

The native setup routine creates the `mkdtemp` run root and separate browser
profile/focus-sink session children. It records each directory's canonical
descriptor, uid, exact `0700` mode, `st_dev`, and `st_ino`. It writes only the
fixed-size marker
`HMAC-SHA-256(K, "native-ax/profile-marker/v1" || role || st_dev || st_ino)`
inside the corresponding child. This marker is an authenticated file value, not
the capability secret. The run retains rather than repairs a directory whose
descriptor, owner, mode, identity, or marker differs.

Registration creates an in-memory lease for browser and sink containing:

1. exact PID and kernel birth time;
2. kernel executable realpath compared with the bootstrap-selected realpath;
3. the descriptor-backed directory identity and role-specific marker result;
4. the complete exact parent-chain identities to the launcher-owned process;
   and
5. no raw `K`, raw marker, filesystem path, or identity digest destined for
   output.

Before *each* permitted AX operation the helper obtains a fresh kernel/process
and descriptor validation for the full lease. It refuses PID reuse, executable,
parent-chain, mode/device/inode or marker change, a missing claim, multiple AX
windows, or any foreign AX element. There is no cache grace period and no
recovery selection.

**Alternatives rejected:** a stored random sentinel exposes a second durable
secret-like value and identity digests in receipts can create a correlatable
record. PID-only selection is vulnerable to reuse; bundle/name/title matching
and a system-wide query can select a user process; profile-only checks do not
distinguish process replacement. A capability-secret-derived local marker plus
fresh kernel identity validation provides the necessary proof without an output
identity fingerprint.

### 3. Define closed helper protocol, finite AX actions, and receipt privacy

The test-owned browser setup remains responsible for all application evidence.
Before it asks the launcher for a background action it installs an
observer-only browser init script and pre-arms the exact real post-focus request
observer. The observer records only ordered lifecycle type/visibility/timing;
it never dispatches an event, calls application state, uses CDP, reloads, or
fulfills a route. After sink focus and browser focus, the browser E2E must prove
its specified real lifecycle order, an unmocked exact `GET` with the expected
response, detachment of the old element handle, and the current DOM action.

The native helper cannot report that browser barriers passed. Its work is
limited to closed booleans that say whether it admitted, verified leases,
accepted the manual witness, performed each permitted one-shot action, observed
safe close, and deleted the exact temporary directory. The E2E process combines
that receipt with its own authoritative browser observations but labels every
attempted native route `LOCAL_MANUAL_WITNESS_REQUIRED`; neither it nor the
helper emits a release GREEN. A TE preflight/operation outcome remains TE and
never becomes a fallback conclusion. Once the browser has actually witnessed
its required foreground barriers, a failed browser DOM/handle assertion remains
the browser E2E's own behavioural RED, not a native-helper classification.

The helper communicates through an inherited, one-run, length-delimited pipe;
raw identity and `K` may cross that pipe but are never echoed. Requests have a
closed command set: `registerLeases`, `raiseSink`, `browserBackgroundWitnessed`,
`raiseBrowser`, and `close`. The helper enforces the only legal progression
`ADMITTED → LEASED → WITNESS_CONFIRMED → SINK_RAISED →
BROWSER_BACKGROUND_WITNESSED → BROWSER_RAISED → CLOSING`. A command arriving in
the wrong state, duplicated command, failed lease check, failed AX result, or
timeout writes a fixed TE outcome and permanently closes the action path; it
does not retry, choose an alternative element/PID, or perform a second action.

For each command that reaches AX, the helper freshly revalidates the target
lease before `AXUIElementCreateApplication(verifiedPid)`, each
`kAXWindowsAttribute` descendant read, each `AXUIElementGetPid`, and the one
`kAXRaiseAction`. A target must expose exactly one window. `raiseSink` is the
one permitted action before the independent browser background witness, and
`raiseBrowser` is the one permitted action after it. The helper neither creates
`AXUIElementCreateSystemWide` nor enumerates applications/windows. It does not
use `AXUIElementPostKeyboardEvent`, `CGEventPost`, event taps, mouse/scroll
posting, pasteboard APIs, UI scripting, AppleScript/System Events/CUA,
coordinates, global shortcuts, browser focus APIs, synthetic browser lifecycle
events, CDP lifecycle commands, or any global keyboard/mouse operation.

Every helper stdout result is exactly one UTF-8 JSON line of at most 1024 bytes
and validates the closed canonical schema:

```
{
  "version": 1,
  "testId": "teams/invitation-native-ax-lifecycle",
  "phase": "ready" | "focus" | "cleanup",
  "outcome": "TE" | "LOCAL_MANUAL_WITNESS_REQUIRED",
  "timestampMs": <bounded integer>,
  "checks": { <only that phase's enumerated boolean keys> },
  "mac": "<lowercase HMAC-SHA-256 over canonical object without mac>"
}
```

The MAC is `HMAC-SHA-256(K, "native-ax/receipt/v1" || canonicalPayload)`. It
authenticates a closed payload in memory and is not an identity digest. There is
no `digests` map. Duplicate JSON keys, unknown/missing fields, noncanonical
encoding, bad MAC, excess stdout, more than one receipt, or an invalid phase
boolean map is TE. Helper stderr is collected only in a bounded in-memory
buffer; any stderr byte, invalid UTF-8, or buffer overflow causes a fixed
non-diagnostic TE code, and the bytes are discarded without printing, storing,
or attaching them. A path, PID, parent identity, executable/argument, AX
role/title/value/tree, URL/debug endpoint, token, cookie, header, idempotency
value, `K`, marker, or free-form diagnostic is prohibited in every receipt or
error channel.

**Alternatives rejected:** a detailed AX dump or open JSON diagnostics channel
can leak profile paths, endpoints, or one-time invitation secrets; an identity
digest creates correlatable evidence; treating a native focus action as a
browser success masks the exact regression being tested. Retrying AX failures
or posting input turns a bounded focus attempt into broader desktop control.

### 4. Cleanup is descriptor-anchored, ledger-based, and never forceful

Native setup uses `mkdtemp` to create the per-run root and immediately records
its `st_dev`/`st_ino` after `fstat`; browser and sink children are created only
with `mkdirat` below the opened root descriptor. Their descriptors are opened
with `O_NOFOLLOW` and recorded with `fstat` identity, owner, and exact `0700`
mode. Path strings are only used to create/open these known entries; subsequent
cleanup identifies each object by its parent descriptor, leaf name, device, and
inode.

Before normal close, the helper makes two bounded snapshots of only the exact
browser-root descendant tree via kernel process APIs from the leased root. Each
snapshot records in memory the browser root and every descendant's PID, birth
time, executable realpath, direct parent identity, and lease role. The snapshots
must be identical as a set and parent graph. A new child, missing child,
reparenting, PID reuse, unreadable identity, or sampling timeout is ambiguity.
Only then does Node request the documented normal Playwright context/browser
closure. It waits for every ledger member to exit while ensuring any observed
surviving PID is still the recorded identity.

Deletion begins only after every ledger identity exited and a final descriptor,
device/inode, owner/mode, and domain-separated marker check succeeds. The native
routine walks each known profile/session directory through already-opened
descriptors: every entry is inspected with
`fstatat(parentFd, name, AT_SYMLINK_NOFOLLOW)`, no symlink or unexpected type is
accepted, child directories are opened with `openat(..., O_NOFOLLOW)`, and only
the exact inspected entries are removed with `unlinkat`. Finally the recorded
leaf itself is removed with `unlinkat(parentFd, leaf, AT_REMOVEDIR)` after its
device/inode still match. It does not call shell deletion, `rm -rf`, a generic
recursive-delete API, glob expansion, path re-resolution, broad orphan scan, or
reaper.

On any descriptor/identity/marker/tree/exit/entry/deletion ambiguity, cleanup
returns the fixed TE outcome and retains the whole `mkdtemp` run root for manual
inspection. The harness never sends a signal or kill—even to an apparently
owned process—nor deletes one file as a best-effort partial cleanup. The only
shutdown request is normal Playwright closure.

**Alternatives rejected:** force-killing a browser can affect a PID-reused or
unrelated process; path-based recursive deletion can follow a substituted
target; profile deletion before descendants exit risks deleting an active
profile; broad orphan scanning/reaping cannot establish ownership. A strictly
retained private `mkdtemp` directory on ambiguity is recoverable and safer.

### 5. Bound the threat model and make the human decision deliberate

This harness mitigates accidental or stale targeting during an opted-in local
run: PID reuse, profile replacement, stale bootstrap records, unexpected
descendants, AX foreign elements/multiple windows, receipt/log disclosure, and
unsafe cleanup. It is not a sandbox or endpoint security boundary against a
host compromise, root/MDM/TCC compromise, malicious browser binary, or a hostile
process under the same local uid that can inspect another process's memory,
ptrace it, or race its loopback/temporary state while the manual test is active.
Those conditions are out of scope and must yield no claim that the harness is
safe for shared/hostile-user machines. The capability MAC prevents accidental
or non-secret-output substitution; it does not make an untrusted same-uid host
safe.

The user—not an agent, environment variable, browser callback, or test
fixture—must type exactly `I WITNESS ONLY THE TEMPORARY BROWSER AND SINK` at the
TTY after the launcher explains the one sink-to-browser focus transition. The
accepted value is reduced immediately to `manualWitness: true`; incorrect,
missing, EOF, or interrupted input is `manualWitness: false` and TE. The typed
phrase is neither persisted nor treated as a capability.

### 6. Test-first verification has decomposed native-boundary gates

Before any helper, bootstrap, sink, launcher, or production-for-test source
exists, independently named RED tests will establish:

1. public-API `BrowserLeaseBootstrap` provenance, fresh persistent profile, and
   no-private-field/no-`ps`/no-endpoint contract;
2. local admission and exact fixed-phrase manual witness contract;
3. memory-only capability derivation, closed receipt MAC/schema/size, and
   stderr-discard contract;
4. fresh lease validation plus the finite AX action state/order and prohibited
   global-input/system-wide-AX API contract; and
5. two-snapshot owned-descendant ledger plus `mkdtemp` device/inode and
   descriptor-anchored retain-on-ambiguity cleanup contract.

Each test task freezes its own deterministic RED result. The task auditor, test
reviewer, security/reliability reviewer, and architect must approve the complete
set of observed RED evidence before any source implementation task can start.
These unit/integration tests are the proportionate exception to an E2E-first
test for the native boundary: a normal browser cannot safely induce or inspect
kernel process identity, AX trust, or destructive-cleanup decisions. The final
invitation route remains a browser E2E on explicit unused ports with a present
human witness; its browser event, real-GET, and DOM checks remain authoritative.

## Risks / Trade-offs

- **AX grant, display, or toolchain differs by developer machine** → fail before
  launch as TE; document no auto-prompt, no installation, no CI, and no
  fallback.
- **A PID is reused or profile is substituted** → compare the full kernel lease,
  descriptor device/inode, and capability-derived marker before every action;
  reject ambiguity without an AX query.
- **An AX tree introduces a foreign element or more than one window** → check
  every traversed element PID and exact cardinality; do not search for a
  “closest” target.
- **A receipt or test error discloses data** → enforce one bounded closed MACed
  receipt and discard any stderr byte in unit tests; no identity digest or
  endpoint can be emitted.
- **A browser child outlives Playwright close** → retain the complete `mkdtemp`
  run root and surface TE; never signal/kill/delete on a timeout or altered tree.
- **A hostile same-uid local process is present** → the harness is not offered
  as an isolation boundary; do not run the optional manual tool on a shared or
  hostile-user machine.
- **The optional harness is mistaken for release evidence** → name all native
  outcomes `LOCAL_MANUAL_WITNESS_REQUIRED`/TE and retain browser event/GET/DOM
  checks plus explicit final product review.

## Migration Plan

No deployed data, API, application, or product migration exists. The launcher
is added disabled by default and is reachable only through the new explicit
local command. Rollback removes that command and its test-only directory; it
does not alter user browsers, product profiles, system settings, or persisted
application state. A manually granted macOS Accessibility permission is never
granted or revoked programmatically by this repository.
