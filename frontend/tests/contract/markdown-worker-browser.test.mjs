import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { rspack } from "@rspack/core";
import { chromium } from "playwright";
import config from "../../rspack.config.mjs";

// Component contract: real production Worker chunks, owned loopback server,
// synthetic Markdown only. No application/backend/database is started or used.
const frontend = fileURLToPath(new URL("../../", import.meta.url));
const sample = "# Условие\r\n\r\n- **Пункт**\n\n| Имя | Значение |\n| --- | --- |\n| A | B |\n\n[Документация](https://example.com)\n\n```ts\nconst answer: number = 42;\n```\n<script>window.markdownUnsafe = true</script><img src=x onerror='window.markdownUnsafe=true'><span style='color:red'>текст</span>\n[Опасная ссылка](javascript:alert(1))";
let scratch;
let server;
let browser;
let origin;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "interhub-markdown-browser-"));
  const entry = join(scratch, "fixture.tsx");
  const output = join(scratch, "build");
  await writeFile(entry, `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ThemeProvider } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeProvider.tsx"))};
    import { BriefingBoard } from ${JSON.stringify(join(frontend, "src/features/room/BriefingBoard.tsx"))};
    import 'antd/dist/reset.css';
    import ${JSON.stringify(join(frontend, "public/theme-tokens.css"))};
    import ${JSON.stringify(join(frontend, "src/styles/global.css"))};
    function Fixture() {
      const [markdown, setMarkdown] = useState(${JSON.stringify(sample)});
      const [visible, setVisible] = useState(true);
      const [documentKey, setDocumentKey] = useState('first');
      const [other, setOther] = useState('');
      const [readOnly, setReadOnly] = useState(false);
      const [focusMode, setFocusMode] = useState(false);
      window.fixture = { setMarkdown, setVisible, setDocumentKey, setReadOnly, setFocusMode, getMarkdown: () => markdown, getDocumentKey: () => documentKey };
      return <><label>Другой ввод<input aria-label="Другой ввод" value={other} onChange={e => setOther(e.target.value)} /></label>
        <button onClick={() => setVisible(v => !v)}>Переключить предпросмотр</button>
        {visible && <section style={{ height: 700 }}>
          <BriefingBoard mode="interviewer" value={markdown} onChange={setMarkdown} readOnly={readOnly} previewDocumentKey={documentKey} focusMode={focusMode} onFocusModeChange={setFocusMode} />
          <BriefingBoard mode="candidate" value={markdown} previewDocumentKey={documentKey} />
        </section>}</>;
    }
    const content = <ThemeProvider><Fixture /></ThemeProvider>;
    createRoot(document.getElementById('root')!).render(location.search.includes('strict') ? <React.StrictMode>{content}</React.StrictMode> : content);
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
    stats = await new Promise((resolveStats, reject) => compiler.run((error, result) => error ? reject(error) : resolveStats(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  } finally { await new Promise((resolveClose, reject) => compiler.close(error => error ? reject(error) : resolveClose())); }
  const assets = stats.toJson({ all: false, entrypoints: true }).entrypoints.fixture.assets.map(asset => asset.name);
  const html = `<!doctype html><html><head>${assets.filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/${name}">`).join('')}</head><body><div id="root"></div>${assets.filter(name => name.endsWith('.js')).map(name => `<script defer src="/${name}"></script>`).join('')}</body></html>`;
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
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function open({ strict = false, failWorker = false, holdWorker = false, colorScheme = "light", width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
  await context.addInitScript(holdWorker => {
    const NativeWorker = window.Worker;
    window.workerAudit = { created: 0, terminated: 0, posts: [], replies: 0, hold: holdWorker, pendingReplies: [], ticks: 0, ticksDuringWork: 0, processing: 0 };
    window.previewStatusAudit = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (/Готовим предпросмотр/.test(node.textContent ?? "")) window.previewStatusAudit.push(node.textContent);
      }
    }).observe(document, { childList: true, subtree: true });
    setInterval(() => { window.workerAudit.ticks++; if (window.workerAudit.processing) window.workerAudit.ticksDuringWork++; }, 5);
    window.releaseWorkerReplies = () => {
      window.workerAudit.hold = false;
      window.workerAudit.pendingReplies.splice(0).reverse().forEach(deliver => deliver());
    };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.workerAudit.created++; }
      postMessage(message, ...args) {
        window.workerAudit.posts.push({ id: message.id, markdown: message.markdown });
        window.workerAudit.processing++;
        return super.postMessage(message, ...args);
      }
      set onmessage(handler) {
        super.onmessage = event => {
          window.workerAudit.replies++;
          window.workerAudit.processing--;
          const deliver = () => handler?.call(this, event);
          if (window.workerAudit.hold) window.workerAudit.pendingReplies.push(deliver);
          else deliver();
        };
      }
      terminate() { window.workerAudit.terminated++; return super.terminate(); }
    };
  }, holdWorker);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  if (failWorker) await page.route("**/markdown-preview*.js", route => route.abort(), { times: 1 });
  await page.goto(`${origin}/${strict ? '?strict' : ''}`);
  await page.getByRole("textbox", { name: "Другой ввод", exact: true }).waitFor();
  return { context, page };
}

test("initial pending preview stays silent until the real Worker result arrives", async () => {
  const { context, page } = await open({ holdWorker: true });
  try {
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    const previews = page.getByTestId("room-markdown-preview");
    assert.equal(await previews.count(), 2);
    assert.equal(await previews.first().getAttribute("aria-busy"), "true");
    assert.equal(await previews.first().innerText(), "", "pending content does not masquerade as an empty document");
    assert.deepEqual(await page.evaluate(() => window.previewStatusAudit), [], "no transient loading status is mounted");
    await page.evaluate(() => window.releaseWorkerReplies());
    await previews.first().getByRole("heading", { name: "Условие", exact: true }).waitFor();
    assert.equal(await previews.first().getAttribute("aria-busy"), "false");
  } finally { await context.close(); }
});

test("clearing the actual source immediately clears retained preview and rejects a late reply", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown("# Поздний ответ после очистки"); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    const source = page.getByTestId("room-markdown-editor").locator(".cm-content");
    await source.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => window.fixture.getMarkdown() === "");
    assert.equal(await preview.getByRole("heading").count(), 0);
    assert.equal(await preview.getByText("Условие не добавлено", { exact: true }).count(), 1);
    await page.evaluate(() => window.releaseWorkerReplies());
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await preview.getByRole("heading").count(), 0, "late rendering cannot resurrect cleared source");
    assert.equal(await preview.getByText("Условие не добавлено", { exact: true }).count(), 1);
  } finally { await context.close(); }
});

test("document identity changes clear foreign preview without remounting the Board or accepting its late reply", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    const source = page.getByTestId("room-markdown-editor").locator(".cm-content");
    const sourceNode = await source.elementHandle();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown("# Поздний чужой документ"); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await preview.evaluate(element => {
      window.foreignPreviewAudit = [];
      const inspect = () => {
        if (window.fixture.getDocumentKey() === "other-document" && /Условие|Поздний чужой документ/.test(element.textContent)) window.foreignPreviewAudit.push(element.textContent);
      };
      new MutationObserver(inspect).observe(element, { childList: true, subtree: true, characterData: true });
      window.inspectForeignPreview = inspect;
    });
    await page.evaluate(() => { window.fixture.setDocumentKey("other-document"); window.fixture.setMarkdown("# Новый документ"); });
    await page.waitForFunction(() => window.fixture.getDocumentKey() === "other-document" && document.querySelector(".cm-content")?.textContent.includes("Новый документ"));
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => { window.inspectForeignPreview(); requestAnimationFrame(() => { window.inspectForeignPreview(); done(); }); })));
    assert.equal(await sourceNode.evaluate(element => element === document.querySelector(".cm-content")), true, "only preview identity changed; the Board and editor were not remounted");
    assert.equal(await preview.getByRole("heading").count(), 0, "foreign successful HTML is not retained while the new document loads");
    assert.deepEqual(await page.evaluate(() => window.foreignPreviewAudit), []);
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("heading", { name: "Новый документ", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Поздний чужой документ", exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.foreignPreviewAudit), []);
  } finally { await context.close(); }
});

test("committed A to pending B to pending A never resurrects retired successful HTML", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    const source = await page.getByTestId("room-markdown-editor").locator(".cm-content").elementHandle();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setDocumentKey("document-B"); window.fixture.setMarkdown("# Приватный B"); });
    await page.waitForFunction(() => window.fixture.getDocumentKey() === "document-B" && window.workerAudit.pendingReplies.length > 0);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await preview.getByRole("heading").count(), 0, "B is genuinely committed and pending, so A has been retired");
    await page.evaluate(() => { window.fixture.setDocumentKey("first"); window.fixture.setMarkdown("# Возвращённый A"); });
    await page.waitForFunction(() => window.fixture.getDocumentKey() === "first" && document.querySelector(".cm-content")?.textContent.includes("Возвращённый A"));
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await preview.getByRole("heading").count(), 0, "returning to the old identity needs a fresh result instead of the retired A HTML");
    assert.equal(await source.evaluate(element => element === document.querySelector(".cm-content")), true, "the editor was reused across both committed identity changes");
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("heading", { name: "Возвращённый A", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Приватный B", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Условие", exact: true }).count(), 0);
  } finally { await context.close(); }
});

test("committed empty source followed by keyboard Undo waits for a fresh preview", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    const source = page.getByTestId("room-markdown-editor").locator(".cm-content");
    await source.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => window.fixture.getMarkdown() === "");
    await preview.getByText("Условие не добавлено", { exact: true }).waitFor();
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.evaluate(() => { window.workerAudit.hold = true; });
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction(() => window.fixture.getMarkdown().startsWith("# Условие") && window.workerAudit.pendingReplies.length > 0);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await preview.getByRole("heading").count(), 0, "Undo cannot resurrect HTML retired by the committed clear");
    assert.equal(await preview.innerText(), "", "nonempty pending Undo source is not shown as an empty document");
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
  } finally { await context.close(); }
});

test("a new document identity with identical Markdown still retires the previous DOM before fresh replies", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    const previous = await preview.locator(":scope > div").elementHandle();
    const posts = await page.evaluate(() => window.workerAudit.posts.length);
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setDocumentKey("identical-markdown-other-document"); });
    await page.waitForFunction(posts => window.workerAudit.posts.length > posts && window.workerAudit.pendingReplies.length > 0, posts);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await previous.evaluate(element => element.isConnected), false, "matching source text does not authorize retaining the previous context's DOM");
    assert.equal(await preview.getByRole("heading").count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.getMarkdown()), sample, "the source really is byte-for-byte unchanged");
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
  } finally { await context.close(); }
});

test("a real Worker error after a successful preview stays visible and retries the current source", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown("# Текущий документ после ошибки"); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await page.workers()[0].evaluate(() => { setTimeout(() => { throw new Error("Synthetic isolated Worker crash"); }, 0); });
    await preview.getByRole("alert").waitFor();
    assert.equal(await preview.getByRole("heading").count(), 0, "a retained successful preview cannot hide a current rendering error");
    assert.equal(await preview.getByText("Не удалось подготовить предпросмотр.", { exact: true }).count(), 1);
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("button", { name: "Повторить предпросмотр", exact: true }).click();
    await preview.getByRole("heading", { name: "Текущий документ после ошибки", exact: true }).waitFor();
    assert.equal(await preview.getByRole("alert").count(), 0);
    assert.ok(await page.evaluate(() => window.workerAudit.created >= 2), "retry creates a healthy real Worker");
  } finally { await context.close(); }
});

for (const colorScheme of ["light", "dark"]) for (const panelMode of ["compact", "expanded", "focus"]) {
  test(`continuous Markdown typing preserves painted preview, node and scroll in ${panelMode} ${colorScheme}`, async () => {
    const { context, page } = await open({ colorScheme, width: 1280 });
    try {
      const manager = page.getByTestId("briefing-board-interviewer");
      const preview = manager.getByTestId("room-markdown-preview");
      const largeMarkdown = "# Стабильный предпросмотр\n\n" + Array.from({ length: 1250 }, (_, index) => `Строка ${index}: **данные** для проверки прокрутки.`).join("\n\n") + "\n\nИсходный хвост";
      await page.evaluate(markdown => window.fixture.setMarkdown(markdown), largeMarkdown);
      await preview.getByRole("heading", { name: "Стабильный предпросмотр", exact: true }).waitFor();
      if (panelMode === "compact") await manager.evaluate(element => { element.style.height = "280px"; element.style.width = "960px"; });
      if (panelMode === "expanded") await manager.getByRole("button", { name: "Развернуть markdown", exact: true }).click();
      if (panelMode === "focus") await page.evaluate(() => window.fixture.setFocusMode(true));
      const source = manager.getByTestId("room-markdown-editor").locator(".cm-content");
      await source.click();
      await page.keyboard.press("ControlOrMeta+End");
      await preview.evaluate(element => {
        element.scrollTop = 120;
        const content = element.firstElementChild;
        window.pendingPreviewAudit = { content, scrollTop: element.scrollTop, frameGaps: [], hiddenFrames: [], removed: [], frames: 0, running: true };
        const audit = window.pendingPreviewAudit;
        new MutationObserver(records => {
          for (const record of records) for (const node of record.removedNodes) {
            if (node === content || node.contains?.(content)) audit.removed.push("preview content detached");
          }
        }).observe(element, { childList: true, subtree: true });
        const sample = () => {
          if (!audit.running) return;
          audit.frames++;
          if (element.firstElementChild !== content || !content?.isConnected || !element.textContent.includes("Стабильный предпросмотр")) audit.frameGaps.push("preview disappeared");
          const bounds = element.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.top >= innerHeight) audit.hiddenFrames.push("preview has no visible area");
          for (let node = content; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 || style.contentVisibility === "hidden") audit.hiddenFrames.push("preview hidden by CSS");
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        window.workerAudit.hold = true;
        window.previewStatusAudit = [];
      });
      const before = await preview.boundingBox();
      const originalScroll = await page.evaluate(() => window.pendingPreviewAudit.scrollTop);
      assert.ok(originalScroll > 0, "large preview is genuinely scrolled before typing");
      for (const text of [" новый", " ввод", " без мерцания"]) {
        await page.keyboard.insertText(text);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      }
      await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
      await page.waitForFunction(() => window.fixture.getMarkdown().endsWith("Исходный хвост новый ввод без мерцания"));
      const pending = await preview.boundingBox();
      assert.ok(before && pending);
      for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(before[dimension] - pending[dimension]) <= 1, `pending preview preserves ${dimension}`);
      const audit = await preview.evaluate(element => {
        const audit = window.pendingPreviewAudit;
        return { sameNode: element.firstElementChild === audit.content, connected: audit.content?.isConnected,
          scrollTop: element.scrollTop, frameGaps: audit.frameGaps, hiddenFrames: audit.hiddenFrames, removed: audit.removed, frames: audit.frames };
      });
      assert.equal(audit.sameNode, true, "pending work keeps the last successful content DOM node");
      assert.equal(audit.connected, true, "last successful preview remains attached while typing");
      assert.ok(audit.frames >= 3, "painted frames were sampled across consecutive real keyboard edits");
      assert.deepEqual(audit.frameGaps, [], "last successful preview never disappears in a rendered frame");
      assert.deepEqual(audit.hiddenFrames, [], "the preview and its ancestors stay visually visible in every sampled frame");
      assert.deepEqual(audit.removed, [], "last successful preview is never detached even between frame samples");
      assert.equal(audit.scrollTop, originalScroll, "pending renders preserve preview scroll");
      assert.equal(await preview.getByRole("status").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.previewStatusAudit), [], "each edit stays silent even between browser observations");
      await page.evaluate(() => window.releaseWorkerReplies());
      await preview.getByText("Исходный хвост новый ввод без мерцания", { exact: true }).waitFor();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.evaluate(() => { window.workerAudit.hold = true; });
      await page.keyboard.insertText(" ещё");
      await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0 && window.fixture.getMarkdown().endsWith("без мерцания ещё"));
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.evaluate(() => window.releaseWorkerReplies());
      await preview.getByText("Исходный хвост новый ввод без мерцания ещё", { exact: true }).waitFor();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const completed = await preview.evaluate(element => {
        const audit = window.pendingPreviewAudit;
        audit.running = false;
        return { sameNode: element.firstElementChild === audit.content, frameGaps: audit.frameGaps, hiddenFrames: audit.hiddenFrames, removed: audit.removed, scrollTop: element.scrollTop };
      });
      assert.equal(completed.sameNode, true, "completing successive renders preserves the same content wrapper");
      assert.deepEqual(completed.frameGaps, [], "neither pending work nor fresh replies produce an empty painted frame");
      assert.deepEqual(completed.hiddenFrames, [], "fresh replies never hide the preview through CSS");
      assert.deepEqual(completed.removed, [], "content stays mounted through both complete render cycles");
      assert.equal(completed.scrollTop, originalScroll, "fresh results also preserve preview scroll");
      assert.equal(await preview.getByRole("heading", { name: "Стабильный предпросмотр", exact: true }).count(), 1);
    } finally { await context.close(); }
  });
}

test("real Worker preserves Markdown, shares pending previews and sanitizes before display", async () => {
  const { context, page } = await open();
  try {
    const previews = page.getByTestId("room-markdown-preview");
    await previews.first().getByRole("heading", { name: "Условие", exact: true }).waitFor();
    assert.equal(await previews.getByRole("heading", { name: "Условие", exact: true }).count(), 2);
    assert.equal(await previews.first().locator("table").count(), 1);
    assert.ok(await previews.first().locator("code .hljs-keyword").count());
    assert.equal(await previews.first().getByRole("link", { name: "Документация" }).getAttribute("target"), "_blank");
    assert.equal(await previews.locator("script,[onerror],[style]").count(), 0);
    assert.equal(await previews.locator("a[href^='javascript:']").count(), 0);
    assert.equal(await page.evaluate(() => window.markdownUnsafe), undefined);
    assert.equal(await page.evaluate(() => window.workerAudit.created), 1, "two previews use one Worker");
    assert.equal(await page.evaluate(() => window.workerAudit.posts.length), 1, "identical pending text is parsed once");
    assert.equal(await page.workers()[0].evaluate(() => typeof document), "undefined", "parser runs without window DOM");
  } finally { await context.close(); }
});

test("new input wins over delayed Worker replies; empty text and document changes discard old work", async () => {
  const { context, page } = await open();
  try {
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown('# Прежний ответ'); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await page.evaluate(() => window.fixture.setMarkdown('# Актуальный ответ'));
    await page.evaluate(() => window.releaseWorkerReplies());
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Актуальный ответ" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Прежний ответ" }).count(), 0);
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown('# Отменённый ответ'); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await page.evaluate(() => { window.fixture.setMarkdown(''); window.fixture.setDocumentKey('next'); window.releaseWorkerReplies(); });
    await page.getByText("Условие не добавлено", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("heading", { name: "Отменённый ответ" }).count(), 0);
    await page.getByRole("button", { name: "Переключить предпросмотр", exact: true }).click();
    await page.waitForFunction(() => window.workerAudit.terminated === window.workerAudit.created);
  } finally { await context.close(); }
});

test("5000 code lines parse in Worker while another input remains usable", async () => {
  const { context, page } = await open();
  try {
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    const code = Array.from({ length: 5000 }, (_, index) => `const item${index}: number = ${index}; // строка ${index}`).join('\n');
    await page.evaluate(markdown => { window.workerAudit.ticksDuringWork = 0; window.fixture.setMarkdown(markdown); }, `# Большой документ\n\n\`\`\`ts\n${code}\n\`\`\``);
    await page.getByRole("textbox", { name: "Другой ввод", exact: true }).fill("независимый ввод");
    assert.equal(await page.getByRole("textbox", { name: "Другой ввод", exact: true }).inputValue(), "независимый ввод");
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Большой документ" }).waitFor();
    assert.ok((await preview.locator('pre').innerText()).includes('item4999'));
    assert.ok(await page.evaluate(() => window.workerAudit.ticksDuringWork > 0), "main-thread timers continue during Worker processing");
    assert.equal(await page.evaluate(() => window.workerAudit.posts.filter(post => post.markdown.includes('item4999')).length), 1);
  } finally { await context.close(); }
});

test("returning to previous text discards the intermediate queued document", async () => {
  const { context, page } = await open();
  try {
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    await page.evaluate(() => { window.workerAudit.hold = true; window.fixture.setMarkdown('# Возврат A'); });
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await page.evaluate(() => window.fixture.setMarkdown('# Промежуточный B'));
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Промежуточный B'));
    await page.evaluate(() => window.fixture.setMarkdown('# Возврат A'));
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Возврат A'));
    await page.evaluate(() => window.releaseWorkerReplies());
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Возврат A", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Промежуточный B" }).count(), 0);
    assert.equal(await page.evaluate(() => window.workerAudit.posts.filter(post => post.markdown.includes('Промежуточный B')).length), 0);
  } finally { await context.close(); }
});

test("failed Worker loading keeps source editable and retry renders current Markdown", async () => {
  const { context, page } = await open({ failWorker: true });
  try {
    await page.getByRole("alert").first().waitFor();
    assert.ok((await page.locator('.cm-content').first().innerText()).includes('Условие'));
    await page.getByRole("textbox", { name: "Другой ввод", exact: true }).fill("доступно");
    await page.getByRole("button", { name: "Повторить предпросмотр", exact: true }).first().click();
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    assert.ok(await page.evaluate(() => window.workerAudit.created >= 2));
  } finally { await context.close(); }
});

test("StrictMode cleanup and remount leave one active Worker and release it after unmount", async () => {
  const { context, page } = await open({ strict: true });
  try {
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    assert.equal(await page.evaluate(() => window.workerAudit.created - window.workerAudit.terminated), 1);
    await page.getByRole("button", { name: "Переключить предпросмотр", exact: true }).click();
    await page.waitForFunction(() => window.workerAudit.created === window.workerAudit.terminated);
    await page.getByRole("button", { name: "Переключить предпросмотр", exact: true }).click();
    await page.getByTestId("room-markdown-preview").first().getByRole("heading", { name: "Условие" }).waitFor();
    assert.equal(await page.evaluate(() => window.workerAudit.created - window.workerAudit.terminated), 1);
  } finally { await context.close(); }
});

test("room Markdown limit reflects server boundaries, emoji and NUL without waiting for preview", async () => {
  const { context, page } = await open();
  try {
    const counter = page.getByLabel("Объём Markdown", { exact: true });
    await counter.waitFor();
    await page.evaluate(() => { window.workerAudit.hold = true; });
    for (const length of [119_999, 120_000, 120_001]) {
      await page.evaluate(length => window.fixture.setMarkdown('я'.repeat(length)), length);
      await page.waitForFunction(length => document.querySelector('[aria-label="Объём Markdown"]')?.textContent.replace(/\s/g, '') === `${length}/120000символов`, length);
      assert.equal(await page.getByText("Лимит достигнут", { exact: true }).count(), length === 120_000 ? 1 : 0);
      assert.equal(await page.getByTestId("markdown-limit-warning").count(), length > 120_000 ? 1 : 0);
      if (length > 120_000) {
        const warning = page.getByTestId("markdown-limit-warning");
        assert.match((await warning.innerText()).replace(/\s/g, ' '), /Сохраняются первые 120 000 символов/);
        assert.match(await warning.innerText(), /Будет обрезано: 1\./);
      }
    }
    const unicode = 'я'.repeat(119_998) + '\u0000😀\u0000';
    await page.evaluate(value => window.fixture.setMarkdown(value), unicode);
    await page.getByText("Лимит достигнут", { exact: true }).waitFor();
    assert.equal((await counter.innerText()).replace(/\s/g, ''), '120000/120000символов');
    assert.equal(await page.getByTestId("markdown-limit-warning").count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.getMarkdown()), unicode, "counting must not normalize or truncate the source");
    await page.evaluate(() => { window.fixture.setMarkdown(''); window.fixture.setDocumentKey('empty'); });
    await page.waitForFunction(() => document.querySelector('[aria-label="Объём Markdown"]')?.textContent.replace(/\s/g, '') === '0/120000символов');
    assert.equal(await page.getByText("Лимит достигнут", { exact: true }).count(), 0);
    assert.equal(await page.getByTestId("markdown-limit-warning").count(), 0);
  } finally { await context.close(); }
});

test("room Markdown limit warns on paste and deletion while callbacks retain the full source", async () => {
  const { context, page } = await open();
  try {
    await page.evaluate(() => window.fixture.setMarkdown('я'.repeat(119_999)));
    await page.getByLabel("Объём Markdown", { exact: true }).waitFor();
    const source = page.getByTestId("room-markdown-editor").locator('.cm-content');
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    const tail = '😀\n' + 'хвост'.repeat(1000);
    await source.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, tail);
    await page.getByTestId("markdown-limit-warning").waitFor();
    const expected = 'я'.repeat(119_999) + tail;
    assert.equal(await page.evaluate(() => window.fixture.getMarkdown()), expected);
    assert.match((await page.getByTestId("markdown-limit-warning").innerText()).replace(/\s/g, ''), /Будетобрезано:5002\./);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => window.fixture.getMarkdown() === '');
    assert.equal((await page.getByLabel("Объём Markdown", { exact: true }).innerText()).replace(/\s/g, ''), '0/120000символов');
    assert.equal(await page.getByTestId("markdown-limit-warning").count(), 0);
  } finally { await context.close(); }
});

test("room Markdown limit stays visible in compact and expanded panels in both themes, only when editable", async () => {
  for (const colorScheme of ['light', 'dark']) {
    const { context, page } = await open({ colorScheme, width: 768 });
    try {
      await page.evaluate(() => window.fixture.setMarkdown('я'.repeat(120_001)));
      const manager = page.getByTestId('briefing-board-interviewer');
      const warning = manager.getByTestId('markdown-limit-warning');
      await warning.waitFor();
      assert.equal(await page.getByTestId('briefing-board-candidate').getByLabel('Объём Markdown', { exact: true }).count(), 0);
      assert.equal(await page.locator('html').getAttribute('data-theme'), colorScheme);
      await manager.evaluate(element => { element.style.width = '360px'; element.style.height = '180px'; });
      const geometry = await warning.evaluate(element => {
        const box = element.getBoundingClientRect();
        const panel = element.closest('[data-testid="briefing-board-interviewer"]').getBoundingClientRect();
        const style = getComputedStyle(element.parentElement);
        const rootStyle = getComputedStyle(document.documentElement);
        const probe = document.createElement('span');
        probe.style.color = rootStyle.getPropertyValue('--app-warning');
        document.body.append(probe);
        const expectedColor = getComputedStyle(probe).color;
        probe.remove();
        return { box: box.toJSON(), panel: panel.toJSON(), color: style.color, expectedColor, overflow: element.parentElement.scrollWidth > element.parentElement.clientWidth };
      });
      assert.ok(geometry.box.top >= geometry.panel.top && geometry.box.bottom <= geometry.panel.bottom, 'warning is visible inside the compact panel');
      assert.equal(geometry.overflow, false, 'warning wraps instead of overflowing horizontally');
      assert.equal(geometry.color, geometry.expectedColor, 'warning follows the active theme');
      await manager.getByRole('button', { name: 'Развернуть markdown', exact: true }).click();
      assert.equal(await manager.getAttribute('data-expanded'), 'on');
      assert.equal(await warning.isVisible(), true);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.fixture.setReadOnly(true));
      await page.waitForFunction(() => !document.querySelector('[aria-label="Объём Markdown"]'));
      assert.equal(await page.getByTestId('markdown-limit-warning').count(), 0);
    } finally { await context.close(); }
  }
});
