## Context

The completed invitation-preview work already provides authenticated, privacy-safe feedback for UUIDs in the personal room-creation form. Its current rendered copy uses the longer “нанимающий менеджер” noun phrase. This follow-up changes only the exact displayed words requested in the scope; it does not revisit the established preview or room-creation contract.

## Goals / Non-Goals

**Goals:** render the seven supplied compact strings exactly, including the ellipsis and punctuation, in their existing room-creation states and preserve the current accessible feedback wiring.

**Non-Goals:** API or type renames, endpoint/status changes, backend writes, persistence/migrations, realtime behavior, preview-state logic, room assignment, account capability/cabinet terminology, or public/guest UI changes.

## Decisions

### Treat the strings as a product-copy contract

The strings in the delta spec are exact user-facing outputs, not suggestions. The implementation must update the existing form label/placeholder and state-to-message mapping, retaining the current state classification and accessibility roles. A focused source audit complements browser acceptance so a typographic variation such as three dots instead of `…` cannot pass unnoticed.

### Keep the change at the presentation boundary

Technical `HR`/hiring-manager field, route, and type identifiers remain untouched. Renaming them would require coordination with backend contracts and other already accepted role/cabinet surfaces; it is explicitly outside this narrow wording adjustment. The alternative of globally replacing “нанимающий менеджер” is rejected because the user scoped the compact wording to the creation preview.

## Risks / Trade-offs

- **A fallback error path retains the previous longer phrase** → Cover every supplied state in E2E and exact-copy audit, including post-submit mapping.
- **A broad replacement changes role/cabinet wording** → Limit code ownership and static audit to the creation-preview paths; regression-test public/guest absence and existing role surfaces.
- **Punctuation diverges from the supplied copy** → Assert exact Unicode strings, including the ellipsis and final period.

## Migration Plan

Deploy as a frontend copy-only change. It is backward-compatible and has no data, endpoint, or rollout migration. Reverting restores prior copy only and does not affect room drafts, assignments, or server state.
