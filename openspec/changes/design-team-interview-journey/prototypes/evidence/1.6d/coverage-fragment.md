# Coverage fragment — Designer 1.6d

Standalone entry: [`../../hiring.html`](../../hiring.html). This fragment is ready to be copied into the authoritative `prototypes/coverage-matrix.md` by the integration owner. It intentionally does not edit that shared file.

| UX / DA | Surface and route | Roles | Explicit states | Interaction / privacy assertion | Evidence |
|---|---|---|---|---|---|
| UX-09 / DA-04 | Candidates list `hiring.html#/teams/atlas/candidates` | `HIRING isHr=false`, `HIRING isHr=true`, `MEMBER`, `ADMIN` without room grant, team `OWNER` without room grant, assigned `INTERVIEWER` | loading, empty, filter-empty, error, revoked, success | Only current `HIRING` sees rows; personal `isHr` changes no team right; every row is an interview, not a person profile | `report.json.roleMatrix`, `screenshots/candidates-*` |
| UX-09 / DA-04 | Result `hiring.html#/teams/atlas/candidates/room-204` | `HIRING`, assigned `INTERVIEWER`, `MEMBER`, `ADMIN` without grant, team `OWNER` without grant | loading, empty result, filter-empty return, error, revoked, success, archived read-only | Assigned room manager can use the result via their interview; team role alone cannot. Missing score is not zero; archive is read-only; private notes are excluded | `report.json.resultMatrix`, `screenshots/result-*` |
| UX-09 / DA-04 | Export dialog from Candidates | current `HIRING` only | ready, forming, download initiated, valid empty workbook, retryable error, too large, busy with retry time, revoked | List and export carry the exact same filter signature; all pages and empty output are explicit; success appears only after forming; revoke clears export scope | `report.json.filterParity`, `report.json.exportLifecycle`, `screenshots/export-*` |
| UX-11 / DA-04 | Member directory `hiring.html#/teams/atlas/members` | `HIRING`, `MEMBER`, `ADMIN`, team `OWNER`, assigned manager | loading, roster empty, filter-empty, processes error with roster retained, revoked, success | Projection payload contains only track/vacancy IDs and names. Cards and links contain no candidate, count, room ID, interview time or result. Process controls are links, never assignment checkboxes | `report.json.projectionPrivacy`, `screenshots/members-*` |
| UX-11 / DA-04 | Caller-only process list `hiring.html#/teams/atlas/interviews?trackId=frontend&vacancyId=lead-ui` | all active team roles; assigned manager | loading, empty/filter-empty, error, revoked, success for caller with own grant | Link keeps the caller actor and process IDs only; it never carries colleague identity. Empty text explicitly allows that a colleague has the badge while the caller has no accessible interview | `report.json.callerOnlyNavigation`, `screenshots/process-*` |
| UX-10 / DA-04 | Cross-surface geometry | all representative roles | long Russian strings plus every state above | No document-level horizontal overflow; every visible action/control is at least 44×44 px; primary action is scroll-reachable with simulated keyboard inset | `viewport-zoom-report.md`, `report.json.matrix`, `screenshots/keyboard-simulation-390x640.png` |
| UX-10 / DA-04 | Keyboard-only navigation | `MEMBER`, long directory | success | All sampled controls have accessible names, visible focus, and the caller-only process link occurs in normal tab order | `keyboard-report.md`, `report.json.keyboard` |

## Integration instructions

Add a plain link or route from the authoritative prototype entry to:

```text
hiring.html#/teams/atlas/candidates?actor=hiring&state=success&isHr=false
```

Then copy/merge the rows above into `prototypes/coverage-matrix.md`. Do not embed the standalone document in an iframe: the hash routes, native dialog focus, viewport measurements and responsive shell should run at top level.

The artifact is explicitly **prototype-only**. Its DOM-clearing assertions show intended client behavior, not enforcement of API authorization, non-disclosing errors, response payload filtering or actual workbook content.
