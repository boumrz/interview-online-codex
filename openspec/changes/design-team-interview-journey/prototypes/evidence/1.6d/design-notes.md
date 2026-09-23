# Designer notes — 1.6d

## Direction

The candidates area is treated as an interview dossier, not an ATS. Warm paper, dark blue navigation and precise cyan/orange markers keep it visually related to the existing 1.6a/1.6b prototype while making each interview record feel discrete. The member directory deliberately uses quieter cards: process badges are contextual navigation, not editable roles.

## Interaction rules

1. `HIRING` opens `Кандидаты` from team navigation whether personal `isHr` is on or off. The personal setting is shown only as an explanatory chip; it never drives team visibility.
2. `MEMBER`, `ADMIN`, team `OWNER` and assigned `INTERVIEWER` do not receive a Candidates navigation item. A direct route renders a safe denial with no candidate rows.
3. An assigned `INTERVIEWER` may open the same result from `Интервью`; the breadcrumb/back action reflects that source. An admin or team owner without a room grant cannot open it.
4. Applying list filters updates one canonical filter model. The list scope and export dialog expose the same machine-readable signature. The selected row never changes that scope.
5. Export progress distinguishes ready, forming, download initiated, empty workbook, retryable error, size limit, temporary busy and revoked. A forming response cannot be presented as downloaded.
6. On revoke, candidate/result nodes are removed rather than visually covered. An already-open export dialog changes to the revoked state and drops its filter signature.
7. A member process badge serializes only `{trackId, trackName, vacancyId?, vacancyName?}`. Its only action is labelled `Мои интервью: …`; the URL contains process filters and the caller actor, never the observed member identity.
8. A failed process projection leaves the safe roster visible but replaces every old process list with an error and retry. It is not rendered as `Нет процессов`.
9. Member management remains in a separate named menu. Process badges are links, never checkboxes or assignment controls.

## State matrix

| Surface | Loading | Empty | Filter-empty | Error | Revoked | Success |
|---|---|---|---|---|---|---|
| Candidates | permission/data skeleton | no current HIRING assignments | scope and filters retained, zero matching rows | retry without claiming stale data is fresh | sensitive DOM removed, safe route to own interviews | interview-level rows plus result actions |
| Result | card skeleton | meeting exists, result/score missing | return with previous filters | explicit retry | candidate/result DOM removed | details, assignments, verdict, comment, scores; archive adds read-only state |
| Export | forming is `aria-busy` | valid empty headers/filter workbook | same as empty list | retry with same signature | scope signature and rows cleared | ready → forming → download initiated |
| Members | permission/roster skeleton | only current user / no derived processes | search found nobody | roster remains; process projections are errors, not empty | directory removed | safe identity, team role/state and derived process pairs |
| Caller process list | request skeleton | no caller assignments | selected process but no caller rows | retry after current permission check | any caller room content removed | only interviews assigned to the current caller |

## Accessibility and responsive behavior

- All native controls and links have visible labels or accessible names and a minimum target of 44×44 px.
- At 780 px and below, the sidebar becomes a wrapped mobile navigation. At 520 px and below, cards and filters become single-column without horizontal document overflow.
- Long Russian names wrap within cards; the team role stays beside the named member action without forcing the viewport wider.
- The simulated keyboard route adds a 248 px bottom inset and records `visualViewport`; it only proves layout intent. A real mobile browser/device keyboard remains DA-07 work for UX Critic.
- Focus is a high-contrast orange outline with a cyan halo and respects reduced-motion settings.

## Prototype boundary

No request is sent, no workbook is generated, and no permission is enforced. Production implementation still needs server-side authorization, non-disclosing API errors, export cancellation on revoke, protected cache eviction, XLSX parsing tests and caller-derived routing tests.
