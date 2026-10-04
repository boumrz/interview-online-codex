# Shared Agent Contract

Follow [AGENTS.md](../../AGENTS.md) and [the specification standard](../../specs/README.md). [SPEC.md](../../SPEC.md) is the feature index, work order, and brief status; `specs/features/` holds the editable current behavior. Historical notes cannot override it.

## Assignment

Use plain Markdown. Supply only what the role needs:

- Goal and relevant feature path with R/AC identifiers.
- Scope, file ownership, constraints, and necessary dependencies.
- Applicable risk category and the specific review question, if any.
- Existing implementation, design, or verification links.
- Linked issue only when the task already uses Linear.

An agent must preserve unrelated and concurrent edits, avoid silently expanding scope, and distinguish an actual blocker from a routine implementation choice. Ask about unresolved decisions that change observable behavior; make proportionate technical choices within the accepted contract.

## Result

Return a short human-readable result:

- What changed or the review verdict.
- Relevant artifacts and requirement identifiers.
- Verification performed and its outcome; explain unavailable checks.
- Material unresolved decisions, risks, or required fixes.

No mandatory YAML envelope or exhaustive reasoning dump. When an assignment names a real runtime/API consumer, preserve its existing machine schema and artifact types; this document does not replace those contracts.

Do not create or update external issues or send messages merely to satisfy a handoff convention. Use the user's authorization and tool rules. A next specialist is needed only for a concrete remaining question or a risk-based independent review.
