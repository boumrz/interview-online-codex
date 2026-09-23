# Designer notes · 1.6e programmes

## Intent

The interface uses an **operational dossier** aesthetic: immutable programme snapshots read like stamped records; drafts use warm paper; locked foundations use green ledger blocks; dangerous lifecycle actions use explicit red language. Version, provenance and effect are repeated at the decision point rather than hidden in tooltips.

## User flows

### Track programme — first publication

1. ADMIN or team OWNER opens a process with `NONE`.
2. «Настроить программу» creates the first draft and immediately changes the creation semantics: interviews are blocked until publication or allowed discard.
3. The manager adds task/preset sources, sees expanded ordered tasks and source versions.
4. Duplicate source task or stale source prevents publication without deleting draft work.
5. Publish confirmation repeats the full effect: immutable snapshot, required order, future interviews only.
6. Successful publish exposes the current version, source ledger and digest.

### Vacancy inheritance and explicit base update

1. A vacancy without its own configuration reads the current track programme and labels it as inherited.
2. Once a vacancy programme exists, the pinned base and vacancy extras form one mandatory sequence.
3. A later track publication presents an update notice; the current vacancy version remains on the previous base.
4. OWNER/ADMIN explicitly applies the new base to a vacancy draft, reviews the whole structure and publishes separately.

### Interview creation and room continuity

1. The creator selects the process; the programme resolver shows exact source, version and mandatory sequence.
2. Extras can be added only after the foundation and cannot repeat a sourceTaskId.
3. A resolver conflict retains candidate/title/team fields and disables creation until the new version is reviewed.
4. The created room displays the pinned programme version. Mandatory structure and context are locked, while the solution editor, notes and normal room operations remain usable.
5. A later programme version is labelled future-only and does not rewrite the room.

## Component behaviour

- `role-chip`: always-visible actor context; MEMBER has read-only current-state visibility, ADMIN/team OWNER get lifecycle actions, room creator gets create/room actions only.
- `pill.version` / source ledger: version, digest, source task/preset version and inheritance origin remain visible in success views.
- `foundation`: non-editable visual contract. Locked rows never render move/remove actions.
- `extras`: follows foundation and owns its own remove/reorder actions.
- `notice.error`: blocking state with concrete recovery; it is never styled as success.
- native `dialog`: archive, restore, first-draft discard, publish and create confirmations; initial focus is inside and cancel restores the trigger.
- `sticky-actions`: keeps the primary action reachable where useful; degrades to normal document flow on phones so it cannot cover the last field.

## State matrix

| State | Meaning | Primary behaviour |
|---|---|---|
| Loading | Resolver/configuration pending | Skeleton + `aria-busy`; no inferred programme |
| Empty list | Process filter returns no results | Separate from programme `NONE`; reset filter |
| NONE | Configuration never existed or allowed first draft was discarded | Free task choice permitted during creation |
| First draft only | Configuration exists, no published version | Create blocked; publish or authorized discard |
| Published | Immutable current snapshot | New interviews pin it; MEMBER reads |
| Published + draft | v3 current, v4 editable | v3 continues; save/publish v4 separately |
| Duplicate | Same sourceTaskId appears twice | Addressed error, publish disabled, draft retained |
| Stale | Source version changed | Addressed 409 semantics, no automatic latest |
| Vacancy inherited | No vacancy configuration | Current allowed track version is shown/pinned |
| Vacancy update available | Vacancy pins old base | Explicitly apply to draft, then publish |
| Archived | Programme explicitly stopped | Create blocked; no free or parent fallback |
| Restored | Authorized restore confirmed | Version becomes usable for new interviews again |
| Resolver conflict | Effective version changed during form | Fields retained; explicit re-review required |
| Revoked | Membership/assignment no longer grants access | Programme/candidate/task details removed |
| Error | Read/resolve failed | No fake empty state; retry |

## Scope boundary

This prototype does not prove server-side permissions, resolver token validation, deduplication, persistence, snapshot immutability, atomic creation or legacy mutation blocking. Those remain AC-18/AC-19 and INT-08 responsibilities.

