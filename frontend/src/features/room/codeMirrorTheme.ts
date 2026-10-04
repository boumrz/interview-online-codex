import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ThemeMode } from "../theme/themeTokens";

/** Reconfigured independently of the collaborative document and undo history. */
export function codeMirrorTheme(mode: ThemeMode) {
  return [
    mode === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle),
    Prec.highest(EditorView.theme({
      "&": { backgroundColor: "var(--app-editor-bg)", color: "var(--app-editor-text)" },
      ".cm-content": { caretColor: "var(--app-editor-text)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--app-editor-text)" },
      ".cm-gutters": { backgroundColor: "var(--app-editor-bg)", color: "var(--app-editor-muted)", borderColor: "var(--app-border)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--app-editor-active-line)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--app-editor-selection)" },
      ".cm-tooltip": { backgroundColor: "var(--app-surface-elevated)", color: "var(--app-text)", borderColor: "var(--app-border)" },
      ".cm-panels": { backgroundColor: "var(--app-surface-soft)", color: "var(--app-text)" },
    }, { dark: mode === "dark" })),
  ];
}
