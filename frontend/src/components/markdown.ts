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

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const chunks: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    chunks.push(`<ul>${listBuffer.join("")}</ul>`);
    listBuffer = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      listBuffer.push(`<li>${markdownInlineToHtml(bulletMatch[1])}</li>`);
      return;
    }

    flushList();
    if (!line.trim()) {
      chunks.push("<p><br/></p>");
      return;
    }
    if (line.startsWith("### ")) {
      chunks.push(`<h3>${markdownInlineToHtml(line.slice(4))}</h3>`);
      return;
    }
    if (line.startsWith("## ")) {
      chunks.push(`<h2>${markdownInlineToHtml(line.slice(3))}</h2>`);
      return;
    }
    if (line.startsWith("# ")) {
      chunks.push(`<h1>${markdownInlineToHtml(line.slice(2))}</h1>`);
      return;
    }
    chunks.push(`<p>${markdownInlineToHtml(line)}</p>`);
  });

  flushList();
  return chunks.join("");
}
