import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://127.0.0.1:15196";
const api = process.env.E2E_API_URL || "http://127.0.0.1:18096/api";
const password = "test-password-123";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const publicAuditActionLabels = Object.freeze({
  TEAM_CREATE: "Команда создана",
  INVITATION_CREATED: "Приглашение выпущено",
  INVITATION_ACCEPTED: "Приглашение принято",
  INVITATION_REVOKED: "Приглашение отозвано",
  INVITATION_REISSUED: "Приглашение перевыпущено",
  TEAM_RENAMED: "Команда переименована",
  MEMBER_ROLE_UPDATED: "Роль участника изменена",
  MEMBER_LEFT: "Участник вышел из команды",
  MEMBER_SUSPENDED: "Участник приостановлен",
  MEMBER_RESUMED: "Участник восстановлен",
  MEMBER_REMOVED: "Участник удалён из команды",
  TEAM_OWNERSHIP_TRANSFERRED: "Владение командой передано",
  LEGACY_UNCLASSIFIED: "Историческое действие без публичного кода",
});
const managementPersistenceMarkers = Object.freeze([
  "settings",
  "audit",
  "role",
  "revision",
  "target",
  "draft",
  "idempotency",
]);
let browser;

async function raw(path, { token, method = "GET", body, key } = {}) {
  return fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(path, options = {}) {
  const response = await raw(path, options);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function account(prefix) {
  const suffix = unique();
  const result = await json("/auth/register", {
    method: "POST",
    body: {
      nickname: `${prefix}_${suffix}`.slice(0, 32),
      displayName: `${prefix} ${suffix}`,
      password,
      isHr: false,
    },
  });
  assert.equal(result.response.status, 200, "P1_SETTINGS_ACCOUNT_FIXTURE_UNAVAILABLE");
  return result.body;
}

async function createTeam(owner, name) {
  const result = await json("/teams", {
    token: owner.token,
    method: "POST",
    key: randomUUID(),
    body: { name },
  });
  assert.equal(result.response.status, 201, "P1_SETTINGS_TEAM_FIXTURE_UNAVAILABLE");
  return result.body.team ?? result.body;
}

async function managementFixture(prefix) {
  const owner = await account(`${prefix}_owner`);
  const admin = await account(`${prefix}_admin`);
  const member = await account(`${prefix}_member`);
  const team = await createTeam(owner, `P1 ${unique()}`);
  const fixture = await json("/test-fixtures/team-invitations/management", {
    token: owner.token,
    method: "POST",
    body: { teamId: team.id, adminUserId: admin.user.id, memberUserId: member.user.id },
  });
  assert.equal(fixture.response.status, 201, "P1_SETTINGS_ROLE_FIXTURE_UNAVAILABLE");
  assert.deepEqual(
    [fixture.body.owner.role, fixture.body.admin.role, fixture.body.member.role],
    ["OWNER", "ADMIN", "MEMBER"],
    "P1_SETTINGS_ROLE_FIXTURE_INVALID",
  );
  return { owner, admin, member, team };
}

async function openAccount(auth) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route("**/api/**", async (route) => {
    const target = new URL(route.request().url());
    const apiOrigin = new URL(api);
    await route.continue({ url: apiOrigin.origin + target.pathname + target.search });
  });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(6_000);
  return { context, page };
}

async function tabTo(page, locator, marker) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((node) => document.activeElement === node)) {
      await assertKeyboardTarget(locator, marker);
      return;
    }
  }
  assert.fail(`${marker}_NOT_KEYBOARD_REACHABLE`);
}

async function waitForCondition(predicate, marker) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`${marker}_NOT_OBSERVED`);
}

async function assertKeyboardTarget(locator, marker) {
  const metrics = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      active: document.activeElement === node,
      focusVisible: node.matches(":focus-visible"),
      outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      className: node.className,
    };
  });
  assert.equal(metrics.active, true, `${marker}_FOCUS_MISSING`);
  assert.equal(metrics.focusVisible, true, `${marker}_FOCUS_NOT_VISIBLE`);
  assert.equal(metrics.outline, true, `${marker}_FOCUS_INDICATOR_MISSING`);
  assert.equal(metrics.width >= 44, true, `${marker}_WIDTH_BELOW_44`);
  assert.equal(
    metrics.height >= 44,
    true,
    `${marker}_HEIGHT_BELOW_44: actual=${metrics.height}; class=${metrics.className}`,
  );
  assert.equal(metrics.left >= 0 && metrics.right <= metrics.viewportWidth, true, `${marker}_HORIZONTALLY_CLIPPED`);
  assert.equal(metrics.top >= 0 && metrics.bottom <= metrics.viewportHeight, true, `${marker}_VERTICALLY_CLIPPED`);
}

async function navigateToSettingsByKeyboard(page, team, marker) {
  await page.goto(`${web}/workspace/teams/${team.id}/interviews`, { waitUntil: "domcontentloaded" });
  await page.getByRole("main", { name: `Команда ${team.name}: Интервью`, exact: true }).waitFor();
  const settings = page.getByRole("link", { name: "Настройки команды", exact: true });
  await tabTo(page, settings, `${marker}_SETTINGS_NAVIGATION`);
  await page.keyboard.press("Enter");
  await page.waitForURL(`${web}/workspace/teams/${team.id}/settings`);
  await page.getByRole("main", { name: `Команда ${team.name}: Настройки команды`, exact: true }).waitFor();
}

function managementRequest(request, teamId) {
  const url = new URL(request.url());
  return url.pathname === `/api/teams/${teamId}/ownership-transfer`
    || url.pathname.startsWith(`/api/teams/${teamId}/members/`)
    || url.pathname === `/api/teams/${teamId}/audit-events`;
}

async function snapshotBrowserPersistence(page) {
  return page.evaluate(() => {
    const snapshotStorage = (storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return [key, storage.getItem(key) ?? ""];
    }).sort(([left], [right]) => left.localeCompare(right));
    return {
      url: location.href,
      historyState: history.state ?? null,
      localStorage: snapshotStorage(localStorage),
      sessionStorage: snapshotStorage(sessionStorage),
    };
  });
}

function assertNoManagementPersistence(snapshot, marker, sensitiveValues = []) {
  const storageKeys = [...snapshot.localStorage, ...snapshot.sessionStorage]
    .map(([key]) => key.toLowerCase());
  const historyState = JSON.stringify(snapshot.historyState).toLowerCase();
  const persistentValues = JSON.stringify({
    historyState: snapshot.historyState,
    localStorage: snapshot.localStorage,
    sessionStorage: snapshot.sessionStorage,
  }).toLowerCase();
  for (const persistenceMarker of managementPersistenceMarkers) {
    assert.equal(
      storageKeys.some((key) => key.includes(persistenceMarker)) || historyState.includes(persistenceMarker),
      false,
      `${marker}_PERSISTED_${persistenceMarker.toUpperCase()}_STATE`,
    );
  }
  for (const sensitiveValue of sensitiveValues) {
    assert.equal(
      persistentValues.includes(String(sensitiveValue).toLowerCase()),
      false,
      `${marker}_PERSISTED_MANAGEMENT_DATA`,
    );
  }
}

async function assertPersistenceUnchanged(page, before, marker, sensitiveValues = []) {
  assertNoManagementPersistence(before, `${marker}_BEFORE`, sensitiveValues);
  const after = await snapshotBrowserPersistence(page);
  assertNoManagementPersistence(after, `${marker}_AFTER`, sensitiveValues);
  assert.deepEqual(after, before, `${marker}_BROWSER_PERSISTENCE_CHANGED`);
}

async function close(session) {
  await session?.context.close();
}

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("P1 settings: OWNER sees an accessible keyboard-only rename and owner management surface", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_owner_matrix");
  const session = await openAccount(owner);
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_OWNER");
    assert.equal(await session.page.getByText(team.name, { exact: true }).count() > 0, true, "P1_OWNER_SAFE_TEAM_NAME_MISSING");
    assert.equal(await session.page.getByText("OWNER", { exact: true }).count() > 0, true, "P1_OWNER_EFFECTIVE_ROLE_MISSING");

    const name = session.page.getByLabel("Название команды", { exact: true });
    assert.equal(await name.count(), 1, "P1_OWNER_RENAME_FIELD_MISSING");
    await tabTo(session.page, name, "P1_OWNER_RENAME_INPUT");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(`${team.name} новая версия`);
    const rename = session.page.getByRole("button", { name: /переименовать|сохранить название/i });
    await tabTo(session.page, rename, "P1_OWNER_RENAME_SUBMIT");

    assert.equal(await session.page.getByRole("button", { name: /изменить роль участника/i }).count(), 1, "P1_OWNER_ROLE_ACTION_MISSING");
    assert.equal(await session.page.getByRole("button", { name: "Передать владение командой", exact: true }).count(), 1, "P1_OWNER_TRANSFER_ACTION_MISSING");
    assert.equal(await session.page.getByRole("button", { name: "Аудит команды", exact: true }).count(), 1, "P1_OWNER_AUDIT_ACTION_MISSING");
  } finally {
    await close(session);
  }
});

test("P1 settings: ADMIN has rename and audit but never owner-only actions", { timeout: 60_000 }, async () => {
  const { admin, team } = await managementFixture("p1_admin_matrix");
  const session = await openAccount(admin);
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_ADMIN");
    assert.equal(await session.page.getByText("ADMIN", { exact: true }).count() > 0, true, "P1_ADMIN_EFFECTIVE_ROLE_MISSING");
    const name = session.page.getByLabel("Название команды", { exact: true });
    assert.equal(await name.count(), 1, "P1_ADMIN_RENAME_FIELD_MISSING");
    const rename = session.page.getByRole("button", { name: /переименовать|сохранить название/i });
    await tabTo(session.page, rename, "P1_ADMIN_RENAME_SUBMIT");
    const audit = session.page.getByRole("button", { name: "Аудит команды", exact: true });
    await tabTo(session.page, audit, "P1_ADMIN_AUDIT_ACTION");
    assert.equal(await session.page.getByRole("button", { name: /изменить роль участника/i }).count(), 0, "P1_ADMIN_OWNER_ROLE_ACTION_VISIBLE");
    assert.equal(await session.page.getByRole("button", { name: "Передать владение командой", exact: true }).count(), 0, "P1_ADMIN_TRANSFER_ACTION_VISIBLE");
  } finally {
    await close(session);
  }
});

test("P1 settings: MEMBER has safe identity but no audit or management browser traffic", { timeout: 60_000 }, async () => {
  const { member, team } = await managementFixture("p1_member_matrix");
  const session = await openAccount(member);
  const managementPaths = [];
  session.page.on("request", (request) => {
    if (managementRequest(request, team.id)) managementPaths.push(new URL(request.url()).pathname);
  });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_MEMBER");
    assert.equal(await session.page.getByText(team.name, { exact: true }).count() > 0, true, "P1_MEMBER_SAFE_TEAM_NAME_MISSING");
    assert.equal(await session.page.getByText("MEMBER", { exact: true }).count() > 0, true, "P1_MEMBER_EFFECTIVE_ROLE_MISSING");
    assert.equal(await session.page.getByLabel("Название команды", { exact: true }).count(), 0, "P1_MEMBER_RENAME_VISIBLE");
    assert.equal(await session.page.getByRole("button", { name: /изменить роль участника|передать владение командой|аудит команды/i }).count(), 0, "P1_MEMBER_MANAGEMENT_CONTROL_VISIBLE");
    await session.page.waitForTimeout(250);
    assert.deepEqual(managementPaths, [], "P1_MEMBER_MANAGEMENT_REQUEST_SENT");
    assertNoManagementPersistence(
      await snapshotBrowserPersistence(session.page),
      "P1_MEMBER",
      ["LEGACY_UNCLASSIFIED", "TEAM_OWNERSHIP_TRANSFERRED", team.id],
    );
  } finally {
    await close(session);
  }
});

test("P1 settings: transfer needs a named confirmation and restores keyboard focus without an optimistic owner claim", { timeout: 60_000 }, async () => {
  const { owner, member, team } = await managementFixture("p1_transfer_confirmation");
  const session = await openAccount(owner);
  let newOwnerSession;
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_TRANSFER");
    const transferPersistence = await snapshotBrowserPersistence(session.page);
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true });
    assert.equal(await transfer.count(), 1, "P1_TRANSFER_INITIATOR_MISSING");
    await tabTo(session.page, transfer, "P1_TRANSFER_INITIATOR");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: "Передать владение командой", exact: true });
    await dialog.waitFor();
    const cancel = dialog.getByRole("button", { name: /отмена/i });
    await tabTo(session.page, cancel, "P1_TRANSFER_CANCEL");
    assert.equal(await dialog.getByText(member.user.displayName, { exact: true }).count() > 0, true, "P1_TRANSFER_ACTIVE_TARGET_MISSING");
    assert.match(await dialog.innerText(), /прежн.*ADMIN/i, "P1_TRANSFER_OLD_OWNER_CONSEQUENCE_MISSING");
    await session.page.keyboard.press("Enter");
    await transfer.waitFor();
    assert.equal(await transfer.evaluate((node) => document.activeElement === node), true, "P1_TRANSFER_CANCEL_FOCUS_NOT_RESTORED");
    await assertPersistenceUnchanged(session.page, transferPersistence, "P1_TRANSFER_CANCEL", [team.id, member.user.id]);

    let releaseTransfer;
    const transferReleased = new Promise((resolve) => { releaseTransfer = resolve; });
    let transferSeen;
    const transferReceived = new Promise((resolve) => { transferSeen = resolve; });
    await session.page.route(`**/api/teams/${team.id}/ownership-transfer`, async (route) => {
      transferSeen(route);
      await transferReleased;
      await route.continue();
    });
    await tabTo(session.page, transfer, "P1_TRANSFER_REOPEN");
    await session.page.keyboard.press("Enter");
    await dialog.waitFor();
    const target = dialog.getByLabel("Новый владелец", { exact: true });
    await tabTo(session.page, target, "P1_TRANSFER_TARGET");
    await session.page.keyboard.press("ArrowDown");
    assert.equal(await target.inputValue(), member.user.id, "P1_TRANSFER_TARGET_SELECTION_MISSING");
    const confirm = dialog.getByRole("button", { name: "Подтвердить передачу", exact: true });
    await tabTo(session.page, confirm, "P1_TRANSFER_CONFIRM");
    await session.page.keyboard.press("Enter");
    const intercepted = await transferReceived;
    assert.match(await intercepted.request().headerValue("Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/i, "P1_TRANSFER_IDEMPOTENCY_KEY_MISSING");
    assert.equal(await session.page.getByText("OWNER", { exact: true }).count() > 0, true, "P1_TRANSFER_OPTIMISTIC_OWNER_CLAIM");
    assert.equal(await transfer.count(), 1, "P1_TRANSFER_ACTION_REMOVED_BEFORE_SERVER_RESPONSE");
    releaseTransfer();
    const terminalStatus = session.page.getByRole("status").last();
    await terminalStatus.waitFor();
    await session.page.getByText("ADMIN", { exact: true }).waitFor();
    assert.equal(await transfer.count(), 0, "P1_TRANSFER_FORMER_OWNER_ACTION_STILL_VISIBLE_AFTER_REFRESH");
    assert.equal(
      await terminalStatus.evaluate((node) => document.activeElement === node),
      true,
      "P1_TRANSFER_SUCCESS_FOCUS_NOT_TERMINAL_STATUS",
    );
    await assertPersistenceUnchanged(session.page, transferPersistence, "P1_TRANSFER_SUCCESS", [team.id, member.user.id]);

    newOwnerSession = await openAccount(member);
    await navigateToSettingsByKeyboard(newOwnerSession.page, team, "P1_TRANSFER_NEW_OWNER");
    assert.equal(await newOwnerSession.page.getByText("OWNER", { exact: true }).count() > 0, true, "P1_TRANSFER_NEW_OWNER_ROLE_NOT_REFRESHED");
    assert.equal(await newOwnerSession.page.getByRole("button", { name: "Передать владение командой", exact: true }).count(), 1, "P1_TRANSFER_NEW_OWNER_ACTION_MISSING");
  } finally {
    await close(newOwnerSession);
    await close(session);
  }
});

test("P1 settings: retry after a lost response or 429 reuses one key, and role target/draft survive a conflict", { timeout: 60_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p1_retry_conflict");
  const session = await openAccount(owner);
  const renameAttempts = [];
  let routeCalls = 0;
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_RETRY");
    const renamePersistence = await snapshotBrowserPersistence(session.page);
    const name = session.page.getByLabel("Название команды", { exact: true });
    assert.equal(await name.count(), 1, "P1_RETRY_RENAME_FIELD_MISSING");
    await tabTo(session.page, name, "P1_RETRY_RENAME_INPUT");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(`${team.name} retry`);
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      routeCalls += 1;
      renameAttempts.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postDataJSON(),
      });
      if (routeCalls === 1) return route.abort("failed");
      if (routeCalls === 2) {
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ code: "RATE_LIMITED" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ outcome: "RENAMED", recovered: true, team: { id: team.id, name: `${team.name} retry`, role: "OWNER", revision: 1 } }),
      });
    });
    const rename = session.page.getByRole("button", { name: /переименовать|сохранить название/i });
    await tabTo(session.page, rename, "P1_RETRY_RENAME_SUBMIT");
    await session.page.keyboard.press("Enter");
    const retry = session.page.getByRole("button", { name: "Повторить", exact: true });
    await retry.waitFor();
    await tabTo(session.page, retry, "P1_RETRY_ACTION");
    await session.page.keyboard.press("Enter");
    await waitForCondition(() => renameAttempts.length === 2, "P1_RETRY_429_REQUEST");
    await session.page.waitForTimeout(50);
    assert.equal(await retry.count(), 1, "P1_RETRY_429_ACTION_MISSING");
    await tabTo(session.page, retry, "P1_RETRY_429_ACTION");
    await session.page.keyboard.press("Enter");
    await waitForCondition(() => renameAttempts.length === 3, "P1_RETRY_REPLAY_REQUEST");
    assert.equal(renameAttempts.length, 3, "P1_RETRY_EXPECTS_LOST_RESPONSE_AND_429_REPLAYS");
    assert.equal(renameAttempts[1].key, renameAttempts[0].key, "P1_RETRY_429_IDEMPOTENCY_KEY_CHANGED");
    assert.equal(renameAttempts[2].key, renameAttempts[0].key, "P1_RETRY_IDEMPOTENCY_KEY_CHANGED");
    assert.deepEqual(renameAttempts.map((attempt) => attempt.body), [
      { name: `${team.name} retry`, revision: 0 },
      { name: `${team.name} retry`, revision: 0 },
      { name: `${team.name} retry`, revision: 0 },
    ], "P1_RETRY_BODY_CHANGED");
    await assertPersistenceUnchanged(
      session.page,
      renamePersistence,
      "P1_RETRY",
      [team.id, `${team.name} retry`, renameAttempts[0].key],
    );

    const role = session.page.getByRole("button", { name: /изменить роль участника/i });
    await tabTo(session.page, role, "P1_CAS_ROLE_ACTION");
    await session.page.keyboard.press("Enter");
    const roleDialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await roleDialog.waitFor();
    const roleTarget = roleDialog.getByLabel("Участник", { exact: true });
    assert.equal(await roleTarget.count(), 1, "P1_CAS_ROLE_TARGET_SELECT_MISSING");
    assert.deepEqual(
      (await roleTarget.locator("option").evaluateAll((options) => options.map((option) => option.value))).sort(),
      [admin.user.id, member.user.id].sort(),
      "P1_CAS_ROLE_TARGET_OPTIONS_WRONG",
    );
    await tabTo(session.page, roleTarget, "P1_CAS_ROLE_TARGET_SELECT");
    await session.page.keyboard.press("ArrowUp");
    assert.equal(await roleTarget.inputValue(), admin.user.id, "P1_CAS_ROLE_ADMIN_TARGET_NOT_SELECTABLE");
    const selectedRole = roleDialog.getByLabel("Роль", { exact: true });
    await tabTo(session.page, selectedRole, "P1_CAS_ROLE_SELECT");
    await session.page.keyboard.press("ArrowDown");
    const rolePersistence = await snapshotBrowserPersistence(session.page);
    await session.page.route(`**/api/teams/${team.id}/members/${admin.user.id}`, async (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "MEMBER_REVISION_CONFLICT", currentRevision: 1 }),
    }));
    const saveRole = roleDialog.getByRole("button", { name: /сохранить|изменить роль/i });
    await tabTo(session.page, saveRole, "P1_CAS_ROLE_SUBMIT");
    await session.page.keyboard.press("Enter");
    await session.page.getByRole("alert").waitFor();
    assert.equal(await selectedRole.inputValue(), "ADMIN", "P1_CAS_DRAFT_NOT_PRESERVED");
    const refresh = session.page.getByRole("button", { name: "Обновить данные", exact: true });
    await tabTo(session.page, refresh, "P1_CAS_REFRESH");
    await assertPersistenceUnchanged(session.page, rolePersistence, "P1_CAS_ROLE", [team.id, admin.user.id]);
  } finally {
    await close(session);
  }
});

test("P1 settings: owner selects an explicit active non-owner before changing the role", { timeout: 60_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p1_role_target");
  const session = await openAccount(owner);
  const roleRequests = [];
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_ROLE_TARGET");
    await session.page.route(`**/api/teams/${team.id}/members/**`, async (route) => {
      roleRequests.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "MEMBER_REVISION_CONFLICT", currentRevision: 1 }),
      });
    });
    const role = session.page.getByRole("button", { name: /изменить роль участника/i });
    await tabTo(session.page, role, "P1_ROLE_TARGET_ACTION");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await dialog.waitFor();
    const target = dialog.getByLabel("Участник", { exact: true });
    assert.equal(await target.count(), 1, "P1_ROLE_TARGET_SELECT_MISSING");
    assert.deepEqual(
      (await target.locator("option").evaluateAll((options) => options.map((option) => option.value))).sort(),
      [admin.user.id, member.user.id].sort(),
      "P1_ROLE_TARGET_OPTIONS_WRONG",
    );
    await tabTo(session.page, target, "P1_ROLE_TARGET_SELECTOR");
    await session.page.keyboard.press("ArrowUp");
    assert.equal(await target.inputValue(), admin.user.id, "P1_ROLE_TARGET_ADMIN_NOT_SELECTED");
    const selectedRole = dialog.getByLabel("Роль", { exact: true });
    await tabTo(session.page, selectedRole, "P1_ROLE_TARGET_ROLE_SELECTOR");
    await session.page.keyboard.press("ArrowUp");
    const save = dialog.getByRole("button", { name: "Сохранить роль", exact: true });
    await tabTo(session.page, save, "P1_ROLE_TARGET_SAVE");
    await session.page.keyboard.press("Enter");
    await session.page.getByRole("alert").waitFor();
    assert.deepEqual(roleRequests, [{
      path: `/api/teams/${team.id}/members/${admin.user.id}`,
      body: { role: "MEMBER", revision: 0 },
    }], "P1_ROLE_TARGET_WRONG_MUTATION");
  } finally {
    await close(session);
  }
});

test("P1 settings: manager audit renders neutral legacy action and clears protected items on an error before retry", { timeout: 60_000 }, async () => {
  const { admin, team } = await managementFixture("p1_audit_privacy");
  const session = await openAccount(admin);
  let auditCalls = 0;
  const auditItems = Object.keys(publicAuditActionLabels).map((action, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    action,
    createdAt: `2026-09-20T12:${String(9 - index).padStart(2, "0")}:00Z`,
    outcome: "SUCCESS",
    actor: index % 2 === 0 ? { userId: admin.user.id, displayName: "Участник" } : null,
    target: null,
    entityId: action.startsWith("INVITATION_") ? `10000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}` : null,
  }));
  try {
    await session.page.route(`**/api/teams/${team.id}/audit-events*`, async (route) => {
      auditCalls += 1;
      if (auditCalls === 2) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEAM_MANAGEMENT_BUSY" }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: auditItems,
          page: 0,
          size: 25,
          totalElements: auditItems.length,
          totalPages: 1,
        }),
      });
    });
    await navigateToSettingsByKeyboard(session.page, team, "P1_AUDIT");
    const auditPersistence = await snapshotBrowserPersistence(session.page);
    const audit = session.page.getByRole("button", { name: "Аудит команды", exact: true });
    assert.equal(await audit.count(), 1, "P1_AUDIT_CONTROL_MISSING");
    await tabTo(session.page, audit, "P1_AUDIT_OPEN");
    await session.page.keyboard.press("Enter");
    for (const [action, label] of Object.entries(publicAuditActionLabels)) {
      await session.page.getByText(label, { exact: true }).waitFor();
      assert.equal(await session.page.getByText(action, { exact: true }).count(), 0, `P1_AUDIT_RAW_${action}_RENDERED`);
    }
    assert.equal(await session.page.getByText(/HISTORICAL_INTERNAL|receipt|before|after/i).count(), 0, "P1_AUDIT_PROHIBITED_FIELD_RENDERED");
    const refresh = session.page.getByRole("button", { name: "Обновить аудит", exact: true });
    await tabTo(session.page, refresh, "P1_AUDIT_REFRESH");
    await session.page.keyboard.press("Enter");
    await session.page.getByRole("alert").waitFor();
    for (const label of Object.values(publicAuditActionLabels)) {
      assert.equal(await session.page.getByText(label, { exact: true }).count(), 0, "P1_AUDIT_STALE_ITEM_DISCLOSED_AFTER_ERROR");
    }
    const retry = session.page.getByRole("button", { name: "Повторить", exact: true });
    await tabTo(session.page, retry, "P1_AUDIT_RETRY");
    await session.page.keyboard.press("Enter");
    await waitForCondition(() => auditCalls === 3, "P1_AUDIT_RETRY_REQUEST");
    assert.equal(auditCalls, 3, "P1_AUDIT_RETRY_DID_NOT_REQUEST_CURRENT_PAGE");
    await assertPersistenceUnchanged(
      session.page,
      auditPersistence,
      "P1_AUDIT",
      [team.id, ...Object.keys(publicAuditActionLabels), ...auditItems.map(({ id }) => id)],
    );
  } finally {
    await close(session);
  }
});

test("P1 settings: manager paginates, deduplicates and refreshes the safe audit list", { timeout: 60_000 }, async () => {
  const { admin, team } = await managementFixture("p1_audit_pagination");
  const session = await openAccount(admin);
  const createItem = (id, action, minute) => ({
    id,
    action,
    createdAt: `2026-09-20T12:${String(minute).padStart(2, "0")}:00Z`,
    outcome: "SUCCESS",
    actor: null,
    target: null,
    entityId: null,
  });
  const firstPage = Array.from({ length: 25 }, (_, index) => createItem(
    `20000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    index % 2 === 0 ? "TEAM_CREATE" : "TEAM_RENAMED",
    59 - index,
  ));
  const secondPage = [
    firstPage[24],
    firstPage[24],
    createItem("30000000-0000-0000-0000-000000000001", "MEMBER_ROLE_UPDATED", 1),
  ];
  const requestedPages = [];
  try {
    await session.page.route(`**/api/teams/${team.id}/audit-events*`, async (route) => {
      const page = Number(new URL(route.request().url()).searchParams.get("page"));
      requestedPages.push(page);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: page === 0 ? firstPage : secondPage,
          page,
          size: 25,
          totalElements: 26,
          totalPages: 2,
        }),
      });
    });
    await navigateToSettingsByKeyboard(session.page, team, "P1_AUDIT_PAGINATION");
    const audit = session.page.getByRole("button", { name: "Аудит команды", exact: true });
    await tabTo(session.page, audit, "P1_AUDIT_PAGINATION_OPEN");
    await session.page.keyboard.press("Enter");
    await session.page.getByText("Страница 1 из 2", { exact: true }).waitFor();
    assert.equal(await session.page.getByRole("listitem").count(), 25, "P1_AUDIT_FIRST_PAGE_SIZE_WRONG");

    const next = session.page.getByRole("button", { name: "Следующая страница аудита", exact: true });
    await tabTo(session.page, next, "P1_AUDIT_NEXT_PAGE");
    await session.page.keyboard.press("Enter");
    await session.page.getByText("Страница 2 из 2", { exact: true }).waitFor();
    assert.deepEqual(requestedPages, [0, 1], "P1_AUDIT_PAGE_REQUESTS_WRONG");
    assert.equal(await session.page.getByRole("listitem").count(), 1, "P1_AUDIT_DUPLICATE_ID_RENDERED");

    const previous = session.page.getByRole("button", { name: "Предыдущая страница аудита", exact: true });
    await tabTo(session.page, previous, "P1_AUDIT_PREVIOUS_PAGE");
    await session.page.keyboard.press("Enter");
    await session.page.getByText("Страница 1 из 2", { exact: true }).waitFor();
    await tabTo(session.page, next, "P1_AUDIT_NEXT_PAGE_AGAIN");
    await session.page.keyboard.press("Enter");
    await session.page.getByText("Страница 2 из 2", { exact: true }).waitFor();
    assert.deepEqual(requestedPages, [0, 1, 0, 1], "P1_AUDIT_PREVIOUS_OR_NEXT_REQUEST_WRONG");

    const refresh = session.page.getByRole("button", { name: "Обновить аудит", exact: true });
    await tabTo(session.page, refresh, "P1_AUDIT_CURRENT_PAGE_REFRESH");
    await session.page.keyboard.press("Enter");
    await waitForCondition(() => requestedPages.length === 5, "P1_AUDIT_REFRESH_REQUEST");
    assert.deepEqual(requestedPages, [0, 1, 0, 1, 1], "P1_AUDIT_REFRESHED_WRONG_PAGE");
  } finally {
    await close(session);
  }
});

test("P1 settings: successful role update withholds revision-bound controls until authority is refreshed", { timeout: 60_000 }, async () => {
  const { owner, member, team } = await managementFixture("p1_role_authority_refresh");
  const session = await openAccount(owner);
  let releaseDetail;
  const detailReleased = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail;
  const detailRequested = new Promise((resolve) => { observeDetail = resolve; });
  const renameAttempts = [];
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_ROLE_AUTHORITY");
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        renameAttempts.push(route.request().postDataJSON());
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Temporary failure" }),
        });
      }
      if (route.request().method() !== "GET") return route.continue();
      observeDetail();
      await detailReleased;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: team.id,
          name: team.name,
          role: "OWNER",
          revision: 1,
          epoch: 0,
          capabilities: [],
        }),
      });
    });
    await session.page.route(`**/api/teams/${team.id}/members/${member.user.id}`, async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        outcome: "ROLE_UPDATED",
        recovered: false,
        member: {
          userId: member.user.id,
          displayName: member.user.displayName,
          role: "ADMIN",
          state: "ACTIVE",
          revision: 1,
        },
      }),
    }));
    const role = session.page.getByRole("button", { name: /изменить роль участника/i });
    await tabTo(session.page, role, "P1_ROLE_AUTHORITY_ACTION");
    await session.page.keyboard.press("Enter");
    const roleDialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await roleDialog.waitFor();
    await roleDialog.getByLabel("Роль", { exact: true }).selectOption("ADMIN");
    await roleDialog.getByRole("button", { name: /сохранить роль/i }).press("Enter");
    await detailRequested;

    const name = session.page.getByLabel("Название команды", { exact: true });
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    const roleAction = session.page.getByRole("button", { name: "Изменить роль участника", exact: true });
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true });
    assert.equal(await name.isDisabled(), true, "P1_ROLE_STALE_NAME_STILL_ENABLED");
    assert.equal(await save.isDisabled(), true, "P1_ROLE_STALE_SAVE_STILL_ENABLED");
    assert.equal(await roleAction.isDisabled(), true, "P1_ROLE_STALE_ROLE_STILL_ENABLED");
    assert.equal(await transfer.isDisabled(), true, "P1_ROLE_STALE_TRANSFER_STILL_ENABLED");
    releaseDetail();
    await session.page.waitForTimeout(200);
    assert.equal(await transfer.isDisabled(), false, "P1_ROLE_TRANSFER_NOT_RESTORED_AFTER_FRESH_DETAIL");
    await tabTo(session.page, name, "P1_ROLE_AUTHORITY_FRESH_NAME");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type("Команда после обновления");
    await tabTo(session.page, save, "P1_ROLE_AUTHORITY_FRESH_SAVE");
    await session.page.keyboard.press("Enter");
    await waitForCondition(() => renameAttempts.length === 1, "P1_ROLE_FRESH_REVISION_NOT_SENT");
    assert.deepEqual(renameAttempts[0], {
      name: "Команда после обновления",
      revision: 1,
    });
  } finally {
    releaseDetail?.();
    await close(session);
  }
});

test("P1 settings: successful rename withholds management controls until authority is refreshed", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_rename_authority_refresh");
  const session = await openAccount(owner);
  let releaseDetail;
  const detailReleased = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail;
  const detailRequested = new Promise((resolve) => { observeDetail = resolve; });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_RENAME_AUTHORITY");
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "RENAMED",
            recovered: false,
            team: { id: team.id, name: `${team.name} обновлена`, role: "OWNER", revision: 1 },
          }),
        });
      }
      if (route.request().method() !== "GET") return route.continue();
      observeDetail();
      await detailReleased;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: team.id, name: `${team.name} обновлена`, role: "OWNER", revision: 1, epoch: 0, capabilities: [] }),
      });
    });
    const name = session.page.getByLabel("Название команды", { exact: true });
    await tabTo(session.page, name, "P1_RENAME_AUTHORITY_NAME");
    await session.page.keyboard.press("Control+A");
    await session.page.keyboard.type(`${team.name} обновлена`);
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    await tabTo(session.page, save, "P1_RENAME_AUTHORITY_SAVE");
    await session.page.keyboard.press("Enter");
    await detailRequested;

    const role = session.page.getByRole("button", { name: /изменить роль участника/i });
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true });
    assert.equal(await name.isDisabled(), true, "P1_RENAME_STALE_NAME_STILL_ENABLED");
    assert.equal(await save.isDisabled(), true, "P1_RENAME_STALE_SAVE_STILL_ENABLED");
    assert.equal(await role.isDisabled(), true, "P1_RENAME_STALE_ROLE_STILL_ENABLED");
    assert.equal(await transfer.isDisabled(), true, "P1_RENAME_STALE_TRANSFER_STILL_ENABLED");
    releaseDetail();
    await session.page.waitForTimeout(200);
    assert.equal(await save.isDisabled(), false, "P1_RENAME_SAVE_NOT_RESTORED_AFTER_FRESH_DETAIL");
  } finally {
    releaseDetail?.();
    await close(session);
  }
});

test("P1 settings: successful transfer withholds remaining management controls until authority is refreshed", { timeout: 60_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p1_transfer_authority_refresh");
  const session = await openAccount(owner);
  let releaseDetail;
  const detailReleased = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail;
  const detailRequested = new Promise((resolve) => { observeDetail = resolve; });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_TRANSFER_AUTHORITY");
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      observeDetail();
      await detailReleased;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: team.id, name: team.name, role: "ADMIN", revision: 1, epoch: 0, capabilities: [] }),
      });
    });
    await session.page.route(`**/api/teams/${team.id}/ownership-transfer`, async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        outcome: "OWNERSHIP_TRANSFERRED",
        recovered: false,
        team: { id: team.id, name: team.name, role: "ADMIN", revision: 1 },
        affectedMembers: [
          { userId: owner.user.id, displayName: owner.user.displayName, role: "ADMIN", state: "ACTIVE", revision: 1 },
          { userId: admin.user.id, displayName: admin.user.displayName, role: "ADMIN", state: "ACTIVE", revision: 1 },
        ],
      }),
    }));
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true });
    await tabTo(session.page, transfer, "P1_TRANSFER_AUTHORITY_ACTION");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: "Передать владение командой", exact: true });
    await dialog.waitFor();
    const target = dialog.getByLabel("Новый владелец", { exact: true });
    await tabTo(session.page, target, "P1_TRANSFER_AUTHORITY_TARGET");
    await session.page.keyboard.press("ArrowDown");
    assert.equal(await target.inputValue(), member.user.id, "P1_TRANSFER_AUTHORITY_TARGET_NOT_SELECTED");
    const confirm = dialog.getByRole("button", { name: "Подтвердить передачу", exact: true });
    await tabTo(session.page, confirm, "P1_TRANSFER_AUTHORITY_CONFIRM");
    await session.page.keyboard.press("Enter");
    await detailRequested;

    const name = session.page.getByLabel("Название команды", { exact: true });
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    assert.equal(await name.isDisabled(), true, "P1_TRANSFER_STALE_NAME_STILL_ENABLED");
    assert.equal(await save.isDisabled(), true, "P1_TRANSFER_STALE_SAVE_STILL_ENABLED");
    releaseDetail();
    await session.page.waitForTimeout(200);
    assert.equal(await save.isDisabled(), false, "P1_TRANSFER_SAVE_NOT_RESTORED_AFTER_FRESH_DETAIL");
  } finally {
    releaseDetail?.();
    await close(session);
  }
});

test("P3 lifecycle settings: manager removes a member and non-owner leaves with explicit confirmation", { timeout: 90_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p3_lifecycle_settings");
  const ownerSession = await openAccount(owner);
  const adminSession = await openAccount(admin);
  try {
    await navigateToSettingsByKeyboard(ownerSession.page, team, "P3_LIFECYCLE_REMOVE");
    const removeAction = ownerSession.page.getByRole("button", { name: "Удалить участника", exact: true });
    await removeAction.click();
    const removeDialog = ownerSession.page.getByRole("dialog", { name: "Удалить участника из команды", exact: true });
    await removeDialog.waitFor();
    await removeDialog.getByLabel("Участник", { exact: true }).selectOption(member.user.id);
    const removeResponse = ownerSession.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "DELETE"
        && url.pathname === `/api/teams/${team.id}/members/${member.user.id}`;
    });
    await removeDialog.getByRole("button", { name: "Удалить участника", exact: true }).click();
    assert.equal((await removeResponse).status(), 200, "P3_REMOVE_MEMBER_REQUEST_FAILED");
    await ownerSession.page.getByText("Участник удалён из команды", { exact: true }).waitFor();
    assert.equal(
      (await raw(`/teams/${team.id}/members`, { token: member.token })).status,
      404,
      "P3_REMOVED_MEMBER_STILL_READS_ROSTER",
    );

    await navigateToSettingsByKeyboard(adminSession.page, team, "P3_LIFECYCLE_LEAVE");
    await adminSession.page.getByRole("button", { name: "Выйти из команды", exact: true }).click();
    const leaveDialog = adminSession.page.getByRole("dialog", { name: "Выйти из команды", exact: true });
    await leaveDialog.waitFor();
    const leaveResponse = adminSession.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST"
        && url.pathname === `/api/teams/${team.id}/leave`;
    });
    await leaveDialog.getByRole("button", { name: "Выйти из команды", exact: true }).click();
    assert.equal((await leaveResponse).status(), 200, "P3_LEAVE_TEAM_REQUEST_FAILED");
    await adminSession.page.getByText("Вы вышли из команды", { exact: true }).waitFor();
    assert.equal(
      (await raw(`/teams/${team.id}/members`, { token: admin.token })).status,
      404,
      "P3_LEFT_MEMBER_STILL_READS_ROSTER",
    );
  } finally {
    await close(ownerSession);
    await close(adminSession);
  }
});

test("P3 suspend settings: manager suspends a member with explicit confirmation", { timeout: 90_000 }, async () => {
  const { owner, member, team } = await managementFixture("p3_suspend_settings");
  const ownerSession = await openAccount(owner);
  try {
    await navigateToSettingsByKeyboard(ownerSession.page, team, "P3_SUSPEND");
    const suspendAction = ownerSession.page.getByRole("button", { name: "Приостановить участника", exact: true });
    await suspendAction.click();
    const suspendDialog = ownerSession.page.getByRole("dialog", { name: "Приостановить участника", exact: true });
    await suspendDialog.waitFor();
    await suspendDialog.getByLabel("Участник", { exact: true }).selectOption(member.user.id);
    const suspendResponse = ownerSession.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST"
        && url.pathname === `/api/teams/${team.id}/members/${member.user.id}/suspend`;
    });
    await suspendDialog.getByRole("button", { name: "Приостановить участника", exact: true }).click();
    assert.equal((await suspendResponse).status(), 200, "P3_SUSPEND_MEMBER_REQUEST_FAILED");
    await ownerSession.page.getByText("Участник приостановлен", { exact: true }).waitFor();
    assert.equal(
      (await raw(`/teams/${team.id}/members`, { token: member.token })).status,
      404,
      "P3_SUSPENDED_MEMBER_STILL_READS_ROSTER",
    );
    assert.deepEqual(
      (await json(`/teams/${team.id}/members`, { token: owner.token })).body.items
        .filter((item) => item.userId === member.user.id),
      [],
      "P3_SUSPENDED_MEMBER_STILL_VISIBLE_IN_ACTIVE_ROSTER",
    );
  } finally {
    await close(ownerSession);
  }
});

test("P3 resume settings: manager sees suspended members and restores one explicitly", { timeout: 90_000 }, async () => {
  const { owner, member, team } = await managementFixture("p3_resume_settings");
  const suspended = await json(`/teams/${team.id}/members/${member.user.id}/suspend`, {
    token: owner.token,
    method: "POST",
    key: randomUUID(),
  });
  assert.equal(suspended.response.status, 200, "P3_RESUME_FIXTURE_SUSPEND_FAILED");

  const ownerSession = await openAccount(owner);
  try {
    await navigateToSettingsByKeyboard(ownerSession.page, team, "P3_RESUME");
    await ownerSession.page.getByText("Приостановленные участники", { exact: true }).waitFor();
    await ownerSession.page.getByText(member.user.displayName, { exact: true }).waitFor();
    const resumeResponse = ownerSession.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST"
        && url.pathname === `/api/teams/${team.id}/members/${member.user.id}/resume`;
    });
    await ownerSession.page.getByRole("button", { name: "Восстановить участника", exact: true }).click();
    assert.equal((await resumeResponse).status(), 200, "P3_RESUME_MEMBER_REQUEST_FAILED");
    await ownerSession.page.getByText("Участник восстановлен", { exact: true }).waitFor();
    assert.equal(
      (await json(`/teams/${team.id}/members`, { token: owner.token })).body.items
        .some((item) => item.userId === member.user.id),
      true,
      "P3_RESUMED_MEMBER_MISSING_FROM_ACTIVE_ROSTER",
    );
    assert.deepEqual(
      (await json(`/teams/${team.id}/members?state=SUSPENDED`, { token: owner.token })).body.items
        .filter((item) => item.userId === member.user.id),
      [],
      "P3_RESUMED_MEMBER_STILL_VISIBLE_IN_SUSPENDED_ROSTER",
    );
  } finally {
    await close(ownerSession);
  }
});
