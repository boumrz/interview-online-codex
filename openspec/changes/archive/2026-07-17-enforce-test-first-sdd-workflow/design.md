## Context

The project already requires a validated OpenSpec change before implementation, but its governance does not require an executable acceptance check before production code. As a result, an implementation can satisfy an interpretation of a specification without proving the user-facing behaviour.

This governance change applies to new user stories, bug fixes, and behaviour-changing refactors. It does not require artificial automated tests for documentation-only, comment-only, formatting-only, or configuration-only work with no executable behaviour.

## Goals / Non-Goals

### Goals

- Make the delivery order explicit: SDD/OpenSpec, test design and a failing test, implementation, then green verification.
- Prefer E2E tests for user-observable flows, so acceptance is verified through the product boundary.
- Permit proportionate integration or unit tests when an E2E test is not applicable or would be excessive, while preserving an auditable reason.
- Make the rule actionable for planners, task auditors, developers, QA, and test reviewers.

### Non-Goals

- Require a browser E2E test for every internal helper or non-behavioural change.
- Prescribe a single test framework or prohibit exploratory/manual QA.
- Retrofit a red-first history to already implemented active changes.

## Decisions

### 1. A test-first gate follows strict OpenSpec validation

After proposal, capability specs, design when needed, tasks, and strict validation are ready, the delivery owner writes the acceptance test before production implementation. The owner runs it and confirms that it fails because the requested behaviour is absent or incorrect. Only then may production implementation begin.

This keeps SDD as the planning source of truth and TDD as the implementation sequence; neither replaces the other.

### 2. E2E is the preferred acceptance boundary for user-observable flows

For a story that changes an interface, a user journey, or a cross-module outcome, the first acceptance test should be E2E. Examples include a room workflow, an interviewer permission, an analytics dashboard interaction, or a realtime collaboration journey.

For a service contract, reducer, parser, state transition, or behaviour that cannot be exercised reliably at the browser boundary, a focused integration or unit test is acceptable. The OpenSpec task or design must name that choice and explain why an E2E test is not proportionate or applicable.

### 3. Task plans must expose test-before-code dependency

Each in-scope behavioural task list must contain a test-design/test-authoring task that precedes its implementation task. The task-quality gate rejects a plan that lacks an E2E choice or documented exception. Developers retain the red/green result in their handoff and task state.

### 4. Verification remains broader than the first test

The initial red-first acceptance test establishes the requested behaviour. Subsequent verification continues to include relevant unit/integration coverage, negative paths, build/type checks, and manual or exploratory QA where those are needed. E2E tests must be deterministic enough for delivery gating; unstable tests are fixed or their scope is revised rather than ignored.

## Rollout

1. Update the accepted governance capability with the new gate.
2. Align project-level instructions, the Codex SDD skill, and role contracts.
3. Require the sequence for future new work; do not invalidate historical work solely because it lacks a recorded red run.

## Risks / Trade-offs

- A universal E2E mandate would make low-level work slow and brittle. The documented integration/unit exception preserves proportionality.
- A test may fail for a setup issue rather than missing behaviour. The developer must record that the observed failure maps to the requested behaviour before implementation.
- Test-first delivery can reveal unclear acceptance criteria early. This is intentional; the task returns to planning rather than encoding assumptions in production code.
