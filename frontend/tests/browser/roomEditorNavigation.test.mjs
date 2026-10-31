import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { chromium } from "playwright";
import config from "../../rspack.config.mjs";

// Real panels, styles and CodeMirror. No application backend or user runtime.
const frontend = fileURLToPath(new URL("../../", import.meta.url));
let scratch, server, browser, origin;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "interhub-editor-navigation-"));
  const entry = join(scratch, "fixture.tsx");
  const output = join(scratch, "build");
  await writeFile(entry, `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeProvider.tsx"))};
import { RoomContextPanels, RoomContextSurface } from ${JSON.stringify(join(frontend, "src/features/room/RoomContextPanels.tsx"))};
import { RoomCodeEditor } from ${JSON.stringify(join(frontend, "src/features/room/RoomCodeEditor.tsx"))};
import "antd/dist/reset.css";
import ${JSON.stringify(join(frontend, "public/theme-tokens.css"))};
import ${JSON.stringify(join(frontend, "src/styles/global.css"))};
const noop = () => {};
function Fixture() {
  const [room, setRoom] = useState("first-room");
  const [code, setCode] = useState("const first = 1;\\nconst last = 2;");
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <button type="button" onClick={() => setRoom("second-room")}>Другая комната</button>
    <RoomContextPanels layoutKey={room} showCondition={false} headerAction={<button type="button">Режим комнаты — Code</button>}>
      <RoomContextSurface name="editor"><RoomCodeEditor height="100%" language="nodejs" value={code}
        syncKey={room} resyncSignal={0} readOnly={new URLSearchParams(location.search).has("readonly")} sessionId="navigation" participantId="navigation" participantLabel="Navigation"
        sendAwarenessUpdate={noop} onAwarenessBridgeReady={noop} onYjsUpdate={noop} onYjsBridgeReady={noop}
        onEditorValueChange={setCode} onKeyPress={noop} /></RoomContextSurface>
      <RoomContextSurface name="steps"><button type="button">Первая задача</button></RoomContextSurface>
      <RoomContextSurface name="notes"><textarea aria-label="Черновик заметки" /></RoomContextSurface>
      <RoomContextSurface name="chat"><textarea aria-label="Черновик чата" /></RoomContextSurface>
      <RoomContextSurface name="activity"><p>История активности</p></RoomContextSurface>
    </RoomContextPanels>
  </div>;
}
createRoot(document.getElementById("root")).render(<ThemeProvider><Fixture /></ThemeProvider>);
`);
  const compiler = rspack({ ...config, context: frontend, mode: "development", devtool: false,
    entry: { fixture: entry },
    resolve: { ...config.resolve, alias: { components: join(frontend, "src/components") }, modules: [join(frontend, "node_modules"), "node_modules"] },
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

async function openFixture({ theme = "light", width = 768, height = 800, readOnly = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(theme => localStorage.setItem("interview-online:ui-theme", theme), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(`${origin}${readOnly ? "?readonly" : ""}`);
  await page.locator('[data-room-context-mode="focus"]').waitFor();
  return { context, page };
}

const editor = page => page.locator('#room-context-region-editor');

for (const theme of ["light", "dark"]) {
  test(`narrow entry, reload and room change always open the editor in ${theme}`, async () => {
    const { context, page } = await openFixture({ theme });
    try {
      assert.equal(await editor(page).getAttribute("data-room-context-visible"), "true", "entry must open editor, not steps");
      assert.equal(await page.getByRole("tab", { selected: true }).count(), 0);
      assert.equal(await page.getByRole("tab", { name: "Редактор", exact: true }).count(), 0);
      await page.getByRole("tab", { name: "Чат", exact: true }).click();
      await page.getByLabel("Черновик чата").fill("Локальный черновик");
      await page.reload();
      await page.locator('[data-room-context-mode="focus"]').waitFor();
      assert.equal(await editor(page).getAttribute("data-room-context-visible"), "true", "reload must open editor");
      await page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
      await page.getByRole("button", { name: "Другая комната", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#room-context-region-editor')?.dataset.roomContextVisible === "true");
    } finally { await context.close(); }
  });

  for (const viewport of [{ width: 960, height: 640 }, { width: 640, height: 400 }]) {
    test(`all auxiliary panels have an obvious keyboard return at ${viewport.width}x${viewport.height} ${theme}`, async () => {
      const { context, page } = await openFixture({ theme, ...viewport });
      try {
        for (const name of ["Шаги", "Мои заметки", "Чат", "Активность"]) {
          await page.getByRole("tab", { name, exact: true }).click();
          const back = page.getByRole("button", { name: "Вернуться к редактору", exact: true });
          assert.equal((await back.innerText()).trim(), "Вернуться к редактору", "visible label must describe the action fully");
          const appearance = await back.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const root = element.closest('[data-room-context-mode]');
            return { width: rect.width, height: rect.height, x: rect.x, y: rect.y,
              right: rect.right, bottom: rect.bottom, rootWidth: root.getBoundingClientRect().width,
              background: getComputedStyle(element).backgroundColor,
              parentBackground: getComputedStyle(element.parentElement).backgroundColor };
          });
          assert.ok(appearance.width >= appearance.rootWidth - 28, `return must occupy its own full-width row: ${JSON.stringify(appearance)}`);
          assert.ok(appearance.height >= 36);
          assert.ok(appearance.x >= 0 && appearance.right <= viewport.width && appearance.y >= 0 && appearance.bottom <= viewport.height);
          assert.notEqual(appearance.background, "rgba(0, 0, 0, 0)", "return must have a visible filled background");
          assert.notEqual(appearance.background, appearance.parentBackground);
          await back.focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(() => document.querySelector('#room-context-region-editor')?.dataset.roomContextVisible === "true");
          assert.equal(await page.locator('.cm-content').evaluate(element => element === document.activeElement), true, "return restores editor focus");
        }
      } finally { await context.close(); }
    });
  }
}

test("return preserves the existing editor, selected text, draft and undo", async () => {
  const { context, page } = await openFixture();
  try {
    // Enter through the existing public return action so this also checks the
    // old implementation's navigation independently of its wrong default.
    if (await editor(page).getAttribute("data-room-context-visible") !== "true") await page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
    const content = page.locator('.cm-content');
    const node = await content.elementHandle();
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("changed");
    await page.keyboard.press("Shift+ArrowLeft");
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    const text = await content.innerText();
    await page.getByRole("tab", { name: "Чат", exact: true }).click();
    await page.getByLabel("Черновик чата").fill("Не потерять черновик");
    await page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
    assert.equal(await node.evaluate(element => element === document.querySelector('.cm-content')), true);
    assert.equal(await content.innerText(), text);
    assert.equal(await content.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), selected);
    await page.keyboard.press("ControlOrMeta+z");
    assert.doesNotMatch(await content.innerText(), /changed/);
    await page.getByRole("tab", { name: "Чат", exact: true }).click();
    assert.equal(await page.getByLabel("Черновик чата").inputValue(), "Не потерять черновик");
  } finally { await context.close(); }
});

test("return is keyboard accessible when the editor is read only", async () => {
  const { context, page } = await openFixture({ readOnly: true });
  try {
    await page.getByRole("tab", { name: "Чат", exact: true }).click();
    const back = page.getByRole("button", { name: "Вернуться к редактору", exact: true });
    await back.focus();
    await page.keyboard.press("Enter");
    assert.equal(await editor(page).getAttribute("data-room-context-visible"), "true");
    assert.equal(await editor(page).evaluate(element => element.contains(document.activeElement)), true, "focus remains in the visible editor region even when content is not editable");
  } finally { await context.close(); }
});
