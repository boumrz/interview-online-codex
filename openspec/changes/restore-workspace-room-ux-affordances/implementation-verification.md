# Implementation verification

## RED — 2026-09-19, freshly started feature-on runtime

The previously reported local processes had exited before this run (`curl` to both
`:8080` and `:5173` returned `000`). The documented launcher was not modified.
Because its health endpoint is not available in this checkout, a fresh equivalent
test-only pair was started directly:

```sh
# backend/
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
DB_URL=jdbc:postgresql://localhost:5432/interview_online \
DB_USER=interview DB_PASSWORD=interview \
FEATURE_TEAM_WORKSPACES=true \
CHAT_RECEIPT_HMAC_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8 \
mvn -q spring-boot:run

# frontend/
FEATURE_TEAM_WORKSPACES=true npm run dev
```

The backend started with a new PID and Tomcat on `8080`; Rspack started freshly on
`5173`. This does not change a configuration file or the release-default flag.

| Command | Mode | RED marker observed |
| --- | --- | --- |
| `(cd frontend && node --experimental-strip-types --test tests/unit/roomContextPanelLayout.test.ts)` | n/a | `ERR_MODULE_NOT_FOUND` for the deliberately not-yet-created `roomContextPanelLayout.ts` helper |
| `(cd frontend && npm run e2e:team-workspaces)` | feature on | `SWITCHER_ACTION_CUE_OR_FULL_NAME_MISSING`; actual name was only `Рабочее пространство: Личное пространство` |
| `(cd frontend && npm run e2e:workspace-navigation)` | feature on | `WORKSPACE_NAV_NAMED_OVERFLOW_CONTROL_MISSING` under constrained 768px navigation geometry |
| `(cd frontend && npm run e2e:room-context-panels)` | feature on | `AC11_AUXILIARY_SURFACE_COUNT_WRONG` (expected 5, actual 6) and `FOCUS_EDITOR_ONLY_TABLIST_REMAINS` |

The broad workspace suites also expose pre-existing/non-target fixture instability
while the new markers are reached (for example a team-create timeout and a single
existing create-form palette assertion). They do not alter the recorded RED cause
for this change. The feature-off process matrix remains pending and will be run
after the implementation and feature-on GREEN pass.

## GREEN — 2026-09-19

The following assertions were rerun directly by name after the smallest local UI
implementation. Direct Node execution avoids the package-script argument forwarding
issue, where the test-name pattern was ignored and a broad fixture suite started.

| Command | Fresh runtime mode | Result |
| --- | --- | --- |
| `(cd frontend && node --test --test-name-pattern='workspace trigger states' tests/e2e/teams/e2e-team-workspaces.mjs)` | feature on | PASS — explicit current-context/change cue, dialog state, selected identity and focus return |
| `(cd frontend && node --test --test-name-pattern='primary navigation keeps one row' tests/e2e/teams/e2e-workspace-navigation.mjs)` | feature on | PASS — one non-wrapping row, named overflow menu, keyboard open/close and complete links |
| `(cd frontend && E2E_EXPECT_TEAM_WORKSPACES=false node --test --test-name-pattern='primary navigation keeps one row' tests/e2e/teams/e2e-workspace-navigation.mjs)` | feature off | PASS — feature-off matrix preserves the same one-row overflow geometry |
| `(cd frontend && node --test --test-name-pattern='editor is a direct Focus region' tests/e2e/interview/e2e-room-context-panels.mjs)` | feature on | PASS — Focus has named `Редактор` region and no auxiliary tablist/orphan editor tab |
| `(cd frontend && node --test --test-name-pattern='keyboard-only navigation' tests/e2e/interview/e2e-room-context-panels.mjs)` | feature on | PASS — five auxiliary tabs keep roving keyboard navigation |
| `(cd frontend && node --test --test-name-pattern='persistent room status stays' tests/e2e/interview/e2e-room-context-panels.mjs)` | feature on | PASS — candidate/status coverage remains available with the editor-focused presentation |
| `(cd frontend && node --test --test-name-pattern='usable container geometry' tests/e2e/interview/e2e-room-context-panels.mjs)` | feature on | PASS — Work/Overview pointer and keyboard separators, feasibility, resize/route-reset and zero room side effects |
| `(cd frontend && node --experimental-strip-types --test tests/unit/roomContextPanelLayout.test.ts)` | n/a | PASS — 3 tests: dynamic bounds, clamp, 16px arrows/Home/End |
| `(cd frontend && npm run typecheck)` | n/a | PASS |
| `(cd frontend && npm run build)` | n/a | PASS (only existing Rspack asset-size warnings) |

The feature-off pair was freshly restarted with the same command above but without
`FEATURE_TEAM_WORKSPACES=true`; no configuration file or release-default flag was
modified. It was restarted feature-on again after this check so the requested local
workspace mode stays testable.

### Targeted mutation check for the new pure helper

No Stryker configuration/dependency exists in this repository, so the focused pure
helper was manually mutated and its unit suite was run after each mutation:

| Mutation | Expected kill | Observed |
| --- | --- | --- |
| Work maximum `surfaceWidth - 480` → `surfaceWidth + 480` | bounds calculation | FAIL (`1470`, expected `510`) |
| Vertical `ArrowLeft` decrement → increment | directional keyboard reducer | FAIL (`368`, expected `336`) |
| feasible comparison `<` → `<=` | exact min/max feasibility edge | FAIL (equality incorrectly returned `null`) |

Each mutation was restored before the recorded GREEN run.

### Scope-limited baseline note

The full sequential `e2e-room-context-panels` suite was intentionally not recorded
as GREEN: after its initial updated checks passed, its shared fixture accumulated
long-lived SSE/browser sessions and subsequent CodeMirror fixture setup timed out.
The process was stopped safely; this is not a failing target assertion. The targeted
new acceptance assertions and the non-conflicting AC-11 baseline checks above pass.
This remaining broad-fixture instability needs follow-up outside this local-only UX
change and must not be treated as AC-12 completion.

## Review-repair RED → GREEN — 2026-09-19

Solution/UX review identified seven gaps within the same frontend-only scope. New
named browser assertions were added before repair code and executed serially against
the already fresh, feature-on local pair. The release flag, API/authentication,
room transport, RTK cache, storage and Yjs contracts were not changed.

| RED command | Observed marker |
| --- | --- |
| `(cd frontend && node --test --test-name-pattern='Focus leaves no unresolved room surface ARIA references' tests/e2e/interview/e2e-room-context-panels.mjs)` | `FOCUS_ROOM_ARIA_REFERENCE_UNRESOLVED` — five hidden auxiliary regions referenced missing Focus tab IDs |
| `(cd frontend && node --test --test-name-pattern='splitters follow pointer direction and remain inside content-box bounds' tests/e2e/interview/e2e-room-context-panels.mjs)` | `WORK_CONTEXT_POINTER_DIRECTION_INVERTED` — drag left from the Work minimum stayed clamped instead of expanding the right panel |
| `(cd frontend && node --test --test-name-pattern='room layout values reset when only the invite code changes' tests/e2e/interview/e2e-room-context-panels.mjs)` | `ROOM_LAYOUT_PERSISTED_TO_DIFFERENT_INVITE_CODE` — Work value remained `950` after client-side route transition |
| `(cd frontend && node --test --test-name-pattern='workspace trigger states the change action' tests/e2e/teams/e2e-team-workspaces.mjs)` | `SWITCHER_VISUAL_OPEN_CUE_MISSING` |
| `(cd frontend && node --test --test-name-pattern='long Russian team header keeps every navigation section reachable' tests/e2e/teams/e2e-team-workspaces.mjs)` | `TEAM_HEADER_SWITCHER_LABEL_MISSING:100` |

The repair computes split bounds from the grid content box (including responsive
padding), moves right/bottom-anchored handles in the inverse pointer direction,
clears room-local geometry when the `inviteCode` key changes, and preserves modes
until that key changes. Focus-hidden auxiliary regions now have direct labels rather
than dangling tab references. The switcher and choices have 44px minimum targets,
an observable `Сменить`/`Свернуть` cue, and a visually ellipsized label while its
full accessible name remains intact. The team header has constrained/truncatable
labels and gives the one-row navigation a full second grid track at narrow
zoom-equivalent widths, so all links remain reachable through `Ещё` rather than
being clipped.

| GREEN command | Result |
| --- | --- |
| `(cd frontend && node --test --test-name-pattern='Focus leaves no unresolved room surface ARIA references|splitters follow pointer direction and remain inside content-box bounds|room layout values reset when only the invite code changes' tests/e2e/interview/e2e-room-context-panels.mjs)` | PASS — 3/3; ARIA references resolve in both Focus and Work, pointer assertions verify direction and actual resized panel dimension, Home/End content-box minima/no overflow, and client-side invite-code reset |
| `(cd frontend && node --test --test-name-pattern='workspace trigger states the change action|long Russian team header keeps every navigation section reachable' tests/e2e/teams/e2e-team-workspaces.mjs)` | PASS — 2/2; real 768px team route at 100/125/150/200% zoom-equivalent keeps the full accessible team name and all six sections reachable |
| `(cd frontend && node --test --test-name-pattern='editor is a direct Focus region|keyboard-only navigation|usable container geometry' tests/e2e/interview/e2e-room-context-panels.mjs)` | PASS — 3/3 updated AC-11 baseline checks |
| `(cd frontend && node --test --test-name-pattern='primary navigation keeps one row' tests/e2e/teams/e2e-workspace-navigation.mjs)` | PASS |
| `(cd frontend && node --experimental-strip-types --test tests/unit/roomContextPanelLayout.test.ts && npm run typecheck && npm run build)` | PASS; build has only existing Rspack asset-size warnings |
| `(npx --yes @fission-ai/openspec@latest validate restore-workspace-room-ux-affordances --strict && git diff --check)` | PASS |

As a focused mutation check for the review repair, the separator's inverse pointer
calculation was temporarily changed from `startValue - delta` back to
`startValue + delta`. The named pointer E2E failed with
`WORK_CONTEXT_POINTER_DIRECTION_INVERTED`; the mutation was restored and the same
test passed again.

The scope-limited broad-room-fixture note above still applies. Task 4.1 remains
unchecked pending either a stable full suite or a product-owner-approved
proportionate exception.

## Integration rerun — 2026-09-19, existing feature-on local runtime

The existing user-testable local pair was deliberately preserved: frontend stayed
on `http://localhost:5173` and backend stayed on `http://localhost:8080` with
team workspaces enabled for local review. No process was restarted, no
configuration file or release-default flag was modified, and no production source
or test assertion changed in this rerun.

### Reproduced targeted GREEN evidence

| Command | Result |
| --- | --- |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api node --test --test-name-pattern='remediation: workspace trigger states|remediation: long Russian team header' tests/e2e/teams/e2e-team-workspaces.mjs)` | PASS — 2/2: explicit workspace action/selection/focus return and long-name one-row reachability at 768px/zoom equivalents. |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api node --test --test-name-pattern='remediation: primary navigation keeps one row' tests/e2e/teams/e2e-workspace-navigation.mjs)` | PASS — 1/1: named keyboard overflow preserves every primary link in one row. |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api node --test --test-name-pattern='remediation: editor is a direct Focus region|remediation: Focus leaves no unresolved room surface ARIA references|remediation: splitters follow pointer direction|remediation: room layout values reset' tests/e2e/interview/e2e-room-context-panels.mjs)` | PASS — 4/4: editor-only Focus semantics, five auxiliary surfaces, pointer direction/content bounds, keyboard geometry/no side effects and invite-code reset. |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api node --test --test-name-pattern='workspace preserves the established product palette|owner role badge uses established teal mapping|personal interview list combines owner and candidate memberships|empty personal interview list stays honest|personal HR opt-in exposes candidates|personal library keeps tasks and presets|profile is a standalone account settings route|ordinary and anonymous users retain service-route restrictions' tests/e2e/teams/e2e-workspace-navigation.mjs)` | PASS — 13 assertions: non-conflicting AC-01 personal navigation, palette, roles, lists, library/profile and service-route baseline. |

The previous feature-off one-row matrix remains recorded in the earlier GREEN
section. It was not restarted for this rerun because the user requested the
feature-on local mode to remain available for manual testing.

### Broad-suite outcome — not accepted as GREEN

| Command | Observed outcome | Classification |
| --- | --- | --- |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm run e2e:team-workspaces)` | The two remediation scenarios passed before `AC-02: creates Atlas and Orbit once per intent and keeps same-named teams distinct` timed out waiting for a create-team request; the following retry case timed out waiting for its expected alert. After those failures the test runner retained its browser process and was stopped gracefully. The local frontend remained HTTP 200. | Unrelated/shared AC-02 create-flow test failure; no remediation assertion failed. Separate triage required. |
| `(cd frontend && E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm run e2e:workspace-navigation)` | The palette and first eight personal scenarios passed. `failed personal interview creation keeps scope and draft and creates no room` then observed two matching requests where its baseline expects one; the same `2 !== 1` assertion repeated across the create-form viewport/zoom matrix. | Existing AC-01 create-form baseline is not green in this runtime. Separate triage required; no conclusion about the one-row navigation remediation follows from it. |

Task 4.1 remains unchecked. The targeted UX criteria and non-conflicting AC-01
checks are current GREEN evidence, but the full workspace and room release gate
cannot be claimed until the two broad-suite failures and the known accumulated
room-session instability are independently resolved or a proportionate exception
is explicitly accepted.

## Active-overflow remediation and review rerun — 2026-09-19

The final independent reviews identified and repaired one accessibility/UX gap:
when the active route was moved into `Ещё`, the prior trigger was generic and the
active menu item lacked a distinct visual state. The remediation was deliberately
limited to the two workspace headers, their CSS modules and a browser acceptance
test. It did not change routes, source order, permissions, APIs, feature flags,
RTK cache, SSE/POST, Yjs or room state.

| Phase | Evidence |
| --- | --- |
| Test-first RED | A fresh isolated feature-on pair on `:18080/:15173` ran the new personal Candidates and team Members scenarios. Both failed with `WORKSPACE_NAV_ACTIVE_OVERFLOW_TRIGGER_FULL_LABEL_MISSING` before production changes. The user-facing `:8080/:5173` pair was not stopped. |
| Feature-on GREEN | The same isolated pair passed 2/2 after the small header/CSS remediation. At the 200%-equivalent viewport, the visible and accessible triggers read exactly `Ещё: Кандидаты` and `Ещё: Участники`; the sole current overflow item has `aria-current="page"`, a distinct computed foreground/background pair, and Escape returns focus to the unchanged-route trigger. |
| Feature-off GREEN | A separate fresh feature-off pair on `:18081/:15174` passed the personal Candidates scenario with `E2E_EXPECT_TEAM_WORKSPACES=false`, including the required absence of the workspace switcher. Both isolated pairs were stopped after the run; the manual local frontend remained HTTP 200. |
| Static/spec checks | `npm run typecheck`, `npm run build`, `openspec validate restore-workspace-room-ux-affordances --strict` and `git diff --check` all passed; build emitted only the existing asset-size warnings. |

### Task 4.3 independent review outcome

The solution reviewer approved the engineering rerun: the two active-overflow E2E
cases passed, the exact current labels, sole `aria-current`, computed visual
treatment, Escape focus return and route/order/permission/flag boundaries were
verified, and no API/cache/SSE/Yjs contract changed. The UX critic independently
approved the same personal/team scenarios and the regression checks for the
workspace switcher, editor-only Focus surface and local resizers.

Task 4.3 is complete. Task 4.1 remains the unresolved broad release-evidence
gate, and task 4.4 remains open until that gate has a truthful green result or an
explicitly accepted proportionate exception.

## Active-overflow current-state RED → GREEN — 2026-09-19

The user-facing local feature-on pair on `:8080`/`:5173` was kept running for
manual testing throughout this task. To retain the required fresh-process
evidence without stopping it, the documented matrix was reproduced on isolated
ports with the same code and environment values: feature-on on `:18080`/`:15173`
and default feature-off on `:18081`/`:15174`. The isolated pairs were stopped by
their exact alternate ports after each run; no configuration file or release flag
was changed.

| Phase | Command | Mode | Result |
| --- | --- | --- | --- |
| RED | `(cd frontend && E2E_BASE_URL=http://localhost:15173 E2E_API_URL=http://localhost:18080/api node --test --test-name-pattern='active personal candidates section in overflow\|active team members section in overflow' tests/e2e/teams/e2e-workspace-navigation.mjs)` | fresh feature on | Expected failure in both routes: `WORKSPACE_NAV_ACTIVE_OVERFLOW_TRIGGER_FULL_LABEL_MISSING`; the old trigger was only `Ещё разделы`. |
| GREEN | `(cd frontend && E2E_BASE_URL=http://localhost:15173 E2E_API_URL=http://localhost:18080/api node --test --test-name-pattern='active personal candidates section in overflow\|active team members section in overflow' tests/e2e/teams/e2e-workspace-navigation.mjs)` | fresh feature on | PASS — both permitted non-first active routes expose the exact complete visible/accessible labels `Ещё: Кандидаты` and `Ещё: Участники`; their matching menu item is the only `aria-current="page"`, has a distinct computed color/background pair, and Escape returns focus to the unchanged-route trigger. The team fixture was created only in its case by authenticated `POST /teams` with `fixtures.hr`, asserted `201`, and used as that owner. |
| GREEN | `(cd frontend && E2E_BASE_URL=http://localhost:15174 E2E_API_URL=http://localhost:18081/api E2E_EXPECT_TEAM_WORKSPACES=false node --test --test-name-pattern='active personal candidates section in overflow' tests/e2e/teams/e2e-workspace-navigation.mjs)` | fresh feature off | PASS — the personal active-overflow label/current item/style/Escape behavior remains intact and no workspace switcher is rendered. |
| Static verification | `(cd frontend && npm run typecheck)` | n/a | PASS. |
| Static verification | `(cd frontend && npm run build)` | n/a | PASS — only the pre-existing Rspack asset-size warnings were emitted. |

The E2E case opens each route at `768x1024`, applies the suite's 200%
zoom-equivalent `384x512` viewport, and uses a task-local `300px` navigation
constraint so the active route itself is in `Ещё` rather than merely another link.
The change is intentionally limited to the two workspace page navigation
components and their CSS modules: routes, source order, permissions, API calls,
the exact-string feature flag, and switcher implementation remain unchanged.

## AC-01 create-form scope correction and fresh feature-on GREEN — 2026-09-20

The broad workspace-navigation gate previously failed because the legacy AC-01
create-form assertions globally required exactly one visible
«Личное пространство» text node. After the workspace switcher remediation, that
text legitimately appears both as the personal workspace brand/context and as
part of the switcher affordance. The test was corrected to preserve the product
meaning without conflicting with the switcher: it now requires exactly one
canonical main landmark named «Личное пространство: Создать интервью» for
create-form scope and draft preservation.

Fresh isolated feature-on rerun:

```sh
E2E_API_URL=http://127.0.0.1:18230/api \
E2E_BASE_URL=http://127.0.0.1:15230 \
E2E_EXPECT_TEAM_WORKSPACES=true \
npm run e2e:workspace-navigation
```

The run used isolated `127.0.0.1:18230` and `127.0.0.1:15230` services with
disposable schema `workspace_nav_e2e_5c97cc9457ef46e0952044af002f719b`. It
passed `103/103` tests, including the failed-create retry, all create-form
viewport/zoom cells, one-row overflow navigation, active personal/team overflow
current-state cases and HR candidates geometry. Its backend/frontend processes
were stopped and the schema was dropped afterward; the user's `:8080/:5173`
runtime was not touched.

Fresh isolated feature-off targeted rerun:

```sh
E2E_API_URL=http://127.0.0.1:18231/api \
E2E_BASE_URL=http://127.0.0.1:15231 \
E2E_EXPECT_TEAM_WORKSPACES=false \
node --test --test-name-pattern="remediation: primary navigation keeps one row|remediation: active personal candidates section in overflow" \
  tests/e2e/teams/e2e-workspace-navigation.mjs
```

The primary-navigation feature-off regression passed. The paired personal active
overflow case timed out once at its existing `30s` per-test limit, so it was
rerun by itself on another isolated feature-off pair:

```sh
E2E_API_URL=http://127.0.0.1:18232/api \
E2E_BASE_URL=http://127.0.0.1:15232 \
E2E_EXPECT_TEAM_WORKSPACES=false \
node --test --test-name-pattern="remediation: active personal candidates section in overflow" \
  tests/e2e/teams/e2e-workspace-navigation.mjs
```

That rerun passed `1/1`, including complete `Ещё: Кандидаты` trigger/current
menu semantics, Escape focus return and absence of the workspace switcher. Both
disposable schemas,
`workspace_nav_e2e_ac6541b0a5c3408ca3dee5bbc053ed2e` and
`workspace_nav_e2e_02dac09faac44d738afd264222688554`, were dropped afterward.
