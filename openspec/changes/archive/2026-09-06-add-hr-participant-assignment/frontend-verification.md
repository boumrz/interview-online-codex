# Frontend implementation handoff

Tasks 3.2 and 3.3 were implemented after the recorded browser RED in `output/hr-participant-browser-red.log`: the authenticated HR participant had zero `Назначить HR` actions where the acceptance test required one. Product, architecture, execution plan and task audit were read before production edits.

Only the assigned frontend files changed: `TopBar.tsx`, `useRoomSocket.ts`, `RoomPage.tsx` and `RoomPage.module.css`. This report is the sole additional artifact owned by the frontend executor.

- Optional server-projected `isHr` defaults to ineligible; eligibility also requires authenticated identity and a nonempty account ID.
- Any current manager can use the HR action. Ordinary interviewer promotion/removal remains gated by the existing owner-only `canGrantAccess` capability.
- The existing RTK `addHrManager` mutation receives the selected server account ID and current owner/interviewer/event credentials. Its established Authorization header and invalidation behavior remain unchanged.
- Target-specific pending requests prevent synchronous duplicate assignment and disable that target's ordinary role mutation. Menus show `Назначить HR`, `Назначаем HR…`, or disabled `HR назначен`; eligible interviewers show an accessible `HR-менеджер` badge. Success/error feedback remains visible outside the menu, and failures permit explicit retry.
- No role is assigned optimistically. Generation and abort guards invalidate pending operations on room, account/token, manager authority, connection/session, and terminal-state changes. Each SSE authority transition invalidates synchronously, including loss and regain batched into one React render. The canonical stored auth token is also checked before submission and completion.
- Current-context 410 invokes a stable hook callback delegating to the existing terminal room-unavailable transition; stale-generation 410 is ignored.

Checks executed by the frontend executor:

| Command | Result | Evidence |
| --- | --- | --- |
| `npm --prefix frontend run typecheck` | PASS, exit 0 | `output/hr-participant-frontend-typecheck.log` |
| `npm --prefix frontend run build` | PASS, exit 0; existing asset/entrypoint size warnings | `output/hr-participant-frontend-build.log` |
| `git diff --check` | PASS | no whitespace errors |

Root owns the prewritten E2E tests, backend implementation, runtime restart, final browser GREEN and regression runs. Their final results are recorded in `verification.md`; this handoff does not claim tests not yet executed by the frontend executor. No dependency, API, schema, persistence, or transport-retry changes were introduced. Review and security gates remain the next owners after root verifies the complete runtime.
