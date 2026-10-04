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
async function theme(page, mode) {
  await page.evaluate(mode => {
    localStorage.setItem("interview-online:ui-theme", mode);
    window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: mode }));
  }, mode);
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
}
const clean = value => value.replace(/^<!--briefing:focus=on-->\n?/, "");
const choose = async (page, mode, keyboard = false) => {
  const control = page.getByTestId("room-editor-mode-switch");
  const input = control.getByRole("combobox");
  const inputId = await input.getAttribute("id");
  await page.waitForFunction(id => {
    const input = document.getElementById(id);
    return input && !input.disabled;
  }, inputId);
  if (keyboard) {
    const currentMode = (await control.textContent()).includes("Markdown") ? "Markdown" : "Code";
    await input.focus();
    assert.equal(await input.evaluate(element => element === document.activeElement), true, "keyboard mode selection starts in the enabled combobox");
    await input.press("ArrowDown");
    await page.locator(".ant-select-dropdown:visible").waitFor();
    // Select activates its current value after opening. Wait for that state
    // before navigating with its supported arrow keys; Home/End are not handled.
    const activeOptionIs = ({ id, label }) => {
      const input = document.getElementById(id);
      const activeId = input?.getAttribute("aria-activedescendant");
      return activeId && document.getElementById(activeId)?.getAttribute("aria-label") === label;
    };
    await page.waitForFunction(activeOptionIs, { id: inputId, label: currentMode });
    await input.press(mode === "Code" ? "ArrowUp" : "ArrowDown");
    await page.waitForFunction(activeOptionIs, { id: inputId, label: mode });
    await input.press("Enter");
  }
  else { await control.click(); await page.locator(".ant-select-dropdown:visible").getByText(mode, {exact:true}).click(); }
  await page.getByRole("dialog",{name:"Изменить режим комнаты?"}).getByRole("button",{name:"Изменить режим",exact:true}).click();
};

test("all note command labels align with the left padding in both themes and widths", async () => {
  const f = await fixture();
  try {
    for (const width of [1366, 390]) for (const mode of ["light", "dark"]) {
      await f.page.setViewportSize({ width, height: width === 390 ? 700 : 900 });
      await theme(f.page, mode);
      const modeBox = await f.page.getByTestId("room-editor-mode-switch").boundingBox();
      assert.ok(modeBox && modeBox.x >= 0 && modeBox.x + modeBox.width <= width + 1, "editor choices fit the viewport");
      await f.page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
      await f.page.getByTestId("room-private-notes-input").fill("/");
      const menu = f.page.getByTestId("room-private-notes-command-menu");
      const presets = menu.getByRole("group", { name: "Шаги интервью", exact: true }).getByRole("button");
      assert.equal(await presets.count(), 2, "both step shortcuts are present");
      for (const button of await presets.all()) {
        const geometry = await button.evaluate(button => {
          const range = document.createRange(); range.selectNodeContents(button.querySelector("span") ?? button);
          const text = range.getBoundingClientRect(), rect = button.getBoundingClientRect(), style = getComputedStyle(button);
          return { textLeft: text.left, expectedLeft: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), textRight: text.right, buttonRight: rect.right };
        });
        assert.ok(Math.abs(geometry.textLeft - geometry.expectedLeft) <= 2, `${mode}/${width}: shortcut starts at the left content edge: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.textRight <= geometry.buttonRight + 1, "shortcut stays within its row");
      }
      await presets.first().click();
      await f.page.getByText("Блок: Шаг 1", { exact: false }).waitFor();
      await f.page.getByTestId("room-private-notes-input").fill("/block Пользовательский блок");
      const custom = menu.getByTestId("room-private-notes-command-create-custom");
      const customGeometry = await custom.evaluate(button => {
        const label = button.querySelector("span").getBoundingClientRect(), box = button.getBoundingClientRect();
        return { offset: label.left - box.left, right: label.right, parentRight: box.right };
      });
      assert.ok(customGeometry.offset <= 16 && customGeometry.right <= customGeometry.parentRight + 1, "custom-block action is also left aligned");
      if (process.env.EVIDENCE_DIR) {
        await mkdir(process.env.EVIDENCE_DIR, { recursive: true });
        await f.page.screenshot({ path: `${process.env.EVIDENCE_DIR}/commands-${mode}-${width}.png` });
      }
    }
  } finally { await f.close(); }
});

test("explicit code and text choices preserve both documents and synchronize the public mode", async () => {
  const f = await fixture();
  try {
    const guest = await f.browser.newContext();
    await guest.addInitScript(invite => localStorage.setItem(`guest_display_name_${invite}`, "Кандидат переключателя"), f.room.inviteCode);
    const candidate = await guest.newPage();
    await candidate.goto(`${web}/room/${f.room.inviteCode}`);
    await candidate.getByTestId("room-code-editor-host").waitFor();
    const control = f.page.getByTestId("room-editor-mode-switch");
    await control.waitFor();
    assert.match(await control.textContent(),/Code/);
    await choose(f.page, "Markdown");
    await f.page.getByTestId("room-current-local-step-context").getByTestId("room-markdown-editor").waitFor();
    await candidate.locator('[data-testid="briefing-board-candidate"][data-focus="on"]').waitFor();
    await candidate.getByTestId("room-code-editor-host").waitFor({state:"hidden"});
    await f.page.reload();
    await f.page.waitForFunction(()=>document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Markdown"));
    await choose(f.page,"Code",true);
    await f.page.getByTestId("room-code-editor-host").waitFor();
    await candidate.getByTestId("room-code-editor-host").waitFor();
    await f.page.waitForFunction(expected => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === expected, code);
    const saved = await request(`/rooms/${f.room.inviteCode}/tasks/0/workspace`, f.auth.token);
    assert.equal(saved.code, code);
    assert.equal(clean(saved.briefingMarkdown), markdown);
  } finally { await f.close(); }
});

test("room mode from a private step does not publish its task or documents", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("tab", { name: "Шаги", exact: true }).click();
    await f.page.getByTestId("room-step-row-1").click();
    const control = f.page.getByTestId("room-editor-mode-switch");
    await control.waitFor();
    await choose(f.page, "Markdown");
    await f.page.getByTestId("room-current-local-step-context").getByTestId("room-markdown-editor").waitFor();
    const publicState = await request(`/rooms/${f.room.inviteCode}`, f.auth.token);
    assert.equal(publicState.currentStep, 0);
    assert.equal(publicState.code, code);
    assert.equal(clean(publicState.briefingMarkdown), markdown);
    await choose(f.page, "Code");
    await f.page.getByTestId("room-code-editor-host").waitFor();
    await f.page.waitForFunction(expected => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === expected, code);
  } finally { await f.close(); }
});

test("completed notes export uses one top notification instead of an inline result", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
    await f.page.getByTestId("room-private-notes-export").click();
    const dialog = f.page.getByRole("dialog", { name: "Экспорт личных заметок", exact: true });
    const download = f.page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Скачать .md", exact: true }).click();
    await download;
    const notice = f.page.locator(".ant-notification-notice").filter({ hasText: "Заметки выгружены в Markdown" });
    await notice.waitFor();
    assert.equal(await notice.count(), 1);
    await f.page.waitForFunction(() => {
      const box = document.querySelector(".ant-notification-top .ant-notification-notice")?.getBoundingClientRect();
      return box && box.y >= 0 && box.y < 130;
    });
    assert.equal(await dialog.getByText("Файл готов, начинаем скачивание", { exact: false }).count(), 0, "no inline completed-action duplicate");
  } finally { await f.close(); }
});

test("participant hiring assignment confirms once at the top after the server response", async () => {
  const f = await fixture();
  let release;
  try {
    const hr = await request("/auth/register", null, { nickname: `ux_hr_${crypto.randomUUID().slice(0, 10)}`, displayName: "Нанимающий уведомлений", password: "test-password-123", isHr: true });
    const context = await f.browser.newContext();
    await context.addInitScript(auth => {
      localStorage.setItem("auth_token", auth.token);
      localStorage.setItem("auth_user", JSON.stringify(auth.user));
      localStorage.setItem("display_name", auth.user.displayName);
    }, hr);
    const guest = await context.newPage();
    await guest.goto(`${web}/room/${f.room.inviteCode}`);
    await guest.getByTestId("room-code-editor-host").waitFor();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await f.page.route(`**/api/rooms/${f.room.inviteCode}/hr-managers/${hr.user.id}`, async route => {
      started(); await gate; await route.continue();
    });
    await f.page.getByRole("button", { name: /Нанимающий уведомлений/ }).click();
    await f.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await ready;
    const notice = f.page.locator(".ant-notification-notice").filter({ hasText: "Нанимающий уведомлений: назначен нанимающим" });
    assert.equal(await notice.count(), 0, "pending assignment cannot announce success");
    release();
    await notice.waitFor();
    assert.equal(await notice.count(), 1);
    await f.page.waitForFunction(() => {
      const box = document.querySelector(".ant-notification-top .ant-notification-notice")?.getBoundingClientRect();
      return box && box.y >= 0 && box.y < 130;
    });
    assert.equal(await f.page.locator('[data-testid="room-status-strip"]').locator('..').getByText("Нанимающий уведомлений: назначен нанимающим", { exact: true }).count(), 0, "no inline completion");
    assert.equal(await notice.evaluate(element => {
      const box = element.getBoundingClientRect();
      return Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".ant-notification"));
    }), false, "a passive result cannot intercept the underlying interface");
    await f.page.getByRole("button", { name: /Нанимающий уведомлений/ }).click({ timeout: 1500 });
    await f.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).waitFor();
    assert.equal(await notice.count(), 1, "the visible result does not block the next native click");
    assert.equal((await request(`/rooms/${f.room.inviteCode}/hr-managers`, f.auth.token)).some(item => item.userId === hr.user.id), true);
    await notice.locator(".ant-notification-notice-close").click();
    await notice.waitFor({ state: "hidden" });
  } finally { release?.(); await f.close(); }
});

test("a late PDF failure from a replaced session does not restore old feedback", async () => {
  const f = await fixture();
  let release;
  try {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await f.page.route("**/fonts/Arial.ttf", async route => {
      started(); await gate; await route.fulfill({ status: 503, body: "" });
    });
    await f.page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
    await f.page.getByTestId("room-private-notes-export").click();
    const dialog = f.page.getByRole("dialog", { name: "Экспорт личных заметок", exact: true });
    await dialog.getByRole("button", { name: "Скачать .pdf", exact: true }).click();
    await ready;
    await f.page.evaluate(() => localStorage.setItem("auth_token", "replaced-ui-session"));
    release();
    await f.page.getByTestId("private-notes-pdf-progress").waitFor({ state: "hidden" });
    assert.equal(await dialog.getByText("Не удалось загрузить шрифт PDF. Повторите попытку.", { exact: true }).count(), 0);
    assert.equal(await f.page.locator(".ant-notification-notice").count(), 0);
  } finally { release?.(); await f.close(); }
});
