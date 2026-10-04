import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const evidence = process.env.EVIDENCE_DIR ?? ".run/ui2-controls";
const initialMode = process.env.INITIAL_THEME === "dark" ? "dark" : "light";
await mkdir(evidence, { recursive: true });
async function request(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}
const auth = await request("/auth/register", null, { nickname: `ui2_${Date.now().toString(36)}`, displayName: "Проверка контролов", password: "test-password-123" });
const { team } = await request("/teams", auth.token, { name: `Контролы ${Date.now()}` });
const browser = await chromium.launch();
const failures = [];
const check = (condition, description) => { if (!condition) failures.push(description); };
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user, initialMode }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
    localStorage.setItem("interview-online:ui-theme", initialMode);
  }, { ...auth, initialMode });
  const page = await context.newPage();
  await page.goto(`${web}/workspace/teams/${team.id}/library`);
  await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByLabel("Название задачи", { exact: true }).fill("Задача для проверки");
  await dialog.getByLabel("Описание задачи", { exact: true }).fill("Содержимое сохраняется при смене темы");
  for (const mode of [initialMode, initialMode === "light" ? "dark" : "light", initialMode]) {
    await page.evaluate((value) => window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: value })), mode);
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
    await page.waitForTimeout(250);
    const visuals = await dialog.evaluate((element) => {
      const container = element.querySelector(".ant-modal-container");
      const textarea = element.querySelector("textarea");
      const select = element.querySelector(".ant-select");
      const field = select.closest(".ant-form-item");
      const css = (target) => getComputedStyle(target);
      const root = css(document.documentElement);
      const resolve = (name) => { const node = document.createElement("span"); node.style.color = root.getPropertyValue(name); element.append(node); const result = css(node).color; node.remove(); return result; };
      return {
        modal: css(container).backgroundColor,
        surface: resolve("--app-surface-elevated"),
        textarea: css(textarea).backgroundColor,
        controlSurface: resolve("--app-surface"),
        selectWidth: select.getBoundingClientRect().width,
        fieldWidth: field.getBoundingClientRect().width,
        editorBackground: resolve("--app-editor-bg"),
        editorText: resolve("--app-editor-text"),
      };
    });
    check(visuals.modal === visuals.surface, `${mode}: modal must follow theme (${visuals.modal} vs ${visuals.surface})`);
    check(visuals.textarea === visuals.controlSurface, `${mode}: textarea must follow theme (${visuals.textarea} vs ${visuals.controlSurface})`);
    check(Math.abs(visuals.selectWidth - visuals.fieldWidth) <= 1, `${mode}: language control must fill its form field (${visuals.selectWidth} vs ${visuals.fieldWidth})`);
    const rgb = (color) => color.match(/\d+/g).map(Number).slice(0, 3).reduce((sum, number) => sum + number, 0) / 3;
    check(mode === "light" ? rgb(visuals.editorBackground) > 230 && rgb(visuals.editorText) < 80 : rgb(visuals.editorBackground) < 50 && rgb(visuals.editorText) > 200, `${mode}: editor roles must follow current theme`);
    assert.equal(await dialog.getByLabel("Описание задачи", { exact: true }).inputValue(), "Содержимое сохраняется при смене темы");
    await page.screenshot({ path: `${evidence}/create-task-${mode}.png` });
  }
  await dialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const refresh = page.getByRole("button", { name: "Обновить", exact: true });
  check(await refresh.evaluate((element) => getComputedStyle(element).boxShadow) === "none", "secondary action must not have a bright bottom shadow");
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  await page.getByRole("button", { name: "Создать набор", exact: true }).click();
  const setDialog = page.getByRole("dialog", { name: "Новый командный набор", exact: true });
  const picker = setDialog.getByRole("combobox", { name: "Задачи набора", exact: true });
  await picker.fill("Задача для проверки");
  await picker.press("Enter");
  await picker.press("Escape");
  const chip = setDialog.locator(".ant-select-selection-item").filter({ hasText: "Задача для проверки" });
  check(await chip.count() === 1, "task selector produces one selected task chip");
  await chip.locator(".ant-select-selection-item-remove").click();
  check(await chip.count() === 0, "selected task can be removed through its chip");
  await picker.fill("Задача для проверки");
  await picker.press("Enter");
  await picker.press("Escape");
  await setDialog.getByRole("textbox", { name: "Название набора", exact: true }).fill("Набор проверки контролов");
  await setDialog.getByRole("button", { name: "Создать набор", exact: true }).click();
  await setDialog.waitFor({ state: "hidden" });
  await page.getByRole("region", { name: "Командный набор Набор проверки контролов", exact: true }).getByText("Задача для проверки", { exact: true }).waitFor();
  await context.close();
} finally { await browser.close(); }
assert.deepEqual(failures, [], "UI.2 control/theme regressions");
console.log("UI.2 shared controls: light/dark/live theme switch, modal, textarea, language width, buttons and task selection/deselection/save passed");
