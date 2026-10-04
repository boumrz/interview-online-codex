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
async function fixture() {
  const auth = await request("/auth/register", null, { nickname: `ux_${crypto.randomUUID().slice(0, 12)}`, displayName: "Проверка редактора", password: "test-password-123" });
  const room = await request("/rooms", auth.token, { title: "Команды и вид редактора", taskIds: [] });
  await request(`/rooms/${room.inviteCode}/tasks`, auth.token, { customTasks: [0, 1].map(index => ({ title: `Шаг ${index + 1}`, description: markdown, starterCode: code, language: "nodejs" })) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByTestId("room-code-editor-host").waitFor();
  await page.waitForFunction(expected => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === expected, code);
  return { auth, room, browser, page, async close() { await browser.close(); await request(`/me/rooms/${room.id}`, auth.token, null, "DELETE").catch(() => {}); } };
}
async function choose(page, mode) {
  await page.getByTestId("room-editor-mode-switch").click();
  await page.locator(".ant-select-dropdown:visible").getByText(mode, { exact: true }).click();
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
   await control.click();
   for(const choice of await f.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").all()) {
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
      await control.click();
      const options = f.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content");
      await options.first().waitFor();
      assert.deepEqual((await options.allTextContents()).map(value => value.trim()), ["Code", "Markdown"]);
      await f.page.locator(".ant-select-dropdown:visible").evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
      await f.page.screenshot({ path: `${evidence}/room-mode-${theme}.png` });
      await f.page.keyboard.press("Escape");
      await f.page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
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
      await control.click();
      await f.page.locator(".ant-select-dropdown:visible").getByText("Markdown", { exact: true }).click();
      const confirmation = f.page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true });
      await assertDialogSurface(confirmation, theme);
      await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
      await confirmation.waitFor({ state: "hidden" });
    }
  } finally { await f.close(); }
});

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
