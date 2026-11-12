export type WhiteboardElement = Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string; readonly version: number; readonly versionNonce: number; readonly isDeleted: boolean };
export type WhiteboardSnapshot = { readonly boardId: string; readonly sequence: number; readonly elements: ReadonlyArray<WhiteboardElement>; readonly canEdit: boolean };
export type WhiteboardAck = { readonly boardId: string; readonly sequence: number; readonly operationId: string };
export type WhiteboardChange = { readonly boardId: string; readonly operationId: string; readonly baseSequence: number; readonly elements: ReadonlyArray<WhiteboardElement> };

const supportedTypes = new Set(["freedraw", "rectangle", "diamond", "ellipse", "line", "arrow", "text", "frame"]);
function invalid(): never { throw new Error("Некорректный документ доски"); }
function record(input: unknown): input is Record<string, unknown> { return typeof input === "object" && input !== null && !Array.isArray(input); }
function id(input: unknown): string { return typeof input === "string" && input.length > 0 && input.length <= 255 ? input : invalid(); }
function integer(input: unknown, minimum = 0): number { return typeof input === "number" && Number.isSafeInteger(input) && input >= minimum ? input : invalid(); }
function finite(input: unknown): input is number { return typeof input === "number" && Number.isFinite(input); }

function validateJson(input: unknown, depth = 0): void {
  if (depth > 32) invalid();
  if (input === null || typeof input === "boolean" || typeof input === "string" || input === undefined) return;
  if (typeof input === "number") { if (!Number.isFinite(input)) invalid(); return; }
  if (Array.isArray(input)) { input.forEach(value => validateJson(value, depth + 1)); return; }
  if (!record(input)) invalid();
  for (const [key, value] of Object.entries(input)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) invalid();
    validateJson(value, depth + 1);
  }
}

function freezeJson<T>(input: T): T {
  if (typeof input === "object" && input !== null) {
    Object.values(input).forEach(freezeJson);
    Object.freeze(input);
  }
  return input;
}

export function parseElement(input: unknown): WhiteboardElement {
  if (!record(input) || !supportedTypes.has(String(input.type)) || typeof input.isDeleted !== "boolean") invalid();
  id(input.id); integer(input.version, 1); integer(input.versionNonce);
  for (const key of ["x", "y", "width", "height"]) if (!finite(input[key])) invalid();
  if (input.link !== undefined && input.link !== null && input.link !== "") invalid();
  if (input.points !== undefined && (!Array.isArray(input.points) || input.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite)))) invalid();
  if (input.pressures !== undefined && (!Array.isArray(input.pressures) || input.pressures.some(value => !finite(value) || value < 0 || value > 1))) invalid();
  validateJson(input);
  // Copy before freezing: native editor objects and point arrays remain owned
  // by the SDK, while canonical and queued versions must never mutate in place.
  return freezeJson(JSON.parse(JSON.stringify(input)) as WhiteboardElement);
}

export function parseSnapshot(input: unknown): WhiteboardSnapshot {
  if (!record(input) || typeof input.canEdit !== "boolean" || !Array.isArray(input.elements) || input.elements.length > 5000) invalid();
  const elements = input.elements.map(parseElement);
  if (new Set(elements.map(element => element.id)).size !== elements.length) invalid();
  return Object.freeze({ boardId: id(input.boardId), sequence: integer(input.sequence), elements: Object.freeze(elements), canEdit: input.canEdit });
}

export function parseAck(input: unknown): WhiteboardAck {
  if (!record(input)) invalid();
  return Object.freeze({ boardId: id(input.boardId), sequence: integer(input.sequence), operationId: id(input.operationId) });
}

/** Excalidraw's deterministic winner: higher version, then lower nonce. */
export function compareElementVersions(left: WhiteboardElement, right: WhiteboardElement): -1 | 0 | 1 {
  if (left.version !== right.version) return left.version > right.version ? 1 : -1;
  if (left.versionNonce !== right.versionNonce) return left.versionNonce < right.versionNonce ? 1 : -1;
  return 0;
}

export function elementFingerprint(element: WhiteboardElement): string {
  return JSON.stringify([element.id, element.version, element.versionNonce]);
}
