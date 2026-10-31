import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const code = "const preserved = 42;\n";
const markdown = "# Условие\nТекст задания сохраняется.";
async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function fixture({ theme = "light", captureMarkdownWorker = false, taskMarkdown = markdown } = {}) {
  const auth = await request("/auth/register", null, { nickname: `ux_${crypto.randomUUID().slice(0, 12)}`, displayName: "Проверка редактора", password: "test-password-123" });
  const room = await request("/rooms", auth.token, { title: "Команды и вид редактора", taskIds: [] });
  await request(`/rooms/${room.inviteCode}/tasks`, auth.token, { customTasks: [0, 1].map(index => ({ title: `Шаг ${index + 1}`, description: taskMarkdown, starterCode: code, language: "nodejs" })) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: theme });
  await context.addInitScript(({ token, user, theme, captureMarkdownWorker }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
    localStorage.setItem("interview-online:ui-theme", theme);
    if (captureMarkdownWorker) {
      const NativeWorker = window.Worker;
      window.markdownReplyGate = { hold: false, held: [], created: 0 };
      window.releaseMarkdownReplies = () => {
        window.markdownReplyGate.hold = false;
        window.markdownReplyGate.held.splice(0).forEach(deliver => deliver());
      };
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          this.isMarkdownPreview = options?.name === "markdown-preview";
          if (this.isMarkdownPreview) window.markdownReplyGate.created++;
        }
        set onmessage(handler) {
          super.onmessage = event => {
            const deliver = () => handler?.call(this, event);
            if (this.isMarkdownPreview && window.markdownReplyGate.hold) window.markdownReplyGate.held.push(deliver);
            else deliver();
          };
        }
        get onmessage() { return super.onmessage; }
      };
    }
  }, { ...auth, theme, captureMarkdownWorker });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByTestId("room-code-editor-host").waitFor();
  await page.waitForFunction(expected => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === expected, code);
  return { auth, room, browser, page, async close() { await browser.close(); await request(`/me/rooms/${room.id}`, auth.token, null, "DELETE").catch(() => {}); } };
}
async function openModeMenu(page) {
  const control = page.getByTestId("room-editor-mode-switch");
  const inputId = await control.getByRole("combobox").getAttribute("id");
  assert.ok(inputId, "ROOM_MODE_INPUT_ID_MISSING");
  await control.click();
  const rendered = await page.waitForFunction((id) => {
    const input = document.getElementById(id);
    const listboxId = input?.getAttribute("aria-controls");
    const dropdown = listboxId && document.getElementById(listboxId)?.closest(".ant-select-dropdown");
    if (input?.getAttribute("aria-expanded") !== "true" || !dropdown) return null;
    const style = getComputedStyle(dropdown);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    const labels = Array.from(dropdown.querySelectorAll(".ant-select-item-option-content"), (option) => option.textContent.trim());
    return labels.length ? { listboxId, labels } : null;
  }, inputId, { timeout: 5_000 });
  const { listboxId, labels } = await rendered.jsonValue();
  await rendered.dispose();
  assert.deepEqual(labels, ["Code", "Markdown"]);
  return {
    labels,
    dropdown: page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id=${JSON.stringify(listboxId)}]`) }),
  };
}
async function choose(page, mode) {
  const { dropdown } = await openModeMenu(page);
  await dropdown.getByText(mode, { exact: true }).click();
}
test("room mode requires explicit confirmation and cancellation sends no mutation", async () => {
  const f = await fixture();
  try {
    const guestContext = await f.browser.newContext();
    await guestContext.addInitScript(invite => localStorage.setItem(`guest_display_name_${invite}`, "Кандидат режима"), f.room.inviteCode);
    const guest = await guestContext.newPage();
    await guest.goto(`${web}/room/${f.room.inviteCode}`);
    await guest.getByTestId("room-code-editor-host").waitFor();
    await f.page.evaluate(() => window.__originalCodeView = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView);
    let writes = 0;
    f.page.on("request", req => { if (req.method() === "POST" && req.postData()?.includes("room_editor_mode_update")) writes++; });
    await choose(f.page, "Markdown");
    const dialog = f.page.getByRole("dialog", { name: "Изменить режим комнаты?" });
    await dialog.getByText("Изменится редактор кандидата и всех интервьюеров.", {exact:true}).waitFor();
    assert.equal(writes, 0);
    await dialog.getByRole("button", {name:"Отмена",exact:true}).click();
    assert.equal(writes, 0);
    assert.match(await f.page.getByTestId("room-editor-mode-switch").textContent(), /Code/);
    await choose(f.page, "Markdown");
    await dialog.getByRole("button", {name:"Изменить режим",exact:true}).click();
    await f.page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Markdown"));
    await guest.getByText("Режим комнаты — Markdown", {exact:true}).waitFor();
    assert.equal(await guest.getByTestId("room-code-editor-host").isVisible(), false);
    assert.equal(await f.page.evaluate(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView === window.__originalCodeView),true);
    const saved = await request(`/rooms/${f.room.inviteCode}`, f.auth.token);
    assert.equal(saved.roomEditorMode, "markdown"); assert.equal(saved.currentStep,0); assert.equal(clean(saved.briefingMarkdown),markdown);
    for (const name of ["Шаги", "Мои заметки", "Чат", "Активность"]) await f.page.getByRole("tab", {name,exact:true}).waitFor();
    await f.page.getByRole("tab", {name:"Шаги",exact:true}).click();
    await f.page.getByTestId("room-step-row-1").click();
    assert.match(await f.page.getByTestId("room-editor-mode-switch").textContent(), /Markdown/);
    await f.page.getByTestId("room-publish-step").click();
    await f.page.reload();
    await f.page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Markdown"));
    assert.equal((await request(`/rooms/${f.room.inviteCode}`, f.auth.token)).roomEditorMode,"markdown");
  } finally { await f.close(); }
});
const clean = value => value.replace(/^<!--briefing:focus=on-->\n?/, "");

test("failed room command retains the confirmed mode and can be retried explicitly", async () => {
  const f = await fixture();
  try {
    await f.page.route("**/realtime/rooms/*/events", async route => {
      if (route.request().postDataJSON()?.type === "room_editor_mode_update") await route.fulfill({status:503, contentType:"application/json", body:JSON.stringify({error:"Режим временно недоступен"})});
      else await route.continue();
    });
    await choose(f.page,"Markdown");
    const dialog=f.page.getByRole("dialog",{name:"Изменить режим комнаты?"});
    await dialog.getByRole("button",{name:"Изменить режим",exact:true}).click();
    await dialog.getByRole("alert").getByText("Режим временно недоступен").waitFor();
    assert.match(await f.page.getByTestId("room-editor-mode-switch").textContent(),/Code/);
    assert.equal((await request(`/rooms/${f.room.inviteCode}`,f.auth.token)).roomEditorMode,"code");
    assert.equal(await f.page.getByRole("status").filter({hasText:"Режим комнаты изменён"}).count(),0);
    await f.page.unroute("**/realtime/rooms/*/events");
    await dialog.getByRole("button",{name:"Изменить режим",exact:true}).click();
    await f.page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Markdown"));
  } finally {await f.close();}
});
test("selector choices align left and help stays stable in both themes and compact viewport",async()=>{
 const f=await fixture();
 try {
  for(const width of [1366,768,390]) for(const theme of ["light","dark"]) {
   await f.page.setViewportSize({width,height:700});
   await f.page.evaluate(theme=>{localStorage.setItem("interview-online:ui-theme",theme);window.dispatchEvent(new StorageEvent("storage",{key:"interview-online:ui-theme",newValue:theme}));},theme);
   await f.page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
   const control=f.page.getByTestId("room-editor-mode-switch");
   const bounds=await control.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   const { dropdown } = await openModeMenu(f.page);
   for(const choice of await dropdown.locator(".ant-select-item-option-content").all()) {
    assert.equal(await choice.evaluate(el=>getComputedStyle(el).textAlign),"left");
    const aligned=await choice.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const box=el.getBoundingClientRect();return Math.abs(r.getBoundingClientRect().left-box.left)<=2;});assert.ok(aligned);
   }
   await f.page.keyboard.press("Escape");
   const help=f.page.getByRole("button",{name:"Как работает режим комнаты",exact:true});
   assert.equal(await help.locator("svg").count(),1,"Room help uses the shared icon instead of a font-dependent question glyph");
   const iconGeometry=await help.evaluate(el=>{
    const button=el.getBoundingClientRect(),icon=el.querySelector("svg").getBoundingClientRect();
    return {dx:Math.abs(icon.left+icon.width/2-button.left-button.width/2),dy:Math.abs(icon.top+icon.height/2-button.top-button.height/2)};
   });
   assert.ok(iconGeometry.dx<=1&&iconGeometry.dy<=1,`${theme}/${width}: help icon is centered: ${JSON.stringify(iconGeometry)}`);
   await help.hover();
   const tip=f.page.getByRole("tooltip").filter({hasText:"Общий редактор"});await tip.waitFor();
   await tip.evaluate(el => Promise.all((el.closest(".ant-tooltip") ?? el).getAnimations({subtree:true}).map(animation => animation.finished.catch(()=>{}))));
   const initial=await tip.boundingBox();
   for(let i=0;i<3;i++){await f.page.waitForTimeout(100);const b=await tip.boundingBox();assert.ok(b&&Math.abs(b.x-initial.x)<=1&&Math.abs(b.y-initial.y)<=1, `${theme}/${width}: ${JSON.stringify({initial,b})}`);}
   await help.press("Tab");
   const finish=f.page.getByRole("button",{name:"Завершить интервью",exact:true}).first();assert.equal(await finish.isVisible(),true);
  }
 }finally{await f.close();}
});

test("room mode uses concise choices, secondary mode text and a quiet finish action with coherent dialogs", async () => {
  const f = await fixture();
  try {
    for (const theme of ["light", "dark"]) {
      await f.page.evaluate(theme => {
        localStorage.setItem("interview-online:ui-theme", theme);
        window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: theme }));
      }, theme);
      await f.page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      const control = f.page.getByTestId("room-editor-mode-switch");
      await control.evaluate(el => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await f.page.locator("body").evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))));
      const label = control.getByText("Режим комнаты", { exact: true });
      const mode = control.getByText("Code", { exact: true });
      await label.waitFor();
      await mode.waitFor();
      const typography = await mode.evaluate((el) => {
        const label = Array.from(el.parentElement.children).find(node => node.textContent === "Режим комнаты");
        return { modeSize: parseFloat(getComputedStyle(el).fontSize), labelSize: parseFloat(getComputedStyle(label).fontSize), modeColor: getComputedStyle(el).color, labelColor: getComputedStyle(label).color };
      });
      assert.ok(typography.modeSize < typography.labelSize, `${theme}: mode should be secondary: ${JSON.stringify(typography)}`);
      assert.notEqual(typography.modeColor, typography.labelColor);
      const evidence = process.env.EVIDENCE_DIR ?? "../.run/oct04-api-ui-validation/screenshots";
      await mkdir(evidence, { recursive: true });
      await f.page.screenshot({ path: `${evidence}/room-header-${theme}.png` });
      const { dropdown, labels } = await openModeMenu(f.page);
      assert.deepEqual(labels, ["Code", "Markdown"]);
      await dropdown.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
      await f.page.screenshot({ path: `${evidence}/room-mode-${theme}.png` });
      await f.page.keyboard.press("Escape");
      await dropdown.waitFor({ state: "hidden" });
      const finish = f.page.getByRole("button", { name: "Завершить интервью", exact: true });
      const surface = await finish.evaluate(el => {
        const color = document.createElement("span");
        color.style.backgroundColor = "var(--app-error-fill)";
        document.body.append(color);
        const loud = getComputedStyle(color).backgroundColor;
        color.remove();
        return { background: getComputedStyle(el).backgroundColor, loud };
      });
      assert.notEqual(surface.background, surface.loud, `${theme}: finish must use a soft red background`);
      await finish.click();
      await assertDialogSurface(f.page.getByRole("dialog", { name: "Завершить интервью", exact: true }), theme);
      await f.page.getByRole("dialog", { name: "Завершить интервью", exact: true }).evaluate(el => Promise.all(el.closest(".ant-modal-wrap").getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
      await f.page.getByRole("dialog", { name: "Завершить интервью", exact: true }).screenshot({ path: `${evidence}/finish-dialog-${theme}.png` });
      await f.page.keyboard.press("Escape");
      await f.page.getByRole("dialog", { name: "Завершить интервью", exact: true }).waitFor({ state: "hidden" });
      await choose(f.page, "Markdown");
      const confirmation = f.page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true });
      await assertDialogSurface(confirmation, theme);
      await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
      await confirmation.waitFor({ state: "hidden" });
    }
  } finally { await f.close(); }
});

for (const scope of ["public", "private"]) for (const theme of ["light", "dark"]) {
  test(`${scope} Markdown preview remains painted while typing and accepting fresh Worker replies in ${theme}`, async () => {
    const title = `Непрерывный предпросмотр ${scope} ${theme}`;
    const initial = `# ${title}\n\n${Array.from({ length: 80 }, (_, index) => `Абзац ${index + 1}: исходный документ остаётся виден при следующем вводе.`).join("\n\n")}`;
    const tail = `preview_${scope}_${theme}_abcdefghijklmnopqrstuvwxyz_0123456789_latest_keyboard_text`;
    const expected = `${initial}\n\n${tail}`;
    const f = await fixture({ theme, captureMarkdownWorker: true, taskMarkdown: initial });
    try {
      await choose(f.page, "Markdown");
      await f.page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true }).getByRole("button", { name: "Изменить режим", exact: true }).click();
      await f.page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Markdown"));
      if (scope === "private") {
        await Promise.all([
          f.page.waitForResponse(response => new URL(response.url()).pathname === `/api/rooms/${f.room.inviteCode}/tasks/1/workspace` && response.status() === 200),
          f.page.getByTestId("room-step-row-1").click(),
        ]);
        await f.page.waitForFunction(() => document.querySelector('#room-context-region-editor [data-testid="room-current-local-step-context"]')?.dataset.stepIndex === "1");
      }
      const editor = f.page.getByRole("region", { name: "Редактор", exact: true });
      const preview = editor.getByTestId("room-markdown-preview");
      await preview.getByRole("heading", { name: title, exact: true }).waitFor();
      const guestContext = await f.browser.newContext({ colorScheme: theme });
      await guestContext.addInitScript(invite => localStorage.setItem(`guest_display_name_${invite}`, "Кандидат непрерывного предпросмотра"), f.room.inviteCode);
      const guest = await guestContext.newPage();
      await guest.goto(`${web}/room/${f.room.inviteCode}`);
      await guest.getByTestId("room-markdown-preview").getByRole("heading", { name: title, exact: true }).waitFor();
      const source = editor.getByTestId("room-markdown-editor").locator(".cm-content");
      await source.click();
      await f.page.keyboard.press("ControlOrMeta+End");
      await preview.evaluate(element => {
        const content = element.firstElementChild;
        if (!content?.textContent.trim()) throw new Error("PREVIEW_WAS_NOT_INITIALISED");
        element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight);
        window.previewPaintAudit = { frames: 0, mutations: 0, failures: [], scrollTop: element.scrollTop, running: true };
        const sample = () => {
          const audit = window.previewPaintAudit;
          if (!element.isConnected || element.firstElementChild !== content || !content.textContent.trim()) audit.failures.push("preview wrapper or content disappeared");
          if (/загруз.*предпросмотр/i.test(element.textContent)) audit.failures.push("loading status appeared");
        };
        const observer = new MutationObserver(() => { window.previewPaintAudit.mutations++; sample(); });
        observer.observe(element, { childList: true, subtree: true, characterData: true });
        const frame = () => {
          if (!window.previewPaintAudit.running) return;
          window.previewPaintAudit.frames++;
          sample();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        window.stopPreviewPaintAudit = () => { sample(); window.previewPaintAudit.running = false; observer.disconnect(); };
        window.markdownReplyGate.hold = true;
      });
      await f.page.keyboard.press("Enter");
      await f.page.keyboard.press("Enter");
      await f.page.keyboard.type(tail, { delay: 8 });
      await f.page.waitForFunction(() => window.markdownReplyGate.held.length > 0);
      assert.equal(await preview.getByText(tail, { exact: true }).count(), 0, "a genuine native Worker reply is still held");
      await preview.getByRole("heading", { name: title, exact: true }).waitFor();
      await f.page.evaluate(() => window.releaseMarkdownReplies());
      await preview.getByText(tail, { exact: true }).waitFor();
      const paint = await preview.evaluate(element => {
        window.stopPreviewPaintAudit();
        return { ...window.previewPaintAudit, finalScrollTop: element.scrollTop, workers: window.markdownReplyGate.created };
      });
      assert.ok(paint.workers > 0 && paint.frames > 2 && paint.mutations > 0, `native Worker, painted frames and fresh DOM commits were observed: ${JSON.stringify(paint)}`);
      assert.deepEqual(paint.failures, [], "preview stays nonempty in MutationObserver callbacks and every rendered frame, including the fresh reply commit");
      assert.ok(paint.scrollTop > 0 && Math.abs(paint.finalScrollTop - paint.scrollTop) <= 1, "preview scroll position survives continuous typing and fresh HTML");
      const path = scope === "private" ? `/rooms/${f.room.inviteCode}/tasks/1/workspace` : `/rooms/${f.room.inviteCode}`;
      let saved;
      const deadline = Date.now() + 10_000;
      do {
        saved = await request(path, f.auth.token);
        if (clean(saved.briefingMarkdown) === expected) break;
        await new Promise(resolve => setTimeout(resolve, 80));
      } while (Date.now() < deadline);
      assert.equal(clean(saved.briefingMarkdown), expected, "actual keyboard edits reach durable room/workspace storage");
      const room = await request(`/rooms/${f.room.inviteCode}`, f.auth.token);
      assert.equal(room.currentStep, 0, "editing a preview does not publish another step");
      if (scope === "private") {
        assert.equal(clean(room.briefingMarkdown), initial, "private draft does not alter the published Markdown");
        assert.equal((await guest.getByTestId("room-markdown-preview").innerText()).includes(tail), false, "candidate cannot see private Markdown edits");
      } else await guest.getByTestId("room-markdown-preview").getByText(tail, { exact: true }).waitFor();
    } finally {
      await f.page.evaluate(() => { window.releaseMarkdownReplies?.(); window.stopPreviewPaintAudit?.(); }).catch(() => {});
      await f.close();
    }
  });
}

async function assertDialogSurface(dialog, theme) {
  await dialog.waitFor();
  await dialog.evaluate(el => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await dialog.evaluate(el => Promise.all(el.closest(".ant-modal-wrap").getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  const colors = await dialog.evaluate(el => {
    const header = el.querySelector(".ant-modal-header");
    const body = header.closest(".ant-modal-container, .ant-modal-content");
    return { header: getComputedStyle(header).backgroundColor, body: getComputedStyle(body).backgroundColor };
  });
  assert.ok(colors.header === colors.body || colors.header === "rgba(0, 0, 0, 0)", `${theme}: dialog header must share its surface: ${JSON.stringify(colors)}`);
}
