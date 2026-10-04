/** Shared form overrides backed by the active product theme tokens. */
export const darkFieldStyles = {
  label: { color: "var(--app-text)" },
  input: {
    backgroundColor: "var(--app-surface)",
    borderColor: "var(--app-control-border)",
    color: "var(--app-text)",
  },
};

const monoFontStack =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const markdownInputStyles = {
  ...darkFieldStyles,
  input: {
    ...darkFieldStyles.input,
    fontFamily: monoFontStack,
    fontSize: "12px",
    lineHeight: 1.45,
    resize: "vertical" as const,
  },
};

export const codeInputStyles = {
  ...darkFieldStyles,
  input: {
    ...darkFieldStyles.input,
    fontFamily: monoFontStack,
    fontSize: "12px",
    lineHeight: 1.45,
    resize: "vertical" as const,
  },
};

export const darkSelectStyles = {
  ...darkFieldStyles,
  dropdown: { backgroundColor: "var(--app-surface-elevated)", borderColor: "var(--app-border)" },
  option: { color: "var(--app-text)" },
};
