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
      window.fixture = { setMarkdown, setVisible, setDocumentKey, setReadOnly, getMarkdown: () => markdown };
      return <><label>Другой ввод<input aria-label="Другой ввод" value={other} onChange={e => setOther(e.target.value)} /></label>
        <button onClick={() => setVisible(v => !v)}>Переключить предпросмотр</button>
        {visible && <section key={documentKey} style={{ height: 700 }}>
          <BriefingBoard mode="interviewer" value={markdown} onChange={setMarkdown} readOnly={readOnly} />
          <BriefingBoard mode="candidate" value={markdown} />
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

test("continuous Markdown typing has no loading status and keeps preview panel geometry stable", async () => {
  const { context, page } = await open();
  try {
    const preview = page.getByTestId("room-markdown-preview").first();
    await preview.getByRole("heading", { name: "Условие", exact: true }).waitFor();
    const before = await preview.boundingBox();
    await page.evaluate(() => { window.workerAudit.hold = true; window.previewStatusAudit = []; });
    const source = page.getByTestId("room-markdown-editor").locator(".cm-content");
    await source.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("# Набор");
    await page.waitForFunction(() => window.workerAudit.pendingReplies.length > 0);
    await page.keyboard.insertText(" продолжается");
    await page.keyboard.insertText(" без статуса");
    await page.waitForFunction(() => window.fixture.getMarkdown() === "# Набор продолжается без статуса");
    const pending = await preview.boundingBox();
    assert.ok(before && pending);
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(Math.abs(before[dimension] - pending[dimension]) <= 1, `pending preview preserves ${dimension}`);
    }
    assert.equal(await preview.getByRole("status").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.previewStatusAudit), [], "each edit stays silent even between browser observations");
    await page.evaluate(() => window.releaseWorkerReplies());
    await preview.getByRole("heading", { name: "Набор продолжается без статуса", exact: true }).waitFor();
    assert.equal(await preview.getByRole("heading", { name: "Набор", exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.previewStatusAudit), []);
  } finally { await context.close(); }
});

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
