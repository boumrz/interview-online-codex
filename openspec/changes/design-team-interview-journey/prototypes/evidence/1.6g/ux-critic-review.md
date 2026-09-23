# UX Critic tenth re-review — OpenSpec task 1.6g

**Verdict: `ux-approved`.** Zero blocking findings. The latest authoritative prototype satisfies the Product Owner's explicit iPhone Safari orientation support boundary and preserves the existing role/privacy model.

## Gate summary

- Real iPhone 17 Pro Simulator / iOS 26.2 / Mobile Safari 26.2: PASS.
- Portrait room and compact-form input: PASS, including edit, explicit re-focus and state preservation.
- Keyboard-closed landscape viewing/navigation in both Dynamic Island directions: PASS with ≥44px targets.
- Direct landscape input in both directions: PASS; focus/input is prevented before activation and an accessible orientation fallback is shown without mutation.
- Portrait→landscape during input: PASS; input closes without Send/Save and draft/scope/session/context/local step/selection/scroll persist.
- Return portrait: PASS; state persists, fallback disappears and explicit re-focus is required.
- Safe areas, horizontal overflow and document scroll: PASS.
- 1.6a–1.6f replay: 44/44 each, zero runtime errors, expected screenshots present. Strict OpenSpec validation: PASS.
- Publish/privacy: PASS under the reconciled room-grant policy. Other mobile browsers/devices are explicitly not claimed.

## Mandatory UX checklist

| Check | Result | Note |
|---|---|---|
| Room creation without registration in ≤3 steps | PASS | Existing accepted invite/create journey remains covered; this review introduces no registration gate. |
| Owner distinct from participant | PASS | Room-owner and candidate surfaces remain visually and structurally distinct. |
| Current step always visible | PASS | Current local and candidate-published step remain present in portrait and keyboard-closed landscape; preserved through fallback rotation. |
| Next-step authority clear | PASS | Publish control appears only for room OWNER/INTERVIEWER with room authority. |
| Run code owner-only/distinct | N/A | This design change does not introduce or alter a code-run action; no misleading runner control is present. |
| First-time join flow | PASS | Invite/acceptance role and privacy states remain covered by the current matrix. |
| Critical error/loading/empty states | PASS | DA coverage and 1.6a–1.6f state matrices replay cleanly. |
| Reconnect communicated | PASS | Reconnecting, frozen and revoked room states remain visually distinct. |
| Laptop/mobile usability | PASS | Accepted iPhone Safari support matrix passes in real Safari; laptop-sized automated matrices remain green. |

## Findings

None. Historical fourth–ninth `revise` screenshots remain evidence of superseded approaches, not current blockers.

## Release gate

Task 1.6g is `ux-approved` with zero MVP-blocking UX issues. Next owner: Product Owner for final acceptance. This review is prototype evidence only; production browser detection, server authorization and mutation guarantees still require their implementation/E2E gates.
