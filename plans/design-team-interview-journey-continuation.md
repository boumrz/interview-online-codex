# Plan: Complete design-team-interview-journey

**Branch**: `main` (dirty working tree; do not reset, clean or discard changes)
**Status**: Historical checkpoint, superseded by `SPEC.md` and `specs/features/`
**Source of truth at the time**: `openspec/changes/design-team-interview-journey/`
**Checkpoint date**: 2026-09-12 Europe/Moscow

## Goal

Deliver the complete accepted business journey in the OpenSpec change, with every executable checkbox backed by RED/GREEN and review evidence, while preserving the existing graphite/neutral palette, blue action/focus accents and teal OWNER semantics. Phone/mobile adaptation is explicitly out of scope.

## Non-negotiable constraints

- Read `AGENTS.md`, `.codex/skills/sdd-openspec/SKILL.md` and `.codex/skills/openspec-apply-change/SKILL.md` before changing code.
- OpenSpec is authoritative: `tasks.md` defines order; `implementation-verification.md` records evidence.
- Before every production task: Prompt/Task Auditor must return `ready`; the accepted failing test must exist and fail for the missing behavior.
- After implementation: Solution Review is mandatory; Security/Reliability is mandatory for auth, invites, realtime, grants, exports and merge; then QA/Test Reviewer/UX Critic/Product Owner as listed.
- Do not modify frozen acceptance assertions to manufacture GREEN.
- Do not change the color palette. Do not add phone/mobile CSS or responsive behavior.
- Preserve all current user/agent edits. Never run destructive git cleanup. Do not commit without user approval.
- Keep local frontend/backend available whenever tests do not require an isolated process.

## Current checkpoint

OpenSpec checkbox inventory at this checkpoint: **45 complete / 119 total / 74 open**. This is a task count, not a reliable percentage of product effort.

Completed and accepted:

- Sections 1–3: specification/prototypes, personal workspace, team creation/switching.
- Section 13: room context panels and continuity.
- Personal task/preset language correction: all six established choices are restored (`Node JS`, `Python`, `Kotlin`, `Java`, `SQL`, `Plain text`); preset create/edit options show `Название — Язык`; cards show total plus grouped counts such as `Node JS · 2, Python · 1`.
- Invitation backend 4.2 and initial UI 4.3b; remediation RED 4.3b1 is accepted by Test Reviewer.
- Chat backend/transport 14.2 is closed: the updated focused suite is 33/33 GREEN, full backend is 211/211 GREEN, and repeated 14.2c Solution/Security reviews approve. Task 14.3 is next for chat.

Paused for handoff when this plan was written:

- **4.3b2** invitation security/retry remediation is implemented and GREEN: policy 9/9, lifecycle 5/5, invitation E2E 14/14, workspace navigation 100/100 assertions, typecheck and both feature builds pass. Solution and Security reviews approve. QA found one reproducible short-height geometry defect; 4.3b3 captured it as behavioral RED without production changes.
- The two former **14.2c Solution Review blockers are fixed test-first** and both repeated reviews approve; aggregate 14.2 is closed.
- All current subagents were stopped or completed before handoff, so a new session may resume without another agent editing the same files.
- A new session must still re-read `tasks.md`, `implementation-verification.md` and `git status` before acting.

Runtime checkpoint:

- Frontend: `http://localhost:5173` (HTTP 200 at handoff).
- Backend: `http://localhost:8080`, PID 53575 in unified exec session `2927`; protected `/api/me/workspaces` returns HTTP 401.
- Backend uses Java 17 and the ignored stable secret in `backend/.run/chat-receipt.secret`; never print or commit that value.

## Immediate continuation queue

### Slice A: Finish invitation review gates (task 4.3c)

**Actor**: invited employee and team OWNER/ADMIN.
**Trigger**: login-return, accept, reissue or revoke after a lost/ambiguous response.
**Observable outcome**: the same intent is safely retried, the one-shot secret is not duplicated/leaked, login reload works, and no phone/palette changes appear.
**Production path**: invitation policy/token helpers → management/join pages → existing invitation API/backend.

1. Preserve the frozen 4.3b2 implementation and GREEN evidence; Solution Reviewer and Security/Reliability already approve.
2. Let Test Reviewer accept the 4.3b3 behavioral RED, then create/audit a narrow production remediation for `BUG_AC03_QA_001_1280x720_TO_640x360_REVOKE_VERTICALLY_CLIPPED`. The test may be changed only if the reviewer finds a test defect; do not add phone/mobile support or change the palette.
3. Make the minimum short-height desktop/tablet layout fix, rerun `npm run e2e:team-invitations`, then complete QA → Test Reviewer/UX Critic 4.3c.

### Slice B: Finish PERSONAL chat continuity (tasks 14.2c → 14.3 → 14.4a–f)

**Actor**: manager in a compatible PERSONAL interview room.
**Trigger**: send/retry/reconnect while chat/history panels change visibility.
**Observable outcome**: no duplicate message after lost ACK, draft/read position/unread remain stable, revoked access is cleared, and reading does not jump.
**Production path**: secured realtime endpoint/storage → credentialed transport → `roomChatDelivery` state seam → room/context panels/activity history.

1. Preserve closed 14.2 and its accepted test/review evidence.
2. Audit/implement 14.3 against the already accepted `roomChatDelivery.test.ts` and AC-12 RED; do not change palette or phone/mobile behavior.
3. Run 14.4a–f sequential reviews and acceptance. TEAM chat remains fenced until tasks 10–12.

### Slice C: Team roster and roles (tasks 5.1 → 5.2 → 5.3)

**Actor**: team OWNER/ADMIN/MEMBER.
**Trigger**: open roster/audit, rename team, change stored role or transfer team ownership.
**Observable outcome**: exact role matrix, one effective OWNER, safe roster/audit projections and recoverable CAS mutations without changing interview grants.
**Production path**: team management HTTP → PostgreSQL membership/team/audit/receipt → workspace management UI.

1. Start only after 4.3c. Task 5.1 is already architecture-resolved and Prompt/Task Auditor=`ready`.
2. Author RED only in the files/commands frozen in task 5.1; obtain Test Reviewer approval.
3. Audit and implement 5.2 backend, then review/security/QA.
4. Audit and implement 5.3 frontend, then AC-03 and UX/QA gates.

## Remaining vertical milestones

Execute every numbered task in `tasks.md`; the list below is navigation, not a replacement for its exact criteria.

1. **Structure (6)** — tracks/vacancies CRUD, archive/restore, scoped counts and directory UI.
2. **Shared task library (7)** — publish/copy tasks into team scope with language/search and no candidate leakage.
3. **Safe shared-task editing (8)** — immutable versions, CAS conflicts, archive/restore and authorship continuity.
4. **Team interview creation/editing (9)** — TEAM scope/grants, atomic room creation, snapshots, track/vacancy context and add-task/edit metadata.
5. **Interview assignments (10)** — independent OWNER/INTERVIEWER/HIRING sources with current epoch/revision and session invalidation.
6. **Leave/remove/rejoin (11)** — revoke only team access, preserve history, require room ownership transfer, never revive old grants.
7. **Emergency suspension/recovery (12)** — permission fence, freeze, blind successor flow, explicit resume/archive; finish release gate 12.6.
8. **Result/history (15)** — stable first completion and read-only archived/frozen TEAM history; depends on 10–12.
9. **Hiring list/export (16)** — HIRING-scoped candidates/results/XLSX with final authorization fence.
10. **Shared presets (17)** — immutable team preset versions and explicit ordered task expansion; depends on 7–9.
11. **Programmes (18–19)** — draft/publish/archive standards, compiled mandatory snapshots and all-entry-point integrity; close programme feature gate 19.5.
12. **Member process projection (20)** — safe DISTINCT process tags and caller-only navigation; depends on 10–12 and 15.
13. **Team merge (21–22)** — reviewed plan, dual approval, atomic commit, canonical redirects/revocation and merge release gate.
14. **Release (23)** — AC-15 composition, full regression, PostgreSQL upgrade/fresh/rollback, D9 measurements, all review gates and final strict validation/archive.

Dependency spine from the accepted plan:

`4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 15 → 16`

`7–9 → 17 → 18 → 19`; `10–12 + 15 → 20`; `5 + 12 + 17–20 → 21`; `16 + 21 → 22`; everything `2–22 → 23`.

Section 14 can continue in parallel with the team spine, but its TEAM authorization variant remains blocked on 10–12.

## Per-task execution loop

For each next open checkbox:

1. Read its exact OpenSpec inputs/dependencies.
2. Prompt/Task Auditor: `ready` or amend OpenSpec and rerun strict validation.
3. RED test first; prove failure is behavioral, not infrastructure.
4. Test Reviewer accepts RED when the task requires it.
5. Minimal production GREEN within explicit file ownership.
6. Focused regression, then proportional full regression.
7. Solution Review; Security/Reliability where applicable; QA/Test/UX/Product gates in task order.
8. Record exact command/result/environment in `implementation-verification.md` and only then check the task.
9. Re-run `npx --yes @fission-ai/openspec@latest validate design-team-interview-journey --strict` and `git diff --check`.

## Runtime recovery commands

Check first:

```bash
curl -I http://127.0.0.1:5173
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/me/workspaces
```

Expected: frontend 200; backend protected smoke 401.

If backend is down, run from `backend/` in a persistent terminal using Java 17 and the ignored existing secret:

```bash
chat_receipt_secret="$(<.run/chat-receipt.secret)"
JAVA_HOME="$(/usr/libexec/java_home -v 17)" \
FEATURE_TEAM_WORKSPACES=true \
CHAT_RECEIPT_HMAC_SECRET="$chat_receipt_secret" \
mvn -q spring-boot:run
```

If frontend is down, run from `frontend/`:

```bash
npm run dev
```

Do not generate a new chat secret on every restart; the current ignored value must remain stable through the receipt horizon.

## New-session starter prompt

Copy this into a new Codex session opened at the repository root:

> Продолжи реализацию OpenSpec change `design-team-interview-journey` по `plans/design-team-interview-journey-continuation.md`. Сначала прочитай `AGENTS.md`, skills `sdd-openspec` и `openspec-apply-change`, затем проверь `git status`, текущие чекбоксы `tasks.md`, последние evidence в `implementation-verification.md` и доступность `5173/8080`. Не сбрасывай dirty worktree и не меняй чужие правки. Сохраняй существующую цветовую палитру; phone/mobile адаптацию не добавляй. 4.3b2 уже GREEN, Solution и Security approve; 4.3b3 зафиксировал behavioral RED `BUG_AC03_QA_001_1280x720_TO_640x360_REVOKE_VERTICALLY_CLIPPED`: keyboard-focused revoke имеет ≥44×44, но уходит ниже effective 640×360. Сначала получи Test Reviewer approve для этого RED, затем оформи и проаудируй узкую production-remediation, исправь только short-height desktop/tablet layout, повтори invitation E2E и закрой QA → Test Reviewer/UX Critic 4.3c. Aggregate 14.2 полностью закрыт; после 4.3c выбери 5.1 или 14.3. Для каждого production изменения соблюдай OpenSpec → audit → RED → GREEN → review/QA, отмечай checkbox только по evidence и оставляй проект запущенным для локального тестирования.

## Completion condition

The change is complete only when every applicable checkbox in sections 2–23 is closed with evidence, section 23 release gates pass, strict validation is GREEN, the accepted specs match actual behavior, and the running local project is available for user testing. Delete this plan only then.
