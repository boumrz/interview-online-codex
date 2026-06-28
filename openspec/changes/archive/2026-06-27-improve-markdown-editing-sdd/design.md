## Context

The current markdown implementation in `frontend/src/components/markdown.ts` is a small regex parser. It handles headings, unordered lists, a narrow inline subset, links, and simple tables, but it does not implement CommonMark/GFM semantics, fenced code blocks, ordered lists, blockquotes, nested structures, task lists, autolinks, robust escaping, or code highlighting.

markdownlivepreview.com provides a useful reference shape: split editor and preview panes, a GitHub-style markdown body, Monaco-based markdown editing, reset/copy/export controls, sync scroll, dark mode, and live preview. For this project the relevant parts are the split live-preview workflow, GitHub-like preview readability, and syntax-aware rendering. PDF export, Mermaid rendering, and sync-scroll are useful follow-ups but not required for the requested fix.

## Goals / Non-Goals

**Goals:**

- Make OpenSpec the SDD specification layer for this and future changes.
- Keep the existing room and dashboard markdown editing surfaces.
- Replace handcrafted markdown parsing with a maintained renderer.
- Sanitize rendered HTML before it is passed to `dangerouslySetInnerHTML`.
- Highlight fenced code blocks while failing safely for unknown languages.
- Improve preview CSS for headings, lists, blockquotes, links, code, tables, and overflow.

**Non-Goals:**

- Do not replace the whole briefing editor with Monaco in this change.
- Do not add Markdown PDF export, Mermaid diagrams, sync-scroll, or split-pane resizing.
- Do not change backend persistence, room event payloads, or realtime sync semantics.

## Decisions

### Use OpenSpec for SDD governance

OpenSpec CLI creates the `openspec/changes` and `openspec/specs` workflow and Codex skills. The repository will keep `openspec/project.md` as project context, active changes under `openspec/changes`, and archived baseline specs under `openspec/specs`.

Alternative considered: keep updating `TECHNICAL_SPECIFICATION.md` and ADR files. Rejected because the user explicitly requested SDD through OpenSpec and a spec-first process for every future feature or bug.

### Use `marked` for Markdown/GFM parsing

`marked` is a maintained browser-friendly parser that supports the GFM-oriented constructs needed by the current UI, including tables and fenced code blocks. It fits the existing `markdownToHtml(markdown: string): string` boundary with minimal component churn.

Alternative considered: continue expanding the regex parser. Rejected because correctness would remain fragile for nested blocks, code fences, escaping, and edge cases.

Alternative considered: `react-markdown` with remark/rehype plugins. It is a good option, but it would require changing all current `dangerouslySetInnerHTML` call sites to component rendering. `marked` keeps this change narrower.

### Sanitize with DOMPurify

Rendered HTML will be sanitized by DOMPurify before injection. Markdown authored by interviewers can be shown to candidates, so the preview path must treat the source as untrusted.

Alternative considered: disable all raw HTML in the parser only. This reduces risk but does not protect against every unsafe URL or renderer edge case as clearly as a sanitizer.

### Highlight with highlight.js through `marked-highlight`

Fenced code blocks will use highlight.js when a language identifier is recognized. Unknown languages return escaped plaintext. The app will import a highlight.js dark theme globally and add local CSS for code block framing.

Alternative considered: no highlighting. Rejected because the requested experience calls out correct highlighting and the product domain is technical interviews where code examples are common.

## Risks / Trade-offs

- [Risk] Additional frontend dependencies increase bundle size. -> Mitigation: use targeted dependencies and keep the parsing boundary centralized in `components/markdown.ts`.
- [Risk] Sanitization could strip HTML some users expect. -> Mitigation: prefer safe markdown constructs; raw HTML is out of scope for interview task authoring.
- [Risk] Highlight auto-detection can be expensive or surprising. -> Mitigation: only highlight when the fenced language is recognized; otherwise render escaped plaintext.
- [Risk] Existing E2E tests may rely on old simple output. -> Mitigation: extend the markdown smoke test to cover GFM structures and XSS sanitization while preserving existing selectors.

## Migration Plan

1. Add OpenSpec artifacts and update agent/project instructions to reference OpenSpec.
2. Remove legacy specification files from active locations.
3. Install markdown renderer, sanitizer, and highlighter dependencies.
4. Replace the parser implementation behind `markdownToHtml`.
5. Improve preview CSS in room and dashboard surfaces.
6. Extend E2E coverage and run OpenSpec validation, typecheck, build, backend tests, and targeted E2E.

Rollback is straightforward: revert frontend dependency changes and `markdown.ts` to the previous parser. OpenSpec files can remain because they are process documentation and do not affect runtime.

## Open Questions

- None blocking. Full Monaco markdown editing, sync scroll, PDF export from markdown preview, and Mermaid rendering are follow-up scope, not requirements for this change.
