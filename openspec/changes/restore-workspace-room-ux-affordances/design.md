## Context

`WorkspaceSwitcher` is currently a visually subtle Mantine button whose label does
not clearly communicate an available choice. The personal/team headers use a flex
navigation that permits wrapping; the six-link team navigation therefore creates a
second row under constrained width. `RoomContextPanels` models `editor` as both a
surface and a selectable tab and fixes work/overview grid fractions in CSS, so the
new context surfaces cannot be resized. The older `useOwnerPanelResize` remains a
separate legacy split in `RoomPage` and must stay intact.

This is a frontend-only remediation layered on the implemented UI parts of
`design-team-interview-journey`. The authoritative access, cache scope, room
transport, SSE, POST relay and Yjs contracts remain unchanged.

## Goals / Non-Goals

**Goals:**

- Make workspace selection discoverable and keyboard-complete without changing its
  data or access semantics.
- Keep the workspace header's primary navigation one visual row, using a named
  overflow affordance rather than visual wrapping.
- Make the editor a persistent room base surface instead of a redundant selectable
  tab.
- Restore adjustable room split geometry with reliable pointer and keyboard
  behavior, viewport/zoom clamping and no room-side effects.

**Non-Goals:**

- No changes to phone/mobile layouts, workspace routes, API endpoints, feature
  flags, roles, authorization, RTK cache keys, analytics, realtime transport or
  Yjs collaboration.
- No redesign of the room's Work/Focus/Overview thresholds or existing minimum
  surface dimensions; this change operates inside those rules.
- No persistence of panel dimensions through full reloads, across rooms, accounts,
  tabs or devices. This bounds a purely local layout preference and avoids an
  unrequested storage/migration contract.
- No removal of the editor region, CodeMirror DOM, its label, or legacy owner-panel
  resizer.

## Decisions

### 1. Use an explicit labelled trigger and selected-state dialog for workspace choice

The switcher trigger will retain native button behavior but add a visible action
cue (for example, a change verb and disclosure indicator), an explicit expanded
state, and a stable dialog relationship. The selected workspace list item will use
the dialog's selected-state semantics; inaccessible/stale workspace names will
continue to be rejected by the detail/list authorization boundary already present.
The team name remains text, never an icon-only identity.

This keeps existing lazy list loading, abort/generation protection and navigation
paths. Replacing the switcher with an always-open select was rejected: it would
increase header pressure and complicate loading/error/retry states. Changing the
workspace from a hover-only menu was rejected because touch, keyboard and focus
return would be less reliable.

### 2. Keep header navigation in one flex row and overflow actual links, not their text

The workspace header gets a non-wrapping primary-nav container. A measured
available-width layout (for example, `ResizeObserver` plus link measurements) will
move complete low-priority links into a labelled `Ещё` menu when needed; it will not
shrink labels into unclear abbreviations or make the full page scroll horizontally.
The active route remains either a direct link or is reflected by the overflow
trigger and selected menu item. The priority/order are the existing source order;
only presentation changes.

CSS-only nowrap plus clipping was rejected because it would make valid sections
unreachable. A second navigation row was rejected because it is the reported defect.
A horizontal scroller was rejected because it hides actions, produces ambiguous
keyboard behavior and conflicts with the no-page-overflow requirement. The menu
implementation must use Mantine components already installed; no dependency is
introduced.

### 3. Treat editor as the persistent base surface rather than a tab target

`editor` remains in the internal room surface model and preserves its region label,
but is removed from the array that renders selectable auxiliary controls. Work and
Overview always render it. When Focus displays only the editor, the auxiliary
`tablist` is not rendered at all and the editor region has its direct accessible
name `Редактор`, rather than an `aria-labelledby` reference to a nonexistent tab.
When Focus displays an auxiliary surface, the tablist contains only the five
auxiliary controls. The existing Work-mode action is the recovery path from an
auxiliary-only Focus view; it restores the editor alongside the last chosen
auxiliary surface. Roving tabindex/arrow logic derives its indexes from the
auxiliary array, avoiding focus references to a removed tab.

Removing the editor from the surface model was rejected because it would risk
unmounting CodeMirror/Yjs or duplicating layout state. Merely hiding its text with
CSS was rejected because an unnamed/hidden selectable element would leave broken
keyboard and screen-reader semantics.

### 4. Hold room split geometry in local component state and expose semantic separators

`RoomContextPanels` will own local CSS-pixel split values for the currently
renderable layouts. CSS custom properties feed the Work auxiliary-column width,
the Overview right-context-column width and the Overview lower-chat-row height. A
pure clamp helper receives current usable geometry and the existing surface
minimums, so every render and ResizeObserver update can keep values valid.

The constants are fixed for this remediation: grid gap `10px`, Work editor minimum
`480px`, Work auxiliary minimum `320px`, Overview steps minimum `240px`, Overview
editor minimum `480px`, Overview right context minimum `320px`, Overview activity
minimum `240px`, Overview chat minimum `320px`, and keyboard step `16px`. Thus the
feasible bounds are: Work auxiliary `[320, surfaceWidth - 480 - 10]`; Overview
right context `[320, surfaceWidth - 240 - 480 - 20]`; and, only when both chat and
activity are visible, lower-chat height `[320, surfaceHeight - 240 - 10]`. Values
are clamped to an integer CSS pixel before being exposed through `aria-valuenow`.
If a maximum is below its minimum, that separator is not rendered and the existing
automatic Focus/Work/Overview eligibility rules decide the safe layout.

Pointer drag operates from a captured start position and applies the same bounds.
For vertical separators ArrowRight increases the right-hand context width and
ArrowLeft decreases it; for the horizontal chat/activity separator ArrowDown
increases the lower chat height and ArrowUp decreases it. Home selects the minimum
and End the maximum. Every Arrow change is exactly `16px` before clamping.

Each rendered divider is a focusable `role=separator` with orientation, label and
ARIA numeric range/value. It exists only when the matching pair is co-visible and
has feasible room. Dimension state survives Work/Overview/Focus transitions and
viewport changes in the mounted room component, but disappears with an unmount.
No localStorage/sessionStorage, Redux, query cache, HTTP, relay or Yjs write is
allowed for geometry changes.

Using native CSS `resize` was rejected: it has incomplete keyboard semantics and
cannot reliably enforce coupled panel minimums. Reusing `useOwnerPanelResize`
directly was rejected because it models a different, legacy left-owner split with
different min/max geometry and route ownership. A server-stored layout was rejected
as private UI preference that would expand authorization, migration and realtime
scope without a user request.

### 5. Test the user path first and isolate deterministic geometry arithmetic

Before implementation, extend three existing E2E files with named scenarios:
feature-on switcher affordance/focus return and stale-list preservation in
`e2e-team-workspaces.mjs`; one-row/overflow navigation in
`e2e-workspace-navigation.mjs`; and editor-tab absence, Focus editor-only semantics,
separator pointer/keyboard behavior, clamp after resize/zoom, and a
network/SSE/Yjs no-side-effect assertion in `e2e-room-context-panels.mjs`. Record
their initial RED status, command, runtime mode and assertion marker in
`implementation-verification.md`. Add a focused unit test for the pure layout
clamp/keyboard CSS-pixel behavior; route reload/unmount reset is browser-visible
and remains an E2E assertion. This is the documented unit exception because
browser pixel drag timing is non-deterministic.

The E2E additions run against real routes, server fixtures and room collaboration
to prove that no user-visible or realtime regression was hidden by a component-only
test. AC-01 continues as an unchanged workspace regression. The AC-11 suite is
intentionally updated: it must now assert five auxiliary tabs, an editor region
named directly in editor-only Focus, and the new resizers while retaining its
existing mounted-editor/Yjs, draft, selection, scroll, geometry and role assertions.
AC-12 is not run or claimed by this change because its parent production work 14.3
is still unfinished.

## Risks / Trade-offs

- [A dynamic overflow decision can flicker while fonts or header measurements settle] →
  calculate after layout, batch ResizeObserver updates, and test after stable
  animation frames; the conservative state keeps all links reachable in `Ещё`.
- [A long current team name can consume header width] → allow only the label itself
  to truncate with a full accessible name; do not truncate or wrap navigation
  actions.
- [Split constraints can conflict with short height or high zoom] → clamp against
  actual usable geometry and hide unavailable dividers before a surface overlaps;
  reuse the existing automatic Work → Focus downgrade rules.
- [Pointer drag can select text or leave document listeners active] → capture or
  register cleanup on pointer end/cancel and unmount; use keyboard separators as an
  equivalent accessible path.
- [A room geometry update might accidentally trigger existing editor effects] →
  keep split state outside editor content state and assert no mutation, relay,
  Yjs update, reconnect or published-step change in E2E.
- [Concurrent edits in the shared worktree] → implementation owners modify only
  the scoped frontend components/styles/tests after checking current files; no
  reset/revert of unrelated changes.

## Migration Plan

1. Keep `FEATURE_TEAM_WORKSPACES` at its existing state; this change adds no
   enablement authority and is reviewed alongside the parent change's gate 12.6.
   The configuration contract remains exact-string `true`, default `false`; changing
   it requires a fresh backend process and a fresh Rspack process.
2. Add and run the named E2E/unit RED tests before production edits, saving the
   command output and failure reason in
   `openspec/changes/restore-workspace-room-ux-affordances/implementation-verification.md`.
   Run the following exact fresh-process matrix from the repository root, always
   stopping the prior pair before the next pair. A test-only stable secret avoids
   the local launcher precondition without changing configuration files:

   ```sh
   FEATURE_TEAM_WORKSPACES=true CHAT_RECEIPT_HMAC_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8 ./scripts/dev-up.sh
   # Separate terminal after both health checks:
   (cd frontend && npm run e2e:team-workspaces && npm run e2e:workspace-navigation)
   ./scripts/dev-up.sh --stop

   env -u FEATURE_TEAM_WORKSPACES CHAT_RECEIPT_HMAC_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8 ./scripts/dev-up.sh
   # Separate terminal after both health checks:
   (cd frontend && npm run e2e:workspace-navigation)
   ./scripts/dev-up.sh --stop
   ```

   The feature-on process pair is evidence only; the feature-off process pair
   proves the default-off contract. Neither run changes config files or enables
   the release flag.
3. Deliver the switcher/header and room layout slices independently, running their
   targeted E2E tests after each slice and then AC-01 plus the updated AC-11 suite,
   frontend typecheck and build. Do not claim AC-12 as a regression result.
4. Roll back by reverting only this change's frontend commits. There are no schema,
   API, cache or persisted-preference migrations, and default room geometry remains
   available if the local resizer is removed.
