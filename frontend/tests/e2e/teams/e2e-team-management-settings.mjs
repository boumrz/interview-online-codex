import "../support/require-isolated-api.mjs";
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
      nickname: `${prefix.slice(0, 31 - suffix.length)}_${suffix}`,
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

async function waitForModalInteraction(locator) {
  await locator.evaluate(async (node) => {
    const wrap = node.closest(".ant-modal-wrap");
    if (!wrap) return;
    const modal = node.closest(".ant-modal") ?? wrap.querySelector(".ant-modal");
    const deadline = performance.now() + 6_000;
    let stableFrames = 0;
    let previousBounds;
    while (performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // rc-motion PREPARE/START have no WebAnimation and can still have full-size
      // geometry. Wait for these phases as well as the following zoom animation.
      const inMotionPhase = [...(modal?.classList ?? [])].some((name) =>
        /-(appear|enter|leave)(?:-(prepare|start|active))?$/.test(name));
      const hasAnimation = wrap.getAnimations({ subtree: true }).some((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && (animation.pending || animation.playState === "running" || animation.playState === "paused"));
      const rect = modal?.getBoundingClientRect();
      const bounds = rect && [rect.left, rect.top, rect.width, rect.height];
      const unchanged = bounds && previousBounds
        && bounds.every((value, index) => Math.abs(value - previousBounds[index]) < 0.1);
      stableFrames = !inMotionPhase && !hasAnimation && rect?.width > 0 && rect?.height > 0 && unchanged
        ? stableFrames + 1 : 0;
      previousBounds = bounds;
      if (stableFrames >= 2) return;
    }
    throw new Error("MODAL_ENTRY_MOTION_DID_NOT_SETTLE");
  });
}

async function tabTo(page, locator, marker) {
  await waitForModalInteraction(locator);
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
  await locator.evaluate(async (node) => {
    for (let frame = 0; frame < 60; frame += 1) {
      const focused = node === document.activeElement ? node : node.contains(document.activeElement) ? document.activeElement : null;
      const widget = node.getAttribute("role") === "combobox" ? node.closest(".ant-select") : focused;
      const styles = [focused, widget].filter(Boolean).map((element) => getComputedStyle(element));
      const rect = (widget ?? node).getBoundingClientRect();
      if (focused && rect.width >= 32 && rect.height >= 32 && styles.some((style) => (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none")) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  const metrics = await locator.evaluate((node) => {
    const widget = node.getAttribute("role") === "combobox" ? node.closest(".ant-select") ?? node : node;
    const rect = widget.getBoundingClientRect();
    const focused = document.activeElement === node ? node : node.contains(document.activeElement) ? document.activeElement : node;
    const style = getComputedStyle(focused);
    const widgetStyle = getComputedStyle(widget);
    return {
      active: document.activeElement === node || node.contains(document.activeElement),
      focusVisible: focused.matches(":focus-visible"),
      outline: [style, widgetStyle].some((item) => (item.outlineStyle !== "none" && Number.parseFloat(item.outlineWidth) > 0) || item.boxShadow !== "none"),
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
  assert.equal(metrics.width >= 32, true, `${marker}_WIDTH_BELOW_32: actual=${metrics.width}; class=${metrics.className}`);
  assert.equal(
    metrics.height >= 32,
    true,
    `${marker}_HEIGHT_BELOW_32: actual=${metrics.height}; class=${metrics.className}`,
  );
  assert.equal(metrics.left >= 0 && metrics.right <= metrics.viewportWidth, true, `${marker}_HORIZONTALLY_CLIPPED`);
  assert.equal(metrics.top >= 0 && metrics.bottom <= metrics.viewportHeight, true, `${marker}_VERTICALLY_CLIPPED`);
}

async function navigateToSettingsByKeyboard(page, team, marker) {
  await page.goto(`${web}/workspace/teams/${team.id}/interviews`, { waitUntil: "domcontentloaded" });
  await page.getByRole("main", { name: `Команда ${team.name}: Интервью`, exact: true }).waitFor();
  const settings = page.getByRole("link", { name: "Настройки команды", exact: true });
  await tabTo(page, settings, `${marker}_SETTINGS_GEAR`);
  await page.keyboard.press("Enter");
  await page.waitForURL(`${web}/workspace/teams/${team.id}/settings`);
  await page.getByRole("main", { name: `Команда ${team.name}: Настройки команды`, exact: true }).waitFor();
  await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
}

async function openRenameDialog(page) {
  const action = page.getByRole("button", { name: "Переименовать команду", exact: true });
  await tabTo(page, action, "RENAME_PENCIL");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Переименовать команду", exact: true });
  await dialog.waitFor();
  // A visible opening modal can still move focus/restore its controlled input.
  // Wait for the actual motion before exercising native keyboard input.
  await waitForModalInteraction(dialog);
  return dialog.getByLabel("Название команды", { exact: true });
}

function selectSurface(locator) {
  return locator.locator("xpath=ancestor-or-self::div[contains(concat(' ',normalize-space(@class),' '),' ant-select ')][1]");
}

async function selectedLabel(locator) {
  return (await selectSurface(locator).locator(".ant-select-content").innerText()).trim();
}

async function selectPopup(page, locator) {
  const listId = await locator.getAttribute("aria-controls");
  assert.ok(listId, "SELECT_LIST_RELATION_MISSING");
  return page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id=${JSON.stringify(listId)}]`) });
}

async function chooseSelectByKeyboard(page, locator, label) {
  await tabTo(page, locator, "SELECT_KEYBOARD");
  await page.keyboard.press("Enter");
  const popup = await selectPopup(page, locator);
  await popup.locator(".ant-select-item-option").filter({ hasText: label }).waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const active = await popup.locator(".ant-select-item-option-active").innerText();
    if (active.trim() === label) { await page.keyboard.press("Enter"); return; }
    await page.keyboard.press("ArrowDown");
  }
  assert.fail(`SELECT_OPTION_NOT_KEYBOARD_REACHABLE: ${label}`);
}

async function chooseSelect(page, locator, label) {
  await selectSurface(locator).locator(".ant-select-content").click();
  const popup = await selectPopup(page, locator);
  await popup.locator(".ant-select-item-option").filter({ hasText: label }).click();
}

async function isWithheld(locator) {
  return locator.evaluateAll((nodes) => !nodes.length || nodes.every((node) => !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    || node.disabled || node.getAttribute("aria-disabled") === "true"));
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
    assert.equal(await session.page.getByText("Владелец", { exact: true }).count() > 0, true, "P1_OWNER_EFFECTIVE_ROLE_MISSING");

    const name = await openRenameDialog(session.page);
    assert.equal(await name.count(), 1, "P1_OWNER_RENAME_FIELD_MISSING");
    await tabTo(session.page, name, "P1_OWNER_RENAME_INPUT");
    await session.page.keyboard.press("ControlOrMeta+A");
    await session.page.keyboard.type(`${team.name} новая версия`);
    const rename = session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).getByRole("button", { name: "Сохранить название", exact: true });
    await tabTo(session.page, rename, "P1_OWNER_RENAME_SUBMIT");

    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).getByRole("button", { name: "Отмена", exact: true }).press("Enter");
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await session.page.getByRole("button", { name: /изменить роль участника/i }).first().count(), 1, "P1_OWNER_ROLE_ACTION_MISSING");
    assert.equal(await session.page.getByRole("button", { name: "Передать владение командой", exact: true }).first().count(), 1, "P1_OWNER_TRANSFER_ACTION_MISSING");
    assert.equal(await session.page.getByRole("button", { name: "Аудит команды", exact: true }).count(), 0, "P1_OWNER_REMOVED_AUDIT_VISIBLE");
  } finally {
    await close(session);
  }
});

test("P1 settings: ADMIN has rename but no removed audit or owner-only actions", { timeout: 60_000 }, async () => {
  const { admin, team } = await managementFixture("p1_admin_matrix");
  const session = await openAccount(admin);
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_ADMIN");
    assert.equal(await session.page.getByText("Администратор", { exact: true }).count() > 0, true, "P1_ADMIN_EFFECTIVE_ROLE_MISSING");
    const name = await openRenameDialog(session.page);
    assert.equal(await name.count(), 1, "P1_ADMIN_RENAME_FIELD_MISSING");
    const rename = session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).getByRole("button", { name: "Сохранить название", exact: true });
    await tabTo(session.page, rename, "P1_ADMIN_RENAME_SUBMIT");
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).getByRole("button", { name: "Отмена", exact: true }).press("Enter");
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await session.page.getByRole("button", { name: "Аудит команды", exact: true }).count(), 0);
    assert.equal((await raw(`/teams/${team.id}/audit-events`, { token: admin.token })).status, 404);
    assert.equal(await session.page.getByRole("button", { name: /изменить роль участника/i }).first().count(), 0, "P1_ADMIN_OWNER_ROLE_ACTION_VISIBLE");
    assert.equal(await session.page.getByRole("button", { name: "Передать владение командой", exact: true }).first().count(), 0, "P1_ADMIN_TRANSFER_ACTION_VISIBLE");
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
    assert.equal(await session.page.getByText("Участник", { exact: true }).count() > 0, true, "P1_MEMBER_EFFECTIVE_ROLE_MISSING");
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
    const transfer = session.page.getByRole("row").filter({ hasText: member.user.displayName }).getByRole("button", { name: "Передать владение командой", exact: true });
    assert.equal(await transfer.count(), 1, "P1_TRANSFER_INITIATOR_MISSING");
    await tabTo(session.page, transfer, "P1_TRANSFER_INITIATOR");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: "Передать владение командой", exact: true });
    await dialog.waitFor();
    const cancel = dialog.getByRole("button", { name: /отмена/i });
    await tabTo(session.page, cancel, "P1_TRANSFER_CANCEL");
    await dialog.getByText(member.user.displayName, { exact: true }).waitFor();
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
    await dialog.getByText(member.user.displayName, { exact: true }).waitFor();
    const confirm = dialog.getByRole("button", { name: "Подтвердить передачу", exact: true });
    await tabTo(session.page, confirm, "P1_TRANSFER_CONFIRM");
    await session.page.keyboard.press("Enter");
    const intercepted = await transferReceived;
    assert.match(await intercepted.request().headerValue("Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/i, "P1_TRANSFER_IDEMPOTENCY_KEY_MISSING");
    assert.equal(await session.page.getByText("Владелец", { exact: true }).count() > 0, true, "P1_TRANSFER_OPTIMISTIC_OWNER_CLAIM");
    assert.equal(await transfer.count(), 1, "P1_TRANSFER_ACTION_REMOVED_BEFORE_SERVER_RESPONSE");
    releaseTransfer();
    const success = session.page.getByRole("status").filter({ hasText: "Владение командой передано" });
    await success.waitFor();
    await session.page.getByRole("main").getByText("Администратор", { exact: true }).first().waitFor();
    assert.equal(await transfer.count(), 0, "P1_TRANSFER_FORMER_OWNER_ACTION_STILL_VISIBLE_AFTER_REFRESH");
    const settingsHeading = session.page.getByRole("heading", { name: "Настройки команды", exact: true });
    await session.page.waitForFunction((node) => document.activeElement === node, await settingsHeading.elementHandle());
    assert.equal(await success.evaluate((node) => node.contains(document.activeElement)), false, "P1_TRANSFER_SUCCESS_POPUP_STOLE_FOCUS");
    assert.equal(await success.evaluate((node) => node.closest("main") === null), true, "P1_TRANSFER_SUCCESS_STILL_INLINE");
    await assertPersistenceUnchanged(session.page, transferPersistence, "P1_TRANSFER_SUCCESS", [team.id, member.user.id]);

    newOwnerSession = await openAccount(member);
    await navigateToSettingsByKeyboard(newOwnerSession.page, team, "P1_TRANSFER_NEW_OWNER");
    assert.equal(await newOwnerSession.page.getByText("Владелец", { exact: true }).count() > 0, true, "P1_TRANSFER_NEW_OWNER_ROLE_NOT_REFRESHED");
    assert.equal(await newOwnerSession.page.getByRole("button", { name: "Передать владение командой", exact: true }).first().count(), 1, "P1_TRANSFER_NEW_OWNER_ACTION_MISSING");
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
    const name = await openRenameDialog(session.page);
    assert.equal(await name.count(), 1, "P1_RETRY_RENAME_FIELD_MISSING");
    await tabTo(session.page, name, "P1_RETRY_RENAME_INPUT");
    await session.page.keyboard.press("ControlOrMeta+A");
    await session.page.keyboard.type(`${team.name} retry`);
    assert.equal(await name.inputValue(), `${team.name} retry`, "P1_RETRY_KEYBOARD_DRAFT_NOT_COMMITTED");
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
    const rename = session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).getByRole("button", { name: "Сохранить название", exact: true });
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

    const role = session.page.getByRole("row").filter({ hasText: admin.user.displayName }).getByRole("button", { name: "Изменить роль участника", exact: true });
    await tabTo(session.page, role, "P1_CAS_ROLE_ACTION");
    await session.page.keyboard.press("Enter");
    const roleDialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await roleDialog.waitFor();
    await roleDialog.getByText(admin.user.displayName, { exact: true }).waitFor();
    assert.equal(await roleDialog.getByRole("combobox", { name: "Участник", exact: true }).count(), 0, "row target cannot change in confirmation");
    const selectedRole = roleDialog.getByLabel("Роль", { exact: true });
    await chooseSelectByKeyboard(session.page, selectedRole, "Администратор");
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
    assert.equal(await selectedLabel(selectedRole), "Администратор", "P1_CAS_DRAFT_NOT_PRESERVED");
    await roleDialog.getByText(admin.user.displayName, { exact: true }).waitFor();
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
    const role = session.page.getByRole("row").filter({ hasText: admin.user.displayName }).getByRole("button", { name: "Изменить роль участника", exact: true });
    await tabTo(session.page, role, "P1_ROLE_TARGET_ACTION");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await dialog.waitFor();
    await dialog.getByText(admin.user.displayName, { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("combobox", { name: "Участник", exact: true }).count(), 0, "row target cannot change in confirmation");
    const selectedRole = dialog.getByLabel("Роль", { exact: true });
    await chooseSelectByKeyboard(session.page, selectedRole, "Участник");
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

test("P1 settings: internal audit is absent from UI and public API for every active role", { timeout: 60_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p1_internal_audit");
  for (const auth of [owner, admin, member]) {
    const session = await openAccount(auth); const requests = [];
    session.page.on("request", (request) => { if (request.url().includes("audit-events")) requests.push(request.url()); });
    try {
      await navigateToSettingsByKeyboard(session.page, team, "P1_INTERNAL_AUDIT");
      assert.equal(await session.page.getByRole("button", { name: "Аудит команды", exact: true }).count(), 0);
      assert.equal((await raw(`/teams/${team.id}/audit-events`, { token: auth.token })).status, 404);
      assert.deepEqual(requests, [], "SETTINGS_BROWSER_FETCHED_REMOVED_INTERNAL_AUDIT");
      assertNoManagementPersistence(await snapshotBrowserPersistence(session.page), "P1_INTERNAL_AUDIT", Object.keys(publicAuditActionLabels));
    } finally { await close(session); }
  }
});

test("P1 settings: pagination queries cannot expose the removed public audit", { timeout: 60_000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("p1_no_audit_pages");
  for (const auth of [owner, admin, member]) {
    for (const page of [0, 1]) {
      const result = await json(`/teams/${team.id}/audit-events?page=${page}&size=25`, { token: auth.token });
      assert.equal(result.response.status, 404);
      assert.equal(JSON.stringify(result.body).includes("LEGACY_UNCLASSIFIED"), false);
      assert.equal(JSON.stringify(result.body).includes(owner.user.id), false);
    }
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
    const role = session.page.getByRole("button", { name: /изменить роль участника/i }).first();
    await tabTo(session.page, role, "P1_ROLE_AUTHORITY_ACTION");
    await session.page.keyboard.press("Enter");
    const roleDialog = session.page.getByRole("dialog", { name: /изменить роль участника/i });
    await roleDialog.waitFor();
    await chooseSelect(session.page, roleDialog.getByLabel("Роль", { exact: true }), "Администратор");
    await roleDialog.getByRole("button", { name: /сохранить роль/i }).press("Enter");
    await detailRequested;
    await session.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const name = session.page.getByLabel("Название команды", { exact: true });
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    const roleAction = session.page.getByRole("button", { name: "Изменить роль участника", exact: true }).first();
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true }).first();
    assert.equal(await isWithheld(name), true, "P1_ROLE_STALE_NAME_STILL_ENABLED");
    assert.equal(await isWithheld(save), true, "P1_ROLE_STALE_SAVE_STILL_ENABLED");
    assert.equal(await isWithheld(roleAction), true, "P1_ROLE_STALE_ROLE_STILL_ENABLED");
    assert.equal(await isWithheld(transfer), true, "P1_ROLE_STALE_TRANSFER_STILL_ENABLED");
    releaseDetail();
    await session.page.waitForTimeout(200);
    assert.equal(await transfer.isDisabled(), false, "P1_ROLE_TRANSFER_NOT_RESTORED_AFTER_FRESH_DETAIL");
    const freshName = await openRenameDialog(session.page);
    await tabTo(session.page, freshName, "P1_ROLE_AUTHORITY_FRESH_NAME");
    await session.page.keyboard.press("ControlOrMeta+A");
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
    const name = await openRenameDialog(session.page);
    await tabTo(session.page, name, "P1_RENAME_AUTHORITY_NAME");
    await session.page.keyboard.press("ControlOrMeta+A");
    await session.page.keyboard.type(`${team.name} обновлена`);
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    await tabTo(session.page, save, "P1_RENAME_AUTHORITY_SAVE");
    await session.page.keyboard.press("Enter");
    await detailRequested;
    await session.page.getByRole("status").filter({ hasText: "Проверяем актуальные права" }).waitFor();
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).waitFor({ state: "hidden" });

    const role = session.page.getByRole("button", { name: /изменить роль участника/i }).first();
    const transfer = session.page.getByRole("button", { name: "Передать владение командой", exact: true }).first();
    assert.equal(await isWithheld(name), true, "P1_RENAME_STALE_NAME_STILL_ENABLED");
    assert.equal(await isWithheld(save), true, "P1_RENAME_STALE_SAVE_STILL_ENABLED");
    assert.equal(await isWithheld(role), true, "P1_RENAME_STALE_ROLE_STILL_ENABLED");
    assert.equal(await isWithheld(transfer), true, "P1_RENAME_STALE_TRANSFER_STILL_ENABLED");
    releaseDetail();
    await session.page.getByRole("status").filter({ hasText: "Проверяем актуальные права" }).waitFor({ state: "hidden" });
    const freshName = await openRenameDialog(session.page);
    assert.equal(await freshName.isDisabled(), false, "P1_RENAME_INPUT_NOT_RESTORED_AFTER_FRESH_DETAIL");
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
    const transfer = session.page.getByRole("row").filter({ hasText: member.user.displayName }).getByRole("button", { name: "Передать владение командой", exact: true });
    await tabTo(session.page, transfer, "P1_TRANSFER_AUTHORITY_ACTION");
    await session.page.keyboard.press("Enter");
    const dialog = session.page.getByRole("dialog", { name: "Передать владение командой", exact: true });
    await dialog.waitFor();
    await dialog.getByText(member.user.displayName, { exact: true }).waitFor();
    const confirm = dialog.getByRole("button", { name: "Подтвердить передачу", exact: true });
    await tabTo(session.page, confirm, "P1_TRANSFER_AUTHORITY_CONFIRM");
    await session.page.keyboard.press("Enter");
    await detailRequested;
    await session.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const name = session.page.getByLabel("Название команды", { exact: true });
    const save = session.page.getByRole("button", { name: "Сохранить название", exact: true });
    assert.equal(await isWithheld(name), true, "P1_TRANSFER_STALE_NAME_STILL_ENABLED");
    assert.equal(await isWithheld(save), true, "P1_TRANSFER_STALE_SAVE_STILL_ENABLED");
    releaseDetail();
    await session.page.waitForTimeout(200);
    const freshName = await openRenameDialog(session.page);
    assert.equal(await freshName.isDisabled(), false, "P1_TRANSFER_INPUT_NOT_RESTORED_AFTER_FRESH_DETAIL");
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
    const removeAction = ownerSession.page.getByRole("row").filter({ hasText: member.user.displayName }).getByRole("button", { name: "Удалить участника", exact: true });
    await removeAction.click();
    const removeDialog = ownerSession.page.getByRole("dialog", { name: "Удалить участника из команды", exact: true });
    await removeDialog.waitFor();
    await removeDialog.getByText(member.user.displayName, { exact: true }).waitFor();
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

test("P3 legacy settings: new suspension is absent and cannot mutate an active member", { timeout: 90_000 }, async () => {
  const { owner, member, team } = await managementFixture("p3_no_new_suspend");
  const ownerSession = await openAccount(owner);
  try {
    await navigateToSettingsByKeyboard(ownerSession.page, team, "P3_NO_NEW_SUSPEND");
    assert.equal(await ownerSession.page.getByRole("button", { name: "Приостановить участника", exact: true }).count(), 0);
    assert.equal(await ownerSession.page.getByRole("button", { name: "Удалить участника", exact: true }).first().count(), 1);
    const result = await raw(`/teams/${team.id}/members/${member.user.id}/suspend`, {
      token: owner.token, method: "POST", key: randomUUID(),
    });
    assert.equal(result.status, 404, "P3_REMOVED_SUSPEND_ENDPOINT_STILL_AVAILABLE");
    assert.equal((await json(`/teams/${team.id}/members`, { token: owner.token })).body.items
      .some((item) => item.userId === member.user.id && item.state === "ACTIVE"), true,
      "P3_REJECTED_SUSPEND_MUTATED_ACTIVE_MEMBER");
  } finally { await close(ownerSession); }
});

test("P3 legacy settings: suspended roster remains manager-only without exposing transition controls", { timeout: 90_000 }, async () => {
  const { owner, member, team } = await managementFixture("p3_legacy_roster");
  const ownerSession = await openAccount(owner);
  const memberSession = await openAccount(member);
  try {
    await navigateToSettingsByKeyboard(ownerSession.page, team, "P3_LEGACY_OWNER");
    assert.equal(await ownerSession.page.getByRole("button", { name: /Приостановить|Восстановить участника/ }).count(), 0);
    assert.equal((await raw(`/teams/${team.id}/members?state=SUSPENDED`, { token: owner.token })).status, 200);
    assert.equal((await raw(`/teams/${team.id}/members?state=SUSPENDED`, { token: member.token })).status, 403,
      "P3_MEMBER_CAN_READ_LEGACY_SUSPENDED_ROSTER");
    await navigateToSettingsByKeyboard(memberSession.page, team, "P3_LEGACY_MEMBER");
    assert.equal(await memberSession.page.getByText("Приостановленные участники", { exact: true }).count(), 0);
    assert.equal(await memberSession.page.getByRole("button", { name: /Приостановить|Восстановить участника/ }).count(), 0);
  } finally { await close(ownerSession); await close(memberSession); }
});

test("P1 settings: unchanged Save or Enter replays a committed rename with the same intent", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_rename_save_replay");
  const session = await openAccount(owner);
  const attempts = [];
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_RENAME_SAVE_REPLAY");
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts.push({ key: await route.request().headerValue("Idempotency-Key"), body: route.request().postDataJSON() });
      if (attempts.length === 1) {
        const committed = await route.fetch();
        assert.equal(committed.status(), 200, "RENAME_FIRST_ATTEMPT_MUST_COMMIT");
        return route.abort("failed");
      }
      return route.continue();
    });
    const field = await openRenameDialog(session.page);
    const renamed = `${team.name} replay`;
    await field.fill(renamed);
    const dialog = session.page.getByRole("dialog", { name: "Переименовать команду", exact: true });
    await dialog.getByRole("button", { name: "Сохранить название", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await field.inputValue(), renamed, "RENAME_RETRY_LOST_DRAFT");
    await dialog.getByRole("button", { name: "Повторить", exact: true }).waitFor();
    const replay = session.page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/teams/${team.id}`);
    // Submitting the same form is also a retry and must not mint another key.
    await field.press("Enter");
    assert.equal((await replay).status(), 200);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].key, attempts[0].key, "UNCHANGED_SAVE_CHANGED_IDEMPOTENCY_KEY");
    assert.deepEqual(attempts[1].body, attempts[0].body);
    assert.equal((await json(`/teams/${team.id}`, { token: owner.token })).body.name, renamed);
  } finally { await close(session); }
});

for (const responseStatus of [403, 503]) {
  test(`P1 settings: mutation refresh ${responseStatus} hides controls after preserving the pending success state`, { timeout: 60_000 }, async () => {
    const { owner, team } = await managementFixture(`p1_mutation_${responseStatus}`);
    const session = await openAccount(owner);
    let releaseDetail;
    const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
    let observeDetail;
    const detailRequested = new Promise((resolve) => { observeDetail = resolve; });
    try {
      await navigateToSettingsByKeyboard(session.page, team, `P1_MUTATION_${responseStatus}`);
      await session.page.route(`**/api/teams/${team.id}`, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        observeDetail();
        await detailGate;
        return route.fulfill({ status: responseStatus, contentType: "application/json", body: JSON.stringify({ error: "TEAM_UNAVAILABLE" }) });
      });
      const name = await openRenameDialog(session.page);
      await name.fill(`${team.name} updated`);
      await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true })
        .getByRole("button", { name: "Сохранить название", exact: true }).click();
      await detailRequested;
      const status = session.page.getByRole("status").filter({ hasText: "Название команды сохранено" });
      await status.waitFor();
      assert.equal(await status.evaluate((node) => node.contains(document.activeElement)), false,
        "MUTATION_REFRESH_SUCCESS_POPUP_STOLE_FOCUS");
      assert.equal(await status.evaluate((node) => node.closest("main") === null), true,
        "MUTATION_REFRESH_SUCCESS_STILL_INLINE");
      assert.equal(await session.page.getByRole("button", { name: "Изменить роль участника", exact: true }).first().isDisabled(), true);
      assert.equal(await session.page.getByRole("button", { name: "Передать владение командой", exact: true }).first().isDisabled(), true);
      releaseDetail();
      await session.page.getByRole("alert").filter({ hasText: "Команда недоступна" }).waitFor();
      assert.equal(await session.page.getByRole("button", { name: /Переименовать команду|Изменить роль участника|Передать владение командой/ }).count(), 0,
        "FAILED_MUTATION_REFRESH_RESTORED_STALE_MANAGEMENT");
      assert.equal(await session.page.getByLabel("Название команды", { exact: true }).count(), 0);
      assert.equal(await session.page.getByRole("navigation", { name: "Разделы команды", exact: true }).count(), 0);
    } finally { releaseDetail?.(); await close(session); }
  });
}

test("P1 settings: late team-A rename cannot abort team-B authority or restore its success surface", { timeout: 60_000 }, async () => {
  const { owner, team: teamA } = await managementFixture("p1_late_mutation_a");
  const teamB = await createTeam(owner, `B authority ${unique()}`);
  const session = await openAccount(owner);
  let releasePatch; const patchGate = new Promise((resolve) => { releasePatch = resolve; });
  let observePatch; const patchStarted = new Promise((resolve) => { observePatch = resolve; });
  let releaseDetail; const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail; const detailStarted = new Promise((resolve) => { observeDetail = resolve; });
  let abortedDetail = false;
  session.page.on("requestfailed", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === `/api/teams/${teamB.id}`) abortedDetail = true;
  });
  try {
    await navigateToSettingsByKeyboard(session.page, teamA, "P1_LATE_MUTATION_A");
    await session.page.route(`**/api/teams/${teamA.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      observePatch(); await patchGate; return route.continue();
    });
    await session.page.route(`**/api/teams/${teamB.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      observeDetail(); await detailGate; return route.continue();
    });
    const field = await openRenameDialog(session.page);
    const renamedA = `${teamA.name} late`;
    await field.fill(renamedA);
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true })
      .getByRole("button", { name: "Сохранить название", exact: true }).click();
    await patchStarted;
    await session.page.keyboard.press("Escape");
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).waitFor({ state: "hidden" });
    await session.page.getByRole("button", { name: /^Команды:/ }).click();
    await session.page.getByRole("menuitemradio", { name: teamB.name, exact: true }).click();
    await session.page.waitForURL(`**/workspace/teams/${teamB.id}/interviews`);
    await detailStarted;
    const lateResponse = session.page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/teams/${teamA.id}`);
    releasePatch(); assert.equal((await lateResponse).status(), 200);
    await session.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(abortedDetail, false, "LATE_A_CALLBACK_ABORTED_B_AUTHORITY_REQUEST");
    assert.equal(await session.page.getByRole("status").filter({ hasText: "Название команды сохранено" }).count(), 0,
      "LATE_A_CALLBACK_RESTORED_A_SUCCESS_IN_B");
    releaseDetail();
    await session.page.getByRole("main", { name: `Команда ${teamB.name}: Интервью`, exact: true }).waitFor();
    assert.doesNotMatch(await session.page.locator("body").innerText(), new RegExp(renamedA));
    assert.equal((await json(`/teams/${teamA.id}`, { token: owner.token })).body.name, renamedA,
      "OLD_COMMAND_MUST_COMMIT_ONLY_TO_ORIGINAL_TEAM");
  } finally { releasePatch?.(); releaseDetail?.(); await close(session); }
});

test("P1 settings: conflict refresh retains the draft and withholds actions until fresh authority", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_conflict_authority");
  const session = await openAccount(owner);
  let releaseDetail; const gate = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail; const started = new Promise((resolve) => { observeDetail = resolve; });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_CONFLICT_AUTHORITY");
    const canonical = (await json(`/teams/${team.id}`, { token: owner.token })).body;
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() === "PATCH") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "TEAM_REVISION_CONFLICT" }) });
      if (route.request().method() !== "GET") return route.continue();
      observeDetail(); await gate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...canonical, revision: canonical.revision + 1 }) });
    });
    const field = await openRenameDialog(session.page);
    const draft = `${team.name} unsaved draft`;
    await field.fill(draft);
    const dialog = session.page.getByRole("dialog", { name: "Переименовать команду", exact: true });
    const save = dialog.getByRole("button", { name: "Сохранить название", exact: true });
    await save.click();
    await dialog.getByRole("alert").waitFor();
    await dialog.getByRole("button", { name: "Обновить данные", exact: true }).click();
    await started;
    assert.equal(await field.inputValue(), draft, "CONFLICT_REFRESH_LOST_PENDING_DRAFT");
    assert.equal(await save.isDisabled(), true, "CONFLICT_REFRESH_LEFT_STALE_SAVE_ENABLED");
    assert.equal(await session.page.getByRole("button", { name: "Изменить роль участника", exact: true }).first().isDisabled(), true);
    releaseDetail();
    await save.waitFor({ state: "visible" });
    await session.page.waitForFunction(() => !document.querySelector('[role="dialog"] button[type="submit"]')?.disabled);
    assert.equal(await field.inputValue(), draft, "FRESH_AUTHORITY_REPLACED_UNSAVED_CONFLICT_DRAFT");
    assert.equal(await dialog.count(), 1, "CONFLICT_REFRESH_UNMOUNTED_DIALOG");
  } finally { releaseDetail?.(); await close(session); }
});

test("P1 settings: same-context focus authority response preserves native keyboard input in the rename dialog", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_focus_keyboard_draft");
  const session = await openAccount(owner);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let observe; const started = new Promise((resolve) => { observe = resolve; });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_FOCUS_KEYBOARD_DRAFT");
    const canonical = (await json(`/teams/${team.id}`, { token: owner.token })).body;
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      observe(); await gate;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...canonical, name: `${team.name} remote`, revision: canonical.revision + 1 }) });
    });
    const field = await openRenameDialog(session.page);
    await tabTo(session.page, field, "P1_FOCUS_KEYBOARD_DRAFT_INPUT");
    await field.press("ControlOrMeta+A");
    await session.page.keyboard.type("Keyboard partial ");
    assert.equal(await field.inputValue(), "Keyboard partial ");
    await session.page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    await started;
    release();
    await session.page.getByText(`${team.name} remote`, { exact: true }).first().waitFor();
    assert.equal(await field.inputValue(), "Keyboard partial ", "SAME_CONTEXT_AUTHORITY_REPLACED_KEYBOARD_DRAFT");
    await field.press("End");
    await session.page.keyboard.type("retained");
    assert.equal(await field.inputValue(), "Keyboard partial retained");
    assert.equal(await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true }).count(), 1);
  } finally { release?.(); await close(session); }
});

test("P1 settings: focus during mutation authority refresh cannot restore stale controls before failure or retry", { timeout: 60_000 }, async () => {
  const { owner, team } = await managementFixture("p1_mutation_focus");
  const session = await openAccount(owner);
  let releaseDetail; const gate = new Promise((resolve) => { releaseDetail = resolve; });
  let observeDetail; const started = new Promise((resolve) => { observeDetail = resolve; });
  let focusReturned = false; let authorityAborted = false; let failAuthority = true;
  session.page.on("requestfailed", (request) => {
    if (focusReturned && request.method() === "GET" && new URL(request.url()).pathname === `/api/teams/${team.id}`) authorityAborted = true;
  });
  try {
    await navigateToSettingsByKeyboard(session.page, team, "P1_MUTATION_FOCUS");
    await session.page.route(`**/api/teams/${team.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      observeDetail(); await gate;
      if (failAuthority) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARILY_UNAVAILABLE" }) });
      return route.continue();
    });
    const field = await openRenameDialog(session.page);
    await field.fill(`${team.name} renamed`);
    await session.page.getByRole("dialog", { name: "Переименовать команду", exact: true })
      .getByRole("button", { name: "Сохранить название", exact: true }).click();
    await started;
    const action = session.page.getByRole("button", { name: "Изменить роль участника", exact: true }).first();
    await session.page.getByRole("status").filter({ hasText: "Проверяем актуальные права" }).waitFor();
    assert.equal(await action.isDisabled(), true);
    focusReturned = true;
    await session.page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    await session.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await action.isDisabled(), true, "FOCUS_ABORT_REENABLED_STALE_MANAGEMENT");
    assert.equal(authorityAborted, false, "FOCUS_ABORTED_IN_PROGRESS_MUTATION_AUTHORITY");
    releaseDetail();
    await session.page.getByRole("alert").filter({ hasText: "Команда недоступна" }).waitFor();
    assert.equal(await action.count(), 0, "FAILED_AUTHORITY_EXPOSED_OLD_OWNER_CONTROLS");
    failAuthority = false;
    await session.page.getByRole("button", { name: "Повторить", exact: true }).click();
    await action.waitFor();
    assert.equal(await action.isDisabled(), false, "SUCCESSFUL_AUTHORITY_RETRY_DID_NOT_RELEASE_ACTIONS");
  } finally { releaseDetail?.(); await close(session); }
});

for (const downgrade of ["rename", "role"]) {
  test(`P1 settings: fresh authority downgrade closes the ${downgrade} dialog and does not restore its draft`, { timeout: 60_000 }, async () => {
    const { owner, admin, team } = await managementFixture(`p1_downgrade_${downgrade}`);
    const auth = downgrade === "rename" ? admin : owner;
    const session = await openAccount(auth);
    let releaseDetail; const gate = new Promise((resolve) => { releaseDetail = resolve; });
    let observeDetail; const started = new Promise((resolve) => { observeDetail = resolve; });
    try {
      await navigateToSettingsByKeyboard(session.page, team, `P1_DOWNGRADE_${downgrade}`);
      const dialogName = downgrade === "rename" ? "Переименовать команду" : "Изменить роль участника";
      if (downgrade === "rename") await (await openRenameDialog(session.page)).fill("Protected stale rename draft");
      else await session.page.getByRole("button", { name: dialogName, exact: true }).first().click();
      const dialog = session.page.getByRole("dialog", { name: dialogName, exact: true });
      await session.page.route(`**/api/teams/${team.id}**`, async (route) => {
        if (route.request().method() === "PATCH") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "TEAM_REVISION_CONFLICT" }) });
        if (route.request().method() !== "GET" || new URL(route.request().url()).pathname !== `/api/teams/${team.id}`) return route.continue();
        observeDetail(); await gate; return route.continue();
      });
      await dialog.getByRole("button", { name: downgrade === "rename" ? "Сохранить название" : "Сохранить роль", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      if (downgrade === "rename") {
        const roster = (await json(`/teams/${team.id}/members`, { token: owner.token })).body.items;
        const target = roster.find((member) => member.userId === admin.user.id);
        assert.equal((await raw(`/teams/${team.id}/members/${admin.user.id}`, { token: owner.token, method: "PATCH", key: randomUUID(), body: { role: "MEMBER", revision: target.revision } })).status, 200);
      } else {
        assert.equal((await raw(`/teams/${team.id}/ownership-transfer`, { token: owner.token, method: "POST", key: randomUUID(), body: { targetUserId: admin.user.id, revision: team.revision } })).status, 200);
      }
      await dialog.getByRole("button", { name: "Обновить данные", exact: true }).click();
      await started;
      releaseDetail();
      await session.page.getByText(`Ваша роль: ${downgrade === "rename" ? "Участник" : "Администратор"}`, { exact: true }).waitFor();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await session.page.getByRole("button", { name: downgrade === "rename" ? "Переименовать команду" : "Изменить роль участника", exact: true }).count(), 0,
        "CONFIRMED_DOWNGRADE_LEFT_PROTECTED_ACTION_VISIBLE");
      assert.doesNotMatch(await session.page.locator("body").innerText(), /Protected stale rename draft/);
      if (downgrade === "rename") {
        const roster = (await json(`/teams/${team.id}/members`, { token: owner.token })).body.items;
        const target = roster.find((member) => member.userId === admin.user.id);
        assert.equal((await raw(`/teams/${team.id}/members/${admin.user.id}`, { token: owner.token, method: "PATCH", key: randomUUID(), body: { role: "ADMIN", revision: target.revision } })).status, 200);
      } else {
        const current = (await json(`/teams/${team.id}`, { token: admin.token })).body;
        assert.equal((await raw(`/teams/${team.id}/ownership-transfer`, { token: admin.token, method: "POST", key: randomUUID(), body: { targetUserId: owner.user.id, revision: current.revision } })).status, 200);
      }
      await session.page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
      await session.page.getByText(`Ваша роль: ${downgrade === "rename" ? "Администратор" : "Владелец"}`, { exact: true }).waitFor();
      await session.page.getByRole("button", { name: dialogName, exact: true }).first().waitFor();
      assert.equal(await dialog.count(), 0, "REGRANT_REOPENED_PREVIOUSLY_REVOKED_DIALOG");
      assert.doesNotMatch(await session.page.locator("body").innerText(), /Protected stale rename draft/);
    } finally { releaseDetail?.(); await close(session); }
  });
}
