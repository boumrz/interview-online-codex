## Why

The project currently relies on legacy specification documents and a handcrafted markdown parser that only covers a narrow subset of Markdown. This blocks SDD adoption and causes inaccurate preview formatting for common authoring patterns such as fenced code blocks, nested lists, blockquotes, autolinks, and safe inline HTML handling.

## What Changes

- Introduce OpenSpec as the project specification source of truth.
- Replace legacy specification entry points with an OpenSpec-first workflow for all bugs and features.
- Make the multi-agent pipeline implicit for project work by documenting spec-first orchestration in project and agent rules.
- Upgrade markdown rendering from a regex-based parser to a library-backed GFM renderer with HTML sanitization.
- Add syntax highlighting for fenced code blocks and improve preview formatting in room briefings and dashboard task descriptions.
- Keep the current editor surface and realtime markdown sync behavior intact.

## Capabilities

### New Capabilities

- `sdd-workflow-governance`: Rules that require OpenSpec artifacts before implementation and make the existing multi-agent workflow the default path.
- `markdown-authoring`: Markdown authoring, live preview, formatting, sanitization, and code highlighting behavior for interview task descriptions and room briefings.

### Modified Capabilities

- None.

## Impact

- Adds OpenSpec project structure under `openspec/` and Codex OpenSpec skills under `.codex/skills/`.
- Removes legacy specification sources from active use and updates project instructions that referenced them.
- Affects frontend markdown rendering in `frontend/src/components/markdown.ts`, briefing UI styles, dashboard preview styles, and markdown E2E coverage.
- Adds frontend dependencies for markdown parsing, sanitization, and code highlighting.
- No backend API or database contract changes are required.
