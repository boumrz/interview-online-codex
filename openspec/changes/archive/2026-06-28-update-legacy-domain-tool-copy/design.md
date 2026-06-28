## Context

The existing legacy-domain notice already detects the old domain, supports local override flags, preserves the current route in the transition link, and renders the notice globally.

## Goals / Non-Goals

**Goals:**
- Update only the user-facing body copy so it says users can continue using the tool.
- Keep the existing domain detection, shutdown date, link behavior, and local test overrides unchanged.

**Non-Goals:**
- No layout, API, routing, authentication, or deployment behavior changes.

## Decisions

- Keep the copy in `LegacyDomainNotice` because the notice is already a small static UI component.
- Extend the existing E2E check to assert the new wording so future copy regressions are visible.

## Risks / Trade-offs

- [Risk] Copy can diverge from the accepted requirement later. Mitigation: assert the key wording in the legacy-domain notice E2E.
