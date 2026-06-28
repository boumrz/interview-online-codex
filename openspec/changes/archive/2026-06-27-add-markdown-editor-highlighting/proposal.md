## Why

The markdown preview now renders GFM, but the authoring pane is still a plain textarea. Users expect the editor itself to highlight Markdown syntax and code inside fenced blocks, matching markdownlivepreview-style authoring.

## What Changes

- Replace the room briefing markdown textarea with a CodeMirror markdown editor.
- Add Markdown syntax highlighting, line numbers, active line, bracket matching, and dark editor styling.
- Enable fenced code block highlighting in the editor for common languages where CodeMirror support is available.
- Preserve existing toolbar insertion behavior, cursor selection, autosync, focus/expand modes, and candidate preview-only behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `markdown-authoring`: The authoring editor must highlight Markdown syntax and fenced code block content while preserving current editing behavior.

## Impact

- Adds CodeMirror markdown language dependencies.
- Updates `BriefingBoard` to use a local CodeMirror editor wrapper.
- Updates room markdown editor CSS and E2E assertions.
- No backend or persistence contract changes.
