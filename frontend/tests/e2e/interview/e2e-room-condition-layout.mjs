import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const web = process.env.E2E_BASE_URL ?? "http://localhost:15173";
const api = process.env.E2E_API_URL ?? "http://localhost:18080/api";
async function req(path, auth, body) {
  const response = await fetch(api + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${path}: ${response.status}`); return response.json();
}
async function open(viewport) {
  const auth = await req("/auth/register", null, { nickname: `condition_${randomUUID().slice(0,10)}`, displayName: "Интервьюер условия", password: "test-password-123" });
  const task = await req("/me/tasks", auth, { title: "Условие отдельной области", description: "Длинное условие\n\n" + "Описание задачи с прокруткой. ".repeat(90), starterCode: "const conditionLayout = true;", language: "nodejs" });
  const room = await req("/rooms", auth, { title: "Постоянное условие", taskIds: [task.id] });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(({token,user}) => { localStorage.setItem("auth_token",token);localStorage.setItem("auth_user",JSON.stringify(user)); }, auth);
    const page = await context.newPage();page.setDefaultTimeout(8000);
    await page.goto(`${web}/room/${room.inviteCode}`);await page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute("data-state") === "online");
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
test("condition stays outside the four tabs and collapse preserves its mounted editor and draft", async () => {
  const { browser, page } = await open({ width: 1366, height: 850 });
  try {
    const toggle = page.getByRole("button", { name: "Свернуть условие", exact: true });
    await toggle.waitFor(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const tabs = page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true });
    assert.deepEqual(await tabs.getByRole("tab").allTextContents(), ["Шаги", "Мои заметки", "Чат", "Активность"]);
    assert.equal(await tabs.getByRole("tab", { name: "Шаги", exact: true }).getAttribute("aria-selected"), "true");
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    for (const name of ["Мои заметки", "Чат", "Активность", "Шаги"]) {
      await tabs.getByRole("tab", { name, exact: true }).click(); assert.ok(await condition.isVisible());
    }
    await tabs.getByRole("tab", { name: "Мои заметки", exact: true }).click();
    const editor = condition.getByTestId("room-markdown-editor").locator(".cm-content");
    await editor.fill("# Черновик условия\nСохраняется при сворачивании.");
    assert.equal(await tabs.getByRole("tab", { name: "Мои заметки", exact: true }).getAttribute("aria-selected"), "true", "condition editing does not change the auxiliary tab");
    await page.evaluate(() => { window.__conditionEditorNode = document.querySelector('#room-context-region-condition .cm-content'); });
    await toggle.click();
    const expand = page.getByRole("button", { name: "Развернуть условие", exact: true });
    assert.equal(await expand.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#room-context-region-condition").getAttribute("aria-hidden"), "true");
    assert.equal(await page.evaluate(() => window.__conditionEditorNode === document.querySelector('#room-context-region-condition .cm-content')), true);
    await expand.click();
    assert.equal(await editor.innerText(), "# Черновик условия\nСохраняется при сворачивании.");
    assert.equal(await page.evaluate(() => window.__conditionEditorNode === document.querySelector('#room-context-region-condition .cm-content')), true);
    assert.equal(await tabs.getByRole("tab", { name: "Мои заметки", exact: true }).getAttribute("aria-selected"), "true");
  } finally { await browser.close(); }
});
test("short tablet room starts with steps and keeps condition, controls and editor reachable in both themes", async () => {
  const { browser, page } = await open({ width: 768, height: 520 });
  try {
    const steps = page.getByRole("tab", { name: "Шаги", exact: true });
    await page.waitForFunction(() => document.querySelector('#room-context-tab-steps')?.getAttribute('aria-selected') === 'true');
    assert.equal(await steps.getAttribute("aria-selected"), "true");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { localStorage.setItem("interview-online:ui-theme",theme);window.dispatchEvent(new StorageEvent("storage",{key:"interview-online:ui-theme",newValue:theme})); }, theme);
      const condition = page.getByRole("region", { name: "Условие", exact: true });
      assert.ok(await condition.isVisible());
      const box = await condition.boundingBox(); assert.ok(box.height <= 520 * .35 + 1 && box.height > 40);
      await page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
      await page.getByRole("region", { name: "Редактор", exact: true }).waitFor();
      assert.ok(await condition.isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole("button", { name: "Свернуть условие", exact: true }).click();
      await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
      await steps.click();
    }
  } finally { await browser.close(); }
});

test("expanded condition leaves chat and notes composers visible when focused in a short narrow viewport", async () => {
  const { browser, page } = await open({ width: 768, height: 1024 });
  try {
    for (const viewport of [{ width: 384, height: 512 }, { width: 819, height: 480 }, { width: 512, height: 300 }]) {
    await page.setViewportSize(viewport);
    for (const [tab, testId, sendId] of [["Мои заметки", "room-private-notes-input", "room-private-notes-send"], ["Чат", "room-notes-input", "room-notes-send"]]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const input = page.getByTestId(testId);
    await input.focus();
    await input.fill(Array.from({length: 12}, (_, index) => `Доступный черновик ${index}`).join("\n"));
    await input.press("End");
    const geometry = await input.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const rect = node => { const box = node.getBoundingClientRect(); return { y: box.y, height: box.height, bottom: box.bottom, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop }; };
      return { input: rect(element), condition: rect(document.querySelector('[data-condition-expanded]')), root: rect(document.querySelector('[data-room-context-mode]')), surface: rect(element.closest('[data-room-context-surface]')), ancestors: [element.parentElement, element.parentElement.parentElement, element.closest('[data-room-context-surface]')?.querySelector('[class*="surfaceBody"]')].filter(Boolean).map(rect), insideViewport: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth };
    });
    assert.equal(geometry.insideViewport, true, `focused ${tab} composer is clipped: ${JSON.stringify(geometry)}`);
    await input.press("Tab");
    const send = page.getByTestId(sendId);
    assert.equal(await send.evaluate(element => element === document.activeElement), true, "Tab must reach the composer action");
    const actionGeometry = await send.evaluate(element => { const bounds = element.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight }; });
    assert.ok(actionGeometry.top >= 0 && actionGeometry.bottom <= actionGeometry.viewportHeight, `focused ${tab} action is clipped: ${JSON.stringify(actionGeometry)}`);
    assert.equal(await page.evaluate(() => window.scrollY), 0, "focusing a composer must scroll panels without moving the page");
    assert.equal(await page.getByRole("button", { name: "Свернуть условие", exact: true }).getAttribute("aria-expanded"), "true");
    assert.equal(await page.getByRole("region", { name: "Условие", exact: true }).isVisible(), true);
    }
    }
  } finally { await browser.close(); }
});

test("condition has stable geometry across tabs and its vertical resize preserves draft and collapsed height", async () => {
  const { browser, page } = await open({ width: 1366, height: 1000 });
  try {
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    await condition.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const section = page.locator("[data-condition-expanded]");
    const initial = await section.boundingBox();
    for (const name of ["Мои заметки", "Чат", "Активность", "Шаги"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const box = await section.boundingBox();
      assert.ok(Math.abs(box.y - initial.y) <= 1 && Math.abs(box.height - initial.height) <= 1,
        `condition jumps on ${name}: ${JSON.stringify({ initial, box })}`);
    }
    const separator = page.getByRole("separator", { name: "Изменить высоту условия", exact: true });
    await separator.waitFor({ timeout: 1500 });
    const editor = condition.getByTestId("room-markdown-editor").locator(".cm-content");
    await editor.fill("# Условие после изменения высоты\nЧерновик остаётся на месте.");
    const before = Number(await separator.getAttribute("aria-valuenow"));
    const handle = await separator.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const resized = Number(await separator.getAttribute("aria-valuenow"));
    assert.ok(resized >= before + 35, `dragging down must increase condition height: ${before} → ${resized}`);
    await separator.focus();
    await separator.press("ArrowUp");
    assert.equal(Number(await separator.getAttribute("aria-valuenow")), resized - 16);
    await separator.press("Home");
    assert.equal(await separator.getAttribute("aria-valuenow"), await separator.getAttribute("aria-valuemin"));
    await separator.press("End");
    assert.equal(await separator.getAttribute("aria-valuenow"), await separator.getAttribute("aria-valuemax"));
    const editorBox = await page.getByRole("region", { name: "Редактор", exact: true }).getByTestId("room-code-editor-host").locator(".cm-editor").boundingBox();
    assert.ok(editorBox.height >= 320, `resizing condition must leave the code editor usable: ${JSON.stringify(editorBox)}`);
    const savedHeight = (await section.boundingBox()).height;
    await page.getByRole("button", { name: "Свернуть условие", exact: true }).click();
    assert.equal(await separator.isVisible(), false);
    await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    assert.ok(Math.abs((await section.boundingBox()).height - savedHeight) <= 1);
    assert.equal(await editor.innerText(), "# Условие после изменения высоты\nЧерновик остаётся на месте.");
  } finally { await browser.close(); }
});

test("Markdown removes the separate condition and returning to Code restores its editor and chosen height", async () => {
  const { browser, page } = await open({ width: 1366, height: 1000 });
  try {
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    const source = condition.getByTestId("room-markdown-editor").locator(".cm-content");
    const markdown = "# Единственное условие Markdown\nТекст сохраняется при перестройке комнаты.";
    await source.fill(markdown);
    const separator = page.getByRole("separator", { name: "Изменить высоту условия", exact: true });
    await separator.press("ArrowDown");
    const savedHeight = Number(await separator.getAttribute("aria-valuenow"));
    await page.evaluate(() => { window.__conditionEditorNode = document.querySelector('#room-context-region-condition .cm-content'); });
    async function selectMode(mode) {
      await page.getByTestId("room-editor-mode-switch").click();
      await page.locator(".ant-select-dropdown:visible").getByText(mode, { exact: true }).click();
      await page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true }).getByRole("button", { name: "Изменить режим", exact: true }).click();
      await page.waitForFunction(mode => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes(mode), mode);
    }
    await selectMode("Markdown");
    assert.equal(await page.getByRole("region", { name: "Условие", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Свернуть условие", exact: true }).count(), 0);
    assert.equal(await page.getByRole("separator", { name: "Изменить высоту условия", exact: true }).count(), 0);
    assert.equal(await page.locator('#room-context-region-condition').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#room-context-region-condition .cm-content').getAttribute('tabindex'), '-1');
    const mainSource = page.getByRole("region", { name: "Редактор", exact: true }).getByTestId("room-markdown-editor").locator(".cm-content");
    assert.equal(await mainSource.innerText(), markdown);
    for (const name of ["Мои заметки", "Чат", "Активность", "Шаги"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      assert.equal(await mainSource.isVisible(), true);
      assert.equal(await page.getByRole("region", { name: "Условие", exact: true }).count(), 0);
    }
    await selectMode("Code");
    await condition.waitFor();
    assert.equal(Number(await separator.getAttribute("aria-valuenow")), savedHeight);
    assert.equal(await source.innerText(), markdown);
    assert.equal(await page.evaluate(() => window.__conditionEditorNode === document.querySelector('#room-context-region-condition .cm-content')), true);
  } finally { await browser.close(); }
});

test("condition title and tools have clear insets and compact source stays usable through its local scroll", async () => {
  const { browser, page } = await open({ width: 1366, height: 1000 });
  try {
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    const title = condition.getByRole("heading", { name: "Условие отдельной области", exact: true });
    const toolbar = condition.getByRole("button", { name: "Жирный текст", exact: true }).locator("..");
    const source = condition.getByTestId("room-markdown-editor").locator(".cm-editor");
    const preview = condition.getByTestId("room-markdown-preview");
    const c = await condition.boundingBox(), t = await title.boundingBox(), tools = await toolbar.boundingBox();
    assert.ok(t.x >= c.x + 10 && t.y >= c.y + 10, `title must be inset: ${JSON.stringify({ c, t })}`);
    assert.ok(tools.y >= t.y + t.height + 6, "title and tools must not stick together");
    const s = await source.boundingBox(), p = await preview.boundingBox();
    assert.ok(s.height >= 60 && p.height >= 60);
    assert.ok(s.y >= tools.y + tools.height + 6 && s.y + s.height <= c.y + c.height);
    assert.ok(p.y + p.height <= c.y + c.height && s.x + s.width <= p.x, "source and preview must fit without overlap");
    await page.getByRole("separator", { name: "Изменить высоту условия", exact: true }).press("Home");
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 768, height: 520 }, { width: 512, height: 300 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => { localStorage.setItem("interview-online:ui-theme", theme); window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: theme })); }, theme);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const box = await source.boundingBox();
        assert.ok(box.height >= 60, `compact source must retain usable height: ${JSON.stringify({ viewport, theme, box })}`);
        const local = await source.evaluate(element => { const surface = element.closest('[data-room-context-surface]'); let body = element.parentElement; while (body !== surface && getComputedStyle(body).overflowY !== 'auto') body = body.parentElement; body.scrollTop = body.scrollHeight; return { scrollTop: body.scrollTop, overflow: getComputedStyle(body).overflowY, sourceHeight: element.getBoundingClientRect().height }; });
        assert.ok(local.scrollTop > 0 && local.overflow === "auto", `compact condition must scroll its padded content: ${JSON.stringify(local)}`);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
      }
    }
  } finally { await browser.close(); }
});

test("a remote Markdown switch moves focus out of the hidden condition and preserves collapsed and fullscreen state", async () => {
  const { browser, page } = await open({ width: 1366, height: 1000 });
  try {
    const remote = await page.context().newPage();
    await remote.goto(page.url());
    await remote.getByTestId("room-editor-mode-switch").waitFor();
    const notes = page.getByRole("tab", { name: "Мои заметки", exact: true });
    await notes.click();
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    const source = condition.getByTestId("room-markdown-editor").locator(".cm-content");
    await source.fill("# Черновик при удалённом переключении");
    async function remoteMode(mode) {
      await remote.getByTestId("room-editor-mode-switch").click();
      await remote.locator(".ant-select-dropdown:visible").getByText(mode, { exact: true }).click();
      await remote.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true }).getByRole("button", { name: "Изменить режим", exact: true }).click();
      await page.waitForFunction(mode => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes(mode), mode);
    }
    await source.focus();
    assert.equal(await source.evaluate(element => document.activeElement === element), true);
    await remoteMode("Markdown");
    await page.waitForFunction(() => document.activeElement?.id === 'room-context-tab-notes', null, { timeout: 1500 });
    assert.equal(await notes.getAttribute("aria-selected"), "true", "remote mode must preserve chosen auxiliary tab");
    await remoteMode("Code");
    const separator = page.getByRole("separator", { name: "Изменить высоту условия", exact: true });
    await separator.focus();
    await remoteMode("Markdown");
    await page.waitForFunction(() => document.activeElement?.id === 'room-context-tab-notes', null, { timeout: 1500 });
    await remoteMode("Code");
    await condition.getByRole("button", { name: "Развернуть markdown", exact: true }).click();
    assert.equal(await condition.getByTestId("briefing-board-interviewer").getAttribute("data-expanded"), "on");
    await source.focus();
    await remoteMode("Markdown");
    assert.equal(await page.getByRole("region", { name: "Условие", exact: true }).count(), 0, "hidden condition fullscreen must disappear completely");
    assert.equal(await page.getByRole("region", { name: "Редактор", exact: true }).getByTestId("room-markdown-editor").isVisible(), true);
    await remoteMode("Code");
    await condition.getByRole("button", { name: "Свернуть markdown", exact: true }).click();
    await page.getByRole("button", { name: "Свернуть условие", exact: true }).click();
    await remoteMode("Markdown");
    await remoteMode("Code");
    assert.equal(await page.getByRole("button", { name: "Развернуть условие", exact: true }).getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    assert.equal(await source.innerText(), "# Черновик при удалённом переключении");
    assert.equal(await notes.getAttribute("aria-selected"), "true");
  } finally { await browser.close(); }
});

test("condition resizing remains meaningful on everyday desktop sizes without shrinking the code editor", async () => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    const { browser, page } = await open(viewport);
    try {
      const condition = page.getByRole("region", { name: "Условие", exact: true });
      const source = condition.getByTestId("room-markdown-editor").locator(".cm-content");
      const draft = "# Ручная высота условия\nТекст остаётся при прокрутке комнаты.";
      await source.fill(draft);
      await page.getByTestId("room-code-editor-host").waitFor();
      await page.evaluate(() => { window.__roomResizeCodeView = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView; });
      const separator = page.getByRole("separator", { name: "Изменить высоту условия", exact: true });
      const initial = Number(await separator.getAttribute("aria-valuenow"));
      if (viewport.width === 1366) {
        const handle = await separator.boundingBox();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 100, { steps: 8 });
        await page.mouse.up();
        assert.ok(Number(await separator.getAttribute("aria-valuenow")) >= initial + 80, "a normal desktop must allow a meaningful downward drag");
      } else {
        await separator.press("ArrowDown");
        assert.equal(Number(await separator.getAttribute("aria-valuenow")), initial + 16, "a 720px room must allow keyboard resizing");
        for (let index = 0; index < 5; index++) await separator.press("ArrowDown");
      }
      const height = Number(await separator.getAttribute("aria-valuenow"));
      const code = page.getByTestId("room-code-editor-host").locator(".cm-editor");
      assert.ok((await code.boundingBox()).height >= 320, "manual expansion must retain the code editor's minimum size");
      await code.scrollIntoViewIfNeeded();
      const geometry = await code.evaluate(element => {
        const root = element.closest('[data-room-context-mode]'), bounds = element.getBoundingClientRect();
        const controls = root.firstElementChild.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, controlsBottom: controls.bottom, viewport: innerHeight, rootScroll: root.scrollTop, overflow: getComputedStyle(root).overflowY, pageScroll: window.scrollY };
      });
      assert.ok(geometry.top >= geometry.controlsBottom && geometry.bottom <= geometry.viewport, `code must remain reachable through the room's local scroll: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.rootScroll > 0 && geometry.overflow === "auto");
      assert.equal(geometry.pageScroll, 0);
      assert.equal(await source.innerText(), draft);
      assert.equal(await page.evaluate(() => window.__roomResizeCodeView === document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView), true);
      await page.getByRole("button", { name: "Свернуть условие", exact: true }).click();
      await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
      assert.equal(Number(await separator.getAttribute("aria-valuenow")), height);
      assert.equal(await source.innerText(), draft);
    } finally { await browser.close(); }
  }
});

test("short Focus condition can grow manually while chat and notes remain reachable without page scrolling", async () => {
  const { browser, page } = await open({ width: 512, height: 300 });
  try {
    const condition = page.getByRole("region", { name: "Условие", exact: true });
    const source = condition.getByTestId("room-markdown-editor").locator(".cm-content");
    const draft = "# Компактный режим\nЧерновик сохраняется при изменении высоты.";
    await source.fill(draft);
    const separator = page.getByRole("separator", { name: "Изменить высоту условия", exact: true });
    const initial = Number(await separator.getAttribute("aria-valuenow"));
    await separator.press("ArrowDown");
    assert.equal(Number(await separator.getAttribute("aria-valuenow")), initial + 16, "short Focus must have a real resize range");
    for (let index = 0; index < 4; index++) await separator.press("ArrowDown");
    assert.ok(Number(await separator.getAttribute("aria-valuenow")) >= initial + 80);
    for (const [tab, inputId, actionId] of [["Мои заметки", "room-private-notes-input", "room-private-notes-send"], ["Чат", "room-notes-input", "room-notes-send"]]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const input = page.getByTestId(inputId);
      await input.focus();
      await input.fill("Доступный черновик панели");
      for (const control of [input, page.getByTestId(actionId)]) {
        await control.focus();
        const bounds = await control.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 300, `${tab} control must remain reachable: ${JSON.stringify(bounds)}`);
      }
      assert.equal(await page.evaluate(() => window.scrollY), 0);
    }
    assert.equal(await source.innerText(), draft);
    assert.equal(await page.getByRole("button", { name: "Свернуть условие", exact: true }).getAttribute("aria-expanded"), "true");
  } finally { await browser.close(); }
});
