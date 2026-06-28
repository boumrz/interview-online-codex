## Why

The public production domain has moved from `https://interview.domiknote.ru/` to `https://interview.vtools.tech/`. Users who still open the old domain need a clear shutdown warning before `interview.domiknote.ru` is disabled on July 26, 2026.

The markdown briefing editor also needs two small polish fixes found during manual review: the fenced-code toolbar button label should not show raw backticks, and the editor should start as an empty text block without placeholder copy.

## What Changes

- Show a global legacy-domain notice when the frontend runs on `interview.domiknote.ru`.
- Include the shutdown date, July 26, 2026, and a direct call to continue on `https://interview.vtools.tech/`.
- Preserve the current path and query string when building the new-domain link.
- Add a local test override so the notice can be manually tested on localhost.
- Remove the markdown editor placeholder text.
- Rename the fenced-code toolbar label from raw backticks to a clean `Code` label while keeping the inserted snippet unchanged.

## Capabilities

### New Capabilities

- `domain-migration-notice`: Users on a legacy production domain see a migration notice with a transition link.

### Modified Capabilities

- `markdown-authoring`: Markdown editor polish for empty editor state and toolbar wording.

## Impact

- Adds a small global frontend component and styles.
- Adds compile-time config for legacy/new domain values and local override.
- Updates E2E coverage for the local notice flag and markdown toolbar/placeholder polish.
- No backend or persistence contract changes.
