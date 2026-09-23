# Proposal: build a bounded native AX lifecycle harness for local acceptance

## Why

The invitation lifecycle's real foreground/background tab transition cannot be
reliably witnessed by the current browser-only runner in this macOS environment.
The existing change correctly treats that result as a test-environment failure
rather than converting it to a product pass. A separate, local-only native
Accessibility (AX) harness is needed to make the OS-focus action safe enough to
attempt, while keeping browser evidence—not native automation—the authority for
the invitation behaviour.

## What Changes

- Add a macOS-only, test-only lifecycle harness consisting of a direct native AX
  helper, an owned focus-sink process, and one `BrowserLeaseBootstrap` launch
  path. The bootstrap uses the public Playwright persistent-context launch API
  with a fresh profile and an executable wrapper that atomically reports the
  post-`exec` browser PID. It does not inspect private Playwright fields or
  discover processes with `ps`, `pgrep`, display names, bundle names, or titles.
  It can be invoked only by a new explicit local acceptance command; it is not
  attached to the ordinary invitation suite or CI.
- Require a per-run ownership lease before **every** native action: exact owned
  PID, process birth time, canonical executable realpath, canonical `0700`
  temporary profile/session directory, and a capability-secret-derived marker.
  The raw per-run capability secret remains in memory only and authenticates
  domain-separated profile-marker and receipt MACs; receipts carry no identity
  digest. The helper may read and act only in the verified target application's
  AX subtree.
- Define fail-closed preflight, readiness, receipt, and descriptor-anchored
  cleanup contracts. The
  runner rejects CI, noninteractive shells, absent AX trust, or unavailable
  display as test-environment (`TE`) outcomes; it does not fall back to
  AppleScript, System Events, CUA, coordinates, global shortcuts, fuzzy process
  selection, the user's browser, or the in-app browser.
- Keep the native receipt deliberately non-sensitive and closed: it has a
  fixed-size, schema-validated envelope of fixed enum values, booleans, the
  allowlisted relative test ID, bounded timestamps, and a domain-separated MAC.
  It must contain no filesystem paths, process IDs, identity digest, AX
  tree/element text, URL, debug endpoint, invitation token, authentication
  material, idempotency value, raw capability secret, or free-form diagnostics.
  Any stderr byte or invalid/oversize stdout receipt becomes a non-persisted TE
  outcome.
- Make native execution optional supporting evidence for a manually witnessed
  local acceptance attempt. Browser lifecycle events, the real post-focus GET,
  and DOM assertions remain the authoritative behaviour evidence. A TE outcome
  or a native action alone never produces a behavioural GREEN, CI substitute,
  or production-change authorization.
- Add separate test-first RED gates for bootstrap provenance, admission and
  fixed-phrase witness confirmation, receipt privacy, ownership/AX state order,
  and descriptor-anchored cleanup before the helper or launcher is implemented.
  Add a real local macOS acceptance procedure only after the
  security/reliability gates approve every frozen RED contract.

## Capabilities

### New Capabilities

- `native-ax-lifecycle-harness`: A fail-closed, test-owned macOS AX facility
  that can move focus only between verified harness-owned processes and report
  privacy-safe local evidence for a browser-authoritative lifecycle test.

### Modified Capabilities

- None. This change does not alter the invitation-management, team-workspace,
  product, API, authorization, feature-flag, or browser-test requirements.

## Impact

- New test infrastructure is limited to a dedicated native-AX directory under
  `frontend/tests/e2e/` and one separate local launcher/package command. The
  future implementation may compile a small Swift or Objective-C helper,
  focus-sink, and browser executable wrapper only on macOS; no native helper is
  bundled with the product.
- The ordinary `e2e:team-invitations` command, its runner, user-facing
  `:8080/:5173` processes, backend, frontend production code,
  `TeamWorkspacePage`, APIs, data model, permissions, RTK state, SSE/Yjs,
  browser storage, and feature flags remain out of scope.
- The harness is a security-sensitive local developer tool. It requires
  security/reliability, architecture, task-audit, test-review, QA, and product
  acceptance gates before any implementation is eligible to run.
