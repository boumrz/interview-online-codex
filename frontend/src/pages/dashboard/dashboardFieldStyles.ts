/**
 * Mantine `styles` overrides reused across dashboard forms to keep the
 * dark "deep navy" form palette consistent. Kept as plain objects rather
 * than CSS modules because Mantine's API takes the prop literally.
 */
export const darkFieldStyles = {
  label: { color: "#cbd5e1" },
  input: {
    backgroundColor: "#0b1529",
    borderColor: "#27456f",
    color: "#e2e8f0",
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
  dropdown: { backgroundColor: "#0f1c34", borderColor: "#27456f" },
  option: { color: "#e2e8f0" },
};
