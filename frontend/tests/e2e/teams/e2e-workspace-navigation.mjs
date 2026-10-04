import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let browser;
let fixtures;

async function request(path, { token, method = "GET", body, status = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function rawRoomSnapshot(token) {
  const response = await fetch(`${api}/me/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  assert.equal(response.status, 200, `GET /me/rooms: ${text.slice(0, 600)}`);
  return { text, rooms: JSON.parse(text) };
}

async function account({ isHr = false, displayName = "Участник проверки" } = {}) {
  return request("/auth/register", {
    method: "POST",
    body: {
      nickname: `ac01_${unique()}`.slice(0, 32),
      displayName,
      password: "test-password-123",
      isHr,
    },
  });
}

async function createRoom(auth, title) {
  return request("/rooms", {
    token: auth.token,
    method: "POST",
    body: { title, language: "nodejs", taskIds: [] },
  });
}

async function assignParticipant(owner, room, participant, role) {
  return request(`/rooms/${room.inviteCode}/participants/${participant.user.id}/role`, {
    token: owner.token,
    method: "POST",
    body: { role },
  });
}

async function createTask(auth, title, language = "nodejs") {
  return request("/me/tasks", {
    token: auth.token,
    method: "POST",
    body: {
      title,
      description: "Условие личной задачи для проверки совместимости библиотеки",
      starterCode: "export function solve() { return 42; }",
      language,
    },
  });
}

async function createPreset(auth, name, taskId) {
  return request("/me/presets", {
    token: auth.token,
    method: "POST",
    status: 201,
    body: { name, taskTemplateIds: [taskId] },
  });
}

async function createTeamApi(auth, name) {
  const response = await fetch(`${api}/teams`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ name }),
  });
  const text = await response.text();
  assert.equal(response.status, 201, `POST /teams must provision active-overflow fixture: ${text.slice(0, 600)}`);
  const result = JSON.parse(text);
  return result.team;
}

async function settleApp(page) {
  await page.locator("#root").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(document.querySelector("#root")?.textContent?.trim()));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openAccount(auth, path, {
  viewport = { width: 1280, height: 720 },
  permissions = [],
  onPage,
  waitForWorkspaceData = true,
} = {}) {
  const context = await browser.newContext({ viewport, permissions });
  if (permissions.includes("clipboard-read")) {
    // Context-scoped clipboard prevents parallel browser suites from replacing
    // this flow's exported data between the UI write and assertion read.
    await context.addInitScript(() => {
      let copied = "";
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text) => { copied = text; },
        readText: async () => copied,
      } });
    });
  }
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  const expectedDataPath = path === "/workspace/personal/interviews" || path === "/dashboard" || path === "/dashboard/manage"
    ? "/api/me/rooms"
    : path === "/workspace/personal/library" || path.startsWith("/dashboard/tasks") || path.startsWith("/dashboard/presets")
      ? "/api/me/tasks"
      : path === "/workspace/personal/candidates" || path === "/dashboard/hr"
        ? "/api/me/hr/rooms?"
        : null;
  const workspaceDataReady = waitForWorkspaceData && expectedDataPath
    ? page.waitForResponse((response) => response.url().includes(expectedDataPath))
    : null;
  onPage?.(page);
  page.setDefaultTimeout(10000);
  if (path === "/workspace/personal/interviews/new") {
    // A routed create form must have real browser history so Back remains
    // available even while a mutation makes its modal close control busy.
    await page.goto(`${web}/workspace/personal/interviews`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await page.waitForURL(`**${path}`);
  } else {
    await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  }
  await workspaceDataReady;
  await settleApp(page);
  return { context, page };
}

async function readCopiedLibraryData(page, predicate) {
  // Read in the same browser world as the context-scoped clipboard fixture.
  // The utility-world polling used by waitForFunction can read native data.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    try { if (predicate(JSON.parse(copied))) return copied; } catch { /* wait for the UI write */ }
    await page.waitForTimeout(20);
  }
  assert.fail("LIBRARY_UI_CLIPBOARD_WRITE_NOT_OBSERVED");
}

function pathnameAndSearch(page) {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

function assertRoute(page, expected, marker) {
  assert.equal(pathnameAndSearch(page), expected, `${marker}: expected ${expected}, got ${pathnameAndSearch(page)}`);
}

async function logoutAndLogin(page, auth, destination = "/workspace/personal/interviews") {
  const openDialog = page.getByRole("dialog");
  if (await openDialog.count()) {
    const close = openDialog.getByRole("button", { name: "Закрыть", exact: true });
    if (await close.count()) await close.first().click();
    else await page.goBack();
    await openDialog.waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(`${web}/`);
  await page.getByRole("link", { name: "Личный кабинет", exact: true }).click();
  await page.waitForURL("**/login");
  await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(auth.user.nickname);
  await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill("test-password-123");
  await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();
  await page.waitForURL(`**${destination}`);
  await page.getByText(`@${auth.user.nickname}`, { exact: true }).waitFor();
}

function roomSnapshot(rooms) {
  return rooms
    .map(({ id, inviteCode, accessRole, title }) => ({ id, inviteCode, accessRole, title }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

before(async () => {
  browser = await chromium.launch({ headless: true });

  const owner = await account({ displayName: "Владелец личных интервью" });
  let unified = await account({ isHr: true, displayName: "Личный владелец и кандидат" });
  const hr = await account({ isHr: true, displayName: "Личный нанимающий" });
  const empty = await account({ displayName: "Пользователь без интервью" });
  const ordinary = await account({ displayName: "Обычный пользователь" });
  const creator = await account({ displayName: "Автор нового интервью" });
  const rolesOwner = await account({ displayName: "Владелец ролевого интервью" });
  const interviewer = await account({ displayName: "Назначенный интервьюер" });
  let candidate = await account({ isHr: true, displayName: "Назначенный кандидат" });
  const profile = await account({ displayName: "Профиль до изменения" });
  const hrMatrix = await account({ isHr: true, displayName: "Нанимающий матрицы" });

  const ownedRoom = await createRoom(unified, `Личное интервью владельца ${unique()}`);
  const candidateRoom = await createRoom(owner, `Личное интервью кандидата ${unique()}`);
  await request(`/rooms/${candidateRoom.inviteCode}/hr-managers/${unified.user.id}`, {
    token: owner.token,
    method: "PUT",
  });
  await request(`/rooms/${candidateRoom.inviteCode}/hr-managers/${unified.user.id}`, {
    token: owner.token,
    method: "DELETE",
    status: 204,
  });
  const unifiedProfile = await request("/me/profile", {
    token: unified.token,
    method: "PATCH",
    body: { displayName: unified.user.displayName, isHr: false },
  });
  unified = { ...unified, user: unifiedProfile };

  const hrRoom = await createRoom(hr, `Интервью кандидата для HR ${unique()}`);
  await request(`/rooms/${hrRoom.inviteCode}/interview-metadata`, {
    token: hr.token,
    method: "PUT",
    body: {
      candidateName: "Евгения Константинопольская",
      position: "Ведущий разработчик платформы совместной работы",
      scheduledAt: "2030-09-12T10:30:00+03:00",
      revision: 0,
    },
  });
  await request(`/rooms/${hrRoom.inviteCode}/hr-tracking`, { token: hr.token, method: "POST" });

  const task = await createTask(unified, `Личная задача Node.js ${unique()}`);
  const pythonTask = await createTask(unified, `Личная задача Python ${unique()}`, "python");
  const preset = await createPreset(unified, `Личный набор задач ${unique()}`, task.id);

  const roleRoom = await createRoom(rolesOwner, `Ролевое интервью ${unique()}`);
  const deletableRoom = await createRoom(rolesOwner, `Удаляемое интервью ${unique()}`);
  await assignParticipant(rolesOwner, roleRoom, interviewer, "interviewer");
  await request(`/rooms/${roleRoom.inviteCode}/hr-managers/${candidate.user.id}`, {
    token: rolesOwner.token,
    method: "PUT",
  });
  await request(`/rooms/${roleRoom.inviteCode}/hr-managers/${candidate.user.id}`, {
    token: rolesOwner.token,
    method: "DELETE",
    status: 204,
  });
  const candidateProfile = await request("/me/profile", {
    token: candidate.token,
    method: "PATCH",
    body: { displayName: candidate.user.displayName, isHr: false },
  });
  candidate = { ...candidate, user: candidateProfile };
  await request(`/rooms/${roleRoom.inviteCode}/interview-metadata`, {
    token: rolesOwner.token,
    method: "PUT",
    body: {
      candidateName: "Мария Ролевая",
      position: "Ведущий инженер платформы",
      scheduledAt: "2030-09-12T10:30:00+03:00",
      revision: 0,
    },
  });

  const hrMatrixRoom = await createRoom(hrMatrix, `HR матрица ${unique()}`);
  const hrMatrixCandidate = "АлександраЕкатеринаКонстантинопольскаяСверхдлинноеИмяБезПробеловДляПроверкиПереноса";
  const hrMatrixPosition = "ВедущийИнженерРаспределённыхСистемИПлатформСовместнойРаботыБезПробелов";
  await request(`/rooms/${hrMatrixRoom.inviteCode}/interview-metadata`, {
    token: hrMatrix.token,
    method: "PUT",
    body: {
      candidateName: hrMatrixCandidate,
      position: hrMatrixPosition,
      scheduledAt: "2031-11-20T15:45:00+03:00",
      revision: 0,
    },
  });
  await request(`/rooms/${hrMatrixRoom.inviteCode}/hr-tracking`, { token: hrMatrix.token, method: "POST" });

  fixtures = {
    owner, unified, hr, empty, ordinary, creator, ownedRoom, candidateRoom, hrRoom, task, pythonTask, preset,
    rolesOwner, interviewer, candidate, profile, roleRoom, deletableRoom, hrMatrix, hrMatrixRoom, hrMatrixCandidate, hrMatrixPosition,
  };
});

after(async () => {
  await browser?.close();
});

test("infrastructure: current dashboard, API and authenticated room list are ready", { timeout: 30000 }, async () => {
  const rooms = await request("/me/rooms", { token: fixtures.unified.token });
  assert.equal(rooms.length, 2, "Fixture must expose one owner and one candidate membership");
  assert.deepEqual(new Set(rooms.map((room) => room.accessRole)), new Set(["owner", "candidate"]));

  const { context, page } = await openAccount(fixtures.unified, "/dashboard/manage");
  try {
    await settleApp(page);
    assert.notEqual((await page.locator("#root").innerText()).trim(), "", "APP_ROOT_MUST_RENDER");
    assert.notEqual(pathnameAndSearch(page), "/login", "AUTHENTICATED_DASHBOARD_MUST_NOT_OPEN_LOGIN");
    assert.notEqual(pathnameAndSearch(page), "/", "AUTHENTICATED_DASHBOARD_MUST_NOT_OPEN_LANDING");
  } finally {
    await context.close();
  }
});

test("workspace follows the unified light palette and focus treatment", async (t) => {
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await t.test(`${viewport.width}x${viewport.height}`, async () => {
      const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/library", { viewport });
      try {
        await page.waitForURL("**/workspace/personal/library");
        const main = page.getByRole("main", { name: "Личный раздел: Библиотека", exact: true });
        assert.equal(await main.count(), 1, "PALETTE_CANONICAL_LANDMARK_MISSING");
        assert.equal(await main.getByRole("heading", { name: "Библиотека", exact: true }).count(), 1, "PALETTE_CANONICAL_HEADING_MISSING");

        const shell = main.locator("..");
        const header = page.locator("header");
        const brand = header.getByText("IH", { exact: true });
        const activeNav = header.getByRole("link", { name: "Библиотека", exact: true });
        const activeTab = main.getByRole("tab", { name: "Задачи", exact: true });

        assert.deepEqual(await shell.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
          };
        }), {
          color: "rgb(29, 33, 41)",
          backgroundColor: "rgb(243, 245, 251)",
          backgroundImage: "none",
        }, "PALETTE_WORKSPACE_SURFACE_CHANGED");

        assert.deepEqual(await header.evaluate((element) => {
          const style = getComputedStyle(element);
          return { borderBottomColor: style.borderBottomColor, backgroundImage: style.backgroundImage };
        }), {
          borderBottomColor: "rgb(224, 225, 232)",
          backgroundImage: "none",
        }, "PALETTE_WORKSPACE_HEADER_CHANGED");

        assert.deepEqual(await brand.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, backgroundColor: style.backgroundColor, borderColor: style.borderColor };
        }), {
          color: "rgb(70, 12, 235)",
          backgroundColor: "rgb(242, 241, 255)",
          borderColor: "rgb(224, 225, 232)",
        }, "PALETTE_WORKSPACE_BRAND_CHANGED");

        if (await activeNav.count()) {
          assert.deepEqual(await activeNav.evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, backgroundColor: style.backgroundColor };
          }), {
            color: "rgb(70, 12, 235)",
            backgroundColor: "rgb(242, 241, 255)",
          }, "PALETTE_WORKSPACE_ACTIVE_NAV_CHANGED");
        }
        assert.deepEqual(await activeTab.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, backgroundColor: style.backgroundColor };
        }), {
          color: "rgb(70, 12, 235)",
          backgroundColor: "rgba(0, 0, 0, 0)",
        }, "PALETTE_WORKSPACE_ACTIVE_TAB_CHANGED");

        const primaryAction = main.getByRole("button", { name: "Создать задачу", exact: true });
        const assertPrimaryHover = async (theme) => {
          const initial = await primaryAction.evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, backgroundColor: style.backgroundColor };
          });
          await primaryAction.hover();
          await page.waitForTimeout(180);
          const hovered = await primaryAction.evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, backgroundColor: style.backgroundColor };
          });
          assert.notDeepEqual(hovered, initial, `BUTTON_HOVER_MUST_BE_VISIBLE_IN_${theme.toUpperCase()}`);
        };
        await assertPrimaryHover("light");

        const focusTarget = await activeNav.count()
          ? activeNav
          : header.getByRole("button", { name: /^Меню разделов/ });
        let reachedActiveNav = false;
        for (let step = 0; step < 12; step += 1) {
          await page.keyboard.press("Tab");
          if (await focusTarget.evaluate((element) => document.activeElement === element)) {
            reachedActiveNav = true;
            break;
          }
        }
        assert.equal(reachedActiveNav, true, "PALETTE_ACTIVE_NAV_NOT_REACHED_BY_KEYBOARD");
        assert.deepEqual(await focusTarget.evaluate((element) => {
          const style = getComputedStyle(element);
          return { outlineColor: style.outlineColor, outlineStyle: style.outlineStyle };
        }), {
          outlineColor: "rgb(100, 46, 255)",
          outlineStyle: "solid",
        }, "PALETTE_WORKSPACE_FOCUS_CHANGED");

        await page.evaluate(() => {
          document.body.style.minHeight = "1800px";
          window.scrollTo(0, 520);
        });
        await page.waitForTimeout(80);
        const stickyHeader = await header.boundingBox();
        assert.ok(stickyHeader && Math.abs(stickyHeader.y) <= 1, "WORKSPACE_HEADER_MUST_STAY_STICKY_WHILE_PAGE_SCROLLS");
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await assertPrimaryHover("dark");
        await page.evaluate(() => window.scrollTo(0, 520));
        await page.waitForTimeout(80);
        const darkHeader = await header.boundingBox();
        assert.ok(darkHeader && Math.abs(darkHeader.y) <= 1, "DARK_WORKSPACE_HEADER_MUST_STAY_STICKY_WHILE_PAGE_SCROLLS");
      } finally {
        await context.close();
      }
    });
  }
});

test("owner role badge uses established teal mapping", async () => {
  const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/interviews");
  try {
    await page.waitForURL("**/workspace/personal/interviews");
    const main = page.getByRole("main", { name: "Личный раздел: Интервью", exact: true });
    assert.equal(await main.count(), 1, "OWNER_BADGE_CANONICAL_LANDMARK_MISSING");

    const ownerRow = main.getByRole("row", { name: new RegExp(fixtures.ownedRoom.title) });
    assert.equal(await ownerRow.count(), 1, "OWNER_BADGE_ROW_NOT_UNIQUE");
    const ownerBadgeLabel = ownerRow.getByText("Владелец", { exact: true });
    assert.equal(await ownerBadgeLabel.count(), 1, "OWNER_ROLE_BADGE_NOT_UNIQUE");
    assert.deepEqual(await ownerBadgeLabel.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, backgroundColor: style.backgroundColor };
    }), {
      color: "rgb(6, 116, 58)",
      backgroundColor: "rgb(238, 254, 240)",
    }, "OWNER_ROLE_BADGE_PALETTE_CHANGED");
  } finally {
    await context.close();
  }
});

test("personal interview list combines owner and candidate memberships without candidate manager actions", async () => {
  const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/interviews");
  try {
    assertRoute(page, "/workspace/personal/interviews", "WORKSPACE_PERSONAL_INTERVIEW_LIST_ROUTE_MISSING");
    assert.equal(await page.getByRole("heading", { name: "Интервью", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /Создать интервью/ }).count(), 1);
    assert.equal(await page.getByText(fixtures.ownedRoom.title, { exact: true }).count(), 1);
    const candidateRow = page.getByRole("row", { name: new RegExp(fixtures.candidateRoom.title) });
    assert.equal(await candidateRow.count(), 1);
    assert.match(await candidateRow.innerText(), /Кандидат/);
    assert.equal(await candidateRow.getByRole("button", { name: /Удалить|Архивировать|Переименовать/ }).count(), 0);
  } finally {
    await context.close();
  }
});

test("empty personal interview list stays honest and still exposes creation", async () => {
  const { context, page } = await openAccount(fixtures.empty, "/workspace/personal/interviews");
  try {
    assertRoute(page, "/workspace/personal/interviews", "WORKSPACE_EMPTY_INTERVIEW_LIST_ROUTE_MISSING");
    assert.equal(await page.getByText("У вас пока нет интервью", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /Создать интервью/ }).count(), 1);
  } finally {
    await context.close();
  }
});

test("personal HR opt-in exposes candidates as a work section, not profile content", async () => {
  const { context, page } = await openAccount(fixtures.hr, "/workspace/personal/candidates");
  try {
    assertRoute(page, "/workspace/personal/candidates", "WORKSPACE_PERSONAL_CANDIDATES_ROUTE_MISSING");
    assert.equal(await page.getByRole("heading", { name: "Кандидаты", exact: true }).count(), 1);
    assert.equal(
      await page.getByText("Кандидаты по вашим интервью. Один кандидат может встречаться несколько раз", { exact: true }).count(),
      1,
    );
    assert.equal(await page.getByText("Евгения Константинопольская", { exact: true }).count(), 1);
    assert.equal(await page.getByText(fixtures.hrRoom.title, { exact: true }).count(), 1);
    assert.equal(await page.getByRole("checkbox", { name: "Я нанимающий", exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test("personal library keeps tasks and presets under Tasks and Sets tabs", async () => {
  const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/library");
  try {
    assertRoute(page, "/workspace/personal/library", "WORKSPACE_PERSONAL_LIBRARY_ROUTE_MISSING");
    assert.equal(await page.getByRole("tab", { name: "Задачи", exact: true }).count(), 1);
    assert.equal(await page.getByRole("tab", { name: "Наборы задач", exact: true }).count(), 1);
    await page.getByText(fixtures.task.title, { exact: true }).waitFor();
    assert.equal(await page.getByText(fixtures.task.title, { exact: true }).count(), 1);
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await page.getByText(fixtures.preset.name, { exact: true }).waitFor();
    assert.equal(await page.getByText(fixtures.preset.name, { exact: true }).count(), 1);
  } finally {
    await context.close();
  }
});

test("personal interview actions and library rows keep stable alignment", { timeout: 45_000 }, async () => {
  const actionColumnWidths = [];

  for (const [auth, isOwner] of [[fixtures.rolesOwner, true], [fixtures.interviewer, false]]) {
    const { context, page } = await openAccount(auth, "/workspace/personal/interviews");
    try {
      const row = page.getByRole("row", { name: new RegExp(fixtures.roleRoom.title) });
      await row.waitFor();
      const cells = row.locator("td");
      const titleCell = cells.first();
      const actionCell = cells.last();
      const rename = titleCell.getByRole("button", { name: `Переименовать интервью ${fixtures.roleRoom.title}`, exact: true });

      assert.equal(await rename.count(), isOwner ? 1 : 0, "RENAME_CONTROL_MUST_BE_NEXT_TO_TITLE");
      assert.doesNotMatch(await actionCell.innerText(), /Переименовать/, "RENAME_TEXT_MUST_NOT_TAKE_ACTION_COLUMN_SPACE");
      assert.equal(await actionCell.getByRole("button", { name: "Открыть интервью", exact: true }).count(), 1);

      const alignment = await actionCell.evaluate((cell) => {
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        const buttons = [...cell.querySelectorAll("button")];
        const finalButton = buttons.at(-1);
        const finalButtonRect = finalButton?.getBoundingClientRect();
        return {
          width: rect.width,
          rightInset: finalButtonRect ? rect.right - Number.parseFloat(style.paddingRight) - finalButtonRect.right : null,
        };
      });
      actionColumnWidths.push(alignment.width);
      assert.ok(alignment.rightInset !== null && Math.abs(alignment.rightInset) <= 2, "ACTION_GROUP_MUST_ALIGN_TO_RIGHT_CONTENT_EDGE");
    } finally {
      await context.close();
    }
  }

  assert.ok(Math.abs(actionColumnWidths[0] - actionColumnWidths[1]) <= 1, "ACTION_COLUMN_WIDTH_MUST_NOT_CHANGE_WITH_ROW_ROLE");

  const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/library");
  try {
    const taskCard = page.getByTestId("task-bank-panel").locator(".ant-card").filter({ hasText: fixtures.task.title }).first();
    await taskCard.waitFor();
    const cardBody = taskCard.locator(":scope > .ant-card-body");
    const detailLayout = await cardBody.evaluate((body) => {
      const details = body.firstElementChild?.firstElementChild;
      if (!details) return null;
      const style = getComputedStyle(details);
      return { display: style.display, rowGap: style.rowGap };
    });
    assert.ok(detailLayout, "PERSONAL_LIBRARY_TASK_DETAILS_MISSING");
    assert.equal(detailLayout.display, "grid", "PERSONAL_LIBRARY_TASK_TEXT_MUST_STACK_WITH_SPACING");
    assert.ok(Number.parseFloat(detailLayout.rowGap) >= 8, "PERSONAL_LIBRARY_TASK_TEXT_GAP_MUST_BE_VISIBLE");
    const taskTag = taskCard.locator(".ant-tag").first();
    const tagStyle = await taskTag.evaluate((tag) => ({ alignSelf: getComputedStyle(tag).alignSelf, height: tag.getBoundingClientRect().height }));
    assert.equal(tagStyle.alignSelf, "center", "PERSONAL_LIBRARY_BADGES_MUST_NOT_STRETCH_TO_ROW_HEIGHT");
    assert.ok(tagStyle.height < 36, `PERSONAL_LIBRARY_BADGE_HEIGHT_MUST_REMAIN_COMPACT:${tagStyle.height}`);
    const metrics = await cardBody.evaluate((body) => {
      const padding = getComputedStyle(body);
      const row = body.firstElementChild;
      const details = row?.firstElementChild;
      const actions = row?.lastElementChild;
      if (!row || !details || !actions) return null;
      const detailsRect = details.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      return {
        paddingLeft: Number.parseFloat(padding.paddingLeft),
        paddingRight: Number.parseFloat(padding.paddingRight),
        verticalCenterDelta: Math.abs((detailsRect.top + detailsRect.bottom) / 2 - (actionsRect.top + actionsRect.bottom) / 2),
        actionsRightInset: bodyRect.right - Number.parseFloat(padding.paddingRight) - actionsRect.right,
      };
    });
    assert.ok(metrics, "PERSONAL_TASK_ROW_CONTENT_MISSING");
    assert.ok(metrics.paddingLeft >= 16 && metrics.paddingRight >= 16, "PERSONAL_TASK_ROW_PADDING_MUST_REMAIN_VISIBLE");
    assert.ok(metrics.verticalCenterDelta <= 2, "PERSONAL_TASK_ACTIONS_MUST_BE_VERTICALLY_CENTERED");
    assert.ok(Math.abs(metrics.actionsRightInset) <= 2, "PERSONAL_TASK_ACTIONS_MUST_ALIGN_TO_RIGHT_EDGE");

    await page.setViewportSize({ width: 375, height: 812 });
    const narrowMetrics = await cardBody.evaluate((body) => {
      const row = body.firstElementChild;
      const actions = row?.lastElementChild;
      if (!actions) return null;
      const rect = actions.getBoundingClientRect();
      const buttons = [...actions.querySelectorAll("button, .ant-tag")].map((item) => item.getBoundingClientRect());
      const bodyRect = body.getBoundingClientRect();
      const paddingRight = Number.parseFloat(getComputedStyle(body).paddingRight);
      return {
        actionWidth: rect.width,
        contentRight: bodyRect.right - paddingRight,
        actionsRight: rect.right,
        itemRects: buttons.map((item) => ({ top: item.top, bottom: item.bottom })),
      };
    });
    assert.ok(narrowMetrics && narrowMetrics.actionWidth > 0, "NARROW_PERSONAL_TASK_ACTIONS_MISSING");
    assert.ok(narrowMetrics.actionsRight <= narrowMetrics.contentRight + 1, "NARROW_PERSONAL_TASK_ACTIONS_MUST_STAY_INSIDE_CARD");
    assert.ok(
      Math.min(...narrowMetrics.itemRects.map((item) => item.bottom)) > Math.max(...narrowMetrics.itemRects.map((item) => item.top)),
      "NARROW_PERSONAL_TASK_ACTIONS_MUST_WRAP_AS_ONE_GROUP",
    );
  } finally {
    await context.close();
  }
});

test("P1.4: personal task sets copy to clipboard and delete from the library UI", { timeout: 45_000 }, async () => {
  const auth = await account({ displayName: "Владелец наборов задач" });
  const task = await createTask(auth, `Задача для набора ${unique()}`, "kotlin");
  const preset = await createPreset(auth, `Набор lifecycle ${unique()}`, task.id);
  const { context, page } = await openAccount(auth, "/workspace/personal/library?tab=sets");
  try {
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const presetCard = page.getByTestId(`preset-card-${preset.id}`);
    await presetCard.waitFor();
    assert.equal(await page.getByRole("tab", { name: "Архив", exact: true }).count(), 0);

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await presetCard.getByRole("button", { name: "Копировать", exact: true }).click();
    const copied = await readCopiedLibraryData(page, (data) => data.kind === "task-set" && data.name === preset.name);
    assert.match(copied, new RegExp(preset.name));
    assert.match(copied, new RegExp(task.title));
    assert.equal(await page.getByText(`${preset.name} (копия)`, { exact: true }).count(), 0);

    const deleteResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/me/presets/${preset.id}` && response.request().method() === "DELETE" && response.status() === 200);
    await presetCard.getByRole("button", { name: `Удалить набор ${preset.name}`, exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить набор?", exact: true }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deleteResponse;
    await presetCard.waitFor({ state: "detached" });
  } finally {
    await context.close();
  }
});

test("library clipboard data transfers a task and set between accounts and into a team", { timeout: 90_000 }, async () => {
  const sender = await account({ displayName: "Автор материалов" });
  const receiver = await account({ displayName: "Получатель материалов" });
  const title = `Передаваемая задача ${unique()}`;
  const name = `Передаваемый набор ${unique()}`;
  const task = await createTask(sender, title, "kotlin");
  const preset = await createPreset(sender, name, task.id);
  const team = await createTeamApi(receiver, `Команда импорта ${unique()}`);
  const authorView = await openAccount(sender, "/workspace/personal/library", { permissions: ["clipboard-read", "clipboard-write"] });
  let taskData;
  let setData;
  try {
    await authorView.page.getByText(title, { exact: true }).waitFor();
    await authorView.page.getByRole("button", { name: "Копировать", exact: true }).click();
    await authorView.page.locator(".ant-notification-notice").filter({ hasText: "Скопировано" }).waitFor({ state: "visible" });
    assert.equal(
      await authorView.page.getByRole("status").filter({ hasText: "готова к передаче" }).count(),
      0,
      "CLIPBOARD_SUCCESS_MUST_NOT_BE_INSERTED_INTO_LIBRARY_FLOW",
    );
    taskData = await authorView.page.evaluate(() => navigator.clipboard.readText());
    assert.equal(JSON.parse(taskData).task.starterCode, "export function solve() { return 42; }");
    await authorView.page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const card = authorView.page.getByTestId(`preset-card-${preset.id}`);
    await card.getByRole("button", { name: "Копировать", exact: true }).click();
    setData = await readCopiedLibraryData(authorView.page, (data) => data.kind === "task-set" && data.name === preset.name && Array.isArray(data.tasks));
    assert.equal(JSON.parse(setData).tasks[0]?.description, "Условие личной задачи для проверки совместимости библиотеки");
  } finally {
    await authorView.context.close();
  }

  const receiverView = await openAccount(receiver, "/workspace/personal/library");
  try {
    await receiverView.page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const taskDialog = receiverView.page.getByRole("dialog", { name: "Импортировать задачу", exact: true });
    await taskDialog.getByLabel("Данные задачи", { exact: true }).fill(taskData);
    await taskDialog.getByRole("button", { name: "Импортировать задачу", exact: true }).click();
    await taskDialog.waitFor({ state: "hidden" });
    await receiverView.page.getByText(title, { exact: true }).waitFor();

    await receiverView.page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await receiverView.page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const setDialog = receiverView.page.getByRole("dialog", { name: "Импортировать набор", exact: true });
    await setDialog.getByLabel("Данные набора", { exact: true }).fill("123 1. CodeRun · Two Sum");
    await setDialog.getByRole("button", { name: "Импортировать набор", exact: true }).click();
    await setDialog.getByText(/Вставьте скопированные данные/).waitFor();
    await setDialog.getByLabel("Данные набора", { exact: true }).fill(setData);
    await setDialog.getByRole("button", { name: "Импортировать набор", exact: true }).click();
    await setDialog.waitFor({ state: "hidden" });
    await receiverView.page.getByText(name, { exact: true }).waitFor();
  } finally {
    await receiverView.context.close();
  }

  const teamView = await openAccount(receiver, `/workspace/teams/${team.id}/library`);
  try {
    await teamView.page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await teamView.page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const dialog = teamView.page.getByRole("dialog", { name: "Импортировать набор", exact: true });
    await dialog.getByLabel("Данные набора или ID личного набора", { exact: true }).fill(setData);
    await dialog.getByRole("button", { name: "Импортировать набор", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await teamView.page.getByRole("region", { name: `Командный набор ${name}`, exact: true }).waitFor();
  } finally {
    await teamView.context.close();
  }
});

test("workspace switcher stays compact and interview search remains wide", async () => {
  const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews");
  try {
    const switcher = page.getByRole("button", { name: /^Команды:/ });
    const searchBox = await page.getByLabel("Поиск интервью", { exact: true }).boundingBox();
    assert.ok(searchBox && searchBox.width >= 450, "INTERVIEW_SEARCH_TOO_NARROW");
    const switcherBox = await switcher.boundingBox();
    assert.ok(switcherBox && switcherBox.width < 300, "WORKSPACE_SWITCHER_TOO_WIDE");
    await switcher.click();
    const dialog = page.getByRole("menu", { name: "Выбор команды", exact: true });
    const activeColor = await dialog.getByRole("menuitemradio", { name: "Личное", exact: true }).evaluate((node) => getComputedStyle(node).backgroundColor);
    const createColor = await dialog.getByRole("menuitem", { name: "Создать команду", exact: true }).evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(activeColor, createColor, "CREATE_TEAM_BLEND_WITH_ACTIVE_WORKSPACE");
  } finally {
    await context.close();
  }
});

test("profile is a standalone account settings route", async () => {
  const { context, page } = await openAccount(fixtures.hr, "/profile");
  try {
    assertRoute(page, "/profile", "STANDALONE_PROFILE_ROUTE_MISSING");
    await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Профиль", exact: true }).count(), 1);
    assert.equal(await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).count(), 1);
    assert.equal(await page.getByText(/Кандидаты и Excel в команде доступны всем её участникам/).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "Кандидаты", exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test("profile link keeps the selected team workspace", async () => {
  const auth = await account({ displayName: "Участник команды" });
  const team = await createTeamApi(auth, `Профиль команды ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews`);
  try {
    await page.getByRole("link", { name: `Открыть профиль @${auth.user.nickname}` }).click();
    await page.waitForURL(`**/workspace/teams/${team.id}/profile`);
    await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
    assert.match(await page.getByRole("button", { name: /^Команды:/ }).innerText(), new RegExp(team.name));
    await page.reload();
    await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
    assertRoute(page, `/workspace/teams/${team.id}/profile`, "PROFILE_TEAM_CONTEXT_LOST_ON_RELOAD");
  } finally {
    await context.close();
  }
});

test("enabling hiring role shows earlier personal interviews under Candidates", async () => {
  const auth = await account({ isHr: false, displayName: "Автор интервью" });
  const room = await createRoom(auth, `Личное интервью ${unique()}`);
  const { context, page } = await openAccount(auth, "/profile");
  try {
    await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).click();
    await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).waitFor();
    await page.getByRole("link", { name: "Кандидаты", exact: true }).click();
    await page.waitForURL("**/workspace/personal/candidates");
    await page.getByText(room.title, { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("failed personal interview creation keeps scope and draft and creates no room", async () => {
  const title = `Черновик после серверной ошибки ${unique()}`;
  const before = await rawRoomSnapshot(fixtures.creator.token);
  const { context, page } = await openAccount(fixtures.creator, "/workspace/personal/interviews/new", {
    onPage: (openedPage) => openedPage.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Временно недоступно"}' });
    }),
  });
  try {
    assertRoute(page, "/workspace/personal/interviews/new", "WORKSPACE_PERSONAL_CREATE_ROUTE_MISSING");
    await page.getByRole("dialog", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
    await page.getByLabel("Название интервью", { exact: true }).fill(title);
    await page.getByRole("dialog", { name: "Создать интервью", exact: true })
      .getByRole("button", { name: "Создать интервью", exact: true }).click();
    assert.equal(await page.getByRole("alert").filter({ hasText: /Не удалось|Повтор/ }).count(), 1);
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), title);
    assert.equal(
      await page.getByRole("main", { name: "Личный раздел: Создать интервью", exact: true }).count(),
      1,
      "CREATE_SCOPE_MAIN_LANDMARK_MISSING",
    );
    const after = await rawRoomSnapshot(fixtures.creator.token);
    assert.equal(after.text, before.text, "FAILED_CREATE_CHANGED_ROOM_SNAPSHOT");
  } finally {
    await context.close();
  }
});

test("successful personal interview creation sends one POST and opens the new room", async () => {
  const title = `Новое личное интервью ${unique()}`;
  const before = await rawRoomSnapshot(fixtures.creator.token);
  let roomPosts = 0;
  const { context, page } = await openAccount(fixtures.creator, "/workspace/personal/interviews/new", {
    onPage: (openedPage) => openedPage.on("request", (browserRequest) => {
      if (browserRequest.method() === "POST" && new URL(browserRequest.url()).pathname === "/api/rooms") roomPosts += 1;
    }),
  });
  try {
    assertRoute(page, "/workspace/personal/interviews/new", "WORKSPACE_PERSONAL_CREATE_ROUTE_MISSING");
    await page.getByLabel("Название интервью", { exact: true }).fill(title);
    const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
    await page.getByRole("dialog", { name: "Создать интервью", exact: true })
      .getByRole("button", { name: "Создать интервью", exact: true }).click();
    const response = await createResponse;
    assert.equal(response.status(), 200, `PERSONAL_CREATE_FAILED:${await response.text()}`);
    const created = await response.json();
    await page.waitForURL(`**/room/${created.inviteCode}`);
    await page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute("data-state") === "online");
    assert.equal(roomPosts, 1, "CREATE_MUST_SEND_EXACTLY_ONE_ROOM_POST");
    const after = await rawRoomSnapshot(fixtures.creator.token);
    assert.equal(after.rooms.length, before.rooms.length + 1, "CREATE_MUST_ADD_EXACTLY_ONE_ROOM");
    assert.equal(after.rooms.filter((room) => room.title === title).length, 1);
  } finally {
    await context.close();
  }
});

const oldRoutes = [
  ["/dashboard", "/workspace/personal/interviews", "dashboard root"],
  ["/dashboard/rooms", "/workspace/personal/interviews", "interview list"],
  ["/dashboard/manage", "/workspace/personal/interviews", "managed rooms"],
  ["/dashboard/tasks?language=python", "/workspace/personal/library?language=python", "task library filter"],
  ["/dashboard/presets", "/workspace/personal/library?tab=sets", "preset sets"],
  ["/dashboard/hr", "/workspace/personal/candidates", "personal candidates"],
];

for (const [oldPath, expectedPath, label] of oldRoutes) {
  test(`old route mapping: ${label} ${oldPath} -> ${expectedPath} is read-only`, async () => {
    const auth = oldPath === "/dashboard/hr" ? fixtures.hr : fixtures.unified;
    const beforeRooms = await rawRoomSnapshot(auth.token);
    let mutations = 0;
    const { context, page } = await openAccount(auth, oldPath, {
      onPage: (openedPage) => openedPage.on("request", (browserRequest) => {
        if (unsafeMethods.has(browserRequest.method())) mutations += 1;
      }),
    });
    try {
      await settleApp(page);
      const afterRooms = await rawRoomSnapshot(auth.token);
      assert.equal(afterRooms.text, beforeRooms.text, `READ_ONLY_REDIRECT_CHANGED_ROOMS: ${oldPath}`);
      assert.equal(mutations, 0, `READ_ONLY_REDIRECT_SENT_${mutations}_MUTATIONS: ${oldPath}`);
      assertRoute(page, expectedPath, `OLD_ROUTE_MAPPING_MISSING: ${oldPath}`);
    } finally {
      await context.close();
    }
  });
}

test("ordinary and anonymous users retain service-route restrictions without mutations", async (t) => {
  await t.test("ordinary account cannot enter admin service screen", async () => {
    const beforeRooms = roomSnapshot(await request("/me/rooms", { token: fixtures.ordinary.token }));
    const { context, page } = await openAccount(fixtures.ordinary, "/dashboard/admin");
    try {
      await page.waitForURL("**/workspace/personal/interviews");
      await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
      assert.notEqual(pathnameAndSearch(page), "/dashboard/admin", "ORDINARY_ACCOUNT_ENTERED_ADMIN_SERVICE_SCREEN");
      assert.equal(await page.getByRole("heading", { name: /Администрирование/ }).count(), 0);
      assert.deepEqual(roomSnapshot(await request("/me/rooms", { token: fixtures.ordinary.token })), beforeRooms);
    } finally {
      await context.close();
    }
  });

  await t.test("anonymous account is sent to login from agent service screen", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${web}/dashboard/agents`, { waitUntil: "domcontentloaded" });
      await settleApp(page);
      await page.waitForURL("**/login");
      await page.getByRole("button", { name: "Войти в кабинет", exact: true }).waitFor();
      assertRoute(page, "/login", "ANONYMOUS_SERVICE_ROUTE_MUST_REQUIRE_LOGIN");
      assert.equal(await page.getByRole("button", { name: "Войти в кабинет", exact: true }).count(), 1);
    } finally {
      await context.close();
    }
  });

  await t.test("ordinary account cannot enter agent service screen", async () => {
    const before = await rawRoomSnapshot(fixtures.ordinary.token);
    const { context, page } = await openAccount(fixtures.ordinary, "/dashboard/agents");
    try {
      await page.waitForURL("**/workspace/personal/interviews");
      await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
      assert.notEqual(pathnameAndSearch(page), "/dashboard/agents", "ORDINARY_ACCOUNT_ENTERED_AGENT_SERVICE_SCREEN");
      assert.equal(await page.getByRole("heading", { name: /Агент-операции/ }).count(), 0);
      assert.equal((await rawRoomSnapshot(fixtures.ordinary.token)).text, before.text);
    } finally {
      await context.close();
    }
  });
});

const viewports = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 1024, height: 600 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
];
const zoomLevels = [100, 125, 150, 200];
const longInterviewName = "Собеседование ведущего разработчика распределённых систем и платформ совместной работы";
const longCandidateName = "Александра-Екатерина Константинопольская — кандидат с длинным русским именем для проверки переноса строк";

async function assertCreationFormLayout(page, baseViewport, zoom) {
  assertRoute(page, "/workspace/personal/interviews/new", "WORKSPACE_PERSONAL_CREATE_ROUTE_MISSING");
  await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Создать интервью", exact: true }).count(), 1);
  assert.equal(
    await page.getByRole("main", { name: "Личный раздел: Создать интервью", exact: true }).count(),
    1,
    "CREATE_SCOPE_MAIN_LANDMARK_MISSING",
  );

  const form = page.locator("form").first();
  assert.equal(await form.count(), 1, "CREATE_INTERVIEW_FORM_MISSING");
  const title = page.getByLabel("Название интервью", { exact: true });
  const candidate = page.getByLabel("Имя кандидата", { exact: true });
  const position = page.getByLabel("Позиция", { exact: true });
  const submit = page.getByRole("dialog", { name: "Создать интервью", exact: true })
    .getByRole("button", { name: "Создать интервью", exact: true });
  for (const control of [title, candidate, position, submit]) {
    assert.equal(await control.count(), 1, `CREATE_FORM_CONTROL_MISSING: ${await control.toString()}`);
  }

  await title.fill(longInterviewName);
  await candidate.fill(longCandidateName);
  await position.fill("Ведущий инженер клиентской платформы с ответственностью за доступность и надёжность интерфейса");

  let automaticMutations = 0;
  page.on("request", (browserRequest) => {
    if (unsafeMethods.has(browserRequest.method())) automaticMutations += 1;
  });
  const scale = zoom / 100;
  const effectiveViewport = {
    width: Math.max(320, Math.floor(baseViewport.width / scale)),
    height: Math.max(300, Math.floor(baseViewport.height / scale)),
  };
  await page.setViewportSize(effectiveViewport);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  assert.equal(await title.inputValue(), longInterviewName, "RESIZE_OR_ZOOM_LOST_TITLE_DRAFT");
  assert.equal(await candidate.inputValue(), longCandidateName, "RESIZE_OR_ZOOM_LOST_CANDIDATE_DRAFT");
  assert.equal(
    await page.getByRole("main", { name: "Личный раздел: Создать интервью", exact: true }).count(),
    1,
    "RESIZE_OR_ZOOM_CHANGED_SCOPE",
  );
  assert.equal(automaticMutations, 0, "RESIZE_OR_ZOOM_TRIGGERED_AUTOMATIC_MUTATION");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    geometry.scrollWidth <= geometry.clientWidth + 1,
    `HORIZONTAL_OVERFLOW: scrollWidth=${geometry.scrollWidth} clientWidth=${geometry.clientWidth}`,
  );

  await title.clear();
  await submit.click();
  const error = page.getByRole("alert").filter({ hasText: /Название интервью обязательно/ });
  assert.equal(await error.count(), 1, "LOCAL_TITLE_ERROR_MISSING");
  assert.equal(automaticMutations, 0, "INVALID_LOCAL_FORM_SENT_MUTATION");

  await title.fill(longInterviewName);
  await title.focus();
  let reachedSubmit = false;
  let visibleFocusObserved = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    const focusState = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return { submit: false, visible: false };
      const style = getComputedStyle(active);
      return {
        submit: active instanceof HTMLButtonElement && active.textContent?.trim() === "Создать интервью",
        visible: style.outlineStyle !== "none" || (style.boxShadow !== "none" && style.boxShadow !== ""),
      };
    });
    visibleFocusObserved ||= focusState.visible;
    if (focusState.submit) {
      reachedSubmit = true;
      break;
    }
  }
  assert.equal(reachedSubmit, true, "KEYBOARD_COULD_NOT_REACH_PRIMARY_SUBMIT");
  assert.equal(visibleFocusObserved, true, "KEYBOARD_FOCUS_NOT_VISIBLE");

  const lastField = form.locator("input, textarea, select").last();
  for (const target of [lastField, error, submit]) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    assert.ok(box, "LAST_FIELD_ERROR_OR_SUBMIT_NOT_RENDERED");
    assert.ok(box.y + box.height > 0 && box.y < effectiveViewport.height, "LAST_FIELD_ERROR_OR_SUBMIT_UNREACHABLE");
  }
  const submitBox = await submit.boundingBox();
  assert.ok(submitBox.width >= 44 && submitBox.height >= 44, `PRIMARY_TARGET_TOO_SMALL: ${JSON.stringify(submitBox)}`);
  const submitIsTopmost = await submit.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return topmost === element || Boolean(topmost && element.contains(topmost));
  });
  assert.equal(submitIsTopmost, true, "PRIMARY_SUBMIT_OVERLAPPED");
}

for (const viewport of viewports) {
  for (const zoom of zoomLevels) {
    test(`create form layout ${viewport.width}x${viewport.height} at ${zoom}% zoom`, { timeout: 30000 }, async () => {
      const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/interviews/new", { viewport });
      try {
        await assertCreationFormLayout(page, viewport, zoom);
      } finally {
        await context.close();
      }
    });
  }
}

test("remediation: primary navigation keeps one row and exposes complete overflow links by keyboard", { timeout: 30_000 }, async () => {
  const { context, page } = await openAccount(fixtures.hr, "/workspace/personal/interviews", {
    viewport: { width: 768, height: 1024 },
  });
  try {
    const nav = page.getByRole("navigation", { name: "Разделы личного раздела", exact: true });
    await nav.waitFor();
    const constrained = await page.addStyleTag({
      content: '[aria-label="Разделы личного раздела"]{width:300px!important;flex:0 0 300px!important}',
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const overflow = nav.getByRole("button", { name: /^Меню разделов/ });
    assert.equal(await overflow.count(), 1, "WORKSPACE_NAV_NAMED_OVERFLOW_CONTROL_MISSING");
    assert.equal(await overflow.getAttribute("aria-haspopup"), "menu", "WORKSPACE_NAV_OVERFLOW_MENU_SEMANTICS_MISSING");
    const directRows = await nav.locator("a, button").evaluateAll((elements) => (
      [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))]
    ));
    assert.equal(directRows.length, 1, `WORKSPACE_NAV_WRAPPED_TO_MULTIPLE_ROWS:${JSON.stringify(directRows)}`);
    const pageGeometry = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(pageGeometry.scrollWidth <= pageGeometry.clientWidth + 1, `WORKSPACE_NAV_PAGE_HORIZONTAL_OVERFLOW:${JSON.stringify(pageGeometry)}`);

    const normalStyle = await overflow.evaluate((element) => ({
      color: getComputedStyle(element).color,
      borderWidth: getComputedStyle(element).borderWidth,
    }));
    await overflow.hover();
    await page.waitForTimeout(200);
    const hoverBefore = await overflow.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color, borderColor: style.borderColor, borderWidth: style.borderWidth, hovered: element.matches(":hover") };
    });
    await page.waitForTimeout(500);
    const hoverAfter = await overflow.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color, borderColor: style.borderColor, borderWidth: style.borderWidth, hovered: element.matches(":hover") };
    });
    assert.equal(hoverBefore.hovered, true, `WORKSPACE_NAV_POINTER_MUST_REMAIN_OVER_TRIGGER:${JSON.stringify(hoverBefore)}`);
    assert.equal(hoverBefore.color, normalStyle.color, "WORKSPACE_NAV_HOVER_MUST_KEEP_BUTTON_COLOR");
    assert.equal(hoverBefore.borderWidth, "0px", "WORKSPACE_NAV_HOVER_MUST_NOT_FLASH_A_BORDER");
    assert.deepEqual(hoverAfter, hoverBefore, "WORKSPACE_NAV_HOVER_MUST_REMAIN_STABLE_WHILE_POINTER_STAYS");

    await overflow.focus();
    await overflow.press("Enter");
    assert.equal(await overflow.getAttribute("aria-expanded"), "true", "WORKSPACE_NAV_KEYBOARD_DID_NOT_OPEN_OVERFLOW");
    const menu = page.locator('[role="menu"][aria-label="Дополнительные разделы"]');
    await menu.waitFor({ state: "attached" });
    assert.notEqual(await menu.evaluate((element) => getComputedStyle(element).display), "none", "WORKSPACE_NAV_OVERFLOW_MENU_HIDDEN_AFTER_KEYBOARD_OPEN");
    const availableNames = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.textContent?.trim()));
    const overflowNames = await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
    assert.deepEqual(
      [...availableNames, ...overflowNames].sort(),
      ["Интервью", "Библиотека", "Кандидаты"].sort(),
      "WORKSPACE_NAV_LINKS_LOST_FROM_DIRECT_OR_OVERFLOW",
    );
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Меню разделов"));
    assert.equal(await overflow.evaluate((element) => document.activeElement === element), true, "WORKSPACE_NAV_OVERFLOW_ESCAPE_FOCUS_NOT_RETURNED");
    const switcherCount = await page.getByRole("button", { name: /^Команды:/ }).count();
    assert.equal(switcherCount, 1, "WORKSPACE_NAV_SWITCHER_MISSING");
    await constrained.evaluate((element) => element.remove());
  } finally {
    await context.close();
  }
});

test("remediation: pending menu focus cannot outlive fast Escape, later Tab or a new open", { timeout: 30_000 }, async () => {
  const { context, page } = await openAccount(fixtures.hr, "/workspace/personal/interviews", {
    viewport: { width: 768, height: 1024 },
  });
  try {
    const nav = page.getByRole("navigation", { name: "Разделы личного раздела", exact: true });
    await page.addStyleTag({ content: '[aria-label="Разделы личного раздела"]{width:300px!important;flex:0 0 300px!important}' });
    const overflow = nav.getByRole("button", { name: /^Меню разделов/ });
    await overflow.waitFor();
    await overflow.focus();
    await page.keyboard.press("Shift+Tab");
    const previousTarget = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") }));
    assert.notEqual(await overflow.evaluate(element => document.activeElement === element), true, "SHIFT_TAB_DID_NOT_MOVE_TO_PREVIOUS_CONTROL");
    await overflow.focus();
    await page.evaluate(() => {
      const nativeFrame = window.requestAnimationFrame, nativeCancel = window.cancelAnimationFrame;
      const pending = new Map();
      let sequence = 0;
      window.requestAnimationFrame = callback => { const id = --sequence; pending.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { if (!pending.delete(id)) nativeCancel.call(window, id); };
      window.__navigationFrames = {
        advance(count) {
          for (let frame = 0; frame < count; frame++) {
            const callbacks = [...pending.values()]; pending.clear();
            callbacks.forEach(callback => callback(performance.now()));
          }
        },
        restore() { pending.clear(); window.requestAnimationFrame = nativeFrame; window.cancelAnimationFrame = nativeCancel; },
      };
    });
    const menu = page.locator('[role="menu"][aria-label="Дополнительные разделы"]');
    await overflow.press("Enter");
    await menu.waitFor({ state: "attached" });
    assert.equal(await overflow.getAttribute("aria-expanded"), "true");
    // Native keys run before any pending animation-frame autofocus can execute.
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await overflow.evaluate(element => document.activeElement === element), true, "CLOSED_MENU_STOLE_ESCAPE_FOCUS");

    await overflow.press("Enter");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const nextTarget = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") }));
    assert.notEqual(await overflow.evaluate(element => document.activeElement === element), true, "TAB_DID_NOT_MOVE_TO_NEXT_CONTROL");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") })), nextTarget, "CLOSED_MENU_OVERRODE_LATER_TAB_INTENT");

    await overflow.focus();
    await overflow.press("Enter");
    await page.keyboard.press("Escape");
    await overflow.press("Enter");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await overflow.getAttribute("aria-expanded"), "true", "OLD_CLOSE_CANCELLED_NEW_OPEN");
    assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, "NEW_OPEN_DID_NOT_FOCUS_ITS_MENU");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await overflow.evaluate(element => document.activeElement === element), true, "FOCUSED_MENU_ESCAPE_DID_NOT_RETURN_FOCUS");
    await overflow.press("Enter");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, "TAB_STARTS_FROM_FOCUSED_MENU");
    await page.keyboard.press("Tab");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await overflow.getAttribute("aria-expanded"), "false", "MENU_TAB_DID_NOT_CLOSE_MENU");
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") })), nextTarget, "MENU_TAB_DID_NOT_REACH_NEXT_NATIVE_CONTROL");
    await overflow.focus();
    await overflow.press("Enter");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, "SHIFT_TAB_STARTS_FROM_FOCUSED_MENU");
    await page.keyboard.press("Shift+Tab");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    assert.equal(await overflow.getAttribute("aria-expanded"), "false", "MENU_SHIFT_TAB_DID_NOT_CLOSE_MENU");
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") })), previousTarget, "MENU_SHIFT_TAB_DID_NOT_REACH_PREVIOUS_NATIVE_CONTROL");
    for (const key of ["ArrowDown", "Home", "End"]) {
      await overflow.focus();
      await overflow.press("Enter");
      await page.evaluate(() => window.__navigationFrames.advance(8));
      assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, `${key}_STARTS_FROM_FOCUSED_MENU`);
      await page.keyboard.press(key);
      await page.keyboard.press("Escape");
      if (key !== "ArrowDown") await page.keyboard.press("Tab");
      await page.evaluate(() => window.__navigationFrames.advance(8));
      if (key === "ArrowDown") {
        assert.equal(await overflow.evaluate(element => document.activeElement === element), true, "CLOSED_MENU_ARROW_FOCUS_OVERRODE_ESCAPE");
      } else {
        assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, href: document.activeElement?.getAttribute("href") })), nextTarget, `CLOSED_MENU_${key}_FOCUS_OVERRODE_LATER_TAB`);
      }
      await overflow.focus();
      await overflow.press("Enter");
      await page.evaluate(() => window.__navigationFrames.advance(8));
      const initialLabel = await menu.evaluate(element => {
        window.__retiredNavigationMenu = element;
        return document.activeElement?.textContent;
      });
      await page.keyboard.press(key);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => window.__retiredNavigationMenu.inert), true, `${key}_RETAINED_CLOSING_MENU_MUST_BE_INERT`);
      await overflow.press("Enter");
      assert.equal(await page.evaluate(() => window.__retiredNavigationMenu.isConnected), false, `${key}_OLD_NATIVE_MENU_GENERATION_MUST_BE_DETACHED`);
      assert.equal(await menu.evaluate(element => element !== window.__retiredNavigationMenu && !element.inert), true, `${key}_REOPEN_MUST_HAVE_A_NEW_ACTIVE_MENU_GENERATION`);
      await page.evaluate(() => window.__navigationFrames.advance(8));
      assert.equal(await overflow.getAttribute("aria-expanded"), "true", `${key}_OLD_FOCUS_CANCELLED_NEW_OPEN`);
      assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true, `${key}_NEW_OPEN_DID_NOT_FOCUS_CURRENT_MENU`);
      assert.equal(await menu.evaluate(element => document.activeElement?.textContent), initialLabel, `${key}_OLD_NAVIGATION_FOCUS_LEAKED_INTO_NEW_OPEN`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.__navigationFrames.advance(8));
    }
    await overflow.focus();
    await overflow.press("Enter");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__navigationFrames.advance(8));
    await page.evaluate(() => window.__navigationFrames.restore());
    await menu.waitFor({ state: "hidden" });
    assert.equal(await overflow.evaluate(element => document.activeElement === element), true, "FINAL_ESCAPE_FOCUS_NOT_RETURNED");
  } finally {
    await page.evaluate(() => window.__navigationFrames?.restore()).catch(() => {});
    await context.close();
  }
});

async function assertActiveOverflowNavigation({ auth, path, navigationName, activeLabel }) {
  const expectedRoute = path;
  const { context, page } = await openAccount(auth, path, {
    viewport: { width: 768, height: 1024 },
  });
  try {
    const nav = page.getByRole("navigation", { name: navigationName, exact: true });
    await nav.waitFor();
    const constrained = await page.addStyleTag({
      content: `[aria-label="${navigationName}"]{width:300px!important;flex:0 0 300px!important}`,
    });
    await page.setViewportSize({ width: 384, height: 512 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const trigger = nav.getByRole("button", { name: /^Меню разделов/ });
    assert.equal(await trigger.count(), 1, "WORKSPACE_NAV_ACTIVE_OVERFLOW_TRIGGER_FULL_LABEL_MISSING");
    assert.equal(await trigger.getAttribute("aria-haspopup"), "menu", "WORKSPACE_NAV_ACTIVE_OVERFLOW_TRIGGER_MENU_SEMANTICS_MISSING");
    assertRoute(page, expectedRoute, "WORKSPACE_NAV_ACTIVE_OVERFLOW_ROUTE_CHANGED_BEFORE_OPEN");

    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.locator('[role="menu"][aria-label="Дополнительные разделы"]');
    await menu.waitFor({ state: "visible" });
    const activeItem = menu.getByRole("menuitem", { name: activeLabel, exact: true });
    assert.equal(await activeItem.count(), 1, "WORKSPACE_NAV_ACTIVE_OVERFLOW_MENU_ITEM_MISSING");
    assert.equal(await activeItem.getAttribute("aria-current"), "page", "WORKSPACE_NAV_ACTIVE_OVERFLOW_MENU_ITEM_NOT_CURRENT");
    const currentItems = page.locator('[aria-current="page"]');
    assert.equal(await currentItems.count(), 1, "WORKSPACE_NAV_ACTIVE_OVERFLOW_MULTIPLE_CURRENT_ITEMS");
    assert.equal(await currentItems.first().innerText(), activeLabel, "WORKSPACE_NAV_ACTIVE_OVERFLOW_CURRENT_ITEM_WRONG");

    const inactiveItem = menu.getByRole("menuitem").filter({ hasNotText: activeLabel }).first();
    const activeStyle = await activeItem.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });
    if (await inactiveItem.count()) {
      const inactiveStyle = await inactiveItem.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      });
      assert.notDeepEqual(activeStyle, inactiveStyle, "WORKSPACE_NAV_ACTIVE_OVERFLOW_CURRENT_STYLE_NOT_DISTINCT");
    } else {
      assert.notEqual(activeStyle.backgroundColor, "rgba(0, 0, 0, 0)", "WORKSPACE_NAV_ACTIVE_OVERFLOW_CURRENT_STYLE_NOT_DISTINCT");
    }

    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "WORKSPACE_NAV_ACTIVE_OVERFLOW_ESCAPE_FOCUS_NOT_RETURNED");
    assertRoute(page, expectedRoute, "WORKSPACE_NAV_ACTIVE_OVERFLOW_ROUTE_CHANGED_AFTER_ESCAPE");
    assert.equal(
      await page.getByRole("button", { name: /^Команды:/ }).count(),
      1,
      "WORKSPACE_NAV_ACTIVE_OVERFLOW_SWITCHER_MISSING",
    );
    await constrained.evaluate((element) => element.remove());
  } finally {
    await context.close();
  }
}

test("remediation: active personal candidates section in overflow keeps its current state", { timeout: 30_000 }, async () => {
  await assertActiveOverflowNavigation({
    auth: fixtures.hr,
    path: "/workspace/personal/candidates",
    navigationName: "Разделы личного раздела",
    activeLabel: "Кандидаты",
  });
});

test("remediation: active team settings uses its own gear outside navigation overflow", { timeout: 30_000 }, async () => {
  const team = await createTeamApi(fixtures.hr, `Команда активного раздела ${unique()}`);
  const { context, page } = await openAccount(fixtures.hr, `/workspace/teams/${team.id}/settings`);
  try {
    await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
    const gear = page.getByRole("link", { name: "Настройки команды", exact: true });
    assert.equal(await gear.getAttribute("aria-current"), "page");
    assert.equal(await page.getByRole("navigation", { name: "Разделы команды", exact: true }).getByRole("link", { name: "Настройки команды", exact: true }).count(), 0);
  } finally { await context.close(); }
});

test("remediation: workspace create surface renders the current account identity exactly once", async () => {
  const { context, page } = await openAccount(fixtures.creator, "/workspace/personal/interviews/new");
  try {
    await page.getByText(`@${fixtures.creator.user.nickname}`, { exact: true }).waitFor();
    assert.equal(
      await page.getByText(`@${fixtures.creator.user.nickname}`, { exact: true }).count(),
      1,
      "WORKSPACE_ACCOUNT_IDENTITY_DUPLICATED",
    );
  } finally {
    await context.close();
  }
});

test("remediation: distinct owner interviewer and candidate rows expose permitted actions and open safely", async () => {
  const roleCases = [
    [fixtures.rolesOwner, "Владелец", true],
    [fixtures.interviewer, "Интервьюер", false],
    [fixtures.candidate, "Кандидат", false],
  ];

  for (const [auth, roleLabel, canManage] of roleCases) {
    const { context, page } = await openAccount(auth, "/workspace/personal/interviews");
    try {
      const row = page.getByRole("row", { name: new RegExp(fixtures.roleRoom.title) });
      assert.equal(await row.count(), 1, `ROLE_ROW_MISSING: ${roleLabel}`);
      assert.equal(await row.getByText(roleLabel, { exact: true }).count(), 1, `ROLE_LABEL_MISSING: ${roleLabel}`);
      assert.equal(
        await row.getByRole("button", { name: new RegExp(`Переименовать интервью ${fixtures.roleRoom.title}`) }).count(),
        canManage ? 1 : 0,
        `ROLE_RENAME_POLICY_WRONG: ${roleLabel}`,
      );
      assert.equal(
        await row.getByRole("button", { name: new RegExp(`Удалить ${fixtures.roleRoom.title}`) }).count(),
        canManage ? 1 : 0,
        `ROLE_DELETE_POLICY_WRONG: ${roleLabel}`,
      );
      const open = row.getByRole("button", { name: "Открыть интервью", exact: true });
      assert.equal(await open.count(), 1, `ROLE_PRIMARY_ACTION_MISSING: ${roleLabel}`);
      await open.click();
      assertRoute(page, `/room/${fixtures.roleRoom.inviteCode}`, `ROLE_ROOM_DID_NOT_OPEN: ${roleLabel}`);
    } finally {
      await context.close();
    }
  }

  const renamedTitle = `Переименованное ролевое интервью ${unique()}`;
  let renameMutations = 0;
  const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews", {
    onPage: (openedPage) => openedPage.on("request", (browserRequest) => {
      const requestUrl = new URL(browserRequest.url());
      if (browserRequest.method() === "PATCH" && requestUrl.pathname === `/api/me/rooms/${fixtures.roleRoom.id}`) {
        renameMutations += 1;
      }
    }),
  });
  try {
    const row = page.getByRole("row", { name: new RegExp(fixtures.roleRoom.title) });
    await row.getByRole("button", { name: `Переименовать интервью ${fixtures.roleRoom.title}`, exact: true }).click();
    const renameDialog = page.getByRole("dialog", { name: "Переименовать интервью", exact: true });
    const input = renameDialog.getByLabel("Название интервью", { exact: true });
    assert.equal(await input.count(), 1, "OWNER_RENAME_INPUT_MISSING");
    await input.fill(renamedTitle);
    await renameDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await renameDialog.waitFor({ state: "hidden" });
    assert.equal(renameMutations, 1, `OWNER_RENAME_MUTATION_COUNT: ${renameMutations}`);
    assert.equal(await row.getByText(renamedTitle, { exact: true }).count(), 1, "OWNER_RENAME_RESULT_MISSING");
    fixtures.roleRoom.title = renamedTitle;
  } finally {
    await context.close();
  }
});

test("remediation-2: owner deletion requires confirmation, cancel is inert, confirm sends one DELETE", async () => {
  let deletes = 0;
  const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews", {
    onPage: (openedPage) => openedPage.on("request", (browserRequest) => {
      if (browserRequest.method() === "DELETE" && new URL(browserRequest.url()).pathname === `/api/me/rooms/${fixtures.deletableRoom.id}`) deletes += 1;
    }),
  });
  try {
    const row = page.getByRole("row", { name: new RegExp(fixtures.deletableRoom.title) });
    await row.getByRole("button", { name: `Удалить ${fixtures.deletableRoom.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Удалить интервью", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1, "DELETE_CONFIRMATION_MISSING");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(deletes, 0, "DELETE_CANCEL_SENT_MUTATION");
    assert.equal(await row.count(), 1, "DELETE_CANCEL_REMOVED_ROW");

    await row.getByRole("button", { name: `Удалить ${fixtures.deletableRoom.title}`, exact: true }).click();
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().endsWith(`/api/me/rooms/${fixtures.deletableRoom.id}`));
    await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await deleted;
    await row.waitFor({ state: "hidden" });
    assert.equal(deletes, 1, `OWNER_DELETE_MUTATION_COUNT: ${deletes}`);
    assert.equal(await row.count(), 0, "DELETED_ROW_REMAINS_VISIBLE");
    const snapshot = await rawRoomSnapshot(fixtures.rolesOwner.token);
    assert.equal(snapshot.rooms.some((room) => room.id === fixtures.deletableRoom.id), false, "DELETED_ROOM_REMAINS_IN_API");
  } finally {
    await context.close();
  }
});

test("remediation-2: library language query is normalized, filters real tasks, and resets filter-empty", async () => {
  const { context, page } = await openAccount(fixtures.unified, "/dashboard/tasks?language=PYTHON");
  try {
    assertRoute(page, "/workspace/personal/library?language=python", "LANGUAGE_QUERY_NOT_NORMALIZED");
    assert.equal(await page.getByText(fixtures.pythonTask.title, { exact: true }).count(), 1, "PYTHON_TASK_MISSING");
    assert.equal(await page.getByText(fixtures.task.title, { exact: true }).count(), 0, "NODE_TASK_NOT_FILTERED");
    await page.getByRole("combobox", { name: "Язык задач", exact: true }).click();
    const languageOptions = page.locator(".ant-select-dropdown:visible").last();
    await languageOptions.waitFor({ state: "visible" });
    await languageOptions.locator(".ant-select-item-option").filter({ hasText: /^SQL$/ }).click();
    assert.equal(await page.getByText("Для выбранного языка задач нет", { exact: true }).count(), 1, "LANGUAGE_FILTER_EMPTY_MISSING");
    assert.equal(await page.getByText("В библиотеке пока нет задач", { exact: true }).count(), 0, "FILTER_EMPTY_COLLAPSED_TO_LIBRARY_EMPTY");
    await page.getByRole("button", { name: "Сбросить фильтр", exact: true }).click();
    assert.equal(await page.getByText(fixtures.pythonTask.title, { exact: true }).count(), 1, "PYTHON_TASK_MISSING_AFTER_RESET");
    assert.equal(await page.getByText(fixtures.task.title, { exact: true }).count(), 1, "NODE_TASK_MISSING_AFTER_RESET");
    assertRoute(page, "/workspace/personal/library", "LANGUAGE_FILTER_QUERY_NOT_RESET");
  } finally {
    await context.close();
  }
});

for (const entry of ["/workspace/personal/interviews/new"]) {
  test(`remediation-2: ${entry} exposes one canonical create form and no profile or legacy aliases`, async () => {
    const { context, page } = await openAccount(fixtures.hr, entry);
    try {
      assertRoute(page, "/workspace/personal/interviews/new", `CREATE_ENTRY_NOT_CANONICAL: ${entry}`);
      await page.getByTestId("create-room-card").waitFor();
      assert.equal(await page.getByTestId("create-room-card").count(), 1, "CREATE_SURFACE_COUNT_WRONG");
      assert.equal(await page.getByLabel("Название интервью", { exact: true }).count(), 1, "CREATE_FORM_COUNT_WRONG");
      assert.equal(await page.getByRole("checkbox", { name: "Я нанимающий", exact: true }).count(), 0, "PROFILE_LEAKED_INTO_CREATE");
      for (const alias of ["Комнаты", "Кабинет нанимающего"]) {
        assert.equal(await page.getByText(alias, { exact: true }).count(), 0, `LEGACY_ALIAS_VISIBLE: ${alias}`);
      }
      assert.equal(await page.getByRole("heading", { name: "Кандидаты", exact: true }).count(), 0, "CANDIDATES_DUPLICATED_ON_CREATE");
    } finally {
      await context.close();
    }
  });
}

test("remediation-2 identity fence: delayed profile PATCH from account A cannot alter account B", { timeout: 30000 }, async () => {
  const accountA = await account({ isHr: true, displayName: `Профиль A ${unique()}` });
  const accountB = await account({ isHr: false, displayName: `Профиль B ${unique()}` });
  let releasePatch;
  const patchRelease = new Promise((resolve) => { releasePatch = resolve; });
  let signalPatch;
  const patchStarted = new Promise((resolve) => { signalPatch = resolve; });
  let signalPatchFinished;
  const patchFinished = new Promise((resolve) => { signalPatchFinished = resolve; });
  const { context, page } = await openAccount(accountA, "/workspace/personal/interviews", {
    onPage: (openedPage) => openedPage.route("**/api/me/profile", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      signalPatch();
      await patchRelease;
      try {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...accountA.user, displayName: "Старый ответ A", isHr: false }) });
      } finally {
        signalPatchFinished();
      }
    }),
  });
  try {
    await page.getByRole("link", { name: `Открыть профиль @${accountA.user.nickname}` }).click();
    await page.waitForURL("**/profile");
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    await page.getByLabel("Имя для отображения", { exact: true }).fill("Черновик профиля A");
    await page.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await patchStarted;
    await page.goBack();
    await page.waitForURL("**/workspace/personal/interviews");
    await logoutAndLogin(page, accountB);
    await page.getByRole("link", { name: `Открыть профиль @${accountB.user.nickname}` }).click();
    await page.waitForURL("**/profile");
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    await page.getByLabel("Имя для отображения", { exact: true }).waitFor();
    releasePatch();
    await patchFinished;
    assertRoute(page, "/profile", "STALE_PROFILE_PATCH_CHANGED_B_ROUTE");
    assert.equal(await page.getByText(`@${accountB.user.nickname}`, { exact: true }).count(), 1, "STALE_PROFILE_PATCH_CHANGED_B_IDENTITY");
    assert.equal(await page.getByLabel("Имя для отображения", { exact: true }).inputValue(), accountB.user.displayName, "STALE_PROFILE_PATCH_CHANGED_B_NAME");
    await page.getByRole("dialog", { name: "Изменить имя", exact: true }).getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).isChecked(), false, "STALE_PROFILE_PATCH_CHANGED_B_CAPABILITY");
    assert.equal(await page.getByText("Имя сохранено", { exact: true }).count(), 0, "STALE_PROFILE_PATCH_NOTIFIED_B");
  } finally {
    await context.close();
  }
});

test("remediation-2 identity fence: delayed room POST from account A cannot leak into account B", { timeout: 30000 }, async () => {
  const accountA = await account({ displayName: `Создатель A ${unique()}` });
  const accountB = await account({ displayName: `Создатель B ${unique()}` });
  const title = `Отложенное интервью A ${unique()}`;
  const beforeB = await rawRoomSnapshot(accountB.token);
  const delayedInviteCode = `late${unique()}`.slice(0, 16);
  let releasePost;
  const postRelease = new Promise((resolve) => { releasePost = resolve; });
  let signalPost;
  const postStarted = new Promise((resolve) => { signalPost = resolve; });
  let signalPostFinished;
  const postFinished = new Promise((resolve) => { signalPostFinished = resolve; });
  const { context, page } = await openAccount(accountA, "/workspace/personal/interviews/new", {
    onPage: (openedPage) => openedPage.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      signalPost();
      await postRelease;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: crypto.randomUUID(), inviteCode: delayedInviteCode, ownerToken: "late-owner-token", title, language: "nodejs", taskIds: [] }),
        });
      } catch {
        // Resetting the old account may cancel the request before its delayed response is released.
      } finally {
        signalPostFinished();
      }
    }),
  });
  try {
    await page.getByLabel("Название интервью", { exact: true }).fill(title);
    await page.getByRole("dialog", { name: "Создать интервью", exact: true })
      .getByRole("button", { name: "Создать интервью", exact: true }).click();
    await postStarted;
    await logoutAndLogin(page, accountB);
    assertRoute(page, "/workspace/personal/interviews", "B_ROUTE_NOT_READY_BEFORE_STALE_ROOM_RELEASE");
    assert.equal(await page.getByRole("heading", { name: "Интервью", exact: true }).count(), 1, "B_INTERVIEW_LIST_NOT_READY_BEFORE_STALE_ROOM_RELEASE");
    releasePost();
    await postFinished;
    await settleApp(page);
    assertRoute(page, "/workspace/personal/interviews", "STALE_ROOM_POST_NAVIGATED_B");
    assert.equal(await page.getByText(`@${accountB.user.nickname}`, { exact: true }).count(), 1, "STALE_ROOM_POST_CHANGED_B_IDENTITY");
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).count(), 0, "STALE_ROOM_POST_LEAKED_A_DRAFT");
    assert.equal(await page.evaluate((inviteCode) => localStorage.getItem(`owner_token_${inviteCode}`), delayedInviteCode), null, "STALE_ROOM_POST_LEAKED_A_OWNER_TOKEN");
    assert.equal((await rawRoomSnapshot(accountB.token)).text, beforeB.text, "STALE_ROOM_POST_CHANGED_B_ROOM_SNAPSHOT");
  } finally {
    await context.close();
  }
});

test("remediation-2 identity fence: delayed metadata retry from account A cannot navigate or notify account B", { timeout: 30000 }, async () => {
  const accountA = await account({ displayName: `Метаданные A ${unique()}` });
  const accountB = await account({ displayName: `Метаданные B ${unique()}` });
  const title = `Метаданные A ${unique()}`;
  const beforeB = await rawRoomSnapshot(accountB.token);
  let roomPosts = 0;
  let metadataPuts = 0;
  let releaseRetry;
  const retryRelease = new Promise((resolve) => { releaseRetry = resolve; });
  let signalRetry;
  const retryStarted = new Promise((resolve) => { signalRetry = resolve; });
  let signalRetryFinished;
  const retryFinished = new Promise((resolve) => { signalRetryFinished = resolve; });
  const { context, page } = await openAccount(accountA, "/workspace/personal/interviews/new", {
    onPage: (openedPage) => {
      openedPage.on("request", (browserRequest) => {
        if (browserRequest.method() === "POST" && new URL(browserRequest.url()).pathname === "/api/rooms") roomPosts += 1;
      });
      void openedPage.route("**/api/rooms/*/interview-metadata", async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        metadataPuts += 1;
        if (metadataPuts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' });
        signalRetry();
        await retryRelease;
        try {
          await route.continue();
        } catch {
          // Resetting the old account may cancel its delayed retry.
        } finally {
          signalRetryFinished();
        }
      });
    },
  });
  try {
    await page.getByLabel("Название интервью", { exact: true }).fill(title);
    await page.getByLabel("Имя кандидата", { exact: true }).fill("Кандидат A");
    await page.getByRole("dialog", { name: "Создать интервью", exact: true })
      .getByRole("button", { name: "Создать интервью", exact: true }).click();
    const partial = page.getByRole("alert").filter({ hasText: "Интервью создано, но данные кандидата не сохранены" });
    await partial.waitFor();
    await page.getByRole("button", { name: "Повторить сохранение", exact: true }).click();
    await retryStarted;
    await logoutAndLogin(page, accountB);
    assertRoute(page, "/workspace/personal/interviews", "B_ROUTE_NOT_READY_BEFORE_STALE_METADATA_RELEASE");
    assert.equal(await page.getByRole("button", { name: "Повторить сохранение", exact: true }).count(), 0, "A_METADATA_RETRY_LEAKED_TO_B_BEFORE_RELEASE");
    releaseRetry();
    await retryFinished;
    const created = (await rawRoomSnapshot(accountA.token)).rooms.find((room) => room.title === title);
    assert.ok(created, "A_METADATA_ROOM_IDENTITY_MISSING");
    await settleApp(page);
    assert.equal(await page.getByRole("button", { name: "Повторить сохранение", exact: true }).count(), 0, "A_METADATA_RETRY_LEAKED_TO_B");
    assert.equal(roomPosts, 1, "METADATA_RETRY_REPOSTED_ROOM");
    assert.equal(metadataPuts, 2, "METADATA_RETRY_PUT_COUNT_WRONG");
    assertRoute(page, "/workspace/personal/interviews", "STALE_METADATA_RETRY_NAVIGATED_B");
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).count(), 0, "STALE_METADATA_RETRY_LEAKED_DRAFT_TO_B");
    assert.equal(await page.getByText("Интервью создано", { exact: false }).count(), 0, "STALE_METADATA_RETRY_NOTIFIED_B");
    assert.equal((await rawRoomSnapshot(accountB.token)).text, beforeB.text, "STALE_METADATA_RETRY_CHANGED_B_ROOM_SNAPSHOT");
  } finally {
    await context.close();
  }
});

test("remediation: unified interview rows expose context date status role and primary action", async () => {
  const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews");
  try {
    await page.waitForTimeout(200);
    const row = page.getByRole("row", { name: new RegExp(fixtures.roleRoom.title) });
    assert.equal(await row.count(), 1, "UNIFIED_ROW_MISSING");
    const text = await row.innerText();
    for (const [expected, marker] of [
      [fixtures.roleRoom.title, "title"],
      ["Мария Ролевая", "candidate"],
      ["Без трека и вакансии", "personal context"],
      ["12.09.2030", "date"],
      ["Активно", "lifecycle status"],
      ["Владелец", "current-user role"],
      ["Открыть интервью", "primary action"],
    ]) {
      assert.match(text, new RegExp(expected), `UNIFIED_ROW_MISSING_${marker.toUpperCase().replaceAll(" ", "_")}`);
    }
  } finally {
    await context.close();
  }
});

test("remediation: standalone profile saves display name handles retry and always exposes stable personal ID", async () => {
  const { context, page } = await openAccount(fixtures.profile, "/profile", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    const displayName = page.getByLabel("Имя для отображения", { exact: true });
    assert.equal(await displayName.count(), 1, "PROFILE_DISPLAY_NAME_INPUT_MISSING");
    const savedName = `Сохранённое имя ${unique()}`;
    await displayName.fill(savedName);
    const savedResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/me/profile") && response.ok());
    await page.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await savedResponse;
    await settleApp(page);
    assert.equal(await page.getByText("Имя сохранено", { exact: true }).count(), 1, "PROFILE_SAVE_FEEDBACK_MISSING");
    await page.reload({ waitUntil: "domcontentloaded" });
    await settleApp(page);
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    assert.equal(await page.getByLabel("Имя для отображения", { exact: true }).inputValue(), savedName, "PROFILE_NAME_DID_NOT_SURVIVE_RELOAD");
    await page.getByRole("dialog", { name: "Изменить имя", exact: true }).getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(await page.getByText(fixtures.profile.user.id, { exact: true }).count(), 1, "PERSONAL_ID_MISSING_WITHOUT_HR_OPT_IN");
    const copy = page.getByRole("button", { name: "Скопировать личный ID", exact: true });
    assert.equal(await copy.count(), 1, "PERSONAL_ID_COPY_MISSING");
    await copy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fixtures.profile.user.id, "PERSONAL_ID_COPY_WRONG");
    assert.equal(await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).count(), 1, "HIRING_SETTINGS_ACCESS_LOST");

    const failedDraft = `Черновик профиля ${unique()}`;
    const rejectProfile = (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Временно недоступно"}',
    });
    await page.route("**/api/me/profile", rejectProfile);
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    await displayName.fill(failedDraft);
    const failedSaveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/me/profile") && response.status() === 503);
    await page.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await failedSaveResponse;
    await settleApp(page);
    assert.equal(await page.getByRole("alert").filter({ hasText: /Не удалось сохранить имя/ }).count(), 1, "PROFILE_SAVE_ERROR_MISSING");
    assert.equal(await displayName.inputValue(), failedDraft, "PROFILE_FAILED_SAVE_LOST_DRAFT");
    const retry = page.getByRole("dialog", { name: "Изменить имя", exact: true }).getByRole("button", { name: "Сохранить имя", exact: true });
    assert.equal(await retry.count(), 1, "PROFILE_SAVE_RETRY_MISSING");
    await page.unroute("**/api/me/profile", rejectProfile);
    const retryResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/api/me/profile") && response.ok());
    await retry.click();
    await retryResponse;
    await settleApp(page);
    assert.equal(await page.getByText("Имя сохранено", { exact: true }).count(), 1, "PROFILE_RETRY_DID_NOT_SAVE");
  } finally {
    await context.close();
  }
});

test("remediation: list loading error filter-empty and stale states stay distinct", async (t) => {
  await t.test("remediation: interviews loading is not a confirmed empty state", async () => {
    let releaseRooms;
    let signalRooms;
    const gate = new Promise((resolve) => { releaseRooms = resolve; });
    const started = new Promise((resolve) => { signalRooms = resolve; });
    const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews", {
      waitForWorkspaceData: false,
      onPage: (openedPage) => openedPage.route("**/api/me/rooms", async (route) => {
        signalRooms();
        await gate;
        await route.continue();
      }),
    });
    try {
      await started;
      assert.equal(await page.getByText("Загружаем интервью", { exact: true }).count(), 1, "INTERVIEWS_LOADING_STATE_MISSING");
      assert.equal(await page.getByText("У вас пока нет интервью", { exact: true }).count(), 0, "INTERVIEWS_LOADING_SHOWED_FALSE_EMPTY");
      releaseRooms();
    } finally {
      releaseRooms?.();
      await context.close();
    }
  });

  await t.test("remediation: interview search has filter-empty and reset", async () => {
    const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews");
    try {
      const search = page.getByLabel("Поиск интервью", { exact: true });
      assert.equal(await search.count(), 1, "INTERVIEW_SEARCH_MISSING");
      await search.fill("совпадений-точно-нет");
      assert.equal(await page.getByText("По вашему запросу интервью не найдены", { exact: true }).count(), 1, "INTERVIEW_FILTER_EMPTY_MISSING");
      assert.equal(await page.getByText("У вас пока нет интервью", { exact: true }).count(), 0, "FILTER_EMPTY_COLLAPSED_TO_DATA_EMPTY");
      await page.getByRole("button", { name: "Сбросить поиск", exact: true }).click();
      assert.equal(await page.getByText(fixtures.roleRoom.title, { exact: true }).count(), 1, "INTERVIEW_SEARCH_RESET_FAILED");
    } finally {
      await context.close();
    }
  });

  await t.test("remediation: initial interview failure is retryable and never false-empty", async () => {
    const failRooms = (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' });
    let failedInitialResponse;
    const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews", {
      onPage: (openedPage) => {
        failedInitialResponse = openedPage.waitForResponse((response) => response.url().endsWith("/api/me/rooms") && response.status() === 503);
        void openedPage.route("**/api/me/rooms", failRooms);
      },
    });
    try {
      await failedInitialResponse;
      await settleApp(page);
      assert.equal(await page.getByRole("alert").filter({ hasText: "Не удалось загрузить интервью" }).count(), 1, "INTERVIEWS_INITIAL_ERROR_MISSING");
      assert.equal(await page.getByRole("button", { name: "Повторить загрузку", exact: true }).count(), 1, "INTERVIEWS_INITIAL_RETRY_MISSING");
      assert.equal(await page.getByText("У вас пока нет интервью", { exact: true }).count(), 0, "INTERVIEWS_ERROR_SHOWED_FALSE_EMPTY");
    } finally {
      await context.close();
    }
  });

  await t.test("remediation: failed interview refresh retains rows and marks them stale", async () => {
    const { context, page } = await openAccount(fixtures.rolesOwner, "/workspace/personal/interviews");
    try {
      const refresh = page.getByRole("button", { name: "Обновить интервью", exact: true });
      assert.equal(await refresh.count(), 1, "INTERVIEW_REFRESH_MISSING");
      const failRefresh = (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' });
      await page.route("**/api/me/rooms", failRefresh);
      const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/me/rooms") && response.status() === 503);
      await refresh.click();
      await failedResponse;
      await settleApp(page);
      assert.equal(await page.getByText(fixtures.roleRoom.title, { exact: true }).count(), 1, "STALE_REFRESH_DROPPED_AUTHORIZED_ROW");
      assert.equal(await page.getByRole("alert").filter({ hasText: /Данные не обновлены/ }).count(), 1, "INTERVIEW_STALE_LABEL_MISSING");
      assert.equal(await page.getByRole("button", { name: "Повторить обновление", exact: true }).count(), 1, "INTERVIEW_STALE_RETRY_MISSING");
    } finally {
      await context.close();
    }
  });

  await t.test("remediation: library failure is not an empty library", async () => {
    let failedLibraryResponse;
    const { context, page } = await openAccount(fixtures.unified, "/workspace/personal/library", {
      onPage: (openedPage) => {
        failedLibraryResponse = openedPage.waitForResponse((response) => response.url().endsWith("/api/me/tasks") && response.status() === 503);
        void openedPage.route("**/api/me/tasks", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' }));
      },
    });
    try {
      await failedLibraryResponse;
      await settleApp(page);
      assert.equal(await page.getByRole("alert").filter({ hasText: "Не удалось загрузить библиотеку" }).count(), 1, "LIBRARY_INITIAL_ERROR_MISSING");
      assert.equal(await page.getByRole("button", { name: "Повторить загрузку", exact: true }).count(), 1, "LIBRARY_RETRY_MISSING");
      assert.equal(await page.getByText("В библиотеке пока нет задач", { exact: true }).count(), 0, "LIBRARY_ERROR_SHOWED_FALSE_EMPTY");
    } finally {
      await context.close();
    }
  });

  await t.test("remediation: candidates failure is not an empty candidate list", async () => {
    let failedCandidatesResponse;
    const { context, page } = await openAccount(fixtures.hr, "/workspace/personal/candidates", {
      onPage: (openedPage) => {
        failedCandidatesResponse = openedPage.waitForResponse((response) => response.url().includes("/api/me/hr/rooms?") && response.status() === 503);
        void openedPage.route("**/api/me/hr/rooms?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' }));
      },
    });
    try {
      await failedCandidatesResponse;
      await settleApp(page);
      assert.equal(await page.getByRole("alert").filter({ hasText: "Не удалось загрузить интервью" }).count(), 1, "CANDIDATES_INITIAL_ERROR_MISSING");
      assert.equal(await page.getByRole("button", { name: "Повторить", exact: true }).count(), 1, "CANDIDATES_RETRY_MISSING");
      assert.equal(await page.getByText("Пока нет интервью", { exact: true }).count(), 0, "CANDIDATES_ERROR_SHOWED_FALSE_EMPTY");
    } finally {
      await context.close();
    }
  });
});

const remediationLegacyRoutes = [
  { oldPath: "/dashboard", expected: "/workspace/personal/interviews", authKey: "rolesOwner", heading: "Интервью", data: "roleRoom", action: "Создать интервью" },
  { oldPath: "/dashboard/rooms", expected: "/workspace/personal/interviews", authKey: "rolesOwner", heading: "Интервью", data: "roleRoom", action: "Создать интервью" },
  { oldPath: "/dashboard/manage", expected: "/workspace/personal/interviews", authKey: "rolesOwner", heading: "Интервью", data: "roleRoom", action: "Создать интервью" },
  { oldPath: "/dashboard/tasks?language=python", expected: "/workspace/personal/library?language=python", authKey: "unified", heading: "Библиотека", data: "pythonTask" },
  { oldPath: "/dashboard/presets", expected: "/workspace/personal/library?tab=sets", authKey: "unified", heading: "Библиотека", data: "preset", selectedTab: "Наборы задач" },
  { oldPath: "/dashboard/hr", expected: "/workspace/personal/candidates", authKey: "hr", heading: "Кандидаты", data: "hrRoom" },
];

for (const routeCase of remediationLegacyRoutes) {
  test(`remediation: legacy ${routeCase.oldPath} renders and reloads canonical ${routeCase.expected}`, async () => {
    const auth = fixtures[routeCase.authKey];
    const { context, page } = await openAccount(auth, routeCase.oldPath);
    try {
      assertRoute(page, routeCase.expected, `CANONICAL_ROUTE_MISSING: ${routeCase.oldPath}`);
      for (const phase of ["redirect", "reload"]) {
        if (phase === "reload") {
          const dataFragment = routeCase.expected.includes("/interviews") && !routeCase.expected.endsWith("/new")
            ? "/api/me/rooms"
            : routeCase.expected.includes("/library")
              ? routeCase.selectedTab ? "/api/me/presets" : "/api/me/tasks"
              : routeCase.expected.includes("/candidates")
                ? "/api/me/hr/rooms?"
                : null;
          const dataReady = dataFragment
            ? page.waitForResponse((response) => response.url().includes(dataFragment) && response.ok())
            : null;
          await page.reload({ waitUntil: "domcontentloaded" });
          await dataReady;
          await settleApp(page);
        }
        assert.equal(await page.getByRole("heading", { name: routeCase.heading, exact: true }).count(), 1, `CANONICAL_HEADING_MISSING_AFTER_${phase.toUpperCase()}: ${routeCase.oldPath}`);
        if (routeCase.data) {
          assert.equal(await page.getByText(fixtures[routeCase.data].title ?? fixtures[routeCase.data].name, { exact: true }).count(), 1, `CANONICAL_DATA_MISSING_AFTER_${phase.toUpperCase()}: ${routeCase.oldPath}`);
        }
        if (routeCase.action) {
          assert.equal(await page.getByRole("button", { name: routeCase.action, exact: true }).count(), 1, `CANONICAL_ACTION_MISSING_AFTER_${phase.toUpperCase()}: ${routeCase.oldPath}`);
        }
        if (routeCase.field) {
          assert.equal(await page.getByLabel(routeCase.field, { exact: true }).count(), 1, `CANONICAL_FIELD_MISSING_AFTER_${phase.toUpperCase()}: ${routeCase.oldPath}`);
        }
        if (routeCase.selectedTab) {
          assert.equal(await page.getByRole("tab", { name: routeCase.selectedTab, exact: true }).getAttribute("aria-selected"), "true", `CANONICAL_SET_TAB_NOT_SELECTED_AFTER_${phase.toUpperCase()}`);
        }
      }
      if (routeCase.oldPath.includes("language=python")) {
        const selectedLanguage = await page.getByRole("combobox", { name: "Язык задач", exact: true }).evaluate((element) => (
          element.parentElement?.getAttribute("title") || element.parentElement?.textContent?.trim()
        ));
        assert.equal(selectedLanguage, "Python", "SUPPORTED_LANGUAGE_QUERY_NOT_APPLIED");
      }
    } finally {
      await context.close();
    }
  });
}

const coldCanonicalRoutes = [
  ["/workspace/personal/interviews", "Личный раздел: Интервью"],
  ["/workspace/personal/interviews/new", "Личный раздел: Создать интервью"],
  ["/workspace/personal/library", "Личный раздел: Библиотека"],
  ["/workspace/personal/candidates", "Личный раздел: Кандидаты"],
  ["/profile", "Личный раздел: Профиль"],
];

for (const [path, landmarkName] of coldCanonicalRoutes) {
  test(`remediation: cold direct ${path} and reload expose a semantic landmark after Suspense`, async () => {
    const auth = path.includes("candidates") ? fixtures.hr : fixtures.unified;
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(({ token, displayName }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("display_name", displayName);
    }, { token: auth.token, displayName: auth.user.displayName });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    try {
      for (const phase of ["cold", "reload"]) {
        const profileReady = page.waitForResponse((response) => response.url().endsWith("/api/me/profile") && response.ok());
        if (phase === "cold") await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
        else await page.reload({ waitUntil: "domcontentloaded" });
        await profileReady;
        await settleApp(page);
        assertRoute(page, path, `COLD_CANONICAL_ROUTE_CHANGED_AFTER_${phase.toUpperCase()}`);
        assert.equal(await page.getByRole("main", { name: landmarkName, exact: true }).count(), 1, `COLD_SEMANTIC_LANDMARK_MISSING_AFTER_${phase.toUpperCase()}: ${path}`);
      }
    } finally {
      await context.close();
    }
  });
}

test("remediation: metadata partial failure retries only PUT and then opens the room", async () => {
  const title = `Интервью с повтором метаданных ${unique()}`;
  const candidateName = "Кандидат после повторного сохранения";
  const position = "Инженер надёжности";
  let roomPosts = 0;
  let metadataPuts = 0;
  let signalFirstPut;
  const firstPutStarted = new Promise((resolve) => { signalFirstPut = resolve; });
  const metadataHandler = async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    metadataPuts += 1;
    if (metadataPuts === 1) {
      signalFirstPut();
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"metadata offline"}' });
    }
    return route.continue();
  };
  const { context, page } = await openAccount(fixtures.creator, "/workspace/personal/interviews/new", {
    onPage: (openedPage) => {
      openedPage.on("request", (browserRequest) => {
        if (browserRequest.method() === "POST" && new URL(browserRequest.url()).pathname === "/api/rooms") roomPosts += 1;
      });
      void openedPage.route("**/api/rooms/*/interview-metadata", metadataHandler);
    },
  });
  try {
    await page.getByLabel("Название интервью", { exact: true }).fill(title);
    await page.getByLabel("Имя кандидата", { exact: true }).fill(candidateName);
    await page.getByLabel("Позиция", { exact: true }).fill(position);
    const failedMetadataResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/interview-metadata") && response.status() === 503);
    await page.getByRole("dialog", { name: "Создать интервью", exact: true })
      .getByRole("button", { name: "Создать интервью", exact: true }).click();
    await firstPutStarted;
    await failedMetadataResponse;
    await settleApp(page);
    assertRoute(page, "/workspace/personal/interviews/new", "PARTIAL_METADATA_FAILURE_LOST_CREATE_SCOPE");
    assert.equal(roomPosts, 1, `PARTIAL_METADATA_ROOM_POST_COUNT: ${roomPosts}`);
    assert.equal(metadataPuts, 1, `PARTIAL_METADATA_INITIAL_PUT_COUNT: ${metadataPuts}`);
    assert.equal(await page.getByRole("alert").filter({ hasText: "Интервью создано, но данные кандидата не сохранены" }).count(), 1, "PARTIAL_METADATA_ALERT_MISSING");
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), title, "PARTIAL_METADATA_LOST_TITLE");
    assert.equal(await page.getByLabel("Имя кандидата", { exact: true }).inputValue(), candidateName, "PARTIAL_METADATA_LOST_CANDIDATE");
    assert.equal(await page.getByText("После сохранения данных откроется созданная комната.", { exact: true }).count(), 1, "PARTIAL_METADATA_ROOM_DESTINATION_MISSING");
    const created = (await rawRoomSnapshot(fixtures.creator.token)).rooms.find((room) => room.title === title);
    assert.ok(created, "PARTIAL_METADATA_CREATED_ROOM_IDENTITY_MISSING_FROM_API");
    assert.equal(await page.getByText(created.inviteCode, { exact: true }).count(), 1, "PARTIAL_METADATA_CREATED_ROOM_CODE_MISSING");
    assert.equal(await page.getByRole("link", { name: "Открыть созданное интервью", exact: true }).getAttribute("href"), `/room/${created.inviteCode}`);
    const retry = page.getByRole("button", { name: "Повторить сохранение", exact: true });
    assert.equal(await retry.count(), 1, "PARTIAL_METADATA_RETRY_MISSING");
    const metadataRead = page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith(`/api/rooms/${created.inviteCode}/interview-metadata`));
    await retry.click();
    await metadataRead;
    await page.waitForURL(`**/room/${created.inviteCode}`);
    await page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute("data-state") === "online");
    assert.equal(roomPosts, 1, "PARTIAL_METADATA_RETRY_RECREATED_ROOM");
    assert.equal(metadataPuts, 2, "PARTIAL_METADATA_RETRY_DID_NOT_SEND_ONE_PUT");
  } finally {
    await context.close();
  }
});

for (const viewport of viewports) {
  for (const zoom of zoomLevels) {
    test(`remediation: HR candidates ${viewport.width}x${viewport.height} at ${zoom}% keeps long content and retry controls reachable`, { timeout: 30000 }, async () => {
      let initialHrResponse;
      const { context, page } = await openAccount(fixtures.hrMatrix, "/workspace/personal/candidates", {
        viewport,
        onPage: (openedPage) => {
          initialHrResponse = openedPage.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/me/hr/rooms?") && response.ok());
        },
      });
      try {
        await initialHrResponse;
        const scale = zoom / 100;
        const effectiveViewport = {
          width: Math.max(320, Math.floor(viewport.width / scale)),
          height: Math.max(300, Math.floor(viewport.height / scale)),
        };
        await page.setViewportSize(effectiveViewport);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const row = page.getByRole("row", { name: new RegExp(fixtures.hrMatrixCandidate) });
        assert.equal(await row.count(), 1, "HR_MATRIX_ROW_MISSING");
        const candidateCell = row.getByRole("cell").first();
        const wrap = await candidateCell.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
        assert.ok(wrap.scrollWidth <= wrap.clientWidth + 1, `HR_LONG_TEXT_DID_NOT_WRAP: ${JSON.stringify(wrap)}`);
        const documentGeometry = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert.ok(documentGeometry.scrollWidth <= documentGeometry.clientWidth + 1, `HR_DOCUMENT_HORIZONTAL_OVERFLOW: ${JSON.stringify(documentGeometry)}`);

        const firstFilter = page.getByLabel("С", { exact: true });
        await firstFilter.focus();
        let primaryReached = false;
        let visibleFocus = false;
        for (let step = 0; step < 16; step += 1) {
          await page.keyboard.press("Tab");
          const focus = await page.evaluate(() => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement)) return { primary: false, visible: false };
            const style = getComputedStyle(active);
            return {
              primary: active.textContent?.trim() === "Скачать Excel",
              visible: style.outlineStyle !== "none" || (style.boxShadow !== "none" && style.boxShadow !== ""),
            };
          });
          visibleFocus ||= focus.visible;
          if (focus.primary) { primaryReached = true; break; }
        }
        assert.equal(primaryReached, true, "HR_PRIMARY_ACTION_NOT_KEYBOARD_REACHABLE");
        assert.equal(visibleFocus, true, "HR_KEYBOARD_FOCUS_NOT_VISIBLE");

        const failRefresh = (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"offline"}' });
        await page.route("**/api/me/hr/rooms?**", failRefresh);
        const failedResponse = page.waitForResponse((response) => response.status() === 503 && response.url().includes("/api/me/hr/rooms?"));
        await page.getByRole("button", { name: "Обновить список", exact: true }).click();
        await failedResponse;
        await settleApp(page);
        assert.equal(await row.count(), 1, "HR_STALE_REFRESH_DROPPED_ROW");
        const alert = page.getByRole("alert").filter({ hasText: /Данные не обновлены/ });
        assert.equal(await alert.count(), 1, "HR_STALE_ALERT_MISSING");
        const retry = alert.getByRole("button", { name: "Повторить", exact: true });
        assert.equal(await retry.count(), 1, "HR_STALE_RETRY_MISSING");
        await retry.scrollIntoViewIfNeeded();
        const retryBox = await retry.boundingBox();
        assert.ok(retryBox && retryBox.y >= 0 && retryBox.y + retryBox.height <= effectiveViewport.height, "HR_RETRY_UNREACHABLE_OR_OVERLAPPED");
        const retryTopmost = await retry.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return topmost === element || Boolean(topmost && element.contains(topmost));
        });
        assert.equal(retryTopmost, true, "HR_RETRY_OVERLAPPED_BY_FIXED_CONTENT");
      } finally {
        await context.close();
      }
    });
  }
}
