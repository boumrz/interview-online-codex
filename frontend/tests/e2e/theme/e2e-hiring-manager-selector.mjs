import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const accountId = "00000000-0000-4000-8000-000000000001";
const teamId = "00000000-0000-4000-8000-000000000010";
const externalId = "00000000-0000-4000-8000-0000000000ab";
const externalNickname = "external.hiring";
const otherExternalNickname = "another.hiring";
const otherExternalId = "00000000-0000-4000-8000-0000000000cd";

async function fixture(previewResponse) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const requests = [];
  const user = { id: accountId, nickname: "selector", displayName: "Участник команды", role: "user", isHr: true };
  const team = { id: teamId, name: "Команда разработки", role: "OWNER", epoch: 1, revision: 1, capabilities: [] };
  await context.routeWebSocket("**/ws", socket => socket.close());
  await context.addInitScript(() => localStorage.setItem("auth_token", "selector-ui-fixture"));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    requests.push({ pathname, body });
    if (pathname === "/api/me/hiring-manager-preview") return previewResponse(route, body);
    const response = pathname === "/api/me/profile" ? user
      : pathname === "/api/me/workspaces" ? [{ id: "personal", name: "Личное пространство", role: "OWNER", epoch: 1, capabilities: [] }, team]
      : pathname === `/api/teams/${teamId}` ? team
      : pathname === `/api/teams/${teamId}/members` ? { items: [{ userId: accountId, displayName: user.displayName, role: "OWNER", state: "ACTIVE", revision: 1 }], page: 0, size: 100, totalElements: 1, totalPages: 1 }
      : { items: [], counts: { activeTracks: 0, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${web}/workspace/teams/${teamId}/interviews/new`, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
  await dialog.waitFor();
  return { browser, page, dialog, requests, selector: dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }) };
}

const fulfillPerson = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ normalizedId: body.nickname === otherExternalNickname ? otherExternalId : externalId, displayName: body.nickname === otherExternalNickname ? "Другой нанимающий" : "Внешний нанимающий" }) });

test("hiring selector previews an exact nickname asynchronously and adds only the confirmed option", async () => {
  const { browser, page, dialog, requests, selector } = await fixture(fulfillPerson);
  try {
    await selector.fill(externalNickname);
    const option = page.locator(".ant-select-item-option").filter({ hasText: "Внешний нанимающий" });
    await option.waitFor();
    assert.equal(requests.filter(request => request.pathname === "/api/me/hiring-manager-preview").at(-1).body.nickname, externalNickname);
    assert.equal(requests.filter(request => request.pathname === "/api/me/hiring-manager-preview").at(-1).body.teamId, teamId);
    assert.equal(await option.getByText(externalId, { exact: true }).count(), 0, "technical identifiers are not rendered");
    assert.equal(await dialog.getByText(/UUID|ID нанимающего/).count(), 0, "lookup never asks for technical identifiers");
    assert.equal(await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).count(), 0, "preview does not add the person before confirmation");
    await option.click();
    await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).waitFor();
    assert.equal(await selector.inputValue(), "", "search clears after choosing the confirmed person");
    assert.equal(await dialog.getByText("Участники команды уже видят всех кандидатов.", { exact: false }).count(), 0);
    assert.equal(requests.filter(request => request.pathname === "/api/me/hiring-manager-options").length, 0, "selector does not expose a global hiring directory");
    await selector.fill(externalNickname);
    await dialog.getByRole("alert").filter({ hasText: "Нанимающий уже добавлен" }).waitFor();
    assert.equal(requests.filter(request => request.pathname === "/api/me/hiring-manager-preview").length, 2, "duplicate is rejected after confirming the nickname");
  } finally { await browser.close(); }
});

test("hiring selector rejects invalid nicknames and server-ineligible team members, then allows retry", async () => {
  const { browser, page, dialog, requests, selector } = await fixture((route, body) => body.nickname === "selector"
    ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Участники команды уже имеют доступ ко всем кандидатам" }) })
    : fulfillPerson(route, body));
  try {
    await selector.fill("invalid nickname");
    await selector.press("Enter");
    await dialog.getByRole("alert").filter({ hasText: "Введите ник от 3 до 32 символов без пробелов" }).waitFor();
    assert.equal(requests.filter(request => request.pathname === "/api/me/hiring-manager-preview").length, 0);
    await selector.fill("selector");
    await dialog.getByRole("alert").filter({ hasText: "Участники команды уже имеют доступ" }).waitFor();
    assert.equal(await page.locator(".ant-select-item-option").count(), 0);
    await selector.fill(externalNickname);
    await page.locator(".ant-select-item-option").filter({ hasText: "Внешний нанимающий" }).click();
    await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("alert").filter({ hasText: "Участники команды уже имеют доступ" }).count(), 0);
  } finally { await browser.close(); }
});

test("hiring selector ignores an older response after the search changes", async () => {
  let releaseOld;
  let startedOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  const started = new Promise(resolve => { startedOld = resolve; });
  const { browser, page, dialog, selector } = await fixture(async (route, body) => {
    if (body.nickname === externalNickname) { startedOld(); await gate; }
    return fulfillPerson(route, body);
  });
  try {
    await selector.fill(externalNickname);
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("nickname preview did not start")), 5000))]);
    await selector.fill(otherExternalNickname);
    const current = page.locator(".ant-select-item-option").filter({ hasText: "Другой нанимающий" });
    await current.waitFor();
    releaseOld();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator(".ant-select-item-option").filter({ hasText: "Внешний нанимающий" }).count(), 0, "late preview cannot replace the new search result");
    await current.click();
    await dialog.getByRole("button", { name: "Удалить нанимающего Другой нанимающий", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).count(), 0);
  } finally { releaseOld(); await browser.close(); }
});

test("clearing a pending hiring search releases submit and prevents late suggestions", async () => {
  let releasePreview;
  let startedPreview;
  const gate = new Promise(resolve => { releasePreview = resolve; });
  const started = new Promise(resolve => { startedPreview = resolve; });
  const { browser, page, dialog, selector } = await fixture(async (route, body) => {
    startedPreview();
    await gate;
    return fulfillPerson(route, body);
  });
  try {
    await dialog.getByRole("textbox", { name: "Название интервью", exact: true }).fill("Интервью с внешним нанимающим");
    const submit = dialog.getByRole("button", { name: "Создать интервью", exact: true });
    await submit.waitFor({ state: "visible" });
    assert.equal(await submit.isDisabled(), false);
    await selector.fill(externalNickname);
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("nickname preview did not start")), 5000))]);
    assert.equal(await submit.isDisabled(), true, "a preview in progress holds submission");
    await selector.fill("");
    await page.waitForFunction(() => !document.querySelector('.app-form-actions button[type="submit"]').disabled);
    releasePreview();
    await page.waitForLoadState("networkidle");
    assert.equal(await submit.isDisabled(), false);
    assert.equal(await page.locator(".ant-select-item-option").count(), 0, "cleared search cannot receive an old suggestion");
    assert.equal(await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).count(), 0);
  } finally { releasePreview(); await browser.close(); }
});


test("unknown hiring nickname returns actionable feedback and releases creation", async () => {
  const { browser, dialog, selector } = await fixture(route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Нанимающий не найден или недоступен" }) }));
  try {
    await dialog.getByRole("textbox", { name: "Название интервью", exact: true }).fill("Новое интервью");
    await selector.fill("missing.hiring");
    await dialog.getByRole("alert").filter({ hasText: "Нанимающий не найден или недоступен" }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Создать интервью", exact: true }).isDisabled(), false);
  } finally { await browser.close(); }
});

test("hanging hiring lookup times out, releases creation and allows retry", async () => {
  let releasePreview;
  const gate = new Promise(resolve => { releasePreview = resolve; });
  const { browser, page, dialog, selector } = await fixture(async (route, body) => {
    if (body.nickname === "missing.hiring") await gate;
    return fulfillPerson(route, body);
  });
  try {
    await dialog.getByRole("textbox", { name: "Название интервью", exact: true }).fill("Новое интервью");
    await selector.fill("missing.hiring");
    await dialog.getByRole("alert").filter({ hasText: "Сервер не ответил вовремя" }).waitFor({ timeout: 11000 });
    assert.equal(await dialog.getByRole("button", { name: "Создать интервью", exact: true }).isDisabled(), false);
    await selector.fill(externalNickname);
    await page.locator(".ant-select-item-option").filter({ hasText: "Внешний нанимающий" }).click();
    await dialog.getByRole("button", { name: "Удалить нанимающего Внешний нанимающий", exact: true }).waitFor();
  } finally { releasePreview(); await browser.close(); }
});
