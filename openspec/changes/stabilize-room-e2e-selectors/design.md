## Context

See `proposal.md` for the motivation. Both failures are limited to browser-test
preconditions: one responsive room-panel toggle and one Mantine control locator.
No application, API, persistence, realtime, or dependency design changes are
needed. This short design is included because the selector choices must remain
explicitly state-aware and test-only.

## Goals / Non-Goals

**Goals:**

- Let each E2E establish its required UI precondition idempotently.
- Bind locators to the actual tested control rather than an assumed wrapper DOM.
- Preserve the original user-visible acceptance assertions after setup succeeds.

**Non-Goals:**

- Changing room-panel behaviour, Mantine component markup, test IDs, product
  defaults, or frontend production code.
- Adding retries that hide a genuine product failure.

## Decisions

### Use the assertion target as the room-panel readiness signal

The PDF test will first inspect visibility of the private-notes input. It will
activate the room rail only when that target is not visible and a rail button is
available. This is preferred to always clicking a toggle or inferring an
internal panel state, because visibility is the test's actual prerequisite and
an unconditional toggle can invert a valid state.

### Read the direct data-test-id control

The language test will locate the element carrying the language test ID and
read its input value directly. This reflects the observed Mantine DOM contract.
Searching for a child input is rejected because it encodes an unsupported
wrapper assumption and prevents the language assertion from running.

## Risks / Trade-offs

- [A future product DOM change moves or removes a test ID] -> The focused E2E
  fails at the explicit control boundary, making the selector contract reviewable.
- [A panel never becomes reachable] -> The test still fails waiting for the
  private-notes input; no retry or fallback masks the real UI failure.

## Migration Plan

No migration or rollback procedure is required. The changes are limited to two
test scripts; reverting either selector correction restores only prior test
automation behaviour.
