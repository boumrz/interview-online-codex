import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const languageAliases: Record<string, string> = {
  csharp: "csharp",
  cs: "csharp",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  py: "python",
  shell: "bash",
  sh: "bash",
  text: "plaintext",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
};

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return languageAliases[normalized] ?? normalized;
}

const markdownRenderer = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, language) {
      const normalizedLanguage = normalizeLanguage(language);
      if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
        return hljs.highlight(code, {
          language: normalizedLanguage,
          ignoreIllegals: true,
        }).value;
      }

      return escapeHtml(code);
    },
  }),
);

markdownRenderer.use({
  breaks: true,
  gfm: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<a href="${escapeAttribute(href)}"${titleAttribute} target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
  },
});

export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";

  const html = markdownRenderer.parse(markdown.replaceAll("\r\n", "\n"), {
    async: false,
  });

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    FORBID_ATTR: ["style"],
    USE_PROFILES: { html: true },
  });
}
