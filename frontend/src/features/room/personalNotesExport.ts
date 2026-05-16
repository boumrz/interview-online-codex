/**
 * Экспорт приватных заметок в Markdown.
 *
 * Собирает один документ из плоского списка записей (`PersonalNotesExportEntry`):
 * группирует по блокам (шаговые / кастомные / свободная форма), сортирует
 * шаги по `stepIndex` и записи внутри блока по времени, добавляет оценки
 * шагов и заголовок комнаты.
 *
 * Только pure-функции — никаких React, DOM или сетевых зависимостей.
 */

/**
 * Минимальная форма записи приватных заметок, нужная для экспорта. Совпадает
 * по полям с runtime-типом `PersonalNoteEntry`, который живёт в RoomPage —
 * специально дублируем здесь, чтобы экспорт не зависел от UI-слоя.
 */
export type PersonalNotesExportEntry = {
  id: string;
  text: string;
  blockName?: string | null;
  /**
   * Step index, к которому привязана запись (если она была написана под
   * автоматически выставленным шаговым блоком). UI рисует такие записи как
   * `Шаг N`, экспорт раскрывает их в `Шаг N - <название задачи>`.
   */
  blockStepIndex?: number | null;
  timestampEpochMs: number;
};

export type PersonalNotesExportOptions = {
  includeTimestamps: boolean;
  includeFreeNotes: boolean;
};

/** UI label for a step block: `Шаг 1`, `Шаг 2`, etc. */
export function formatStepBlockLabel(stepIndex: number): string {
  return `Шаг ${stepIndex + 1}`;
}

/** Find the task that backs a given step block (used for export labels). */
export function findStepBlockTask<
  T extends { stepIndex: number; title: string },
>(tasks: T[], stepIndex: number): T | null {
  return tasks.find((task) => task.stepIndex === stepIndex) ?? null;
}

/** Дата/время для экспорта (`12.05.2026, 14:33`). */
export function formatExportTimestamp(timestampEpochMs: number): string {
  if (!timestampEpochMs) return "—";
  return new Date(timestampEpochMs).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Форматирует оценку шага из 5-балльной шкалы в кусочек текста для заголовка
 * блока (например, " — Оценка 4/5"). Если оценка не выставлена — возвращает
 * пустую строку, чтобы заголовок не разрастался.
 */
export function formatStepRatingSuffix(
  rating: number | null | undefined,
): string {
  if (typeof rating !== "number" || rating < 1 || rating > 5) return "";
  return ` — Оценка ${rating}/5`;
}

/** Один текстовый ряд под `# ...` в выгрузке заметок: без переводов строк. */
export function normalizeExportRoomHeadingLine(
  roomTitle: string | null | undefined,
): string {
  const normalized = (roomTitle ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return normalized || "Комната";
}

/**
 * Markdown выгрузки личных заметок: первая строка — `# название комнаты`.
 * Заметки — один поток по комнате, группы по блокам; шаг — «Шаг N - задача»
 * (+ оценка при наличии).
 */
export function buildPersonalNotesMarkdownDocument(
  tasks: Array<{
    stepIndex: number;
    title: string;
  }>,
  entries: PersonalNotesExportEntry[],
  options: PersonalNotesExportOptions,
  /**
   * Карта оценок шагов вида `{ "0": 4, "1": null, ... }`. Ключ — индекс шага
   * как строка, значение — балл 1..5 либо null/отсутствует, если оценки нет.
   */
  taskScores: Record<string, number | null> = {},
  roomTitle?: string | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${normalizeExportRoomHeadingLine(roomTitle)}`);
  lines.push("");
  lines.push(`_Сформировано: ${formatExportTimestamp(Date.now())}_`);
  lines.push("");

  const sorted = entries
    .slice()
    .sort(
      (left, right) =>
        left.timestampEpochMs - right.timestampEpochMs ||
        left.id.localeCompare(right.id),
    );

  type ExportBlock = {
    key: string;
    displayName: string;
    entries: PersonalNotesExportEntry[];
    /**
     * Индекс шага для блока, привязанного к шагу. У кастомных блоков — `null`,
     * чтобы при сортировке экспорта сначала шли шаги по возрастанию `stepIndex`,
     * а уже после них — кастомные блоки в порядке появления.
     */
    stepIndex: number | null;
    /**
     * Порядковый номер вставки. Используется как стабильный вторичный ключ
     * сортировки для кастомных блоков (сохраняем порядок появления).
     */
    insertionOrder: number;
  };
  const freeEntries: PersonalNotesExportEntry[] = [];
  const blocks = new Map<string, ExportBlock>();
  let nextInsertionOrder = 0;

  sorted.forEach((entry) => {
    const stepIndex = entry.blockStepIndex;
    if (typeof stepIndex === "number") {
      const stepKey = `step:${stepIndex}`;
      const taskTitle =
        findStepBlockTask(tasks, stepIndex)?.title.trim() ?? "";
      const baseLabel = taskTitle
        ? `${formatStepBlockLabel(stepIndex)} - ${taskTitle}`
        : formatStepBlockLabel(stepIndex);
      const ratingSuffix = formatStepRatingSuffix(
        taskScores[String(stepIndex)],
      );
      const displayName = `${baseLabel}${ratingSuffix}`;
      const existing = blocks.get(stepKey);
      if (existing) {
        existing.entries.push(entry);
        existing.displayName = displayName;
      } else {
        blocks.set(stepKey, {
          key: stepKey,
          displayName,
          entries: [entry],
          stepIndex,
          insertionOrder: nextInsertionOrder++,
        });
      }
      return;
    }
    const customName = entry.blockName?.trim() ?? "";
    if (!customName) {
      freeEntries.push(entry);
      return;
    }
    const customKey = `custom:${customName.toLocaleLowerCase("ru-RU")}`;
    const existing = blocks.get(customKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      blocks.set(customKey, {
        key: customKey,
        displayName: customName,
        entries: [entry],
        stepIndex: null,
        insertionOrder: nextInsertionOrder++,
      });
    }
  });

  const formatEntry = (entry: PersonalNotesExportEntry) => {
    const prefix = options.includeTimestamps
      ? `[${formatExportTimestamp(entry.timestampEpochMs)}] `
      : "";
    return `- ${prefix}${entry.text}`;
  };

  /**
   * Если у шага есть оценка, но нет ни одной заметки — всё равно выводим
   * блок (без записей), чтобы экспорт показывал оценку каждого шага.
   * Шаги без заметок и без оценки опускаем.
   */
  tasks
    .slice()
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .forEach((task) => {
      const stepKey = `step:${task.stepIndex}`;
      if (blocks.has(stepKey)) return;
      const rating = taskScores[String(task.stepIndex)];
      if (typeof rating !== "number" || rating < 1 || rating > 5) return;
      const baseLabel = task.title.trim()
        ? `${formatStepBlockLabel(task.stepIndex)} - ${task.title.trim()}`
        : formatStepBlockLabel(task.stepIndex);
      blocks.set(stepKey, {
        key: stepKey,
        displayName: `${baseLabel}${formatStepRatingSuffix(rating)}`,
        entries: [],
        stepIndex: task.stepIndex,
        insertionOrder: nextInsertionOrder++,
      });
    });

  /**
   * Шаговые блоки выводим строго по `stepIndex` (Шаг 1, 2, 3...), кастомные —
   * в порядке появления. Записи внутри блоков уже отсортированы по времени
   * выше через `sorted`. «В свободной форме» уезжает в самый конец, чтобы
   * шаги шли первыми, как и просит пользователь.
   */
  const orderedBlocks = Array.from(blocks.values()).sort((left, right) => {
    if (left.stepIndex !== null && right.stepIndex !== null) {
      return left.stepIndex - right.stepIndex;
    }
    if (left.stepIndex !== null) return -1;
    if (right.stepIndex !== null) return 1;
    return left.insertionOrder - right.insertionOrder;
  });

  orderedBlocks.forEach((block) => {
    lines.push(`## ${block.displayName}`);
    if (block.entries.length === 0) {
      lines.push("- _Заметок нет_");
    } else {
      block.entries.forEach((entry) => lines.push(formatEntry(entry)));
    }
    lines.push("");
  });

  if (options.includeFreeNotes && freeEntries.length > 0) {
    lines.push("## В свободной форме");
    freeEntries.forEach((entry) => lines.push(formatEntry(entry)));
    lines.push("");
  }

  if (lines.length <= 4) {
    lines.push("Заметок пока нет.");
    lines.push("");
  }

  return lines.join("\n");
}
