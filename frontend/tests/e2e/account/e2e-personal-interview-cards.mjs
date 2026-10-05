import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:15173";
const api = process.env.E2E_API_URL ?? "http://localhost:18080/api";
let browser;

async function request(path, auth, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

async function account(displayName = "Интервьюер личной карточки", isHr = false) {
  return request("/auth/register", null, {
    nickname: `card_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    displayName,
    password: "test-password-123",
    isHr,
  });
}

async function roomFixture({ withTasks = true, title = "Личная карточка" } = {}) {
  const owner = await account();
  const tasks = [];
  if (withTasks) {
    for (const taskTitle of ["Массивы", "Алгоритмы"]) {
      tasks.push(await request("/me/tasks", owner, {
        title: taskTitle, description: "Проверка карточки интервью", starterCode: "return 1", language: "nodejs",
      }));
    }
  }
  const room = await request("/rooms", owner, { title, language: "nodejs", taskIds: tasks.map(task => task.id) });
  const metadata = await request(`/rooms/${room.inviteCode}/interview-metadata`, owner);
  await request(`/rooms/${room.inviteCode}/interview-metadata`, owner, {
    candidateName: "Анна Карточка", position: "Backend инженер", scheduledAt: "2030-10-12T11:30:00Z", revision: metadata.revision,
  }, "PUT");
  return { owner, room, tasks };
}

async function openAccount(auth, path = "/workspace/personal/interviews", viewport = { width: 1366, height: 850 }, onPage) {
  const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(({ token, user }) => {
    if (localStorage.getItem("personal_card_seeded")) return;
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
    localStorage.setItem("personal_card_seeded", "true");
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await onPage?.(page);
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

async function joinPersonalRoom(auth, room) {
  const controller = new AbortController();
  const stream = await fetch(`${api}/realtime/rooms/${room.inviteCode}/stream?sessionId=${randomUUID()}&displayNameEncoded=${encodeURIComponent(auth.user.displayName)}`, {
    headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
  });
  assert.equal(stream.status, 200, "Guest interviewer first joins through the public room admission");
  try {
    const first = await stream.body.getReader().read();
    assert.ok(first.value?.length, "Public room snapshot confirms admission before host role grant");
  } finally { controller.abort(); }
}

function cardFor(page, title) {
  return page.getByRole("region", { name: `Личное интервью ${title}`, exact: true });
}

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("personal owner card matches team information and candidate-copy, enter and confirmed-delete actions", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const { page, context } = await openAccount(f.owner);
  try {
    const list = page.getByRole("list", { name: "Личные интервью", exact: true });
    await list.waitFor();
    const card = cardFor(page, f.room.title);
    await card.waitFor();
    assert.equal(await list.getByRole("listitem").count(), 1);
    assert.equal(await page.locator(".ant-table").count(), 0, "Personal list uses the same card presentation as team interviews");
    await card.getByText("2 задачи", { exact: true }).waitFor();
    await card.getByText("Активно", { exact: true }).waitFor();
    await card.getByText(/^Создано \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/).waitFor();
    await card.getByText("Массивы → Алгоритмы", { exact: true }).waitFor();
    assert.equal(await card.getByText(/Без трека|Без вакансии/).count(), 0, "Team context is absent from personal cards");
    await card.getByText(`Интервьюеры: ${f.owner.user.displayName}`, { exact: true }).waitFor();
    await card.getByText(/Анна Карточка/).waitFor();
    const search = page.getByRole("textbox", { name: "Поиск интервью", exact: true });
    await search.fill("Нет такого интервью");
    await card.waitFor({ state: "hidden" });
    await search.fill("анна карточка");
    await card.waitFor();
    await search.fill("");
    await card.waitFor();
    await page.getByRole("button", { name: "Обновить интервью", exact: true }).click();
    await card.getByText("2 задачи", { exact: true }).waitFor();
    const edit = card.getByRole("button", { name: `Редактировать интервью ${f.room.title}`, exact: true });
    await edit.waitFor();
    assert.equal((await edit.innerText()).trim(), "Редактировать");
    assert.equal(await card.getByRole("button", { name: /Переименовать|Сведения/ }).count(), 0, "Owner has one combined edit action");
    await card.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).click();
    const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(copied.origin, new URL(web).origin);
    assert.equal(copied.pathname, `/room/${f.room.inviteCode}`);
    assert.equal(copied.search, "", "Candidate copy never carries owner or interviewer credentials");
    assert.equal(copied.hash, "");
    const enter = card.getByRole("link", { name: `Открыть комнату ${f.room.title}`, exact: true });
    assert.equal((await enter.innerText()).trim(), "Войти в комнату");
    await enter.click();
    await page.waitForURL(`**/room/${f.room.inviteCode}`);
    await page.goBack();
    await card.waitFor();
    await card.getByRole("button", { name: `Удалить интервью ${f.room.title}`, exact: true }).click();
    const confirmation = page.getByRole("dialog").filter({ hasText: /Удалить интервью/ });
    await confirmation.waitFor();
    assert.equal((await request("/me/rooms", f.owner)).length, 1, "Delete trigger only asks for confirmation");
    await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    await card.getByRole("button", { name: `Удалить интервью ${f.room.title}`, exact: true }).click();
    await confirmation.getByRole("button", { name: "Удалить", exact: true }).click();
    await card.waitFor({ state: "hidden" });
    assert.equal((await request("/me/rooms", f.owner)).length, 0);
  } finally { await context.close(); }
});

test("personal combined editor persists title and metadata, keeps network drafts and reloads revision conflicts", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const { context, page } = await openAccount(f.owner);
  const endpoint = `/me/rooms/${f.room.id}/details`;
  try {
    const card = cardFor(page, f.room.title);
    await card.getByRole("button", { name: `Редактировать интервью ${f.room.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const title = dialog.getByLabel("Название интервью", { exact: true });
    const candidate = dialog.getByLabel("Имя кандидата", { exact: true });
    const position = dialog.getByLabel("Позиция", { exact: true });
    const date = dialog.getByLabel("Дата и время интервью (МСК)", { exact: true });
    await candidate.waitFor();
    assert.equal(await title.inputValue(), f.room.title);
    assert.equal(await candidate.inputValue(), "Анна Карточка");
    assert.equal(await position.inputValue(), "Backend инженер");
    assert.equal(await date.inputValue(), "2030-10-12T14:30");
    await dialog.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    assert.equal(await dialog.getByText(/внешн|Без трека|Без вакансии/i).count(), 0, "Personal editor uses generic hiring and no TEAM context");
    await title.fill("Сохранённая личная карточка");
    await candidate.fill("Мария Новый кандидат");
    await position.fill("Kotlin инженер");
    await date.fill("2030-10-13T15:45");
    await page.route(`**/api${endpoint}`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByText("Ошибка сети. Проверьте подключение и повторите попытку.", { exact: true }).waitFor();
    assert.equal(await title.inputValue(), "Сохранённая личная карточка");
    assert.equal(await candidate.inputValue(), "Мария Новый кандидат");
    assert.equal(await position.inputValue(), "Kotlin инженер");
    assert.equal(await date.inputValue(), "2030-10-13T15:45");
    const original = await request(endpoint, f.owner);
    assert.deepEqual([original.title, original.candidateName], [f.room.title, "Анна Карточка"]);
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByText("Интервью сохранено", { exact: true }).waitFor();
    const saved = await request(endpoint, f.owner);
    assert.deepEqual([saved.title, saved.candidateName, saved.position, saved.scheduledAt], [
      "Сохранённая личная карточка", "Мария Новый кандидат", "Kotlin инженер", "2030-10-13T12:45:00Z",
    ]);
    await request(endpoint, f.owner, { ...saved, title: "Сведения другого редактора", candidateName: "Кандидат другого редактора" }, "PATCH");
    await title.fill("Черновик после конфликта");
    await candidate.fill("Несохранённый кандидат");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    assert.equal(await title.inputValue(), "Черновик после конфликта");
    assert.equal(await candidate.inputValue(), "Несохранённый кандидат");
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("input")].some(input => input.value === "Сведения другого редактора"));
    assert.equal(await candidate.inputValue(), "Кандидат другого редактора");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    const freshCard = cardFor(page, "Сведения другого редактора");
    await freshCard.waitFor();
    await freshCard.getByText(/Кандидат другого редактора/).waitFor();
    await freshCard.getByRole("button", { name: "Редактировать интервью Сведения другого редактора", exact: true }).click();
    await candidate.waitFor();
    assert.equal(await position.inputValue(), "Kotlin инженер");
    assert.equal(await date.inputValue(), "2030-10-13T15:45");
  } finally { await context.close(); }
});

test("personal interviewer edits permitted metadata and generic hiring without gaining owner actions", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const interviewer = await account("Пётр Интервьюер");
  await joinPersonalRoom(interviewer, f.room);
  await request(`/rooms/${f.room.inviteCode}/participants/${interviewer.user.id}/role`, f.owner, { role: "interviewer" });
  const { context, page } = await openAccount(interviewer);
  try {
    const card = cardFor(page, f.room.title);
    await card.waitFor();
    await card.getByText(/Пётр Интервьюер/).waitFor();
    assert.equal(await card.getByRole("button", { name: /Удалить|Переименовать/ }).count(), 0);
    await card.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).waitFor();
    await card.getByRole("button", { name: `Редактировать интервью ${f.room.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const title = dialog.getByLabel("Название интервью", { exact: true });
    await title.waitFor();
    assert.equal(await title.evaluate(input => input.readOnly || input.disabled), true, "Interviewer cannot rename the owned interview");
    await dialog.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("combobox", { name: /трек|ваканси/i }).count(), 0);
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Кандидат обновлён интервьюером");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByText("Интервью сохранено", { exact: true }).waitFor();
    const details = await request(`/me/rooms/${f.room.id}/details`, f.owner);
    assert.equal(details.title, f.room.title);
    assert.equal(details.candidateName, "Кандидат обновлён интервьюером");
  } finally { await context.close(); }

});

test("revoking personal interviewer access while editing clears private drafts and prevents a save", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const interviewer = await account("Интервьюер до отзыва доступа");
  await joinPersonalRoom(interviewer, f.room);
  await request(`/rooms/${f.room.inviteCode}/participants/${interviewer.user.id}/role`, f.owner, { role: "interviewer" });
  const { context, page } = await openAccount(interviewer);
  try {
    const card = cardFor(page, f.room.title);
    await card.getByRole("button", { name: `Редактировать интервью ${f.room.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const candidate = dialog.getByLabel("Имя кандидата", { exact: true });
    await candidate.waitFor();
    await candidate.fill("Приватный черновик отозванного интервьюера");
    await request(`/rooms/${f.room.inviteCode}/participants/${interviewer.user.id}/role`, f.owner, { role: "candidate" });
    const denied = await fetch(`${api}/me/rooms/${f.room.id}/details`, { headers: { Authorization: `Bearer ${interviewer.token}` } });
    assert.ok([403, 404].includes(denied.status), "Direct details API must enforce revoked interviewer access");
    const rejectedSave = page.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/me/rooms/${f.room.id}/details`);
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.ok([403, 404].includes((await rejectedSave).status()), "The stale editor cannot bypass current server rights");
    await candidate.waitFor({ state: "hidden" });
    assert.equal(await page.getByLabel("Имя кандидата", { exact: true }).count(), 0, "Denied save removes private metadata and its draft from the form");
    assert.equal(await page.getByLabel("Позиция", { exact: true }).count(), 0);
    if (await dialog.isVisible()) {
      assert.equal(await dialog.getByRole("button", { name: "Сохранить", exact: true }).isDisabled(), true);
    }
    await card.waitFor({ state: "hidden" });
    assert.equal(await page.getByText(/Анна Карточка|Приватный черновик отозванного интервьюера/).count(), 0, "Denied metadata cannot remain on a stale card or in search results");
    const storage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
    assert.ok(!storage.includes("Приватный черновик отозванного интервьюера"), "Private draft must not enter browser recovery storage");
    assert.equal((await request(`/rooms/${f.room.inviteCode}/interview-metadata`, f.owner)).candidateName, "Анна Карточка");
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    const refreshedRooms = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/me/rooms");
    await page.reload({ waitUntil: "domcontentloaded" });
    await refreshedRooms;
    assert.equal(await card.count(), 0, "A fresh personal list hides the interview after membership removal");
  } finally { await context.close(); }
});

test("public personal candidate never reads private metadata or external hiring and gets no manager card", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const candidate = await account("Публичный кандидат личного интервью", true);
  const privateRequests = [];
  const { context, page } = await openAccount(candidate, `/room/${f.room.inviteCode}`, undefined, page => {
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (/\/interview-metadata$|\/participants$|\/hr-managers(?:\/|$)|\/hr-tracking$|\/details$|\/hiring-manager-preview$/.test(path)) privateRequests.push(path);
    });
  });
  try {
    await page.getByTestId("room-code-editor-host").locator(".cm-editor").waitFor();
    await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    assert.deepEqual(privateRequests, [], "Public candidate never requests private details or hiring assignments");
    assert.equal(await page.getByRole("button", { name: /^(?:Сведения о кандидате|Кандидат и нанимающие)$/, exact: true }).count(), 0);
    const privateView = await fetch(`${api}/me/rooms/${f.room.id}/details`, { headers: { Authorization: `Bearer ${candidate.token}` } });
    assert.ok([403, 404].includes(privateView.status), "Public personal admission cannot access private interview details");
    const metadataView = await fetch(`${api}/rooms/${f.room.inviteCode}/interview-metadata`, { headers: { Authorization: `Bearer ${candidate.token}` } });
    assert.ok([403, 404].includes(metadataView.status), "Public personal admission cannot read candidate metadata");
    await page.goto(`${web}/workspace/personal/interviews`, { waitUntil: "networkidle" });
    assert.equal(await cardFor(page, f.room.title).count(), 0, "Public admission does not invent durable interview management membership");
    assert.equal(await page.getByText(/Анна Карточка|Backend инженер/).count(), 0);
    const storage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
    assert.ok(!storage.includes("Анна Карточка"), "Public room admission never persists private candidate metadata");
  } finally { await context.close(); }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("a late personal details response after browser navigation cannot reopen the editor or restore private fields", { timeout: 60_000 }, async () => {
  const f = await roomFixture();
  const { context, page } = await openAccount(f.owner, "/profile");
  const entered = deferred();
  const release = deferred();
  const delivered = deferred();
  const pattern = `**/api/me/rooms/${f.room.id}/details`;
  let held = false;
  const handler = async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    held = true;
    entered.resolve();
    await release.promise;
    try { await route.fulfill({ response }); } catch { /* Navigation may already have canceled the request. */ }
    finally { delivered.resolve(); }
  };
  try {
    await page.getByRole("button", { name: "Изменить имя", exact: true }).waitFor();
    await page.getByRole("link", { name: "Интервью", exact: true }).click();
    const card = cardFor(page, f.room.title);
    await card.waitFor();
    await page.route(pattern, handler);
    await card.getByRole("button", { name: `Редактировать интервью ${f.room.title}`, exact: true }).click();
    await entered.promise;
    await page.goBack();
    await page.getByRole("button", { name: "Изменить имя", exact: true }).waitFor();
    release.resolve();
    await delivered.promise;
    await page.unroute(pattern, handler);
    assert.equal(await page.getByRole("dialog", { name: "Редактировать интервью", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Имя кандидата", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Анна Карточка", { exact: true }).count(), 0);
    const storage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
    assert.ok(!storage.includes("Анна Карточка"), "Late private details are not persisted as page recovery state");
  } finally {
    release.resolve();
    if (held) await delivered.promise;
    await page.unroute(pattern, handler);
    await context.close();
  }
});

async function cardAppearance(card) {
  return card.evaluate(element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(["backgroundColor", "borderColor", "borderRadius", "borderWidth", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize"].map(key => [key, style[key]]));
  });
}

test("personal and team cards share light/dark styling and remain usable on a narrow viewport", { timeout: 60_000 }, async () => {
  const f = await roomFixture({ withTasks: false, title: "Карточка оформления" });
  const { team } = await request("/teams", f.owner, { name: "Команда оформления" });
  const { interview } = await request(`/teams/${team.id}/interviews`, f.owner, { title: f.room.title, selectedTaskIds: [] });
  const { context, page } = await openAccount(f.owner);
  const evidence = fileURLToPath(new URL("../../../../.run/personal-interview-cards-evidence/", import.meta.url));
  await mkdir(evidence, { recursive: true });
  try {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => localStorage.setItem("interview-online:ui-theme", theme), theme);
      await page.reload({ waitUntil: "domcontentloaded" });
      const personal = cardFor(page, f.room.title);
      await personal.getByText("0 задач", { exact: true }).waitFor();
      await personal.getByText("Задачи не добавлены", { exact: true }).waitFor();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      const personalStyle = await cardAppearance(personal);
      await page.screenshot({ path: `${evidence}/${theme}-personal-desktop.png`, fullPage: true });
      await page.goto(`${web}/workspace/teams/${team.id}/interviews`);
      const teamCard = page.getByRole("region", { name: `Командное интервью ${interview.title}`, exact: true });
      await teamCard.getByText("0 задач", { exact: true }).waitFor();
      const teamStyle = await cardAppearance(teamCard);
      assert.deepEqual(personalStyle, teamStyle, `${theme}: card borders, padding, background and typography match the team card`);
      await page.screenshot({ path: `${evidence}/${theme}-team-desktop.png`, fullPage: true });
      await page.goto(`${web}/workspace/personal/interviews`);
      await page.setViewportSize({ width: 390, height: 844 });
      await personal.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).waitFor();
      const geometry = await personal.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll("button, a[href]")].map(control => {
          const box = control.getBoundingClientRect();
          return { label: control.getAttribute("aria-label") || control.textContent.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
        });
        return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, controls };
      });
      assert.ok(geometry.scrollWidth <= geometry.viewport + 1, `${theme}: personal list has no horizontal page overflow`);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1, `${theme}: card fits the viewport`);
      for (const control of geometry.controls) {
        assert.ok(control.left >= geometry.left - 1 && control.right <= geometry.right + 1, `${theme}: ${control.label} stays inside the card`);
        assert.ok(control.width > 0 && control.height > 0, `${theme}: ${control.label} remains visible`);
      }
      await writeFile(`${evidence}/${theme}-measurements.json`, JSON.stringify({ personalStyle, teamStyle, geometry }, null, 2));
      await page.screenshot({ path: `${evidence}/${theme}-personal-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1366, height: 850 });
    }
  } finally { await context.close(); }
});
