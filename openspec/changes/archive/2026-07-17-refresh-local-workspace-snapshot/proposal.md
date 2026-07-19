# Refresh local workspace snapshots

## Why

A manager's inactive-task preview is cached in the browser. If the task becomes published, is edited, and later becomes inactive again while the same manager retains that local selection, the previous cached response can be shown instead of the newly persisted task workspace. This can make an interviewer evaluate obsolete code or briefing.

The active-step marker also needs to name its task for screen-reader users, not merely state that some step is active.

## What Changes

- Refetch the manager-only workspace snapshot whenever a local non-published preview is entered again.
- Add an end-to-end regression that covers preview, global publication, editing, switching to another step, and return to the preserved preview.
- Make the `Активен` marker's accessible name include the active task title.

## Affected Areas

- Frontend RTK Query lifecycle and the manager workspace E2E.
- Accessibility label in the manager task list.
