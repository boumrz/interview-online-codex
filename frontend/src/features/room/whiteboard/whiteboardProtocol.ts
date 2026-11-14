export type WhiteboardElement = Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string; readonly version: number; readonly versionNonce: number; readonly isDeleted: boolean };
export type WhiteboardFile = { readonly id: string; readonly mimeType: string; readonly dataURL: string; readonly created: number; readonly lastRetrieved?: number; readonly version?: number };
export type WhiteboardFiles = Readonly<Record<string, WhiteboardFile>>;
export type WhiteboardSnapshot = { readonly boardId: string; readonly sequence: number; readonly elements: ReadonlyArray<WhiteboardElement>; readonly files: WhiteboardFiles; readonly canEdit: boolean };
export type WhiteboardAck = { readonly boardId: string; readonly sequence: number; readonly operationId: string };
export type WhiteboardChange = { readonly boardId: string; readonly operationId: string; readonly baseSequence: number; readonly elements: ReadonlyArray<WhiteboardElement>; readonly files?: WhiteboardFiles };

const supportedTypes = new Set(["freedraw", "rectangle", "diamond", "ellipse", "line", "arrow", "text", "frame", "image"]);
export const MAX_WHITEBOARD_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_WHITEBOARD_FILES_BYTES = 20 * 1024 * 1024;
export const MAX_WHITEBOARD_FILES = 100;
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
  if (input.type === "image") {
    fileId(input.fileId);
    if (!["saved", "pending", "error"].includes(String(input.status)) || !Array.isArray(input.scale) || input.scale.length !== 2 || input.scale.some(value => value !== 1 && value !== -1)) invalid();
    if (input.crop !== undefined && input.crop !== null) {
      if (!record(input.crop)) invalid();
      for (const field of ["x", "y", "width", "height", "naturalWidth", "naturalHeight"]) if (!finite(input.crop[field]) || input.crop[field] < 0) invalid();
    }
  }
  validateJson(input);
  // Copy before freezing: native editor objects and point arrays remain owned
  // by the SDK, while canonical and queued versions must never mutate in place.
  return freezeJson(JSON.parse(JSON.stringify(input)) as WhiteboardElement);
}

function fileId(input: unknown): string {
  return typeof input === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input) && !["__proto__", "constructor", "prototype"].includes(input) ? input : invalid();
}

export function whiteboardFileBytes(file: WhiteboardFile): number {
  const base64 = file.dataURL.slice(file.dataURL.indexOf(",") + 1);
  return base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

export function parseFiles(input: unknown): WhiteboardFiles {
  if (input === undefined) return Object.freeze({});
  if (!record(input) || Object.keys(input).length > MAX_WHITEBOARD_FILES) invalid();
  const files: Record<string, WhiteboardFile> = {};
  let total = 0;
  for (const [key, value] of Object.entries(input)) {
    fileId(key);
    if (!record(value) || value.id !== key || !["image/png", "image/jpeg", "image/webp"].includes(String(value.mimeType)) || typeof value.dataURL !== "string") invalid();
    const prefix = `data:${value.mimeType};base64,`;
    if (!value.dataURL.startsWith(prefix) || value.dataURL.length > prefix.length + Math.ceil(MAX_WHITEBOARD_FILE_BYTES / 3) * 4) invalid();
    const base64 = value.dataURL.slice(prefix.length);
    if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid();
    const file: WhiteboardFile = { id: key, mimeType: String(value.mimeType), dataURL: value.dataURL, created: integer(value.created),
      ...(value.lastRetrieved === undefined ? {} : { lastRetrieved: integer(value.lastRetrieved) }),
      ...(value.version === undefined ? {} : { version: integer(value.version) }) };
    const bytes = whiteboardFileBytes(file);
    if (bytes > MAX_WHITEBOARD_FILE_BYTES || (total += bytes) > MAX_WHITEBOARD_FILES_BYTES) invalid();
    files[key] = Object.freeze(file);
  }
  return Object.freeze(files);
}

/** knownFiles must come from a validated snapshot of this same board/task. */
export function parseSnapshot(input: unknown, knownFiles: WhiteboardFiles = {}): WhiteboardSnapshot {
  if (!record(input) || typeof input.canEdit !== "boolean" || !Array.isArray(input.elements) || input.elements.length > 5000) invalid();
  const elements = input.elements.map(parseElement);
  const received = parseFiles(input.files);
  for (const [id, file] of Object.entries(received)) {
    const known = knownFiles[id];
    if (known && (known.dataURL !== file.dataURL || known.mimeType !== file.mimeType)) invalid();
  }
  const files = Object.freeze({ ...knownFiles, ...received });
  if (Object.keys(files).length > MAX_WHITEBOARD_FILES || Object.values(files).reduce((total, file) => total + whiteboardFileBytes(file), 0) > MAX_WHITEBOARD_FILES_BYTES) invalid();
  if (elements.some(element => element.type === "image" && !Object.hasOwn(files, String(element.fileId)))) invalid();
  if (new Set(elements.map(element => element.id)).size !== elements.length) invalid();
  return Object.freeze({ boardId: id(input.boardId), sequence: integer(input.sequence), elements: Object.freeze(elements), files, canEdit: input.canEdit });
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
