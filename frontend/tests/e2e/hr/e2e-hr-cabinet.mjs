import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function request(path, { token, method = "GET", body, status = 200, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function account(isHr = false, name = "Участник проверки") {
  return request("/auth/register", {
    method: "POST",
    body: { nickname: `hr_${unique()}`, displayName: name, password: "test-password-123", isHr },
  });
}

async function createInterview(owner, title = `Интервью ${unique()}`) {
  const room = await request("/rooms", { token: owner.token, method: "POST", body: { title, taskIds: [] } });
  await request(`/rooms/${room.inviteCode}/tasks`, {
    token: owner.token, method: "POST",
    body: { customTasks: [{ title: "Задача на массивы", description: "Объясните решение", starterCode: "const solve = () => 42;", language: "nodejs" }] },
  });
  return room;
}

async function createTeam(owner, name = `Команда найма ${unique()}`) {
  return (await request("/teams", { token: owner.token, method: "POST", body: { name }, status: 201 })).team;
}

async function createTeamInterview(owner, title = `Интервью ${unique()}`, existingTeamId) {
  const teamId = existingTeamId ?? (await createTeam(owner)).id;
  const { interview: room } = await request(`/teams/${teamId}/interviews`, {
    token: owner.token, method: "POST", body: { title, selectedTaskIds: [] }, status: 201,
  });
  await request(`/rooms/${room.inviteCode}/tasks`, {
    token: owner.token, method: "POST",
    body: { customTasks: [{ title: "Задача на массивы", description: "Объясните решение", starterCode: "const solve = () => 42;", language: "nodejs" }] },
  });
  return { ...room, teamId };
}

async function joinTeam(owner, room, colleague) {
  const { invitation } = await request(`/teams/${room.teamId}/invitations`, { token: owner.token, method: "POST", body: {}, status: 201 });
  const { url } = await request(`/teams/${room.teamId}/invitations/${invitation.id}/link`, { token: owner.token });
  await request("/team-invitations/accept", { token: colleague.token, method: "POST", body: { token: new URL(url, web).hash.slice("#token=".length) } });
}

async function setTeamManagerRole(owner, room, target, role) {
  if (target.user.isHr) {
    await request(`/rooms/${room.inviteCode}/hr-managers/${target.user.id}`, {
      token: owner.token, method: role === "interviewer" ? "PUT" : "DELETE", ...(role === "candidate" ? { status: 204 } : {}),
    });
  } else if (role === "interviewer") await joinTeam(owner, room, target);
  else await request(`/teams/${room.teamId}/members/${target.user.id}`, { token: owner.token, method: "DELETE" });
}

async function openTeamCreation(browser, owner, options) {
  const team = await createTeam(owner);
  return { ...(await openAccount(browser, owner, `/workspace/teams/${team.id}/interviews/new`, options)), team };
}

async function createTaskTemplate(owner, title = `Задача ${unique()}`) {
  return request("/me/tasks", {
    token: owner.token,
    method: "POST",
    body: {
      title,
      description: "Задача для проверки создания комнаты",
      starterCode: "const solve = () => 42;",
      language: "nodejs",
    },
  });
}

async function openAccount(browser, auth, path = "/dashboard/hr", { preserveAuthOnReload = false } = {}) {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(({ token, name, preserveAuthOnReload }) => {
    if (preserveAuthOnReload && localStorage.getItem("auth_token")) return;
    localStorage.setItem("auth_token", token);
    localStorage.setItem("display_name", name);
  }, { token: auth.token, name: auth.user.displayName, preserveAuthOnReload });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  if (path === "/dashboard/rooms") {
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await page.getByRole("dialog", { name: "Создать интервью", exact: true }).waitFor();
  }
  return { context, page };
}

async function chooseHiring(page, input, label) {
  // Ant Select renders its accessible options in the virtual list; keyboard
  // selection uses that list even while its accessibility node is offscreen.
  await page.getByRole("option", { name: label, exact: true }).waitFor({ state: "attached" });
  await input.press("ArrowDown");
  await input.press("Enter");
}

async function downloadWorkbook(page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^hr-interviews-.*\.xlsx$/);
  assert.equal(await download.failure(), null);
  const directory = await mkdtemp(join(tmpdir(), "hr-e2e-"));
  try {
    const path = join(directory, "interviews.xlsx");
    await download.saveAs(path);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, 2).toString(), "PK", "Download must be an OOXML ZIP, not renamed JSON/CSV");
    assert.ok(bytes.length > 1000, "Workbook must contain real sheets");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("cabinet pagination selects the requested page and keeps all owned interviews reachable", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const hr = await account(true, "Нанимающий с двумя страницами интервью");
    for (let index = 0; index < 21; index += 1) {
      const room = await request("/rooms", {
        token: hr.token, method: "POST", body: { title: `Страница ${index + 1} ${unique()}`, taskIds: [] },
      });

    }
    const first = await request("/me/hr/rooms?page=0&size=20", { token: hr.token });
    const second = await request("/me/hr/rooms?page=1&size=20", { token: hr.token });
    assert.equal(first.totalPages, 2);
    assert.equal(first.totalElements, 21);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 1);
    assert.equal(first.items.some(item => item.roomId === second.items[0].roomId), false);

    const { page } = await openAccount(browser, hr);
    await page.getByRole("row").filter({ hasText: first.items[0].title }).waitFor();
    await page.getByText("Показаны 1–20 из 21", { exact: true }).waitFor();
    assert.equal(await page.getByRole("row").filter({ hasText: second.items[0].title }).count(), 0);
    const pager = page.locator(".ant-pagination");
    const secondResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/me/hr/rooms" && url.searchParams.get("page") === "1" && response.status() === 200;
    });
    await pager.getByTitle("2", { exact: true }).click();
    assert.equal((await secondResponse).status(), 200);
    await page.getByRole("row").filter({ hasText: second.items[0].title }).waitFor();
    await page.getByText("Показаны 21–21 из 21", { exact: true }).waitFor();
    assert.equal(await pager.locator(".ant-pagination-item-active").textContent(), "2");
    assert.equal(await page.getByRole("row").filter({ hasText: first.items[0].title }).count(), 0);
    await pager.getByTitle("1", { exact: true }).click();
    await page.getByRole("row").filter({ hasText: first.items[0].title }).waitFor();
    await page.getByText("Показаны 1–20 из 21", { exact: true }).waitFor();
    assert.equal(await pager.locator(".ant-pagination-item-active").textContent(), "1");
  } finally { await browser.close(); }
});

test("profile uses the hiring-manager term and confirmed opt-out removes only cabinet access", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const nickname = `hiring_manager_${unique()}`;
    await page.goto(`${web}/login`);
    await page.getByText("Регистрация", { exact: true }).click();
    const capability = page.getByRole("checkbox", { name: "Я нанимающий", exact: true });
    assert.equal(await capability.count(), 1, "Registration must expose the exact hiring-manager capability label");
    assert.equal(await capability.isChecked(), false);
    await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(nickname);
    await page.getByLabel(/^Имя(?:\s*\*)?$/).fill("Менеджер найма");
    await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill("test-password-123");
    await page.getByLabel(/^Повторите пароль(?:\s*\*)?$/).fill("test-password-123");
    await capability.check();
    await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    await page.waitForURL("**/workspace/personal/interviews");
    await page.getByRole("link", { name: "Кандидаты", exact: true }).waitFor();

    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const profile = await request("/me/profile", { token });
    const room = await createInterview({ token });


    await page.goto(`${web}/profile`);
    const profileToggle = page.getByRole("switch", { name: "Я участвую в найме", exact: true });
    await profileToggle.waitFor();
    assert.equal(await profileToggle.isChecked(), true);
    let releaseStaleSave;
    const staleSaveRelease = new Promise((resolve) => { releaseStaleSave = resolve; });
    let signalStaleSave;
    const staleSaveStarted = new Promise((resolve) => { signalStaleSave = resolve; });
    let signalStaleSaveFulfilled;
    const staleSaveFulfilled = new Promise((resolve) => { signalStaleSaveFulfilled = resolve; });
    let staleSaveRequests = 0;
    const delayedStaleSave = async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      staleSaveRequests += 1;
      signalStaleSave();
      await staleSaveRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...profile, isHr: false }),
      });
      signalStaleSaveFulfilled();
    };
    await page.route("**/api/me/profile", delayedStaleSave);
    await profileToggle.click();
    await staleSaveStarted;
    assert.equal(await page.getByRole("dialog").count(), 0, "Capability changes directly without an edit dialog");
    await page.getByRole("status").filter({ hasText: "Сохраняем…" }).waitFor();
    assert.equal(await profileToggle.isDisabled(), true);
    assert.equal(staleSaveRequests, 1);
    await page.evaluate(() => localStorage.setItem("auth_token", "stale-profile-session"));
    releaseStaleSave();
    await staleSaveFulfilled;
    await page.waitForTimeout(150);
    assert.equal(staleSaveRequests, 1, "A delayed save must not retry itself");
    assert.equal(await profileToggle.isChecked(), true,
      "A response for a replaced session must not apply a stale capability value");
    assert.equal(await page.getByRole("link", { name: "Кандидаты", exact: true }).count(), 1);
    await page.evaluate((currentToken) => localStorage.setItem("auth_token", currentToken), token);
    await page.unroute("**/api/me/profile", delayedStaleSave);
    const rejectedSave = (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Временная ошибка профиля" }),
    });
    await page.route("**/api/me/profile", rejectedSave);
    await profileToggle.click();
    await page.getByRole("alert").filter({ hasText: /Не удалось сохранить/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Повторить", exact: true }).count(), 1);
    assert.equal(await profileToggle.isChecked(), true, "a failed save must retain the last confirmed capability state");
    await page.unroute("**/api/me/profile", rejectedSave);

    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await page.getByRole("link", { name: "Кандидаты", exact: true }).waitFor({ state: "hidden" });
    await request("/me/hr/rooms", { token, status: 403 });
    await request(`/me/hr/rooms/${room.id}`, { token, status: 404 });
    await request("/me/hr/rooms/export", { token, status: 403 });
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token })).role, "owner");

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${web}/login`);
    await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(nickname);
    await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill("test-password-123");
    await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();
    await page.waitForURL("**/workspace/personal/interviews");
    assert.equal(await page.getByRole("link", { name: "Кандидаты", exact: true }).count(), 0);
    const disabledProfile = await request("/me/profile", { token });
    assert.equal(disabledProfile.isHr, false);
    assert.equal(disabledProfile.id, profile.id, "Opt-out must not rotate the invitation UUID");
    await page.getByRole("link", { name: `Открыть профиль @${nickname}` }).click();
    const reenabledToggle = page.getByRole("switch", { name: "Я участвую в найме", exact: true });
    await reenabledToggle.click();
    await page.getByRole("link", { name: "Кандидаты", exact: true }).waitFor();
    const reenabledProfile = await request("/me/profile", { token });
    assert.equal(reenabledProfile.isHr, true);
    assert.equal(reenabledProfile.id, profile.id, "Re-enabling must preserve the same invitation UUID");
    await page.getByText(`@${profile.nickname}`, { exact: true }).first().waitFor();
  } finally { await browser.close(); }
});

test("public guest creation has no hiring-manager field and never submits hiringManagerIds", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    let publicPreviewCalls = 0;
    const rejectPublicPreview = async (route) => {
      publicPreviewCalls += 1;
      await route.abort("failed");
    };
    await page.route("**/api/me/hiring-manager-preview", rejectPublicPreview);
    await page.goto(web, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Создать комнату", exact: true }).waitFor();
    await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
    const guestForm = page.getByRole("dialog", { name: "Создать комнату" }).locator("form");
    assert.equal(await guestForm.count(), 1);
    assert.equal(await guestForm.getByRole("combobox", { name: "Нанимающий", exact: true }).count(), 0,
      "The open public guest form must not expose an authenticated hiring-manager control");
    await guestForm.getByLabel("Ваше имя", { exact: true }).fill(`Гость ${unique()}`);
    await guestForm.getByLabel(/^Название комнаты(?:\s*\*)?$/i).fill(`Гостевая комната ${unique()}`);
    const submitted = page.waitForRequest((request) =>
      request.url().endsWith("/api/public/rooms") && request.method() === "POST",
    );
    await guestForm.getByRole("button", { name: "Создать комнату", exact: true }).click();
    const payload = JSON.parse((await submitted).postData() ?? "{}");
    assert.equal(Object.hasOwn(payload, "hiringManagerIds"), false,
      "The public guest request must omit the authenticated-only field entirely");
    await page.waitForURL(/\/room\//);
    await page.getByTestId("room-code-editor-host").waitFor();
    assert.equal(publicPreviewCalls, 0, "Public creation must never invoke the authenticated preview endpoint");
  } finally { await browser.close(); }
});

test("authenticated creator adds verified hiring people one at a time and submits only remaining selections", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель подборщика");
    const firstManager = await account(true, "Первый нанимающий");
    const secondManager = await account(true, "Второй нанимающий");
    const { page, context, team } = await openTeamCreation(browser, owner);
    try {
      const title = `Комната с подборщиком ${unique()}`;
      await page.getByLabel("Название интервью", { exact: true }).fill(title);
      const input = page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      await input.waitFor();
      assert.equal(await input.getAttribute("aria-label"), "Внешний нанимающий (необязательно)");
      assert.equal(await page.getByRole("combobox", { name: "Нанимающие из команды", exact: true }).count(), 0);
      let previewRequests = 0;
      let releaseFirstPreview;
      const firstPreviewRelease = new Promise((resolve) => { releaseFirstPreview = resolve; });
      let signalFirstPreview;
      const firstPreviewStarted = new Promise((resolve) => { signalFirstPreview = resolve; });
      let releaseSecondPreview;
      const secondPreviewRelease = new Promise((resolve) => { releaseSecondPreview = resolve; });
      let signalSecondPreview;
      const secondPreviewStarted = new Promise((resolve) => { signalSecondPreview = resolve; });
      await page.route("**/api/me/hiring-manager-preview", async (route) => {
        previewRequests += 1;
        const { nickname } = JSON.parse(route.request().postData() ?? "{}");
        if (nickname === firstManager.user.nickname) {
          signalFirstPreview();
          await firstPreviewRelease;
        }
        if (nickname === secondManager.user.nickname) {
          signalSecondPreview();
          await secondPreviewRelease;
        }
        const manager = nickname === firstManager.user.nickname ? firstManager : secondManager;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ normalizedId: manager.user.id, displayName: manager.user.displayName }),
        });
      });

      await input.fill(firstManager.user.nickname);
      await firstPreviewStarted;
      await page.getByText("Проверяем нанимающего…", { exact: true }).waitFor();
      assert.equal(await input.isDisabled(), false, "Search remains editable while verification is pending");
      assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true }).isDisabled(), true);
      releaseFirstPreview();
      await chooseHiring(page, input, firstManager.user.displayName);
      await page.getByRole("button", { name: `Удалить нанимающего ${firstManager.user.displayName}`, exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: `Удалить нанимающего ${firstManager.user.displayName}`, exact: true }).count(), 1);
      await page.getByText(firstManager.user.displayName, { exact: true }).waitFor();
      assert.equal(await input.inputValue(), "");

      await input.fill(secondManager.user.nickname);
      await input.press("Enter");
      await secondPreviewStarted;
      await page.getByText("Проверяем нанимающего…", { exact: true }).waitFor();
      assert.equal(await input.isDisabled(), false, "A pending search can be corrected without selecting an unverified person");
      releaseSecondPreview();
      await chooseHiring(page, input, secondManager.user.displayName);
      await page.getByRole("button", { name: `Удалить нанимающего ${secondManager.user.displayName}`, exact: true }).waitFor();
      assert.equal(previewRequests, 2, "Each search verifies once; selection must not submit the room");
      assert.equal(await page.getByText(secondManager.user.displayName, { exact: true }).count(), 1);

      await input.fill(secondManager.user.nickname);
      await page.getByRole("alert").filter({ hasText: "Нанимающий уже добавлен" }).waitFor();
      assert.equal(await input.inputValue(), secondManager.user.nickname);
      assert.equal(previewRequests, 3, "Nickname duplicate is rejected after resolving the same person");

      const typedButUnaddedId = "typed.unadded";
      await input.fill(typedButUnaddedId);
      await input.press("Escape");
      assert.equal(await input.inputValue(), typedButUnaddedId, "Escape must preserve the unadded nickname search");
      await input.press("ControlOrMeta+A");
      await input.press("Backspace");
      assert.equal(await input.inputValue(), "", "A real keyboard deletion must still clear the nickname search");
      await input.fill(typedButUnaddedId);
      await page.getByRole("button", { name: `Удалить нанимающего ${firstManager.user.displayName}`, exact: true }).click();
      assert.equal(await page.getByText(firstManager.user.displayName, { exact: true }).count(), 0);
      assert.equal(await input.inputValue(), typedButUnaddedId, "Removal must not overwrite an unadded draft nickname");

      const submitted = page.waitForRequest((request) =>
        new URL(request.url()).pathname === `/api/teams/${team.id}/interviews` && request.method() === "POST",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true }).click();
      assert.deepEqual(JSON.parse((await submitted).postData() ?? "{}"), {
        title,
        selectedTaskIds: [],
        hiringManagerIds: [secondManager.user.id],
      });
      await page.waitForURL(/\/room\//);
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("room creation waits for pending verification and excludes a failed hiring-manager lookup", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель с pending подборщика");
    const selectedManager = await account(true, "Добавленный нанимающий");
    const pendingManager = await account(true, "Проверяемый нанимающий");
    const { page, context, team } = await openTeamCreation(browser, owner);
    try {
      const title = `Комната с pending подборщиком ${unique()}`;
      const input = page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      await page.getByLabel("Название интервью", { exact: true }).fill(title);

      let releasePendingPreview;
      const pendingPreviewRelease = new Promise((resolve) => { releasePendingPreview = resolve; });
      let signalPendingPreview;
      const pendingPreviewStarted = new Promise((resolve) => { signalPendingPreview = resolve; });
      await page.route("**/api/me/hiring-manager-preview", async (route) => {
        const { nickname } = JSON.parse(route.request().postData() ?? "{}");
        if (nickname !== pendingManager.user.nickname) {
          await route.continue();
          return;
        }
        signalPendingPreview();
        await pendingPreviewRelease;
        try {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Preview verification is unavailable" }),
          });
        } catch {
          // Successful room creation may abort the obsolete preview request.
        }
      });

      await input.fill(selectedManager.user.nickname);
      await chooseHiring(page, input, selectedManager.user.displayName);
      await page.getByRole("button", { name: `Удалить нанимающего ${selectedManager.user.displayName}`, exact: true }).waitFor();

      await input.fill(pendingManager.user.nickname);
      await pendingPreviewStarted;
      await page.getByText("Проверяем нанимающего…", { exact: true }).waitFor();

      const create = page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true });
      assert.equal(await create.isDisabled(), true, "Creation cannot send an unverified pending selection");
      releasePendingPreview();
      await page.getByRole("alert").filter({ hasText: "Ошибка сервера" }).waitFor();
      assert.equal(await input.inputValue(), pendingManager.user.nickname, "Failed verification retains the retryable nickname draft");
      assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), title, "The unsuccessful lookup does not reset the room draft");
      const submitted = page.waitForRequest((request) =>
        new URL(request.url()).pathname === `/api/teams/${team.id}/interviews` && request.method() === "POST",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true }).click();
      assert.deepEqual(JSON.parse((await submitted).postData() ?? "{}"), {
        title,
        selectedTaskIds: [],
        hiringManagerIds: [selectedManager.user.id],
      });
      await page.waitForURL(/\/room\//);
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("hiring picker retains local validation and unavailable feedback without revealing a person", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель ошибок подборщика");
    const { page, context, team } = await openTeamCreation(browser, owner);
    try {
      const input = page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      let previewRequests = 0;
      await page.route("**/api/me/hiring-manager-preview", async (route) => {
        previewRequests += 1;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Нанимающий не найден или недоступен" }),
        });
      });

      await input.focus();
      assert.equal(await page.getByRole("option").count(), 0, "An empty search exposes no selectable person");
      assert.equal(previewRequests, 0);
      await input.fill("invalid nickname");
      await input.press("Enter");
      await page.getByRole("alert").filter({ hasText: "Введите ник от 3 до 32 символов без пробелов" }).waitFor();
      assert.equal(await input.inputValue(), "invalid nickname");
      assert.equal(previewRequests, 0);

      const unavailable = "missing.hiring";
      await input.fill(unavailable);
      await page.getByRole("alert").filter({ hasText: "Нанимающий не найден или недоступен" }).waitFor();
      assert.equal(await input.inputValue(), unavailable);
      assert.equal(await page.getByRole("heading", { name: "Добавленные нанимающие", exact: true }).count(), 0);
      assert.equal(previewRequests, 1);
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("hiring picker retains a retryable nickname and accepts the corrected retry", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель повтора подборщика");
    const manager = await account(true, "Нанимающий после повтора");
    const { page, context, team } = await openTeamCreation(browser, owner);
    try {
      const input = page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      let requests = 0;
      await page.route("**/api/me/hiring-manager-preview", async (route) => {
        requests += 1;
        if (requests === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Временная ошибка проверки" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ normalizedId: manager.user.id, displayName: manager.user.displayName }),
        });
      });

      await input.fill(manager.user.nickname);
      await page.getByRole("alert").filter({ hasText: "Ошибка сервера" }).waitFor();
      assert.equal(await input.inputValue(), manager.user.nickname);
      await input.press("Enter");
      await chooseHiring(page, input, manager.user.displayName);
      await page.getByRole("button", { name: `Удалить нанимающего ${manager.user.displayName}`, exact: true }).waitFor();
      assert.equal(requests, 2);
      assert.equal(await input.inputValue(), "");
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("an obsolete picker preview cannot restore a selection after an account switch", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const firstOwner = await account(false, "Первый создатель подборщика");
    const successor = await account(false, "Второй создатель подборщика");
    const manager = await account(true, "Устаревший нанимающий");
    const { page, context, team } = await openTeamCreation(browser, firstOwner, { preserveAuthOnReload: true });
    const successorTeam = await createTeam(successor);
    try {
      let releasePreview;
      const previewRelease = new Promise((resolve) => { releasePreview = resolve; });
      let signalPreview;
      const previewStarted = new Promise((resolve) => { signalPreview = resolve; });
      await page.route("**/api/me/hiring-manager-preview", async (route) => {
        signalPreview();
        await previewRelease;
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ normalizedId: manager.user.id, displayName: manager.user.displayName }),
          });
        } catch {
          // A page replacement may abort the route before it can be fulfilled.
        }
      });
      await page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).fill(manager.user.nickname);
      await previewStarted;
      await page.evaluate(({ token, displayName }) => {
        localStorage.setItem("auth_token", token);
        localStorage.setItem("display_name", displayName);
      }, { token: successor.token, displayName: successor.user.displayName });
      await page.goto(`${web}/workspace/teams/${successorTeam.id}/interviews/new`, { waitUntil: "domcontentloaded" });
      await page.getByText(`@${successor.user.nickname}`, { exact: true }).waitFor();
      releasePreview();
      await page.getByRole("dialog", { name: "Создать интервью", exact: true }).waitFor();
      await page.waitForTimeout(150);
      assert.equal(await page.getByText(manager.user.displayName, { exact: true }).count(), 0);
      assert.equal(await page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).inputValue(), "");
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("stale room validation retains selections and disables picker controls while creation is pending", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель устаревшей проверки");
    const manager = await account(true, "Нанимающий для проверки комнаты");
    const { page, context, team } = await openTeamCreation(browser, owner);
    try {
      const title = `Комната с устаревшим нанимающим ${unique()}`;
      await page.getByLabel("Название интервью", { exact: true }).fill(title);
      const input = page.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
      await input.fill(manager.user.nickname);
      await chooseHiring(page, input, manager.user.displayName);
      await page.getByRole("button", { name: `Удалить нанимающего ${manager.user.displayName}`, exact: true }).waitFor();

      let releaseCreate;
      const createRelease = new Promise((resolve) => { releaseCreate = resolve; });
      let signalCreate;
      const createStarted = new Promise((resolve) => { signalCreate = resolve; });
      await page.route(`**/api/teams/${team.id}/interviews`, async (route) => {
        signalCreate();
        await createRelease;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Указанный нанимающий не найден или недоступен" }),
        });
      });
      await page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true }).click();
      await createStarted;
      assert.equal(await input.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: `Удалить нанимающего ${manager.user.displayName}`, exact: true }).isDisabled(), true);
      releaseCreate();
      await page.getByRole("alert").filter({ hasText: "Указанный нанимающий не найден или недоступен" }).waitFor();
      assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), title);
      await page.getByText(manager.user.displayName, { exact: true }).waitFor();
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("personal authenticated creation offers optional generic hiring and keeps an empty selection as a normal room create", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Создатель без назначения");
    const { page, context } = await openAccount(browser, owner, "/dashboard/rooms");
    try {
      const title = `Комната без менеджера ${unique()}`;
      await page.getByLabel("Название интервью", { exact: true }).fill(title);
      const targets = page.getByRole("combobox", { name: "Нанимающий", exact: true });
      await targets.waitFor();
      assert.equal(await page.getByRole("dialog").getByText(/внешн|Без трека|Без вакансии/i).count(), 0, "Personal creation uses generic hiring without TEAM context");
      const submitted = page.waitForRequest((request) =>
        request.url().endsWith("/api/rooms") && request.method() === "POST",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Создать интервью", exact: true }).click();
      const payload = JSON.parse((await submitted).postData() ?? "{}");
      assert.equal(payload.title, title);
      assert.deepEqual(payload.taskIds, []);
      assert.equal((payload.hiringManagerIds ?? []).length, 0);
      assert.ok(!Object.hasOwn(payload, "trackId") && !Object.hasOwn(payload, "vacancyId"));
      await page.waitForURL(/\/room\//);
      await page.getByTestId("room-code-editor-host").waitFor();
    } finally {
      await context.close();
    }
  } finally { await browser.close(); }
});

test("hiring-manager registration is only an optional checkbox; identity persists and existing users opt in", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
    page.setDefaultTimeout(10000);
    await page.goto(`${web}/login`);
    await page.getByText("Регистрация", { exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: "Я нанимающий", exact: true });
    assert.equal(await checkbox.count(), 1, "Registration must offer the optional hiring-manager checkbox");
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await page.getByRole("radio", { name: /Кандидат|Интервьюер/ }).count(), 0);
    await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(`hr_ui_${unique()}`);
    await page.getByLabel(/^Имя(?:\s*\*)?$/).fill("Анна, нанимающий менеджер");
    await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill("test-password-123");
    await page.getByLabel(/^Повторите пароль(?:\s*\*)?$/).fill("test-password-123");
    await checkbox.check();
    await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    await page.waitForURL("**/workspace/personal/interviews");
    await page.getByRole("link", { name: "Кандидаты", exact: true }).click();
    await page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const profile = await request("/me/profile", { token });
    assert.equal(profile.isHr, true);
    assert.equal(profile.role, "user");
    await page.getByRole("link", { name: /^Открыть профиль @/ }).click();
    await page.getByRole("button", { name: "Скопировать никнейм", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), profile.nickname);
    await page.reload();
    await page.getByText(`@${profile.nickname}`, { exact: true }).first().waitFor();

    const ordinary = await account(false, "Пользователь без роли менеджера");
    assert.equal(ordinary.user.isHr, false);
    const existing = await openAccount(browser, ordinary, "/profile");
    assert.equal(await existing.page.getByRole("link", { name: "Кандидаты", exact: true }).count(), 0);
    await existing.page.getByRole("switch", { name: "Я участвую в найме", exact: true }).click();
    await existing.page.getByRole("link", { name: "Кандидаты", exact: true }).waitFor();
    await existing.page.reload();
    await existing.page.getByRole("link", { name: "Кандидаты", exact: true }).waitFor();
    const updated = await request("/me/profile", { token: ordinary.token });
    assert.equal(updated.isHr, true);
    assert.equal(updated.id, ordinary.user.id);
    assert.equal(updated.role, "user");
  } finally { await browser.close(); }
});

test("interviewer invites an offline hiring manager; metadata, refresh, results, export, and archived history work end to end", { timeout: 180000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account();
    const interviewer = await account(false, "Технический интервьюер");
    const hr = await account(true, "Мария, нанимающий менеджер");
    const otherHr = await account(true, "Другой нанимающий менеджер");
    const room = await createTeamInterview(owner);
    await setTeamManagerRole(owner, room, interviewer, "interviewer");
    const hrView = await openAccount(browser, hr);
    await hrView.page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
    await hrView.page.getByText("Пока нет интервью", { exact: true }).waitFor();

    const managerView = await openAccount(browser, interviewer, `/room/${room.inviteCode}`);
    await managerView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const panel = managerView.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await panel.getByLabel("Имя кандидата", { exact: true }).fill("Антон Кандидатов");
    await panel.getByLabel("Позиция", { exact: true }).fill("Frontend developer");
    await panel.getByLabel("Дата и время интервью (МСК)", { exact: true }).fill("2030-10-12T14:30");
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await managerView.page.locator(".ant-notification-notice").filter({ hasText: "Сведения сохранены" }).waitFor();
    await managerView.page.locator(".ant-notification-notice").filter({ hasText: "Сведения сохранены" }).locator(".ant-notification-notice-close").click();
    await managerView.page.locator(".ant-notification-notice").filter({ hasText: "Сведения сохранены" }).waitFor({ state: "hidden" });

    // A real concurrent manager write must preserve the local draft on HTTP 409.
    const currentMetadata = await request(`/rooms/${room.inviteCode}/interview-metadata`, { token: owner.token });
    await request(`/rooms/${room.inviteCode}/interview-metadata`, {
      token: owner.token, method: "PUT", body: { ...currentMetadata, position: "Platform developer" },
    });
    await panel.getByLabel("Позиция", { exact: true }).fill("Local draft");
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await panel.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    assert.equal(await panel.getByLabel("Позиция", { exact: true }).inputValue(), "Local draft");
    await panel.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await managerView.page.waitForFunction(() => document.querySelector('input[value="Platform developer"]'));
    assert.equal(await panel.getByLabel("Позиция", { exact: true }).inputValue(), "Platform developer");
    await panel.getByLabel("Позиция", { exact: true }).fill("Frontend developer");
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await managerView.page.locator(".ant-notification-notice").filter({ hasText: "Сведения сохранены" }).waitFor();
    await panel.getByRole("combobox", { name: "Нанимающий", exact: true }).fill(owner.user.nickname);
    await panel.getByRole("alert").filter({ hasText: /Нанимающий не найден или недоступен/ }).waitFor();
    await panel.getByRole("combobox", { name: "Нанимающий", exact: true }).fill(hr.user.nickname);
    await chooseHiring(managerView.page, panel.getByRole("combobox", { name: "Нанимающий", exact: true }), hr.user.displayName);
    await panel.getByText(hr.user.displayName, { exact: true }).waitFor();
    await panel.getByRole("combobox", { name: "Нанимающий", exact: true }).fill(hr.user.nickname);
    await panel.getByRole("alert").filter({ hasText: "Нанимающий уже добавлен" }).waitFor();

    await hrView.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    const row = hrView.page.getByRole("row").filter({ hasText: "Антон Кандидатов" });
    await row.waitFor();
    assert.equal(await row.count(), 1);
    assert.match(await row.innerText(), /Frontend developer/);
    assert.match(await row.innerText(), /Предстоящее/i);
    const list = await request("/me/hr/rooms", { token: hr.token });
    assert.equal(list.totalElements, 1);
    assert.equal(list.items[0].scheduledAt, "2030-10-12T11:30:00Z");
    assert.equal((await request("/me/hr/rooms", { token: otherHr.token })).totalElements, 0);
    await request(`/me/hr/rooms/${room.id}`, { token: otherHr.token, status: 404 });
    const unauthorized = await account(false, "Посторонний без команды и роли нанимающего");
    await request("/me/hr/rooms/export", { token: unauthorized.token, status: 403 });
    const colleagueExport = await fetch(`${api}/me/hr/rooms/export`, { headers: { Authorization: `Bearer ${interviewer.token}` } });
    assert.equal(colleagueExport.status, 200, "ACTIVE team colleague can export the currently authorized interview without the hiring flag");
    assert.equal(Buffer.from(await colleagueExport.arrayBuffer()).subarray(0, 2).toString(), "PK");

    await request(`/rooms/${room.inviteCode}/verdict`, { token: interviewer.token, method: "POST", body: { verdict: "HIRE", verdictComment: "Уверенное решение\nПригласить на следующий этап" } });
    await hrView.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await row.getByText("Завершено", { exact: true }).waitFor();
    await row.getByRole("button", { name: "Результаты", exact: true }).click();
    const results = hrView.page.getByRole("dialog", { name: "Результаты интервью", exact: true });
    await results.getByText(/Уверенное решение/).waitFor();
    await results.getByText("Задача на массивы", { exact: false }).waitFor();
    await results.getByRole("button", { name: "Закрыть", exact: true }).filter({ hasText: /^Закрыть$/ }).click();
    await downloadWorkbook(hrView.page);

    let accidentalDownload = false;
    const recordUnexpectedDownload = () => { accidentalDownload = true; };
    hrView.page.on("download", recordUnexpectedDownload);
    const failExport = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временная ошибка экспорта" }) });
    await hrView.page.route("**/api/me/hr/rooms/export*", failExport);
    await hrView.page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await hrView.page.getByRole("button", { name: "Повторить скачивание", exact: true }).waitFor();
    assert.equal(accidentalDownload, false, "An export error response must never be downloaded as XLSX");
    hrView.page.off("download", recordUnexpectedDownload);
    await hrView.page.unroute("**/api/me/hr/rooms/export*", failExport);
    const recoveredDownload = hrView.page.waitForEvent("download");
    await hrView.page.getByRole("button", { name: "Повторить скачивание", exact: true }).click();
    assert.equal(await (await recoveredDownload).failure(), null);
    await hrView.page.getByLabel("С", { exact: true }).fill("2030-10-12");
    await hrView.page.getByLabel("По", { exact: true }).fill("2030-10-12");
    await hrView.page.getByRole("button", { name: "Применить период", exact: true }).click();
    await row.waitFor();
    await downloadWorkbook(hrView.page);
    await hrView.page.getByLabel("С", { exact: true }).fill("2030-10-13");
    await hrView.page.getByLabel("По", { exact: true }).fill("2030-10-13");
    await hrView.page.getByRole("button", { name: "Применить период", exact: true }).click();
    await hrView.page.getByText("За выбранный период интервью нет", { exact: true }).waitFor();
    await downloadWorkbook(hrView.page);
    await hrView.page.getByRole("button", { name: "За всё время", exact: true }).click();
    await row.waitFor();

    const finishedArchive = await request(`/teams/${room.teamId}/interviews/${room.id}/archive`, { token: owner.token, method: "POST", status: 409 });
    assert.equal(finishedArchive.code, "TEAM_INTERVIEW_FINISHED", "A finished result stays outside the orphan archive lifecycle");
    const archiveRoom = await createTeamInterview(interviewer, `Архивное интервью ${unique()}`, room.teamId);
    await request(`/rooms/${archiveRoom.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    await request(`/rooms/${archiveRoom.inviteCode}/interview-metadata`, {
      token: interviewer.token, method: "PUT", body: { candidateName: "Архивный Антон Кандидатов", position: "Frontend developer", scheduledAt: "2030-10-12T11:30:00Z", revision: 0 },
    });
    const hrRoom = await openAccount(browser, hr, `/room/${archiveRoom.inviteCode}`);
    await hrRoom.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    await hrRoom.page.reload();
    await hrRoom.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 2);
    await request(`/teams/${archiveRoom.teamId}/leave`, { token: interviewer.token, method: "POST" });
    await request(`/teams/${archiveRoom.teamId}/interviews/${archiveRoom.id}/archive`, { token: owner.token, method: "POST" });
    await hrRoom.page.getByTestId("room-realtime-unavailable").waitFor({ timeout: 20000 });
    const terminalRequests = [];
    const recordTerminalRequest = (req) => {
      if (req.url().includes(`/api/realtime/rooms/${archiveRoom.inviteCode}/`)) terminalRequests.push(req.url());
    };
    hrRoom.page.on("request", recordTerminalRequest);
    await hrRoom.page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await hrView.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    const archivedRow = hrView.page.getByRole("row").filter({ hasText: "Архивный Антон Кандидатов" });
    await archivedRow.getByText("Архив", { exact: true }).waitFor();
    assert.equal(await archivedRow.getByRole("button", { name: "Открыть комнату", exact: true }).count(), 0);
    await archivedRow.getByRole("button", { name: "Результаты", exact: true }).click();
    await results.getByText("Задача на массивы", { exact: false }).waitFor();
    assert.equal(await results.getByRole("textbox").count(), 0, "Archived review is read-only");
    await results.getByRole("button", { name: "Закрыть", exact: true }).filter({ hasText: /^Закрыть$/ }).click();
    await downloadWorkbook(hrView.page);
    // Observe beyond the existing 180ms reconnect interval after focus recovery.
    await hrRoom.page.waitForTimeout(1000);
    assert.equal(terminalRequests.length, 0, "Archived terminal state must stop stream, presence and state retries");
    hrRoom.page.off("request", recordTerminalRequest);
    await hrRoom.page.reload();
    await hrRoom.page.getByTestId("room-realtime-unavailable").waitFor();
    assert.equal(await hrRoom.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
  } finally { await browser.close(); }
});

test("TEAM candidate admission cannot track; explicit hiring assignment enables current cabinet rights and refresh recovery", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account();
    const hr = await account(true, "Нанимающий менеджер на собеседовании");
    const room = await createTeamInterview(owner);
    const candidateView = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await candidateView.page.getByTestId("room-code-editor-host").waitFor();
    const candidate = await request(`/rooms/${room.inviteCode}`, { token: hr.token });
    assert.equal(candidate.role, "candidate");
    assert.equal(await candidateView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
    await request(`/rooms/${room.inviteCode}/hr-tracking`, { token: hr.token, method: "POST", status: 404 });
    await setTeamManagerRole(owner, room, hr, "interviewer");
    await candidateView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    const cabinet = await openAccount(browser, hr);
    await cabinet.page.getByRole("row").filter({ hasText: room.title }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
    const failList = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временная ошибка проверки" }) });
    await cabinet.page.route("**/api/me/hr/rooms?**", failList);
    await cabinet.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await cabinet.page.getByRole("alert").filter({ hasText: /Не удалось загрузить интервью/ }).waitFor();
    await cabinet.page.unroute("**/api/me/hr/rooms?**", failList);
    await cabinet.page.getByRole("button", { name: "Повторить", exact: true }).click();
    await cabinet.page.getByRole("row").filter({ hasText: room.title }).waitFor();
    await setTeamManagerRole(owner, room, hr, "candidate");
    await cabinet.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await cabinet.page.getByText("Пока нет интервью", { exact: true }).waitFor();
    await request(`/me/hr/rooms/${room.id}`, { token: hr.token, status: 404 });
    await candidateView.page.reload();
    await candidateView.page.getByTestId("room-code-editor-host").waitFor();
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
  } finally { await browser.close(); }
});

test("owner and active team colleague can assign two external hiring managers through the room controls", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Владелец интервью");
    const firstHr = await account(true, "Первый нанимающий менеджер");
    const secondHr = await account(true, "Второй нанимающий менеджер");
    const room = await createTeamInterview(owner);
    const ownerView = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    const colleague = await account(false, "Коллега интервьюер");
    const { page: guest } = await openAccount(browser, colleague, `/room/${room.inviteCode}`);
    const guestDiscoveryRequests = [];
    guest.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/me/hiring-manager-preview" || path === "/api/me/hiring-manager-options") guestDiscoveryRequests.push(path);
    });

    await guest.getByTestId("room-code-editor-host").waitFor();
    assert.equal(await guest.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
    await joinTeam(owner, room, colleague);
    await guest.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const guestPanel = guest.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await guestPanel.getByRole("combobox", { name: "Нанимающий", exact: true }).fill(firstHr.user.nickname);
    await chooseHiring(guest, guestPanel.getByRole("combobox", { name: "Нанимающий", exact: true }), firstHr.user.displayName);
    await guestPanel.getByText(firstHr.user.displayName, { exact: true }).waitFor();
    assert.deepEqual(guestDiscoveryRequests, [], "Team colleague assignment uses the current room scope without a global hiring directory");

    await ownerView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const ownerPanel = ownerView.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await ownerPanel.getByRole("combobox", { name: "Нанимающий", exact: true }).fill(secondHr.user.nickname);
    await chooseHiring(ownerView.page, ownerPanel.getByRole("combobox", { name: "Нанимающий", exact: true }), secondHr.user.displayName);
    await ownerPanel.getByText(secondHr.user.displayName, { exact: true }).waitFor();
    await ownerPanel.getByText(firstHr.user.displayName, { exact: true }).waitFor();
    for (const hr of [firstHr, secondHr]) {
      const cabinet = await openAccount(browser, hr);
      await cabinet.page.getByRole("row").filter({ hasText: room.title }).waitFor();
      assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
      assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "interviewer");
      await request(`/me/rooms/${room.id}`, { token: hr.token, method: "DELETE", status: 404 });
    }
  } finally { await browser.close(); }
});

test("switching hiring-manager accounts in one browser clears the previous cabinet and results", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const firstHr = await account(true, "Нанимающий менеджер с интервью");
    const secondHr = await account(true, "Нанимающий менеджер без интервью");
    const room = await createInterview(firstHr);

    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const login = async (hr) => {
      await page.goto(`${web}/login`);
      await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(hr.user.nickname);
      await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill("test-password-123");
      await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();
      await page.waitForURL("**/workspace/personal/interviews");
      await page.getByRole("link", { name: "Кандидаты", exact: true }).click();
      await page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
    };
    await login(firstHr);
    await page.getByRole("row").filter({ hasText: room.title }).waitFor();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(`${web}/`);
    await login(secondHr);
    await page.getByText("Пока нет интервью", { exact: true }).waitFor();
    assert.equal(await page.getByRole("row").filter({ hasText: room.title }).count(), 0);
    assert.equal(await page.getByText(`@${firstHr.user.nickname}`, { exact: true }).count(), 0);
    await page.getByText(`@${secondHr.user.nickname}`, { exact: true }).first().waitFor();
    assert.equal(await page.getByText(secondHr.user.id, { exact: true }).count(), 0, "The successor identity is shown without a technical identifier");
  } finally { await browser.close(); }
});

test("cabinet loading and pending actions stay visible without false empty or duplicate export controls", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const releases = [];
  try {
    const hr = await account(true, "Нанимающий менеджер с медленным соединением");
    const room = await createInterview(hr);

    const context = await browser.newContext();
    await context.addInitScript((token) => localStorage.setItem("auth_token", token), hr.token);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    async function pauseNext(pattern) {
      let release;
      let markStarted;
      const gate = new Promise((resolve) => { release = resolve; });
      const started = new Promise((resolve) => { markStarted = resolve; });
      const handler = async (route) => {
        markStarted();
        await gate;
        await route.continue().catch(() => {});
      };
      releases.push(release);
      await page.route(pattern, handler);
      return { started, release, remove: () => page.unroute(pattern, handler) };
    }
    const initial = await pauseNext("**/api/me/hr/rooms?**");
    await page.goto(`${web}/dashboard/hr`, { waitUntil: "domcontentloaded" });
    await initial.started;
    await page.locator('[aria-label="Список интервью"][aria-busy="true"]').waitFor();
    assert.equal(await page.getByText("Пока нет интервью", { exact: true }).count(), 0,
      "Initial loading must not present a false empty result");
    assert.equal(await page.getByRole("row").filter({ hasText: room.title }).count(), 0);
    initial.release();
    await page.getByRole("row").filter({ hasText: room.title }).waitFor();
    await page.locator('[aria-label="Список интервью"][aria-busy="false"]').waitFor();
    await initial.remove();

    const refresh = await pauseNext("**/api/me/hr/rooms?**");
    await page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await refresh.started;
    const refreshing = page.getByRole("button", { name: "Обновляем…", exact: true });
    await refreshing.waitFor();
    assert.equal(await refreshing.isDisabled(), true);
    assert.equal(await page.getByRole("row").filter({ hasText: room.title }).isVisible(), true,
      "Refresh must retain the last loaded records");
    refresh.release();
    await page.getByRole("button", { name: "Обновить список", exact: true }).waitFor();
    await refresh.remove();

    const exporting = await pauseNext("**/api/me/hr/rooms/export**");
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await exporting.started;
    const pendingExport = page.getByRole("button", { name: "Готовим Excel…", exact: true });
    await pendingExport.waitFor();
    assert.equal(await pendingExport.isDisabled(), true, "A second export action must be disabled while pending");
    exporting.release();
    const download = await downloaded;
    assert.equal(await download.failure(), null);
    assert.match(download.suggestedFilename(), /^hr-interviews-.*\.xlsx$/);
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).waitFor();
  } finally {
    releases.forEach((release) => release());
    await browser.close();
  }
});

test("leaving the account cancels a pending hiring-manager export before a previous-account file can download", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const hr = await account(true, "Нанимающий менеджер с отложенным экспортом");
    const room = await createInterview(hr);

    const exportResponse = await fetch(`${api}/me/hr/rooms/export`, { headers: { Authorization: `Bearer ${hr.token}` } });
    assert.equal(exportResponse.status, 200);
    const workbook = Buffer.from(await exportResponse.arrayBuffer());
    const { page } = await openAccount(browser, hr);
    await page.getByRole("row").filter({ hasText: room.title }).waitFor();
    let release;
    let markIntercepted;
    const delayed = new Promise((resolve) => { release = resolve; });
    const intercepted = new Promise((resolve) => { markIntercepted = resolve; });
    await page.route("**/api/me/hr/rooms/export*", async (route) => {
      markIntercepted();
      await delayed;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="hr-interviews-delayed.xlsx"',
          "Interview-Count": "1",
        },
        body: workbook,
      }).catch(() => {}); // An aborted export may already have cancelled its route.
    });
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await intercepted;
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL(`${web}/`);
    assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
    const lateDownload = page.waitForEvent("download", { timeout: 1500 }).then(() => true, () => false);
    release();
    assert.equal(await lateDownload, false, "Old-account workbook must not download after logout");
  } finally { await browser.close(); }
});

test("a persisted relay 410 makes the room terminal even while its SSE connection is still open", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const hr = await account(true, "Нанимающий менеджер в архивируемой комнате");
    const room = await createInterview(hr);
    const context = await browser.newContext();
    await context.addInitScript((token) => localStorage.setItem("auth_token", token), hr.token);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    let rejected = 0;
    await page.route(`**/api/realtime/rooms/${room.inviteCode}/events`, async (route) => {
      rejected += 1;
      await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Комната архивирована" }) });
    });
    await page.goto(`${web}/room/${room.inviteCode}`);
    await page.getByTestId("room-realtime-unavailable").waitFor();
    const atTerminal = rejected;
    assert.ok(atTerminal > 0);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(800);
    assert.equal(rejected, atTerminal, "Relay 410 must stop queued and recovery traffic immediately");
    assert.equal(await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
  } finally { await browser.close(); }
});

test("a fresh anonymous visit to an archived room is terminal before entering a guest name", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const hr = await account(true);
    const creator = await account(false, "Ушедший создатель архивной комнаты");
    const team = await createTeam(hr);
    await joinTeam(hr, { teamId: team.id }, creator);
    const room = await createTeamInterview(creator, `Архивная комната ${unique()}`, team.id);
    await request(`/teams/${room.teamId}/leave`, { token: creator.token, method: "POST" });
    await request(`/teams/${room.teamId}/interviews/${room.id}/archive`, { token: hr.token, method: "POST" });
    await request(`/rooms/${room.inviteCode}`, { status: 404 });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${web}/room/${room.inviteCode}`);
    await page.getByTestId("room-realtime-unavailable").waitFor();
    assert.equal(await page.getByLabel("Ваше имя", { exact: true }).count(), 0);
    assert.equal(await page.getByTestId("room-code-editor-host").count(), 0);
  } finally { await browser.close(); }
});

test("permission loss invalidates pending private-panel data before a manager can open it again", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account();
    const hr = await account(true, "Нанимающий менеджер с изменяемым доступом");
    const room = await createTeamInterview(owner);
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    const oldMetadata = await request(`/rooms/${room.inviteCode}/interview-metadata`, {
      token: owner.token, method: "PUT", body: { candidateName: "Старое имя из задержанного запроса", position: null, scheduledAt: null, revision: 0 },
    });
    const { page } = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    let release;
    let markIntercepted;
    const gate = new Promise((resolve) => { release = resolve; });
    const intercepted = new Promise((resolve) => { markIntercepted = resolve; });
    let metadataRequests = 0;
    await page.route(`**/api/rooms/${room.inviteCode}/interview-metadata`, async (route) => {
      metadataRequests += 1;
      if (metadataRequests !== 1) return route.continue();
      markIntercepted();
      await gate;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oldMetadata) }).catch(() => {});
    });
    const trigger = page.getByRole("button", { name: "Кандидат и нанимающие", exact: true });
    const panel = page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await trigger.click();
    await intercepted;
    await setTeamManagerRole(owner, room, hr, "candidate");
    await panel.waitFor({ state: "hidden" });
    await trigger.waitFor({ state: "hidden" });
    await request(`/rooms/${room.inviteCode}/interview-metadata`, {
      token: owner.token, method: "PUT", body: { ...oldMetadata, candidateName: "Актуальное имя после изменения доступа" },
    });
    await setTeamManagerRole(owner, room, hr, "interviewer");
    await trigger.click();
    release();
    await panel.getByLabel("Имя кандидата", { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("Имя кандидата", { exact: true }).inputValue(), "Актуальное имя после изменения доступа");
  } finally { await browser.close(); }
});

test("participant hiring-manager assignment works without ID entry, reports failure, waits, and survives reconnect and demotion", { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  let releaseAssignment = () => {};
  try {
    const owner = await account(false, "Владелец назначения");
    const hr = await account(true, "Пришедший нанимающий менеджер");
    const ordinary = await account(false, "Обычный участник");
    const room = await createTeamInterview(owner);
    const ownerView = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    const hrView = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await hrView.page.getByTestId("room-code-editor-host").waitFor();
    const ordinaryView = await openAccount(browser, ordinary, `/room/${room.inviteCode}`);
    await ordinaryView.page.getByTestId("room-code-editor-host").waitFor();
    const cabinet = await openAccount(browser, hr);
    await cabinet.page.getByText("Пока нет интервью", { exact: true }).waitFor();
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
    assert.equal(await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
    const ownerPage = ownerView.page;
    await ownerPage.getByRole("button", { name: /Обычный участник,/ }).click();
    await ownerPage.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).waitFor();
    assert.equal(await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).count(), 0);
    await ownerPage.keyboard.press("Escape");
    const hrMenu = () => ownerPage.getByRole("button", { name: /Пришедший нанимающий менеджер,/ });
    await hrMenu().click();
    await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).waitFor();
    assert.equal(await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).count(), 1,
      "A joined authenticated hiring manager needs a direct participant assignment action without UUID entry");
    const endpoint = `**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`;
    await ownerPage.route(endpoint, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временная ошибка назначения нанимающего" }) }), { times: 1 });
    await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await ownerPage.getByRole("alert").filter({ hasText: "Не удалось назначить нанимающего" }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
    let requestCount = 0;
    let signalRequest;
    const requestArrived = new Promise((resolve) => { signalRequest = resolve; });
    const release = new Promise((resolve) => { releaseAssignment = resolve; });
    await ownerPage.route(endpoint, async (route) => {
      requestCount += 1;
      signalRequest();
      await release;
      await route.continue();
    });
    await hrMenu().click();
    await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await requestArrived;
    await hrMenu().click();
    const pending = ownerPage.getByRole("menuitem", { name: /Назначаем нанимающего/ });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    assert.equal(requestCount, 1);
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
    releaseAssignment();
    await ownerPage.keyboard.press("Escape");
    await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    await hrMenu().getByLabel("Нанимающий", { exact: true }).waitFor();
    await cabinet.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await cabinet.page.getByRole("row").filter({ hasText: room.title }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
    await hrView.page.reload();
    await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    await hrMenu().click();
    assert.equal(await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).count(), 0);
    await ownerPage.getByRole("menuitem", { name: /Снять роль (нанимающего|интервьюера)/ }).click();
    await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
    await request(`/me/hr/rooms/${room.id}`, { token: hr.token, status: 404 });
    await hrView.page.reload();
    await hrView.page.getByTestId("room-code-editor-host").waitFor();
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
    await hrMenu().click();
    await ownerPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
    await request(`/me/rooms/${room.id}`, { token: hr.token, method: "DELETE", status: 404 });
  } finally { releaseAssignment(); await browser.close(); }
});

for (const actorKind of ["registered", "guest"]) {
  test(`nickname hiring follows current authority for a ${actorKind} room actor`, { timeout: 90000 }, async () => {
    const browser = await chromium.launch();
    try {
      const owner = await account(false, "Владелец комнаты");
      const hr = await account(true, "Нанимающий менеджер для интервьюера");
      const room = actorKind === "registered" ? await createTeamInterview(owner) : await createInterview(owner);
      const ownerView = await openAccount(browser, owner, `/room/${room.inviteCode}`);
      const actorName = "Приглашающий интервьюер";
      let actorPage, actor;
      if (actorKind === "registered") {
        actor = await account(false, actorName);
        actorPage = (await openAccount(browser, actor, `/room/${room.inviteCode}`)).page;
      } else {
        const context = await browser.newContext();
        await context.addInitScript(({ code, name }) => localStorage.setItem(`guest_display_name_${code}`, name), { code: room.inviteCode, name: actorName });
        actorPage = await context.newPage();
        actorPage.setDefaultTimeout(10000);
        await actorPage.goto(`${web}/room/${room.inviteCode}`);
      }
      await actorPage.getByTestId("room-code-editor-host").waitFor();
      const panelLabel = "Кандидат и нанимающие";
      assert.equal(await actorPage.getByRole("button", { name: panelLabel, exact: true }).count(), 0);
      if (actorKind === "registered") await joinTeam(owner, room, actor);
      else {
        await ownerView.page.getByRole("button", { name: /Приглашающий интервьюер,/ }).click();
        assert.equal(await ownerView.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).count(), 0);
        await ownerView.page.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();
      }
      await actorPage.getByRole("button", { name: panelLabel, exact: true }).waitFor();
      const hrView = await openAccount(browser, hr, `/room/${room.inviteCode}`);
      await hrView.page.getByTestId("room-code-editor-host").waitFor();
      if (actorKind === "guest") {
        await actorPage.getByRole("button", { name: panelLabel, exact: true }).click();
        const panel = actorPage.getByRole("dialog", { name: panelLabel, exact: true });
        await panel.getByLabel("Имя кандидата", { exact: true }).waitFor();
        const nickname = panel.getByRole("combobox", { name: "Нанимающий", exact: true });
        await nickname.waitFor();
        assert.equal(await panel.getByText(/внешн|Без трека|Без вакансии/i).count(), 0, "A PERSONAL guest uses current room proof with generic hiring and no TEAM context");
        assert.equal(await actorPage.getByRole("button", { name: /Нанимающий менеджер для интервьюера,/ }).count(), 0, "A personal interviewer has no hiring participant shortcut");
        assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
        await nickname.fill(hr.user.nickname);
        await chooseHiring(actorPage, nickname, hr.user.displayName);
        const remove = panel.getByRole("button", { name: `Снять роль нанимающего у ${hr.user.displayName}`, exact: true });
        await remove.waitFor();
        await hrView.page.getByRole("button", { name: panelLabel, exact: true }).waitFor();
        assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
        await remove.click();
        await hrView.page.getByRole("button", { name: panelLabel, exact: true }).waitFor({ state: "hidden" });
        assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
        await ownerView.page.getByRole("button", { name: /Приглашающий интервьюер,/ }).click();
        await ownerView.page.getByRole("menuitem", { name: "Снять роль интервьюера", exact: true }).click();
        await panel.waitFor({ state: "hidden" });
        await actorPage.getByRole("button", { name: panelLabel, exact: true }).waitFor({ state: "hidden" });
      } else {
        await actorPage.getByRole("button", { name: /Нанимающий менеджер для интервьюера,/ }).click();
        assert.equal(await actorPage.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).count(), 0, "Colleague authority does not grant ordinary owner promotion actions");
        await actorPage.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
        await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
        assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
        await actorPage.getByRole("button", { name: /Нанимающий менеджер для интервьюера,/ }).click();
        await actorPage.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).waitFor();
        assert.equal(await actorPage.getByRole("menuitem", { name: "Снять роль интервьюера", exact: true }).count(), 0, "A colleague cannot revoke ordinary owner grants");
        await actorPage.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
        await hrView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
      }
      await hrView.page.reload();
      await hrView.page.getByTestId("room-code-editor-host").waitFor();
      assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
    } finally { await browser.close(); }
  });
}

test("participant hiring-manager assignment handles current 410 as terminal without waiting for SSE failure", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account();
    const hr = await account(true, "Нанимающий менеджер архивной проверки");
    const room = await createTeamInterview(owner);
    const ownerView = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    const hrView = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await hrView.page.getByTestId("room-code-editor-host").waitFor();
    await ownerView.page.route(`**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, (route) => route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Комната архивирована" }) }));
    await ownerView.page.getByRole("button", { name: /Нанимающий менеджер архивной проверки,/ }).click();
    await ownerView.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await ownerView.page.getByTestId("room-realtime-unavailable").waitFor();
    assert.equal(await ownerView.page.getByTestId("room-code-editor-host").count(), 0);
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
  } finally { await browser.close(); }
});

test("participant hiring-manager assignment ignores a stale 410 after inviter demotion and regrant", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  let releaseAssignment = () => {};
  try {
    const owner = await account();
    const actor = await account(false, "Меняющий роль интервьюер");
    const hr = await account(true, "Нанимающий менеджер отложенного запроса");
    const room = await createTeamInterview(owner);
    await setTeamManagerRole(owner, room, actor, "interviewer");
    const actorView = await openAccount(browser, actor, `/room/${room.inviteCode}`);
    const hrView = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await hrView.page.getByTestId("room-code-editor-host").waitFor();
    let signalRequest;
    let signalCompletion;
    const requestArrived = new Promise((resolve) => { signalRequest = resolve; });
    const deliveryCompleted = new Promise((resolve) => { signalCompletion = resolve; });
    const release = new Promise((resolve) => { releaseAssignment = resolve; });
    await actorView.page.route(`**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, async (route) => {
      signalRequest();
      await release;
      try { await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Устаревший ответ" }) }); }
      catch { /* An aborted former-generation request has no current recipient. */ }
      finally { signalCompletion(); }
    });
    await actorView.page.getByRole("button", { name: /Нанимающий менеджер отложенного запроса,/ }).click();
    await actorView.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await requestArrived;
    await setTeamManagerRole(owner, room, actor, "candidate");
    await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
    await setTeamManagerRole(owner, room, actor, "interviewer");
    await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    releaseAssignment();
    await deliveryCompleted;
    await actorView.page.getByRole("button", { name: /Нанимающий менеджер отложенного запроса,/ }).click();
    const action = actorView.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true });
    await action.waitFor();
    assert.equal(await action.isEnabled(), true);
    assert.equal(await actorView.page.getByTestId("room-realtime-unavailable").count(), 0);
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
  } finally { releaseAssignment(); await browser.close(); }
});


test("hiring-manager removal from participant menu updates all tabs and cabinet and survives reconnect", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account(false, "Владелец удаления");
    const hr = await account(true, "Кандидат с отметкой менеджера");
    const room = await createTeamInterview(owner);
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    const actor = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    const secondTab = await target.context.newPage();
    await secondTab.goto(`${web}/room/${room.inviteCode}`);
    for (const page of [target.page, secondTab]) await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    await target.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    const cabinet = await openAccount(browser, hr);
    await cabinet.page.getByRole("row").filter({ hasText: room.title }).waitFor();
    await actor.page.getByRole("button", { name: /Кандидат с отметкой менеджера,/ }).click();
    await actor.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
    for (const page of [target.page, secondTab]) await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
    await target.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
    await cabinet.page.getByRole("button", { name: "Обновить список", exact: true }).click();
    await cabinet.page.getByText("Пока нет интервью", { exact: true }).waitFor();
    await request(`/me/hr/rooms/${room.id}`, { token: hr.token, status: 404 });
    assert.equal((await request("/me/profile", { token: hr.token })).isHr, true);
    await target.page.reload();
    await target.page.getByTestId("room-code-editor-host").waitFor();
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "candidate");
    await actor.page.getByRole("button", { name: /Кандидат с отметкой менеджера,/ }).click();
    await actor.page.getByRole("menuitem", { name: "Назначить нанимающим", exact: true }).click();
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 1);
  } finally { await browser.close(); }
});

test("hiring-manager removal from offline manager list supports pending failure and retry and protects owner", { timeout: 90000 }, async () => {
  const browser = await chromium.launch();
  let release = () => {};
  try {
    const owner = await account(true, "Нанимающий менеджер владелец");
    const hr = await account(true, "Нанимающий менеджер вне комнаты");
    const room = await createTeamInterview(owner);
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    const actor = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    await actor.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const dialog = actor.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    const remove = dialog.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер вне комнаты", exact: true });
    await remove.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер владелец", exact: true }).count(), 0);
    let signal;
    const arrived = new Promise(resolve => { signal = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    let count = 0;
    const endpoint = `**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`;
    await actor.page.route(endpoint, async route => {
      if (route.request().method() !== "DELETE") return route.continue();
      count += 1; signal(); await held;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Повторите запрос" }) });
    });
    await remove.click(); await arrived;
    assert.equal(await remove.isDisabled(), true);
    assert.equal(count, 1);
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "interviewer");
    release();
    await dialog.getByText("Не удалось снять роль нанимающего. Проверьте доступ к комнате и повторите попытку.", { exact: true }).waitFor();
    await actor.page.unroute(endpoint);
    await remove.click();
    await remove.waitFor({ state: "hidden" });
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
    const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await target.page.getByTestId("room-code-editor-host").waitFor();
    assert.equal(await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
  } finally { release(); await browser.close(); }
});

test("hiring-manager removal allows self removal and closes manager panel", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const owner = await account();
    const hr = await account(true, "Нанимающий менеджер снимает свою роль");
    const room = await createTeamInterview(owner);
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const dialog = target.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await dialog.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер снимает свою роль", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: hr.token, method: "DELETE", status: 403 });
    assert.equal((await request("/me/hr/rooms", { token: hr.token })).totalElements, 0);
  } finally { await browser.close(); }
});

for (const surface of ["participant", "panel"]) {
  test(`hiring-manager removal current 410 is terminal from ${surface}`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch();
    try {
      const owner = await account();
      const hr = await account(true, "Нанимающий менеджер архивирования");
      const room = await createTeamInterview(owner);
      await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
      const actor = await openAccount(browser, owner, `/room/${room.inviteCode}`);
      const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
      await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
      await actor.page.route(`**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, route => route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Комната архивирована" }) }));
      if (surface === "participant") {
        await actor.page.getByRole("button", { name: /Нанимающий менеджер архивирования,/ }).click();
        await actor.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
      } else {
        await actor.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
        await actor.page.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер архивирования", exact: true }).click();
      }
      await actor.page.getByTestId("room-realtime-unavailable").waitFor();
      assert.equal(await actor.page.getByTestId("room-code-editor-host").count(), 0);
    } finally { await browser.close(); }
  });
}

for (const surface of ["participant", "panel"]) {
  test(`hiring-manager removal ignores stale response after permission loss from ${surface}`, { timeout: 90000 }, async () => {
    const browser = await chromium.launch();
    let release = () => {};
    try {
      const owner = await account();
      const actor = await account(false, "Менеджер отмены");
      const hr = await account(true, "Нанимающий менеджер задержанного удаления");
      const room = await createTeamInterview(owner);
      await setTeamManagerRole(owner, room, actor, "interviewer");
      await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
      const actorView = await openAccount(browser, actor, `/room/${room.inviteCode}`);
      const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
      await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
      let signal, complete;
      const arrived = new Promise(resolve => { signal = resolve; });
      const delivered = new Promise(resolve => { complete = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      await actorView.page.route(`**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, async route => {
        signal(); await held;
        try { await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Старый ответ" }) }); }
        catch { /* Aborted requests have no recipient after authority changes. */ }
        finally { complete(); }
      });
      if (surface === "participant") {
        await actorView.page.getByRole("button", { name: /Нанимающий менеджер задержанного удаления,/ }).click();
        await actorView.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
      } else {
        await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
        await actorView.page.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер задержанного удаления", exact: true }).click();
      }
      await arrived;
      await setTeamManagerRole(owner, room, actor, "candidate");
      await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
      await setTeamManagerRole(owner, room, actor, "interviewer");
      await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
      release(); await delivered;
      await actorView.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
      await actorView.page.getByRole("button", { name: "Снять роль нанимающего у Нанимающий менеджер задержанного удаления", exact: true }).waitFor();
      assert.equal(await actorView.page.getByTestId("room-realtime-unavailable").count(), 0);
      assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "interviewer");
    } finally { release(); await browser.close(); }
  });
}

test("hiring-manager removal participant pending failure preserves role and permits retry", { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  let release = () => {};
  try {
    const owner = await account();
    const hr = await account(true, "Нанимающий менеджер повторной попытки");
    const room = await createTeamInterview(owner);
    await request(`/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`, { token: owner.token, method: "PUT" });
    const actor = await openAccount(browser, owner, `/room/${room.inviteCode}`);
    const target = await openAccount(browser, hr, `/room/${room.inviteCode}`);
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    let signal;
    const arrived = new Promise(resolve => { signal = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    let count = 0;
    const endpoint = `**/api/rooms/${room.inviteCode}/hr-managers/${hr.user.id}`;
    await actor.page.route(endpoint, async route => {
      count += 1; signal(); await held;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Повторите запрос" }) });
    });
    const participant = actor.page.getByRole("button", { name: /Нанимающий менеджер повторной попытки,/ });
    await participant.click();
    await actor.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
    await arrived;
    await participant.click();
    const pending = actor.page.getByRole("menuitem", { name: /Снимаем роль нанимающего/ });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    assert.equal(count, 1);
    release();
    await actor.page.keyboard.press("Escape");
    await actor.page.getByText("Не удалось снять роль нанимающего. Проверьте доступ к комнате и повторите попытку.", { exact: true }).waitFor();
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hr.token })).role, "interviewer");
    await actor.page.unroute(endpoint);
    await participant.click();
    await actor.page.getByRole("menuitem", { name: "Снять роль нанимающего", exact: true }).click();
    await target.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor({ state: "hidden" });
  } finally { release(); await browser.close(); }
});
