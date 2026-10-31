import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { chromium } from "playwright";
import config from "../../rspack.config.mjs";

// Real editors and application CSS, on a test-owned build/server. Selection is
// exercised through keyboard/mouse and copied text, including painted pixels.
const frontend = fileURLToPath(new URL("../../", import.meta.url));
const text = "first selected line\nmiddle selected line\nlast selected line";
let scratch, server, browser, origin;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "interhub-editor-selection-"));
  const entry = join(scratch, "fixture.tsx");
  const output = join(scratch, "build");
  await writeFile(entry, `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeProvider.tsx"))};
import { RoomCodeEditor } from ${JSON.stringify(join(frontend, "src/features/room/RoomCodeEditor.tsx"))};
import { BriefingBoard } from ${JSON.stringify(join(frontend, "src/features/room/BriefingBoard.tsx"))};
import "antd/dist/reset.css";
import ${JSON.stringify(join(frontend, "public/theme-tokens.css"))};
import ${JSON.stringify(join(frontend, "src/styles/global.css"))};
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [value, setValue] = useState(${JSON.stringify(text)} + (params.has("newline") ? "\\n" : ""));
  const noop = () => {};
  return <main style={{ padding: 24, height: 600 }}>
    {params.get("editor") === "markdown"
      ? <BriefingBoard mode="interviewer" value={value} onChange={setValue} />
      : <RoomCodeEditor height="400px" language="plaintext" value={value} syncKey="selection-fixture"
          resyncSignal={0} readOnly={false} sessionId="selection-session" participantId="selection-participant"
          participantLabel="Selection fixture" sendAwarenessUpdate={noop} onAwarenessBridgeReady={noop}
          onYjsUpdate={noop} onYjsBridgeReady={noop} onEditorValueChange={setValue} onKeyPress={noop} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<ThemeProvider><Fixture /></ThemeProvider>);
`);
  const compiler = rspack({ ...config, context: frontend, mode: "development", devtool: false,
    entry: { fixture: entry },
    resolve: { ...config.resolve, modules: [join(frontend, "node_modules"), "node_modules"] },
    output: { ...config.output, path: output, filename: "[name].js", chunkFilename: "[name].[contenthash:8].js" },
    optimization: { minimize: false, splitChunks: { chunks: "all" }, runtimeChunk: "single" },
    plugins: config.plugins.filter(plugin => !["CopyRspackPlugin", "HtmlRspackPlugin"].includes(plugin.constructor.name)),
  });
  let stats;
  try {
    stats = await new Promise((done, reject) => compiler.run((error, result) => error ? reject(error) : done(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  } finally { await new Promise(done => compiler.close(done)); }
  const assets = stats.toJson({ all: false, entrypoints: true }).entrypoints.fixture.assets.map(asset => asset.name);
  const html = `<!doctype html><html><head>${assets.filter(name => name.endsWith(".css")).map(name => `<link rel="stylesheet" href="/${name}">`).join("")}</head><body><div id="root"></div>${assets.filter(name => name.endsWith(".js")).map(name => `<script defer src="/${name}"></script>`).join("")}</body></html>`;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
    const path = resolve(output, `.${pathname}`);
    if (!path.startsWith(`${output}/`)) { response.writeHead(403).end(); return; }
    try { response.setHeader("Content-Type", extname(path) === ".js" ? "application/javascript" : "text/css"); response.end(await readFile(path)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function open(editor, theme, newline = false) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1,
    permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(theme => localStorage.setItem("interview-online:ui-theme", theme), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${origin}/?editor=${editor}${newline ? "&newline" : ""}`);
  const host = page.getByTestId(editor === "markdown" ? "room-markdown-editor" : "room-code-editor-host");
  await host.locator(".cm-line").nth(2).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page, host, errors };
}

async function assertCopied(page, expected) {
  await page.keyboard.press("ControlOrMeta+C");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, "copy contains the selected text");
}

async function assertCaretLine(page, host) {
  await page.keyboard.press("ArrowRight");
  const colors = await host.locator(".cm-activeLine").evaluate(element => {
    const swatch = document.createElement("span");
    swatch.style.color = "var(--app-editor-active-line)";
    element.closest(".cm-editor").append(swatch);
    const expected = getComputedStyle(swatch).color;
    swatch.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  assert.equal(colors.actual, colors.expected, "collapsing selection restores the active line highlight");
}

async function assertPaintedSelection(page, line) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const geometry = await line.evaluate(element => {
    const line = element.getBoundingClientRect();
    const editor = element.closest(".cm-editor");
    const selected = [...editor.querySelectorAll(".cm-selectionBackground")].sort((first, second) => {
      const overlap = element => {
        const rect = element.getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, line.bottom) - Math.max(rect.top, line.top));
      };
      return overlap(second) - overlap(first);
    }).find(element => {
      const rect = element.getBoundingClientRect();
      return rect.top < line.bottom - 1 && rect.bottom > line.top + 1 && rect.width > 12;
    });
    if (!selected) return { error: "no drawn selection overlaps the selected line" };
    const rect = selected.getBoundingClientRect();
    const x = Math.ceil(Math.max(rect.left + 2, line.left + 8));
    const y = Math.ceil(Math.max(rect.top + 2, line.top + 2));
    return { x, y, width: Math.floor(Math.min(rect.right - 2, x + 40) - x),
      height: Math.floor(Math.min(rect.bottom - 2, line.bottom - 2) - y),
      expected: getComputedStyle(selected).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
      activeBackground: getComputedStyle(element).backgroundColor };
  });
  assert.equal(geometry.error, undefined, geometry.error);
  assert.ok(geometry.width > 0 && geometry.height > 0, `selected line has measurable inner paint area: ${JSON.stringify(geometry)}`);
  const png = await page.screenshot();
  const visibleRatio = await page.evaluate(async ({ png, x, y, width, height, expected }) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(x, y, width, height).data;
    let matching = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (expected.every((value, channel) => value === pixels[index + channel])) matching++;
    }
    return matching / (width * height);
  }, { ...geometry, png: `data:image/png;base64,${png.toString("base64")}` });
  assert.ok(visibleRatio > 0.25,
    `selection color must remain visible behind the line's text (ratio=${visibleRatio}); active-line background ${geometry.activeBackground}`);
}

for (const editor of ["code", "markdown"]) for (const theme of ["light", "dark"]) {
  for (const newline of [false, true]) test(`${editor}, ${theme}: select all paints and copies the last text line${newline ? " with trailing newline" : ""}`, async () => {
    const { context, page, host, errors } = await open(editor, theme, newline);
    try {
      await host.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+A");
      await assertCopied(page, text + (newline ? "\n" : ""));
      await assertPaintedSelection(page, host.locator(".cm-line").nth(2));
      await assertCaretLine(page, host);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const lineIndex of [1, 2]) test(`${editor}, ${theme}: triple click visibly selects and copies ${lineIndex === 1 ? "middle" : "last"} line`, async () => {
    const { context, page, host, errors } = await open(editor, theme);
    try {
      const line = host.locator(".cm-line").nth(lineIndex);
      await line.click({ clickCount: 3, position: { x: 60, y: 8 } });
      await assertCopied(page, text.split("\n")[lineIndex] + (lineIndex === 1 ? "\n" : ""));
      await assertPaintedSelection(page, line);
      await assertCaretLine(page, host);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
