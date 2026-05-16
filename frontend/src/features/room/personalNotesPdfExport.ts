/**
 * PDF-экспорт приватных заметок.
 *
 * Принимает уже собранный markdown-документ (из `buildPersonalNotesMarkdownDocument`),
 * раскрашивает строки по типу markdown-заголовков/буллетов, переносит длинные
 * строки по ширине страницы A4 и собирает PDF через `jspdf` (динамический
 * импорт, чтобы не тащить либу в основной бандл).
 *
 * Зависит от DOM (canvas, document.createElement) — поэтому модуль не
 * импортируется в SSR-путях. RoomPage вызывает его только из обработчиков
 * пользовательских действий.
 */

type StyledRow = {
  text: string;
  fontSize: number;
  bold: boolean;
  marginTop: number;
  marginBottom: number;
};

let pdfCyrillicFontData:
  | null
  | {
      regularBase64: string;
      boldBase64: string;
    } = null;

async function ensurePdfCyrillicFont(pdf: {
  addFileToVFS: (fileName: string, data: string) => void;
  addFont: (fileName: string, fontName: string, fontStyle: string) => void;
}) {
  const toBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  };

  if (!pdfCyrillicFontData) {
    const [regularResponse, boldResponse] = await Promise.all([
      fetch("/fonts/Arial.ttf"),
      fetch("/fonts/Arial-Bold.ttf"),
    ]);

    if (!regularResponse.ok || !boldResponse.ok) {
      throw new Error("PDF_CYRILLIC_FONT_LOAD_FAILED");
    }

    const [regularBuffer, boldBuffer] = await Promise.all([
      regularResponse.arrayBuffer(),
      boldResponse.arrayBuffer(),
    ]);

    pdfCyrillicFontData = {
      regularBase64: toBase64(regularBuffer),
      boldBase64: toBase64(boldBuffer),
    };
  }

  // Important: register font files on every jsPDF instance.
  // Caching only the binary data keeps things fast while avoiding
  // "sometimes works" behaviour when a fresh instance misses fonts.
  pdf.addFileToVFS("Arial.ttf", pdfCyrillicFontData.regularBase64);
  pdf.addFont("Arial.ttf", "Arial", "normal", "Identity-H");
  pdf.addFileToVFS("Arial-Bold.ttf", pdfCyrillicFontData.boldBase64);
  pdf.addFont("Arial-Bold.ttf", "Arial", "bold", "Identity-H");
}

/**
 * Сопоставляет одной строке markdown-документа стили для рендера в PDF
 * (заголовки разных уровней, буллеты, курсив, обычный параграф). Не зависит
 * ни от DOM, ни от canvas — чистая функция.
 */
function classifyMarkdownLine(line: string): StyledRow {
  if (!line.trim()) {
    return { text: "", fontSize: 18, bold: false, marginTop: 4, marginBottom: 8 };
  }
  if (line.startsWith("# ")) {
    return { text: line.slice(2), fontSize: 40, bold: true, marginTop: 8, marginBottom: 14 };
  }
  if (line.startsWith("## ")) {
    return { text: line.slice(3), fontSize: 32, bold: true, marginTop: 8, marginBottom: 10 };
  }
  if (line.startsWith("### ")) {
    return { text: line.slice(4), fontSize: 27, bold: true, marginTop: 6, marginBottom: 8 };
  }
  if (line.startsWith("- ")) {
    return { text: `• ${line.slice(2)}`, fontSize: 20, bold: false, marginTop: 2, marginBottom: 4 };
  }
  const trimmed = line.trim();
  if (trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length > 1) {
    return {
      text: trimmed.slice(1, -1),
      fontSize: 19,
      bold: false,
      marginTop: 2,
      marginBottom: 6,
    };
  }
  return { text: line, fontSize: 20, bold: false, marginTop: 2, marginBottom: 5 };
}

/**
 * Триггерит браузерное скачивание blob'а под указанным именем файла. Дополнительно
 * пишет последнюю операцию в `window.__roomLastDownload` — это используется
 * e2e-тестами, чтобы проверить, что был сделан именно нужный download.
 */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  const debugWindow = window as Window & {
    __roomLastDownload?: { fileName: string; mime: string; timestamp: number };
  };
  debugWindow.__roomLastDownload = {
    fileName,
    mime: blob.type,
    timestamp: Date.now(),
  };
  URL.revokeObjectURL(href);
}

/**
 * Безопасное имя файла для экспорта (`<заголовок комнаты>.<ext>`). Зачищает
 * символы, которые ОС не любит в путях, и режет до 96 символов на случай
 * слишком длинных названий комнат.
 */
export function buildRoomExportFileName(
  roomTitle: string | null | undefined,
  extension: "md" | "pdf",
): string {
  const normalizedTitle = (roomTitle ?? "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  const baseName = normalizedTitle || "room-notes";
  return `${baseName}.${extension}`;
}

export type RenderPersonalNotesPdfArgs = {
  /** Уже собранный markdown-документ (см. `buildPersonalNotesMarkdownDocument`). */
  markdown: string;
  /** Имя файла, под которым будет скачан PDF. */
  fileName: string;
  /**
   * Опциональный progress-репортер. Вызывается с числом от 0 до 1 и
   * краткой меткой шага. Используется, чтобы UI мог отрисовать
   * прогресс-бар, пока выгрузка идёт фоном (yields через
   * `requestAnimationFrame`).
   */
  onProgress?: (progress: number, label: string) => void;
};

/**
 * Возвращает Promise, который resolved в следующем кадре. Используется
 * между порциями тяжёлой работы (per-page render), чтобы UI оставался
 * отзывчивым во время выгрузки PDF при большом числе заметок.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Полный pipeline: markdown → стилизация → раскладка по страницам A4 →
 * прямой текстовый рендер через `pdf.text()` → скачивание в браузере.
 *
 * Раньше использовался canvas + `toDataURL("image/png")` per page —
 * это блокировало главный поток на сотни миллисекунд (PNG-кодирование)
 * и зависало при большом числе заметок. Теперь:
 *   1. Шрифт растеризуется один раз через jsPDF (нативный `text()`).
 *   2. Между страницами делается `await nextFrame()`, чтобы отдать
 *      такт event-loop и не фризить UI/анимации.
 *   3. Опциональный `onProgress` колбэк сообщает фронту, сколько
 *      работы осталось.
 */
export async function renderPersonalNotesPdf({
  markdown,
  fileName,
  onProgress,
}: RenderPersonalNotesPdfArgs): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const marginMm = 12;
  const printableWidthMm = pageWidthMm - marginMm * 2;
  const printableHeightMm = pageHeightMm - marginMm * 2;

  // jsPDF работает в "pt" (point ≈ 1/72 in). Чтобы стили (fontSize в
  // пикселях, как в старой canvas-версии) сохранили примерно тот же
  // визуальный размер, переводим в pt с коэф. 0.5 (≈ 1px → 0.5pt при
  // нашем prev. canvas 1200px шириной, что близко к 186mm = 527pt).
  const PX_TO_PT = 0.5;

  // Уведомить UI, что работа стартовала.
  onProgress?.(0, "Готовим документ");
  // Один отдельный yield перед началом, чтобы успел отрисоваться
  // прогресс/спиннер до того, как мы начнём тяжелую работу.
  await nextFrame();

  const styledRows = markdown.split("\n").map(classifyMarkdownLine);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfCyrillicFont(pdf);
  pdf.setFont("Arial", "normal");

  const usableWidthMm = printableWidthMm;
  const pageBottomMm = marginMm + printableHeightMm;
  let cursorY = marginMm;
  let isFirstPage = true;

  const newPage = () => {
    if (isFirstPage) {
      isFirstPage = false;
      return;
    }
    pdf.addPage("a4", "portrait");
    cursorY = marginMm;
  };

  newPage();

  for (let i = 0; i < styledRows.length; i += 1) {
    const row = styledRows[i];
    const fontSizePt = Math.max(8, row.fontSize * PX_TO_PT);
    const lineHeightMm = (fontSizePt * 1.45) / 2.83465; // pt → mm
    pdf.setFont("Arial", row.bold ? "bold" : "normal");
    pdf.setFontSize(fontSizePt);

    const normalized = (row.text ?? "").replace(/\s+/g, " ").trim();
    const wrapped: string[] = normalized
      ? (pdf.splitTextToSize(normalized, usableWidthMm) as string[])
      : [""];

    cursorY += row.marginTop / 6; // px → mm "комфортный" сжатый отступ

    for (const line of wrapped) {
      if (cursorY + lineHeightMm > pageBottomMm) {
        newPage();
      }
      // `text` рисуется по baseline, поэтому смещаем на высоту строки.
      pdf.text(line, marginMm, cursorY + lineHeightMm * 0.78);
      cursorY += lineHeightMm;
    }

    cursorY += row.marginBottom / 6;

    // Каждые 200 строк отдаём кадр event-loop'у. Это держит UI
    // отзывчивым даже на больших экспортах (сотни заметок).
    if (i > 0 && i % 200 === 0) {
      onProgress?.(i / styledRows.length, "Раскладываем страницы");
      await nextFrame();
    }
  }

  onProgress?.(0.95, "Сохраняем файл");
  await nextFrame();

  const pdfBlob = pdf.output("blob");
  triggerBrowserDownload(pdfBlob, fileName);
  onProgress?.(1, "Готово");
}
