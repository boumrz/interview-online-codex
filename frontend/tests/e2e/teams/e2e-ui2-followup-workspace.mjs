import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
async function create(path, token, body) {
  const response = await fetch(`${api}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}
const auth = await create("/auth/register", null, { nickname: `ui2follow_${Date.now().toString(36)}`, displayName: "Проверка уточнений", password: "test-password-123" });
const { team } = await create("/teams", auth.token, { name: "UX" });
const { team: longTeam } = await create("/teams", auth.token, { name: "Очень длинное название команды для проверки постоянной ширины переключателя" });
const { task } = await create(`/teams/${team.id}/tasks`, auth.token, { title: "Задача", description: "Описание", starterCode: "function solve() {}", language: "nodejs" });
await create(`/teams/${team.id}/task-sets`, auth.token, { name: "Набор", taskIds: [task.id] });
const { track } = await create(`/teams/${team.id}/tracks`, auth.token, { name: "Трек" });
await create(`/teams/${team.id}/tracks/${track.id}/vacancies`, auth.token, { title: "Вакансия" });
const browser = await chromium.launch();
const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.routeWebSocket("**/ws", (socket) => socket.close());
  await context.addInitScript(({ token, user }) => { localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); localStorage.setItem("display_name", user.displayName); }, auth);
  const page = await context.newPage();
  for (const current of [team, longTeam]) {
    await page.goto(`${web}/workspace/teams/${current.id}/interviews`);
    const trigger = page.getByRole("button", { name: `Команды: ${current.name}. Сменить команду`, exact: true });
    await trigger.waitFor();
    const [switcher, theme, profile] = await Promise.all([trigger.boundingBox(), page.getByRole("button", { name: "Тёмная тема", exact: true }).boundingBox(), page.getByRole("link", { name: `Открыть профиль @${auth.user.nickname}` }).boundingBox()]);
    if (Math.abs(switcher.width - 240) > 1) failures.push(`workspace switcher must keep width240 for ${current.name}: ${switcher.width}`);
    if (Math.abs(switcher.height - theme.height) > 1 || Math.abs(switcher.height - profile.height) > 1) failures.push(`header controls must share height: ${switcher.height}/${theme.height}/${profile.height}`);
    for (const box of [theme, profile]) if (Math.abs(switcher.y + switcher.height / 2 - box.y - box.height / 2) > 1) failures.push("header controls must share vertical center");
    await trigger.click();
    await page.getByRole("menu", { name: "Выбор команды" }).getByRole("menuitem", { name: "Создать команду", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
    const input = dialog.getByRole("textbox", { name: "Название команды", exact: true });
    await input.waitFor();
    if (await input.count() !== 1) failures.push("team name must retain an accessible name without a visible repeated label");
    else if (await input.getAttribute("placeholder") !== "Введите название команды") failures.push("team name placeholder must explain the action");
    if (await dialog.getByText("Название команды", { exact: true }).count() !== 0) failures.push("team creation does not repeat the visible field label");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  const scenarios = [
    { route: "library", name: "Задача", trigger: "Редактировать задачу Задача", title: "Редактировать задачу", field: "Новое название задачи", placeholder: "Введите новое название задачи", fullEditor: true },
    { route: "library", tab: "Наборы задач", name: "Набор", trigger: "Редактировать набор Набор", title: "Редактировать набор", field: "Новое название набора", placeholder: "Введите новое название набора", fullEditor: true },
    { route: "tracks", name: "Трек", trigger: "Переименовать трек Трек", title: "Переименовать трек", field: "Новое название трека", placeholder: "Введите новое название трека" },
    { route: "tracks", name: "Вакансия", trigger: "Переименовать вакансию Вакансия", title: "Переименовать вакансию", field: "Новое название вакансии", placeholder: "Введите новое название вакансии" },
  ];
  for (const scenario of scenarios) {
    await page.goto(`${web}/workspace/teams/${team.id}/${scenario.route}`);
    if (scenario.tab) await page.getByRole("tab", { name: scenario.tab, exact: true }).click();
    await page.getByText(scenario.name, { exact: true }).first().waitFor();
    const trigger = page.getByRole("button", { name: scenario.trigger, exact: true });
    if (await trigger.count() !== 1) { failures.push(`${scenario.name} must have one rename pencil beside the title`); continue; }
    const [titleBox, triggerBox] = await Promise.all([page.getByText(scenario.name, { exact: true }).first().boundingBox(), trigger.boundingBox()]);
    if (scenario.fullEditor) {
      if ((await trigger.textContent()).trim() !== "Редактировать") failures.push(`${scenario.name} has one explicit full-editor action`);
      if (await page.getByRole("button", { name: `Переименовать ${scenario.name === "Задача" ? "задачу" : "набор"} ${scenario.name}`, exact: true }).count()) failures.push(`${scenario.name} has no duplicate rename pencil`);
      if (triggerBox.width < 32 || triggerBox.height < 32) failures.push(`${scenario.name} full-editor action remains reachable`);
    } else {
      if ((await trigger.textContent()).trim() || !(await trigger.locator("svg").count()) || triggerBox.width > 36) failures.push(`${scenario.name} rename is an icon action`);
      if (Math.abs(triggerBox.x - titleBox.x - titleBox.width) > 16 || Math.abs(triggerBox.y + triggerBox.height / 2 - titleBox.y - titleBox.height / 2) > 1) failures.push(`${scenario.name} pencil is aligned directly beside the title`);
    }
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: scenario.title, exact: true });
    if (await dialog.getByLabel(scenario.field, { exact: true }).getAttribute("placeholder") !== scenario.placeholder) failures.push(`${scenario.name} rename placeholder is an instruction`);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, scenario.trigger);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${web}/workspace/teams/${longTeam.id}/interviews`);
  await page.getByRole("button", { name: `Команды: ${longTeam.name}. Сменить команду`, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "long workspace label does not overflow the tablet viewport");
  await context.close();
} finally { await browser.close(); }
assert.deepEqual(failures, [], "UI.2 follow-up workspace controls");
console.log("Workspace header, fixed switcher, accessible team creation and rename pencils passed");
