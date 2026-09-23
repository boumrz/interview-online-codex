/** Portable library data contains content only, so it can be pasted into another account. */
export type TransferTask = {
  title: string;
  description: string;
  starterCode: string;
  language: string;
};

export type LibraryTransfer =
  | { kind: "task"; task: TransferTask }
  | { kind: "task-set"; name: string; tasks: TransferTask[] };

const format = "interview-online-library";
const invalidMessage = "Вставьте скопированные данные задачи или набора из библиотеки.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTask(value: unknown): value is TransferTask {
  return isRecord(value)
    && typeof value.title === "string" && value.title.trim().length > 0
    && typeof value.description === "string"
    && typeof value.starterCode === "string"
    && typeof value.language === "string" && value.language.trim().length > 0;
}

function contentOnly(task: TransferTask): TransferTask {
  return {
    title: task.title,
    description: task.description,
    starterCode: task.starterCode,
    language: task.language,
  };
}

export function serializeTask(task: TransferTask): string {
  return JSON.stringify({ format, version: 1, kind: "task", task: contentOnly(task) }, null, 2);
}

export function serializeTaskSet(name: string, tasks: TransferTask[]): string {
  return JSON.stringify({ format, version: 1, kind: "task-set", name, tasks: tasks.map(contentOnly) }, null, 2);
}

export function parseLibraryTransfer(text: string, expectedKind: LibraryTransfer["kind"]): LibraryTransfer {
  if (text.length > 500_000) throw new Error("Скопированные данные слишком велики.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(invalidMessage);
  }
  if (!isRecord(value) || value.format !== format || value.version !== 1) {
    throw new Error(invalidMessage);
  }
  if (value.kind !== expectedKind) {
    throw new Error(expectedKind === "task" ? "Вставьте скопированную задачу." : "Вставьте скопированный набор.");
  }
  if (expectedKind === "task" && isTask(value.task)) {
    return { kind: "task", task: contentOnly(value.task) };
  }
  if (expectedKind === "task-set"
    && typeof value.name === "string" && value.name.trim().length > 0
    && Array.isArray(value.tasks) && value.tasks.length > 0 && value.tasks.length <= 100
    && value.tasks.every(isTask)) {
    return { kind: "task-set", name: value.name, tasks: value.tasks.map(contentOnly) };
  }
  throw new Error(invalidMessage);
}
