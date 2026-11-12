/** Only server-assigned RGB colors can become drawing defaults or CSS values. */
export function normalizeDrawingColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : null;
}
