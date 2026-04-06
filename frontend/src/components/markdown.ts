function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownInlineToHtml(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replaceAll(/`([^`]+)`/g, "<code>$1</code>")
    .replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replaceAll(/\*([^*]+)\*/g, "<em>$1</em>")
    .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

type TableAlignment = "left" | "center" | "right";

function parseTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  let body = trimmed;
  if (body.startsWith("|")) {
    body = body.slice(1);
  }
  if (body.endsWith("|")) {
    body = body.slice(0, -1);
  }

  const cells = body.split("|").map((cell) => cell.trim());
  if (cells.length === 0) return null;
  if (cells.every((cell) => !cell)) return null;
  return cells;
}

function parseTableSeparator(line: string, expectedColumns: number): TableAlignment[] | null {
  const cells = parseTableCells(line);
  if (!cells || cells.length !== expectedColumns) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    const token = cell.replaceAll(/\s+/g, "");
    if (!/^:?-+:?$/.test(token)) {
      return null;
    }
    const startsWithColon = token.startsWith(":");
    const endsWithColon = token.endsWith(":");
    if (startsWithColon && endsWithColon) {
      alignments.push("center");
      continue;
    }
    if (endsWithColon) {
      alignments.push("right");
      continue;
    }
    alignments.push("left");
  }

  return alignments;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const chunks: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    chunks.push(`<ul>${listBuffer.join("")}</ul>`);
    listBuffer = [];
  };

  const renderTableCell = (tag: "th" | "td", content: string, alignment: TableAlignment) =>
    `<${tag} style="text-align:${alignment};">${markdownInlineToHtml(content)}</${tag}>`;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trimEnd();
    const tableHeaderCells = parseTableCells(line);
    const tableSeparator = index + 1 < lines.length ? parseTableSeparator(lines[index + 1], tableHeaderCells?.length ?? 0) : null;
    if (tableHeaderCells && tableSeparator) {
      flushList();
      index += 2;

      const bodyRows: string[][] = [];
      while (index < lines.length) {
        const rowCells = parseTableCells(lines[index].trimEnd());
        if (!rowCells || rowCells.length !== tableHeaderCells.length) break;
        bodyRows.push(rowCells);
        index += 1;
      }

      const headerHtml = tableHeaderCells
        .map((cell, columnIndex) => renderTableCell("th", cell, tableSeparator[columnIndex]))
        .join("");
      const bodyHtml = bodyRows
        .map((row) => `<tr>${row.map((cell, columnIndex) => renderTableCell("td", cell, tableSeparator[columnIndex])).join("")}</tr>`)
        .join("");
      chunks.push(`<table><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}</table>`);
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      listBuffer.push(`<li>${markdownInlineToHtml(bulletMatch[1])}</li>`);
      index += 1;
      continue;
    }

    flushList();
    if (!line.trim()) {
      chunks.push("<p><br/></p>");
      index += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      chunks.push(`<h3>${markdownInlineToHtml(line.slice(4))}</h3>`);
      index += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      chunks.push(`<h2>${markdownInlineToHtml(line.slice(3))}</h2>`);
      index += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      chunks.push(`<h1>${markdownInlineToHtml(line.slice(2))}</h1>`);
      index += 1;
      continue;
    }
    chunks.push(`<p>${markdownInlineToHtml(line)}</p>`);
    index += 1;
  }

  flushList();
  return chunks.join("");
}
