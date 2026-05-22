export const TASK_SHARE_PREFIX = "ITASK1:";

export type TaskSharePayload = {
  v: 1;
  title: string;
  description: string;
  starterCode: string;
  language: string;
};

export type DecodeResult =
  | { ok: true; payload: TaskSharePayload }
  | {
      ok: false;
      reason:
        | "not_a_share_code"
        | "malformed_encoding"
        | "malformed_json"
        | "invalid_schema"
        | "unsupported_version";
    };

/**
 * Encodes a task into a portable share code string.
 *
 * Encoding steps:
 * 1. JSON.stringify the payload with v:1
 * 2. Encode to UTF-8 bytes via TextEncoder
 * 3. Convert bytes to a binary string via String.fromCharCode
 * 4. btoa() to base64
 * 5. Make URL-safe: replace + with -, / with _, remove =
 * 6. Prepend TASK_SHARE_PREFIX
 */
export function encodeTaskShareCode(task: {
  title: string;
  description: string;
  starterCode: string;
  language: string;
}): string {
  const payload: TaskSharePayload = {
    v: 1,
    title: task.title,
    description: task.description,
    starterCode: task.starterCode,
    language: task.language,
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binaryString);
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return TASK_SHARE_PREFIX + base64url;
}

/**
 * Decodes a task share code string back to a TaskSharePayload.
 *
 * Returns a discriminated union result — never throws.
 */
export function decodeTaskShareCode(raw: string): DecodeResult {
  const trimmed = raw.trim();

  if (!trimmed.startsWith(TASK_SHARE_PREFIX)) {
    return { ok: false, reason: "not_a_share_code" };
  }

  const base64url = trimmed.slice(TASK_SHARE_PREFIX.length);
  // Restore standard base64 from base64url
  const base64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  // Add padding if necessary
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  let json: string;
  try {
    const binaryString = atob(padded);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    json = new TextDecoder().decode(bytes);
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, reason: "invalid_schema" };
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj["title"] !== "string" ||
    typeof obj["description"] !== "string" ||
    typeof obj["starterCode"] !== "string" ||
    typeof obj["language"] !== "string"
  ) {
    return { ok: false, reason: "invalid_schema" };
  }

  if (obj["v"] !== 1) {
    return { ok: false, reason: "unsupported_version" };
  }

  return {
    ok: true,
    payload: {
      v: 1,
      title: obj["title"] as string,
      description: obj["description"] as string,
      starterCode: obj["starterCode"] as string,
      language: obj["language"] as string,
    },
  };
}
