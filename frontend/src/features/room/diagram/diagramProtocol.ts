export type DiagramPatch = { readonly [key: string]: unknown };
export type PendingDiagramChange = { readonly operationId: string; readonly patch: DiagramPatch };
export type DiagramOperation = { readonly sequence: number; readonly operationId: string; readonly sessionId: string; readonly xml: string | null; readonly patch?: DiagramPatch; readonly checksum?: string };
export type DiagramDocument = { readonly diagramId: string; readonly sequence: number; readonly xml: string; readonly canEdit: boolean; readonly editor: "drawio"; readonly schemaVersion: 1; readonly operations: ReadonlyArray<DiagramOperation>; readonly requiresSnapshot: boolean };
export type DiagramOrderPage = { readonly id: string; readonly cells: ReadonlyArray<{ readonly id: string; readonly parent: string | null }> };
export function readDrawioChecksum(input: unknown): string {
  if (typeof input === "number" && Number.isSafeInteger(input)) return String(input);
  if (typeof input === "string" && input.length > 0 && input.length <= 128 && input.trim() === input) return input;
  throw new Error("Не удалось проверить согласованность схемы");
}

export function isDiagramRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function invalid(): never { throw new Error("Некорректный документ схемы"); }
function sequence(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : invalid();
}
function text(input: unknown): string { return typeof input === "string" ? input : invalid(); }

export function parseDiagramOperation(input: unknown): DiagramOperation {
  if (!isDiagramRecord(input)) return invalid();
  if (input.patch !== undefined && input.patch !== null && !isDiagramRecord(input.patch)) return invalid();
  if (input.checksum !== undefined && input.checksum !== null && typeof input.checksum !== "string") return invalid();
  return {
    sequence: sequence(input.sequence), operationId: text(input.operationId),
    sessionId: text(input.sessionId), xml: input.xml === null || input.xml === undefined ? null : text(input.xml),
    ...(isDiagramRecord(input.patch) ? { patch: input.patch } : {}),
    ...(typeof input.checksum === "string" ? { checksum: input.checksum } : {}),
  };
}

export function parseDiagramDocument(input: unknown): DiagramDocument {
  if (!isDiagramRecord(input) || input.editor !== "drawio" || input.schemaVersion !== 1 || typeof input.canEdit !== "boolean" || typeof input.requiresSnapshot !== "boolean" || !Array.isArray(input.operations)) return invalid();
  const acceptedSequence = sequence(input.sequence);
  const operations = input.operations.map(parseDiagramOperation);
  if (operations.some((operation, index) => operation.xml === null || operation.sequence > acceptedSequence || (index > 0 && operation.sequence <= operations[index - 1]!.sequence))) return invalid();
  return { diagramId: text(input.diagramId), sequence: acceptedSequence, xml: text(input.xml), canEdit: input.canEdit, editor: "drawio", schemaVersion: 1, operations, requiresSnapshot: input.requiresSnapshot };
}

export function buildDiagramOrderPatch(pages: ReadonlyArray<DiagramOrderPage>): DiagramPatch {
  const updates = new Map<string, unknown>();
  for (const page of pages) {
    const cells = new Map<string, unknown>();
    const previous = new Map<string, string>();
    for (const cell of page.cells) {
      if (cell.parent === null) continue;
      cells.set(cell.id, { parent: cell.parent, previous: previous.get(cell.parent) ?? "" });
      previous.set(cell.parent, cell.id);
    }
    updates.set(page.id, { cells: { u: Object.fromEntries(cells) } });
  }
  return { u: Object.fromEntries(updates) };
}

export function diagramOrderPatchFromXml(xml: string): DiagramPatch {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) return invalid();
  const pages = Array.from(document.querySelectorAll("diagram")).map((page) => {
    const root = page.querySelector("mxGraphModel > root");
    if (!root || !page.id) return invalid();
    return { id: page.id, cells: Array.from(root.children).map((node) => {
      const cell = node.localName === "mxCell" ? node : node.querySelector("mxCell");
      if (!cell) return invalid();
      const id = node.getAttribute("id") ?? cell.getAttribute("id");
      if (!id) return invalid();
      return { id, parent: cell.getAttribute("parent") };
    }) };
  });
  return buildDiagramOrderPatch(pages);
}

export function createDiagramQueue() {
  let changes: ReadonlyArray<PendingDiagramChange> = [];
  let revoked = false;
  return {
    get size() { return changes.length; },
    get changes() { return changes; },
    enqueue(change: PendingDiagramChange): boolean {
      if (revoked || changes.some((queued) => queued.operationId === change.operationId)) return false;
      changes = [...changes, change]; return true;
    },
    peek(): PendingDiagramChange | undefined { return changes[0]; },
    acknowledge(operationId: string): boolean {
      if (revoked || changes[0]?.operationId !== operationId) return false;
      changes = changes.slice(1); return true;
    },
    revoke(): void { revoked = true; changes = []; },
  };
}
