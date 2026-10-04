import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const screenshots = "output/playwright/room-authoring";

async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function fixture() {
  const auth = await request("/auth/register", null, { nickname: `geometry_${crypto.randomUUID().slice(0, 10)}`, displayName: "Автор проверки форм", password: "test-password-123" });
  const room = await request("/rooms", auth.token, { title: "Проверка форм задач", taskIds: [] });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await mkdir(screenshots, { recursive: true });
  return { auth, room, browser, page, async close() { await browser.close(); await request(`/me/rooms/${room.id}`, auth.token, null, "DELETE").catch(() => {}); } };
}

async function settle(page, theme, width = 1366, height = 900) {
  await page.setViewportSize({ width, height });
  await page.evaluate(theme => {
    localStorage.setItem("interview-online:ui-theme", theme);
    window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: theme }));
  }, theme);
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".ant-modal")).every(el => {
    const style = getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden" || el.getClientRects().length === 0 || style.transform === "none";
  }));
}

test("participant role menu has an elevated surface and a visible hovered action in both themes", async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${web}/room/${f.room.inviteCode}`);
    await f.page.getByTestId("room-code-editor-host").waitFor();
    const guest = await f.browser.newContext();
    await guest.addInitScript(inviteCode => localStorage.setItem(`guest_display_name_${inviteCode}`, "Гость проверки меню"), f.room.inviteCode);
    const guestPage = await guest.newPage();
    await guestPage.goto(`${web}/room/${f.room.inviteCode}`);
    await guestPage.getByTestId("room-code-editor-host").waitFor();
    const opener = f.page.getByRole("button", { name: /^Гость проверки меню, .*Открыть доступные действия участника$/ });
    await opener.waitFor();
    for (const theme of ["light", "dark"]) {
      await settle(f.page, theme);
      await opener.click();
      const action = f.page.getByRole("menuitem", { name: "Назначить интервьюером", exact: true });
      await action.waitFor();
      await f.page.mouse.move(0, 0);
      const surface = await action.locator("..").evaluate(el => {
        const style = getComputedStyle(el);
        return { border: parseFloat(style.borderTopWidth), shadow: style.boxShadow };
      });
      assert.ok(surface.border >= 1, `menu has a separate border: ${JSON.stringify(surface)}`);
      assert.notEqual(surface.shadow, "none", "menu has a shadow to separate it from the room");
      // Opening focuses the first item. Native pointer enter/leave establishes
      // an idle hover baseline independently of that keyboard-active state.
      await action.hover();
      await f.page.mouse.move(0, 0);
      const item = await action.elementHandle();
      await f.page.waitForFunction(el => el.isConnected && !el.matches(":hover") && !el.classList.contains("ant-dropdown-menu-item-active"), item);
      await f.page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
      const normal = await action.evaluate(el => getComputedStyle(el).backgroundColor);
      await action.hover();
      await f.page.waitForFunction(({ el, previous }) => el.isConnected && el.matches(":hover") && el.classList.contains("ant-dropdown-menu-item-active") && getComputedStyle(el).backgroundColor !== previous, { el: item, previous: normal });
      await f.page.evaluate(() => { for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
      assert.equal(await action.evaluate(el => el.matches(":hover")), true, "native pointer hovers the tested role action");
      assert.notEqual(await action.evaluate(el => getComputedStyle(el).backgroundColor), normal, "hovered role action differs from its idle background");
      await item.dispose();
      await f.page.screenshot({ path: `${screenshots}/participant-menu-${theme}.png` });
      await action.press("Escape");
      await action.waitFor({ state: "hidden" });
      assert.equal(await opener.evaluate(el => document.activeElement === el), true, "Escape returns focus to the participant");
      await opener.press("Enter");
      await action.waitFor();
      const focusedItem = await action.elementHandle();
      await f.page.waitForFunction(el => document.activeElement === el && el.matches(":focus-visible") && parseFloat(getComputedStyle(el).outlineWidth) >= 1 && getComputedStyle(el).outlineStyle !== "none", focusedItem);
      const focus = await action.evaluate(el => {
        const style = getComputedStyle(el);
        return { focused: document.activeElement === el, visible: el.matches(":focus-visible"), width: parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      assert.equal(focus.focused, true, "native keyboard opening focuses the role action");
      assert.equal(focus.visible, true, "keyboard role focus uses its visible focus state");
      assert.ok(focus.width >= 1 && focus.style !== "none", "keyboard role focus has a visible outline");
      await focusedItem.dispose();
      await action.press("Escape");
      await action.waitFor({ state: "hidden" });
      assert.equal(await opener.evaluate(el => document.activeElement === el), true, "keyboard Escape returns focus to the participant");
    }
  } finally { await f.close(); }
});

test("room task authoring has compact actions, wide grouped fields and scrolls without hiding submit", async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${web}/room/${f.room.inviteCode}`);
    await f.page.getByRole("tab", { name: "Шаги", exact: true }).click();
    await f.page.getByRole("button", { name: "Задача", exact: true }).first().click();
    const dialog = f.page.getByRole("dialog", { name: "Добавить задачу в комнату", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("combobox").count(), 0, "empty catalog gives an actionable empty state, without a disabled selector");
    await dialog.getByText("Новая задача", { exact: true }).click();
    const title = dialog.getByRole("textbox", { name: "Название", exact: true });
    await title.fill("Черновик формы задачи");
    await dialog.getByRole("textbox", { name: "Описание (Markdown, необязательно)", exact: true }).fill("Описание сохраняется при переключении темы и размеров");
    for (const width of [1366, 768, 390]) for (const theme of ["light", "dark"]) {
      const height = width === 1366 ? 900 : 600;
      await settle(f.page, theme, width, height);
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height + 1, `dialog fits ${width}: ${JSON.stringify(box)}`);
      if (width === 1366) assert.ok(box.width >= 930, `room authoring uses a generous desktop width, got ${box.width}`);
      const submit = await dialog.getByRole("button", { name: "Добавить в комнату", exact: true }).boundingBox();
      assert.ok(submit.y >= 0 && submit.y + submit.height <= height, "submit stays visible outside the scrolling fields");
      assert.ok(submit.width < 220, "submit is a compact action, not a full-width control");
      assert.equal(await title.inputValue(), "Черновик формы задачи");
      assert.equal(await dialog.getByRole("button", { name: "Отмена", exact: true }).count(), 1);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.screenshot({ path: `${screenshots}/room-task-${theme}-${width}.png` });
    }
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await settle(f.page, "light");
    await f.page.getByRole("button", { name: "Задача", exact: true }).first().click();
    await dialog.getByRole("button", { name: "Создать новую задачу", exact: true }).click();
    await title.fill("Задача добавлена через Enter");
    await dialog.getByRole("textbox", { name: "Описание (Markdown, необязательно)", exact: true }).fill("Условие задачи");
    await title.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    const savedRoom = await request(`/rooms/${f.room.inviteCode}`, f.auth.token);
    assert.ok(savedRoom.tasks.some(task => task.title === "Задача добавлена через Enter" && task.description === "Условие задачи"), "Enter saves the complete new task to the room");
  } finally { await f.close(); }
});

test("personal and team create/edit task dialogs share responsive grouped geometry", async () => {
  const f = await fixture();
  const { team } = await request("/teams", f.auth.token, { name: "Команда проверки форм" });
  const created = [];
  try {
    for (const scope of ["personal", "team"]) {
      const taskPath = scope === "personal" ? "/me/tasks" : `/teams/${team.id}/tasks`;
      const taskResult = await request(taskPath, f.auth.token, { title: `Задача геометрии ${scope}`, description: "Условие", starterCode: "// solution", language: "nodejs" });
      const task = taskResult.task ?? taskResult;
      created.push(`${taskPath}/${task.id}`);
      await f.page.goto(`${web}/workspace/${scope === "personal" ? "personal" : `teams/${team.id}`}/library`);
      for (const action of ["create", "edit"]) {
        if (action === "create") await f.page.getByRole("button", { name: "Создать задачу", exact: true }).click();
        else await f.page.getByRole("button", { name: `Редактировать задачу ${task.title}`, exact: true }).click();
        const name = action === "create" ? (scope === "personal" ? "Создать задачу" : "Новая командная задача") : "Редактировать задачу";
        const dialog = f.page.getByRole("dialog", { name, exact: true });
        await dialog.waitFor();
        await dialog.getByRole("textbox").first().click();
        for (const width of [1366, 768, 390]) for (const theme of ["light", "dark"]) {
          const height = width === 1366 ? 900 : 600;
          await settle(f.page, theme, width, height);
          const box = await dialog.boundingBox();
          if (width === 1366) assert.ok(box.width >= 930, `${scope} ${action}: expected wide dialog, got ${box.width}`);
          const titleBox = await dialog.getByRole("textbox").first().boundingBox();
          const languageBox = await dialog.getByRole("combobox").locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').boundingBox();
          const textareas = dialog.locator("textarea");
          const [description, code] = await Promise.all([textareas.nth(0).boundingBox(), textareas.nth(1).boundingBox()]);
          if (width === 1366) {
            assert.ok(Math.abs(titleBox.y - languageBox.y) <= 2, `title and language share a row: ${JSON.stringify({ titleBox, languageBox })}`);
            assert.ok(Math.abs(description.y - code.y) <= 2 && code.x >= description.x + description.width, "description and code sit side by side");
          } else assert.ok(code.y > description.y, "narrow views stack long fields");
          const footer = await dialog.getByRole("button", { name: action === "create" && scope === "team" ? "Создать задачу" : "Сохранить задачу", exact: true }).boundingBox();
          assert.ok(footer.y + footer.height <= height && footer.width < 220, "compact submit remains visible");
          assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await f.page.screenshot({ path: `${screenshots}/${scope}-${action}-${theme}-${width}.png` });
        }
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        await settle(f.page, "light");
      }
    }
  } finally { for (const path of created.reverse()) await request(path, f.auth.token, null, "DELETE").catch(() => {}); await f.close(); }
});
