import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const userId = "00000000-0000-4000-8000-000000000001";
const unbroken = `НеразделимоеНазвание${"ОченьДлинное".repeat(20)}`.slice(0, 200);
const spaced = `Очень длинное название команды ${"для проверки ширины списка ".repeat(9)}`.slice(0, 200);
const trackLabel = `ТрекБезПробелов${"РазработкаИнтервью".repeat(13)}`.slice(0, 200);
const memberLabel = `ИнтервьюерБезПробелов${"ДлинноеИмяУчастника".repeat(13)}`.slice(0, 200);
const otherMemberLabel = `Участник с длинным именем ${"для проверки выбранного значения ".repeat(8)}`.slice(0, 200);
const taskLabel = `ЗадачаБезПробелов${"ДлинноеНазваниеУсловия".repeat(12)}`.slice(0, 200);
const spacedTaskLabel = `Задача с длинным названием ${"для проверки списка задач ".repeat(9)}`.slice(0, 200);
const hiringLabel = `НанимающийБезПробелов${"ДлинноеИмяСпециалиста".repeat(12)}`.slice(0, 200);
const teamIds = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`);
const teams = teamIds.map((id, index) => ({ id, name: index === 0 ? unbroken : index === 29 ? spaced : `Команда ${index + 1}`, role: "OWNER", epoch: 1, revision: 1, capabilities: [] }));
const user = { id: userId, nickname: "overflow", displayName: "Проверка селекторов", role: "user", isHr: false };
const members = [
  { userId, displayName: user.displayName, role: "OWNER", state: "ACTIVE", revision: 1 },
  { userId: "00000000-0000-4000-8000-000000000041", displayName: memberLabel, role: "MEMBER", state: "ACTIVE", revision: 1 },
  { userId: "00000000-0000-4000-8000-000000000042", displayName: otherMemberLabel, role: "MEMBER", state: "ACTIVE", revision: 1 },
];
const tracks = [
  { id: "long-track", name: trackLabel, status: "ACTIVE", revision: 1, programme: null, vacancies: [] },
  { id: "spaced-track", name: spaced, status: "ACTIVE", revision: 1, programme: null, vacancies: [] },
];
const tasks = [taskLabel, spacedTaskLabel].map((title, index) => ({ id: `long-task-${index}`, title, description: "Условие", starterCode: "", language: "nodejs", status: "ACTIVE", revision: 1, createdByUserId: userId }));

async function fixture(width, mode) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  await context.addInitScript(({ user, mode }) => {
    localStorage.setItem("auth_token", "selector-overflow-fixture");
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("interview-online:ui-theme", mode);
  }, { user, mode });
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === "/api/me/profile") body = user;
    else if (path === "/api/me/workspaces") body = [{ id: "personal", name: "Личное", role: "OWNER", epoch: 1, capabilities: [] }, ...teams];
    else if (teams.some(team => path === `/api/teams/${team.id}`)) body = teams.find(team => path === `/api/teams/${team.id}`);
    else if (path.endsWith("/members")) body = { items: members, page: 0, size: 100, totalElements: members.length, totalPages: 1 };
    else if (path.endsWith("/tracks")) body = { items: tracks, counts: { activeTracks: 2, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
    else if (path.endsWith("/tasks")) body = { items: tasks };
    else if (path === "/api/me/hiring-manager-preview") body = { normalizedId: "00000000-0000-4000-8000-000000000088", displayName: hiringLabel };
    else if (path.endsWith("/interviews") || path.endsWith("/interview-owner-offers") || path.endsWith("/task-sets")) body = { items: [] };
    else return route.fulfill({ status: 404, json: { error: "Fixture route unavailable" } });
    return route.fulfill({ status: 200, json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(`${web}/workspace/teams/${teams[0].id}/interviews`);
  await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
  await page.evaluate(async () => { await document.fonts.ready; });
  return { browser, page };
}

function controlFor(combobox) {
  return combobox.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-select ')][1]");
}

async function noHorizontalScroll(locator, label, failures) {
  const boxes = await locator.evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({
    width: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX,
  })));
  assert.ok(boxes.length, `${label}: visible surface exists`);
  for (const box of boxes) if (box.scrollWidth > box.width + 1) failures.push(`${label}: horizontal overflow ${box.scrollWidth}px > ${box.width}px (${box.overflowX})`);
}

async function settleOverlay(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function ellipsis(locator, label, failures) {
  const style = await locator.evaluate(element => {
    const computed = getComputedStyle(element);
    return { width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth, overflowX: computed.overflowX, whiteSpace: computed.whiteSpace, textOverflow: computed.textOverflow };
  });
  if (style.textOverflow !== "ellipsis" || style.whiteSpace !== "nowrap" || !["hidden", "clip"].includes(style.overflowX)) failures.push(`${label}: long text is not a single truncated line ${JSON.stringify(style)}`);
  assert.ok(style.width > 0, `${label}: label remains visible`);
}

async function iconInside(icon, container, label, failures) {
  await icon.waitFor();
  const [iconBox, containerBox] = await Promise.all([icon.boundingBox(), container.boundingBox()]);
  if (!iconBox || !containerBox || iconBox.width <= 0 || iconBox.height <= 0) {
    failures.push(`${label}: icon has no visible dimensions`);
    return;
  }
  if (iconBox.x < containerBox.x - 1 || iconBox.x + iconBox.width > containerBox.x + containerBox.width + 1) failures.push(`${label}: icon is clipped beyond its control`);
}

async function dropdown(page, combobox, label, failures) {
  await combobox.click();
  const popup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([class*='-leave'])");
  await popup.waitFor();
  await settleOverlay(page);
  await noHorizontalScroll(popup, `${label} popup`, failures);
  await noHorizontalScroll(popup.locator(".ant-select-dropdown-list-holder"), `${label} option list`, failures);
  return popup;
}

for (const width of [768, 1366]) for (const mode of ["light", "dark"]) {
  test(`long selector labels fit workspace and generic controls without horizontal scrolling at ${width}px ${mode}`, { timeout: 45_000 }, async () => {
    const { browser, page } = await fixture(width, mode);
    const failures = [];
    try {
      const trigger = page.getByRole("button", { name: /Команды:/ });
      await ellipsis(trigger.locator("[data-workspace-switcher-label]"), "workspace current label", failures);
      await noHorizontalScroll(trigger, "workspace current field", failures);
      await iconInside(trigger.locator(".anticon-down"), trigger, "workspace chevron", failures);
      await trigger.focus();
      await trigger.press("ArrowDown");
      const menu = page.getByRole("menu", { name: "Выбор команды", exact: true });
      await menu.waitFor();
      await settleOverlay(page);
      const selected = menu.getByRole("menuitemradio", { name: unbroken, exact: true });
      const list = selected.locator("..");
      await noHorizontalScroll(menu, "workspace popup", failures);
      await noHorizontalScroll(list, "workspace choices", failures);
      await noHorizontalScroll(selected, "workspace selected option", failures);
      await ellipsis(selected.getByTitle(unbroken, { exact: true }), "workspace unbroken option", failures);
      await iconInside(selected.locator(".anticon-check"), menu, "workspace selection check", failures);
      const create = menu.getByRole("menuitem", { name: "Создать команду", exact: true });
      const initialCreate = await create.boundingBox();
      assert.equal(await list.evaluate(element => element.scrollHeight > element.clientHeight), true, "long workspace lists keep vertical scrolling");
      await page.keyboard.press("End");
      const last = menu.getByRole("menuitemradio", { name: spaced, exact: true });
      assert.equal(await last.evaluate(element => element === document.activeElement), true, "End selects the final choice by keyboard");
      await ellipsis(last.getByTitle(spaced, { exact: true }), "workspace spaced option", failures);
      assert.ok(Math.abs((await create.boundingBox()).y - initialCreate.y) < 1, "create action stays fixed during vertical menu scrolling");
      await page.keyboard.press("Enter");
      await page.waitForURL(`**/workspace/teams/${teams.at(-1).id}/interviews`);
      await page.waitForFunction(label => document.querySelector("[data-workspace-switcher-label]")?.textContent === label, spaced);
      await ellipsis(trigger.locator("[data-workspace-switcher-label]"), "workspace selected spaced label", failures);
      await noHorizontalScroll(trigger, "workspace selected spaced field", failures);
      await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
      await dialog.waitFor();
      await settleOverlay(page);
      const track = dialog.getByRole("combobox", { name: "Трек интервью", exact: true });
      let popup = await dropdown(page, track, "single Select", failures);
      const trackOption = popup.getByTitle(trackLabel, { exact: true });
      await ellipsis(trackOption.locator(".ant-select-item-option-content"), "single Select unbroken option", failures);
      await ellipsis(popup.getByTitle(spaced, { exact: true }).locator(".ant-select-item-option-content"), "single Select spaced option", failures);
      await track.fill("ТрекБезПробелов");
      await track.press("ArrowDown");
      await track.press("Enter");
      const trackControl = controlFor(track);
      await trackControl.getByText(trackLabel, { exact: true }).waitFor();
      await noHorizontalScroll(trackControl, "single Select selected control", failures);
      await ellipsis(trackControl.locator(".ant-select-content"), "single Select selected label", failures);
      await iconInside(trackControl.locator(".anticon-down"), trackControl, "single Select chevron", failures);
      const taskPicker = dialog.getByRole("combobox", { name: "Задачи интервью", exact: true });
      popup = await dropdown(page, taskPicker, "composite task MultiSelect", failures);
      const taskOption = popup.getByTitle(taskLabel, { exact: true });
      await ellipsis(taskOption.getByText(taskLabel, { exact: true }), "composite task unbroken title", failures);
      await ellipsis(popup.getByTitle(spacedTaskLabel, { exact: true }).getByText(spacedTaskLabel, { exact: true }), "composite task spaced title", failures);
      const language = taskOption.getByText("Node JS", { exact: true });
      await language.waitFor();
      await iconInside(language, taskOption, "task language label", failures);
      await taskPicker.press("Escape");
      const interviewers = dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true });
      popup = await dropdown(page, interviewers, "MultiSelect", failures);
      await ellipsis(popup.getByTitle(memberLabel, { exact: true }).locator(".ant-select-item-option-content"), "MultiSelect unbroken option", failures);
      await ellipsis(popup.getByTitle(otherMemberLabel, { exact: true }).locator(".ant-select-item-option-content"), "MultiSelect spaced option", failures);
      await interviewers.fill("ИнтервьюерБезПробелов");
      await interviewers.press("ArrowDown");
      await interviewers.press("Enter");
      await interviewers.press("Escape");
      const multiControl = controlFor(interviewers);
      await multiControl.getByText(memberLabel, { exact: true }).waitFor();
      await noHorizontalScroll(multiControl, "MultiSelect selected control", failures);
      await ellipsis(multiControl.locator(".ant-select-selection-item-content"), "MultiSelect selected chip", failures);
      await iconInside(multiControl.locator(".ant-select-selection-item-remove"), multiControl, "MultiSelect remove icon", failures);
      const hiringPicker = dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      await hiringPicker.fill("long.hiring");
      const hiringPopup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([class*='-leave'])");
      await hiringPopup.getByTitle(hiringLabel, { exact: true }).waitFor();
      await settleOverlay(page);
      await noHorizontalScroll(hiringPopup, "hiring picker popup", failures);
      await noHorizontalScroll(hiringPopup.locator(".ant-select-dropdown-list-holder"), "hiring picker option list", failures);
      await ellipsis(hiringPopup.getByTitle(hiringLabel, { exact: true }).getByText(hiringLabel, { exact: true }), "hiring picker nested option text", failures);
      await hiringPicker.press("Escape");
      await noHorizontalScroll(dialog.locator(".app-authoring-fields"), "form scroll area", failures);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "page itself remains within the viewport");
      assert.deepEqual(failures, [], failures.join("\n"));
    } finally { await browser.close(); }
  });
}
