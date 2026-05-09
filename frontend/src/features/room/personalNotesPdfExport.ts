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

type RenderedLine = {
  text: string;
  y: number;
  fontSize: number;
  bold: boolean;
};

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
};

/**
 * Полный pipeline: markdown → стилизация → раскладка по страницам A4 →
 * рендер на canvas → сборка PDF через jspdf → скачивание в браузере.
 *
 * Бросает исключение, если 2D-контекст canvas недоступен (старые браузеры,
 * privacy mode и пр.). Не ловит ошибки jspdf — пусть подскочат наверх,
 * RoomPage логирует их в консоль и (опционально) показывает уведомление.
 */
export async function renderPersonalNotesPdf({
  markdown,
  fileName,
}: RenderPersonalNotesPdfArgs): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const marginMm = 12;
  const printableWidthMm = pageWidthMm - marginMm * 2;
  const printableHeightMm = pageHeightMm - marginMm * 2;
  const canvasWidthPx = 1200;
  const pxPerMm = canvasWidthPx / printableWidthMm;
  const pageHeightPx = Math.max(1, Math.floor(printableHeightMm * pxPerMm));
  const pageWidthPx = canvasWidthPx;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) {
    throw new Error("Unable to create 2D context for PDF export");
  }

  const styledRows = markdown.split("\n").map(classifyMarkdownLine);

  const wrapLine = (
    text: string,
    maxWidth: number,
    fontSize: number,
    bold: boolean,
  ): string[] => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return [""];
    measureCtx.font = `${bold ? 700 : 400} ${fontSize}px "IBM Plex Sans", "Segoe UI", Arial, sans-serif`;
    const words = normalized.split(" ");
    const wrapped: string[] = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (measureCtx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    });
    if (current) wrapped.push(current);
    return wrapped.length > 0 ? wrapped : [normalized];
  };

  const pages: RenderedLine[][] = [[]];
  let pageIndex = 0;
  let cursorY = 0;
  const ensurePage = () => {
    if (!pages[pageIndex]) {
      pages[pageIndex] = [];
    }
  };
  ensurePage();

  styledRows.forEach((row) => {
    const wrapped = wrapLine(row.text, pageWidthPx - 16, row.fontSize, row.bold);
    cursorY += row.marginTop;
    const lineHeight = Math.ceil(row.fontSize * 1.45);
    wrapped.forEach((line) => {
      if (cursorY + lineHeight > pageHeightPx && pages[pageIndex].length > 0) {
        pageIndex += 1;
        cursorY = 0;
        ensurePage();
      }
      pages[pageIndex].push({
        text: line,
        y: cursorY,
        fontSize: row.fontSize,
        bold: row.bold,
      });
      cursorY += lineHeight;
    });
    cursorY += row.marginBottom;
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pages.forEach((pageLines, index) => {
    if (index > 0) {
      pdf.addPage("a4", "portrait");
    }
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = pageWidthPx;
    pageCanvas.height = pageHeightPx;
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) return;
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageWidthPx, pageHeightPx);
    pageCtx.fillStyle = "#10151c";
    pageLines.forEach((line) => {
      pageCtx.font = `${line.bold ? 700 : 400} ${line.fontSize}px "IBM Plex Sans", "Segoe UI", Arial, sans-serif`;
      pageCtx.fillText(line.text, 8, line.y + line.fontSize);
    });
    pdf.addImage(
      pageCanvas.toDataURL("image/png"),
      "PNG",
      marginMm,
      marginMm,
      printableWidthMm,
      printableHeightMm,
    );
  });

  const pdfBlob = pdf.output("blob");
  triggerBrowserDownload(pdfBlob, fileName);
}
