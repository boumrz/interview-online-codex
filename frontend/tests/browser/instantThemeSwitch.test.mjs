import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { rspack } from "@rspack/core";
import { chromium } from "playwright";
import config from "../../rspack.config.mjs";

// Real components on an owned loopback server; no app/backend/user data is used.
const frontend = fileURLToPath(new URL("../../", import.meta.url));
const preferenceKey = "interview-online:ui-theme";
let scratch;
let server;
let browser;
let origin;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "interhub-instant-theme-"));
  const entry = join(scratch, "fixture.tsx");
  const output = join(scratch, "build");
  await writeFile(entry, `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Input, Select } from "antd";
import { Button } from ${JSON.stringify(join(frontend, "src/components/antd-compat.tsx"))};
import { ThemeProvider, useThemeMode } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeProvider.tsx"))};
import { ThemeToggleButton } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeToggleButton.tsx"))};
import { RoomCodeEditor } from ${JSON.stringify(join(frontend, "src/features/room/RoomCodeEditor.tsx"))};
import "antd/dist/reset.css";
import ${JSON.stringify(join(frontend, "public/theme-tokens.css"))};
import ${JSON.stringify(join(frontend, "src/styles/global.css"))};
const noop = () => {};
function Fixture() {
  const [value, setValue] = useState("first line\\nlast line");
  const { setMode } = useThemeMode();
  window.themeFixture = { setMode, value: () => value };
  return <main style={{ padding: 24 }}>
    <ThemeToggleButton />
    <Button data-testid="compat-button">Обычная кнопка</Button>
    <Input aria-label="Поле темы" defaultValue="Текст" style={{ width: 240 }} />
    <Select aria-label="Список темы" open value="one" options={[{ value: "one", label: "Вариант темы" }]} style={{ width: 240 }} />
    <div data-testid="theme-surface" style={{ marginTop: 80, background: "var(--app-surface)", color: "var(--app-text)", transition: "background-color 600ms ease, color 600ms ease" }}>Поверхность с переходом</div>
    <RoomCodeEditor height="240px" language="nodejs" value={value} syncKey="theme-editor" resyncSignal={0}
      readOnly={false} sessionId="theme-session" participantId="theme-user" participantLabel="Theme fixture"
      sendAwarenessUpdate={noop} onAwarenessBridgeReady={noop} onYjsUpdate={noop} onYjsBridgeReady={noop}
      onEditorValueChange={setValue} onKeyPress={noop} />
  </main>;
}
createRoot(document.getElementById("root")).render(<ThemeProvider><Fixture /></ThemeProvider>);
`);
  const compiler = rspack({
    ...config, context: frontend, mode: "production", devtool: false,
    entry: { fixture: entry },
    resolve: { ...config.resolve, modules: [join(frontend, "node_modules"), "node_modules"] },
    output: { ...config.output, path: output, filename: "[name].js", chunkFilename: "[name].[contenthash:8].js" },
    optimization: { splitChunks: { chunks: "all" }, runtimeChunk: "single" },
    plugins: config.plugins.filter(plugin => !["CopyRspackPlugin", "HtmlRspackPlugin"].includes(plugin.constructor.name)),
  });
  let stats;
  try {
    stats = await new Promise((done, reject) => compiler.run((error, result) => error ? reject(error) : done(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  } finally { await new Promise((done, reject) => compiler.close(error => error ? reject(error) : done())); }
  const assets = stats.toJson({ all: false, entrypoints: true }).entrypoints.fixture.assets.map(asset => asset.name);
  const html = `<!doctype html><html><head>${assets.filter(name => name.endsWith(".css")).map(name => `<link rel="stylesheet" href="/${name}">`).join("")}</head><body><div id="root"></div>${assets.filter(name => name.endsWith(".js")).map(name => `<script defer src="/${name}"></script>`).join("")}</body></html>`;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
    const path = resolve(output, `.${pathname}`);
    if (!path.startsWith(`${output}/`)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      response.setHeader("Content-Type", extname(path) === ".js" ? "application/javascript" : "text/css");
      response.end(body);
    } catch { response.writeHead(404).end(); }
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

async function open({ stored = "light", colorScheme = "light", blockedStorage = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme });
  await context.addInitScript(({ stored, preferenceKey, blockedStorage }) => {
    if (stored !== null) localStorage.setItem(preferenceKey, stored);
    if (blockedStorage) {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) {
        if (key === preferenceKey) throw new DOMException("Blocked theme preference", "SecurityError");
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (key === preferenceKey) throw new DOMException("Blocked theme preference", "SecurityError");
        return setItem.call(this, key, value);
      };
    }
  }, { stored, preferenceKey, blockedStorage });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByTestId("room-code-editor-host").locator(".cm-content").waitFor();
  await page.locator(".ant-select-dropdown .ant-select-item-option").waitFor();
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  return { context, page };
}

async function auditNextTheme(page) {
  await page.evaluate(() => {
    const selectors = ["[data-testid=compat-button]", ".ant-input", ".ant-select-dropdown", ".ant-select-item-option", ".cm-editor", "[data-testid=theme-surface]"];
    window.themeAudit = { frames: [], animations: [], ready: false };
    const observer = new MutationObserver(records => {
      if (!records.some(record => record.attributeName === "data-theme")) return;
      observer.disconnect();
      const start = performance.now();
      const sample = () => {
        window.themeAudit.animations.push(...document.getAnimations().flatMap(animation => {
          const frames = animation.effect?.getKeyframes() ?? [];
          const colors = frames.flatMap(frame => Object.keys(frame).filter(key => /color|shadow|fill|stroke|background/i.test(key)));
          return colors.length ? [{ type: animation.constructor.name, colors, target: animation.effect?.target?.className, frames: frames.slice(0, 2) }] : [];
        }));
        window.themeAudit.frames.push(selectors.map(selector => {
          const element = document.querySelector(selector);
          const style = getComputedStyle(element);
          return [selector, style.color, style.backgroundColor, style.borderColor];
        }));
        if (performance.now() - start < 350) requestAnimationFrame(sample);
        else window.themeAudit.ready = true;
      };
      requestAnimationFrame(sample);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });
}

async function assertInstant(page, expectedTheme) {
  await page.waitForFunction(() => window.themeAudit.ready);
  const actual = await page.evaluate(() => ({ ...window.themeAudit, theme: document.documentElement.dataset.theme }));
  assert.equal(actual.theme, expectedTheme);
  assert.equal(actual.animations.length, 0, `theme change never starts a color transition, including Ant Design portals: ${JSON.stringify(actual.animations.slice(0, 3))}`);
  assert.ok(actual.frames.length > 2, "multiple rendered frames were observed");
  for (const frame of actual.frames) assert.deepEqual(frame, actual.frames.at(-1), "the first rendered frame already uses final theme colors");
}

test("manual theme changes are instant across controls, portals and the existing collaborative editor", async () => {
  const { context, page } = await open();
  try {
    const content = page.getByTestId("room-code-editor-host").locator(".cm-content");
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" edited");
    const before = await page.getByTestId("room-code-editor-host").evaluate(host => {
      window.originalThemeEditor = host.__roomEditorView;
      const view = host.__roomEditorView;
      return { doc: view.state.doc.toString(), selection: view.state.selection.toJSON() };
    });
    assert.equal(await page.locator(".ant-select-dropdown").evaluate(element => !document.getElementById("root").contains(element)), true, "Ant Design popup is portaled outside the app root");
    for (const mode of ["dark", "light", "dark"]) {
      await auditNextTheme(page);
      await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
      await assertInstant(page, mode);
      const after = await page.getByTestId("room-code-editor-host").evaluate(host => ({
        sameView: host.__roomEditorView === window.originalThemeEditor,
        doc: host.__roomEditorView.state.doc.toString(), selection: host.__roomEditorView.state.selection.toJSON(),
      }));
      assert.equal(after.sameView, true, "theme does not recreate the Yjs editor");
      assert.equal(after.doc, before.doc);
      assert.deepEqual(after.selection, before.selection);
    }
    await content.click();
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction(() => window.themeFixture.value() === "first line\nlast line");
    assert.notEqual(await page.getByTestId("compat-button").evaluate(element => getComputedStyle(element).transitionDuration), "0s", "ordinary interaction transitions return after the theme switch");
  } finally { await context.close(); }
});

test("system appearance and cross-tab preferences use the same instant theme path", async () => {
  const { context, page } = await open({ stored: null });
  try {
    await auditNextTheme(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await assertInstant(page, "dark");
    const other = await context.newPage();
    await other.goto(origin);
    await other.getByRole("button", { name: "Тёмная тема", exact: true }).waitFor();
    await auditNextTheme(page);
    await other.evaluate(key => localStorage.setItem(key, "light"), preferenceKey);
    await assertInstant(page, "light");
    await auditNextTheme(page);
    await other.evaluate(key => localStorage.removeItem(key), preferenceKey);
    await assertInstant(page, "dark");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), null);
  } finally { await context.close(); }
});

test("rapid manual changes remain instant with blocked storage and restore normal interactions", async () => {
  const { context, page } = await open({ blockedStorage: true });
  try {
    await auditNextTheme(page);
    await page.evaluate(() => {
      window.themeFixture.setMode("dark");
      window.themeFixture.setMode("light");
      window.themeFixture.setMode("dark");
    });
    await assertInstant(page, "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "manual choice keeps priority when preference storage is blocked");
    assert.notEqual(await page.getByTestId("compat-button").evaluate(element => getComputedStyle(element).transitionDuration), "0s", "rapid switches do not leave transitions disabled");
  } finally { await context.close(); }
});
