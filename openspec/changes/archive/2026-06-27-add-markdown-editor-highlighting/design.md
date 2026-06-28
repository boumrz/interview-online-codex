## Context

The room briefing authoring surface currently uses Mantine `Textarea`. A textarea cannot provide token-level syntax highlighting. The project already uses CodeMirror 6 for the collaborative code editor, so adding a local non-Yjs CodeMirror instance for markdown authoring follows an existing UI technology.

## Goals / Non-Goals

**Goals:**

- Provide Markdown source highlighting in the briefing editor.
- Highlight code tokens inside fenced code blocks for common languages.
- Preserve existing controlled `value` / `onChange` contract and toolbar selection behavior.
- Keep candidate briefing preview-only.

**Non-Goals:**

- Do not make markdown briefing collaborative through Yjs in this change.
- Do not replace dashboard task description textareas in this change.
- Do not add sync-scroll, Mermaid, or PDF export.

## Decisions

### Use CodeMirror markdown language

Use `@codemirror/lang-markdown` with `@codemirror/language-data` so fenced code blocks can use nested language parsers where available. This mirrors the existing CodeMirror stack and avoids a custom overlay highlighter.

### Keep a controlled wrapper

Create a small local `MarkdownCodeMirrorEditor` inside `BriefingBoard.tsx`. It owns the CodeMirror view, dispatches full document changes through `onChange`, and updates the document when remote/controlled `value` changes.

### Preserve toolbar selection through an imperative ref

The existing toolbar relies on textarea selection APIs. The new wrapper will expose `focus()` and `setSelectionRange()` through a small ref interface so insertion helpers remain local and unchanged in behavior.

## Risks / Trade-offs

- [Risk] CodeMirror markdown packages add bundle weight. -> Mitigation: reuse the app's existing CodeMirror foundation and only add markdown/language-data packages.
- [Risk] Controlled updates could reset cursor during remote markdown sync. -> Mitigation: only replace the document when incoming `value` differs from the current editor document.
- [Risk] Some fenced languages may not be highlighted if no parser is available. -> Mitigation: support common JS/TS/Python/Java/SQL through CodeMirror language data and keep plaintext fallback.
