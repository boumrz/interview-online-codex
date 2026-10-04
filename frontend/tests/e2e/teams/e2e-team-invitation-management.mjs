import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const password = "test-password-123";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const headedFocusLifecycleEnabled = process.env.E2E_TEAM_INVITATIONS_HEADED_FOCUS === "1";
const nativeAxTestId = "teams/invitation-native-ax-lifecycle";
const nativeAxLifecycleRequested = (
  process.env.E2E_TEAM_INVITATIONS_NATIVE_AX === "1"
  && process.env.E2E_NATIVE_AX_LOCAL_ONLY === "1"
  && process.env.E2E_NATIVE_AX_ALLOW_OS_FOCUS === "1"
  && process.env.E2E_NATIVE_AX_TEST_ID === nativeAxTestId
);
const nativeAxLauncherUrl = new URL("../native-ax/run-native-ax-lifecycle.mjs", import.meta.url);
let browserClientIpSequence = Math.floor(Math.random() * 130_000);
let browser;

function nextBrowserClientIp() {
  // RFC 2544 reserves 198.18.0.0/15 for benchmarking. A browser context is
  // a distinct synthetic client; direct raw() calls intentionally keep their
  // loopback source so rate-limit tests still cover one client identity.
  browserClientIpSequence = (browserClientIpSequence + 1) % 130_000;
  const address = browserClientIpSequence + 1;
  return `198.${18 + Math.floor(address / 65_536)}.${Math.floor((address % 65_536) / 256)}.${address % 256}`;
}

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
  assert.equal(result.response.status, 200, "AC03_MANAGEMENT_ACCOUNT_FIXTURE_UNAVAILABLE");
  return result.body;
}

async function createTeam(owner, name) {
  const result = await json("/teams", {
    token: owner.token,
    method: "POST",
    key: randomUUID(),
    body: { name },
  });
  assert.equal(result.response.status, 201, "AC03_MANAGEMENT_TEAM_FIXTURE_UNAVAILABLE");
  return result.body.team ?? result.body;
}

async function managementFixture(prefix, teamName = `Atlas ${unique()}`) {
  const owner = await account(`${prefix}_owner`);
  const admin = await account(`${prefix}_admin`);
  const member = await account(`${prefix}_member`);
  const invitee = await account(`${prefix}_invitee`);
  const team = await createTeam(owner, teamName);
  const fixture = await json("/test-fixtures/team-invitations/management", {
    token: owner.token,
    method: "POST",
    body: {
      teamId: team.id,
      adminUserId: admin.user.id,
      memberUserId: member.user.id,
    },
  });
  assert.equal(fixture.response.status, 201, "AC03_MANAGEMENT_ROLE_BOOTSTRAP_UNAVAILABLE");
  assert.deepEqual(
    [fixture.body.owner.role, fixture.body.admin.role, fixture.body.member.role],
    ["OWNER", "ADMIN", "MEMBER"],
    "fixture must expose three distinct effective roles without invitation data",
  );
  assert.equal(new Set([fixture.body.owner.userId, fixture.body.admin.userId, fixture.body.member.userId]).size, 3);
  assert.equal("url" in fixture.body || "token" in fixture.body, false, "bootstrap must not mint invitation secrets");
  return { owner, admin, member, invitee, team };
}

async function openAccount(
  auth,
  path,
  viewport = { width: 1280, height: 720 },
  beforeNavigate,
  { browserInstance = browser, observeLifecycle = false, suppressNativeWindowFocus = false } = {},
) {
  const context = await browserInstance.newContext({ viewport });
  const clientIp = nextBrowserClientIp();
  const clientHeaders = {
    Forwarded: `for=${clientIp}`,
    "X-Forwarded-For": clientIp,
  };
  await context.setExtraHTTPHeaders(clientHeaders);
  await context.route("**/api/**", async (route) => {
    const target = new URL(route.request().url());
    const apiOrigin = new URL(api);
    await route.continue({
      url: apiOrigin.origin + target.pathname + target.search,
      headers: { ...route.request().headers(), forwarded: clientHeaders.Forwarded, "x-forwarded-for": clientIp },
    });
  });
  if (observeLifecycle) {
    await context.addInitScript(() => {
      const events = [];
      const record = (type, event) => {
        events.push({
          type,
          order: events.length,
          timestamp: Date.now(),
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          isTrusted: event.isTrusted,
        });
      };
      Object.defineProperty(window, "__ac03LifecycleEvents", {
        configurable: true,
        value: events,
      });
      window.addEventListener("blur", (event) => record("blur", event));
      window.addEventListener("focus", (event) => record("focus", event));
      document.addEventListener("visibilitychange", (event) => record("visibilitychange", event));
    });
  }
  if (suppressNativeWindowFocus) {
    await context.addInitScript(() => {
      // Headless Chromium can emit native window focus/blur as Tab moves
      // between controls. Keep that emulator artifact out of this keyboard
      // geometry cell; foregroundForTeamRevalidation uses a separate tab for
      // revalidation and reserves lifecycle assertions for headed evidence.
      const suppressNativeWindowFocus = (event) => {
        if (event.isTrusted && !window.__ac03AllowNativeWindowFocus) event.stopImmediatePropagation();
      };
      window.addEventListener("blur", suppressNativeWindowFocus, true);
      window.addEventListener("focus", suppressNativeWindowFocus, true);
    });
  }
  await context.addInitScript(({ token, user }) => {
    const accountSeedKey = "__ac03-e2e-account-seeded";
    if (sessionStorage.getItem(accountSeedKey) !== "1") {
      sessionStorage.setItem(accountSeedKey, "1");
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.setItem("display_name", user.displayName);
    }
    window.__ac03ClipboardMode = "success";
    window.__ac03ClipboardWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          if (window.__ac03ClipboardMode === "failure") throw new DOMException("Denied", "NotAllowedError");
          window.__ac03ClipboardWrites.push(value);
        },
      },
    });
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  beforeNavigate?.(page);
  await page.goto(new URL(path, web).href, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached" });
  return { context, page };
}

function invitation(body) {
  return body.invitation ?? body;
}

function secretFromUrl(url) {
  let fragment = "";
  try {
    fragment = typeof url === "string" ? new URL(url, web).hash : "";
  } catch {
    fragment = "";
  }
  assert.equal(/^#token=[A-Za-z0-9_-]{43}$/.test(fragment), true, "INVITATION_REVEAL_MALFORMED_FRAGMENT");
  return fragment.slice("#token=".length);
}

async function assertSecretAbsent(page, secret, marker) {
  const exposed = await page.evaluate((value) => {
    const storageIsClean = (storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)))
      .every((item) => !String(item).includes(value));
    return {
      route: location.href.includes(value),
      history: JSON.stringify(history.state ?? {}).includes(value),
      text: document.body.innerText.includes(value),
      html: document.documentElement.innerHTML.includes(value),
      local: !storageIsClean(localStorage),
      session: !storageIsClean(sessionStorage),
    };
  }, secret);
  assert.deepEqual(exposed, { route: false, history: false, text: false, html: false, local: false, session: false }, marker);
}

function redactSecretsInValue(value, secrets, seen = new WeakSet()) {
  if (typeof value === "string") {
    return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"), value);
  }
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const redacted = redactSecretsInValue(descriptor.value, secrets, seen);
    if (redacted === descriptor.value) continue;
    try {
      Object.defineProperty(value, key, { ...descriptor, value: redacted });
    } catch {
      try { value[key] = redacted; } catch {}
    }
  }
  return value;
}

function valueContainsSecret(value, secret, seen = new WeakSet()) {
  if (typeof value === "string") return value.includes(secret);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && valueContainsSecret(descriptor.value, secret, seen));
  });
}

async function withRedactedSecrets(secrets, action) {
  try {
    return await action();
  } catch (error) {
    throw redactSecretsInValue(error, secrets.filter(Boolean));
  }
}

async function waitForInvitationResponse(page, teamId, operation = "create") {
  return page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    const expected = operation === "create"
      ? `/api/teams/${teamId}/invitations`
      : `/api/teams/${teamId}/invitations/`;
    return candidate.request().method() === "POST"
      && (operation === "create" ? url.pathname === expected : url.pathname.startsWith(expected) && url.pathname.endsWith(`/${operation}`));
  });
}

async function assertKeyboardTarget(page, locator, marker) {
  // Ant Design may update its focused link outline on a following animation
  // frame. Observe the actual visible indicator before measuring its bounds.
  const handle = await locator.elementHandle();
  try {
    await page.waitForFunction(node => {
      const style = getComputedStyle(node);
      const animationRoot = node.closest('.ant-dropdown') ?? node;
      const moving = animationRoot.getAnimations({ subtree: true }).some(animation =>
        (animation.playState === 'running' || animation.pending)
        && Number.isFinite(animation.effect?.getComputedTiming().endTime));
      return document.activeElement === node && node.matches(":focus-visible")
        && !moving
        && ((style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none");
    }, handle, { timeout: 1500 });
  } finally { await handle.dispose(); }
  const metrics = await locator.evaluate((node) => {
    const focusRect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const menuitem = node.closest('[role="menuitem"]');
    const linkOverlay = getComputedStyle(node, '::after');
    // Ant Dropdown preserves a real anchor and extends its actual hit area
    // over the menuitem with an absolute inset:0 pseudo-element.
    const expandedLinkTarget = node.tagName === 'A' && menuitem
      && getComputedStyle(menuitem).position === 'relative'
      && linkOverlay.position === 'absolute' && linkOverlay.content !== 'none'
      && [linkOverlay.top, linkOverlay.right, linkOverlay.bottom, linkOverlay.left].every(value => value === '0px');
    const rect = expandedLinkTarget ? menuitem.getBoundingClientRect() : focusRect;
    const visualViewport = window.visualViewport ?? {
      width: innerWidth,
      height: innerHeight,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    const focusInset = Math.max(0, outlineWidth + outlineOffset);
    const pointIsOwnedByTarget = (x, y) => {
      const topmost = document.elementFromPoint(x, y);
      return Boolean(topmost && (topmost === node || node.contains(topmost) || (!expandedLinkTarget && topmost.contains(node))));
    };
    const points = [
      [rect.left + 2, rect.top + 2],
      [rect.right - 2, rect.top + 2],
      [rect.left + 2, rect.bottom - 2],
      [rect.right - 2, rect.bottom - 2],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    const intersectsAnotherInteractiveSurface = Array.from(document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button], [role=link], [role=menuitem]",
    )).some((candidate) => {
      if (candidate === node || candidate.contains(node) || node.contains(candidate)) return false;
      const candidateStyle = getComputedStyle(candidate);
      if (candidateStyle.display === "none" || candidateStyle.visibility === "hidden" || candidateStyle.pointerEvents === "none") return false;
      const candidateRect = candidate.getBoundingClientRect();
      return candidateRect.width > 0
        && candidateRect.height > 0
        && rect.left < candidateRect.right
        && rect.right > candidateRect.left
        && rect.top < candidateRect.bottom
        && rect.bottom > candidateRect.top;
    });
    return {
      active: document.activeElement === node,
      focusVisible: node.matches(":focus-visible"),
      focusIndicator: (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none",
      height: rect.height,
      width: rect.width,
      hitArea: { expanded: Boolean(expandedLinkTarget), anchorHeight: focusRect.height, itemHeight: menuitem?.getBoundingClientRect().height ?? null,
        itemPosition: menuitem ? getComputedStyle(menuitem).position : null, overlayPosition: linkOverlay.position,
        overlayContent: linkOverlay.content, overlayInset: [linkOverlay.top, linkOverlay.right, linkOverlay.bottom, linkOverlay.left] },
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      focusLeft: focusRect.left - focusInset,
      focusRight: focusRect.right + focusInset,
      focusTop: focusRect.top - focusInset,
      focusBottom: focusRect.bottom + focusInset,
      viewportHeight: visualViewport.height,
      viewportWidth: visualViewport.width,
      viewportLeft: visualViewport.offsetLeft,
      viewportTop: visualViewport.offsetTop,
      pointOccluded: points.some(([x, y]) => !pointIsOwnedByTarget(x, y)),
      occludedPoints: points.filter(([x, y]) => !pointIsOwnedByTarget(x, y)).map(([x, y]) => {
        const topmost = document.elementFromPoint(x, y);
        return { x, y, tag: topmost?.tagName, role: topmost?.getAttribute("role"), label: topmost?.getAttribute("aria-label"), className: topmost?.getAttribute("class") };
      }),
      intersectsAnotherInteractiveSurface,
    };
  });
  assert.equal(metrics.active, true, `${marker}_NOT_FOCUSED`);
  assert.equal(metrics.focusVisible, true, `${marker}_FOCUS_NOT_VISIBLE`);
  assert.equal(metrics.focusIndicator, true, `${marker}_FOCUS_INDICATOR_MISSING`);
  // UI.1 current default target is 32px (36px text controls); 44px is the
  // coarse-pointer contract, not a universal fine-pointer desktop minimum.
  assert.equal(metrics.width >= 32, true, `${marker}_WIDTH_BELOW_CURRENT_DEFAULT`);
  assert.equal(metrics.height >= 32, true, `${marker}_HEIGHT_BELOW_CURRENT_DEFAULT:${JSON.stringify(metrics.hitArea)}`);
  assert.equal(
    metrics.focusLeft >= metrics.viewportLeft && metrics.focusRight <= metrics.viewportLeft + metrics.viewportWidth,
    true,
    `${marker}_HORIZONTALLY_CLIPPED`,
  );
  assert.equal(
    metrics.focusTop >= metrics.viewportTop && metrics.focusBottom <= metrics.viewportTop + metrics.viewportHeight,
    true,
    `${marker}_VERTICALLY_CLIPPED:${JSON.stringify({ top: metrics.top, bottom: metrics.bottom, focusTop: metrics.focusTop, focusBottom: metrics.focusBottom, viewportTop: metrics.viewportTop, viewportHeight: metrics.viewportHeight })}`,
  );
  assert.equal(metrics.pointOccluded, false, `${marker}_OCCLUDED_AT_FOCUS_POINT:${JSON.stringify(metrics.occludedPoints)}`);
  assert.equal(metrics.intersectsAnotherInteractiveSurface, false, `${marker}_OCCLUDED_BY_INTERACTIVE_SURFACE`);
}

async function tabTo(page, locator, marker, key = "Tab") {
  if (await locator.evaluate((node) => document.activeElement === node)) {
    await assertKeyboardTarget(page, locator, marker);
    return;
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.keyboard.press(key);
    if (await locator.evaluate((node) => document.activeElement === node)) {
      await assertKeyboardTarget(page, locator, marker);
      return;
    }
  }
  assert.fail(`${marker}_NOT_KEYBOARD_REACHABLE`);
}

async function focusWithKeyboard(page, locator, marker, key = "Tab") {
  if (await locator.evaluate((node) => document.activeElement === node)) return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await page.keyboard.press(key);
    if (key.startsWith("Arrow")) await page.evaluate(() => new Promise(requestAnimationFrame));
    if (await locator.evaluate((node) => document.activeElement === node)) return;
  }
  assert.fail(`${marker}_NOT_KEYBOARD_REACHABLE`);
}

async function assertInvitationPageGeometry(page, marker) {
  const geometry = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  assert.equal(
    Math.max(geometry.bodyScrollWidth, geometry.documentScrollWidth) <= geometry.viewportWidth,
    true,
    `${marker}_PAGE_HORIZONTAL_OVERFLOW`,
  );
}

async function assertLongTeamHeaderAccessible(page, teamName, marker) {
  await page.getByRole("main", { name: `Команда ${teamName}: Настройки команды`, exact: true }).waitFor();
  const header = page.locator("[title]").filter({ hasText: teamName }).first();
  await header.waitFor({ state: "attached" });
  const accessibleHeader = await header.evaluate((node) => ({
    text: node.textContent?.trim() ?? "",
    title: node.getAttribute("title") ?? "",
  }));
  assert.equal(accessibleHeader.text, teamName, `${marker}_LONG_TEAM_HEADER_ACCESSIBLE_TEXT_MISSING`);
  assert.equal(accessibleHeader.title, teamName, `${marker}_LONG_TEAM_HEADER_ACCESSIBLE_TITLE_MISSING`);
}

async function assertInvitationControls(page, marker, controls) {
  await assertInvitationPageGeometry(page, `${marker}_PAGE`);
  for (const [name, locator] of controls) {
    assert.equal(await locator.isVisible(), true, `${marker}_${name}_NOT_VISIBLE`);
    await tabTo(page, locator, `${marker}_${name}`);
    await assertInvitationPageGeometry(page, `${marker}_${name}_PAGE`);
  }
}

const invitationControlPattern = /Выпустить ссылку|Копировать ссылку|Повторить копирование|Перевыпустить ссылку|Отозвать приглашение/;

function isInvitationMutation(request, teamId) {
  const url = new URL(request.url());
  return request.method() === "POST" && url.pathname.startsWith(`/api/teams/${teamId}/invitations`);
}

function isExactTeamDetailRequest(request, teamId) {
  const url = new URL(request.url());
  return request.method() === "GET" && url.pathname === `/api/teams/${teamId}`;
}

function isExactInvitationListRequest(request, teamId) {
  const url = new URL(request.url());
  return request.method() === "GET" && url.pathname === `/api/teams/${teamId}/invitations`;
}

function isExactInvitationRevealRequest(request, teamId, invitationId) {
  const url = new URL(request.url());
  return request.method() === "GET"
    && url.pathname === `/api/teams/${teamId}/invitations/${invitationId}/link`;
}

function isExactRosterRequest(request, teamId) {
  const url = new URL(request.url());
  return request.method() === "GET" && url.pathname === `/api/teams/${teamId}/members`;
}

async function waitForInvitationListResponse(page, teamId) {
  return page.waitForResponse((candidate) => isExactInvitationListRequest(candidate.request(), teamId));
}

async function waitForInvitationRevealResponse(page, teamId, invitationId) {
  return page.waitForResponse((candidate) => isExactInvitationRevealRequest(candidate.request(), teamId, invitationId));
}

async function waitForRosterResponse(page, teamId) {
  return page.waitForResponse((candidate) => isExactRosterRequest(candidate.request(), teamId));
}

function invitationCard(page, invitationId) {
  return page.locator(`[aria-label="Приглашение ${invitationId}"]`);
}

function invitationControl(page, invitationId, name) {
  if (name === "Перевыпустить ссылку") return page.getByRole("button", { name, exact: true });
  return invitationCard(page, invitationId).getByRole("button", { name, exact: true });
}

function invitationLinkField(page, invitationId) {
  return invitationCard(page, invitationId).getByLabel("Ссылка для приглашения", { exact: true });
}

async function createInvitationMetadata(page, teamId, trigger) {
  const createResponse = waitForInvitationResponse(page, teamId);
  await trigger();
  const created = invitation(await (await createResponse).json());
  assert.equal("url" in created, false, "INVITATION_CREATE_RESPONSE_LEAKED_RAW_URL");
  return created;
}

async function retryInvitationListIfFailed(page, teamId) {
  const unavailable = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить приглашения' });
  if (await unavailable.count() === 0) return;
  const refreshed = waitForInvitationListResponse(page, teamId);
  await unavailable.getByRole('button', { name: 'Повторить', exact: true }).click();
  assert.equal((await refreshed).status(), 200, 'invitation metadata read must recover before automatically loading its link');
}

async function revealInvitationUrl(page, teamId, invitationId) {
  // The UI must obtain and display the current creator link automatically.
  // An independent authorized read checks its value without racing an already
  // completed automatic GET or adding an obsolete reveal interaction.
  const field = invitationLinkField(page, invitationId);
  await field.waitFor();
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const response = await json(`/teams/${teamId}/invitations/${invitationId}/link`, { token });
  assert.equal(response.response.status, 200, "INVITATION_CREATOR_REVEAL_DENIED");
  assert.equal(response.response.headers.get("cache-control"), "private, no-store", "creator link response must never enter a shared or persistent HTTP cache");
  const url = new URL(response.body.url, web).href;
  assert.equal(typeof url, "string", "INVITATION_REVEAL_RESPONSE_URL_MISSING");
  await withRedactedSecrets([secretFromUrl(url)], async () => {
    await page.waitForFunction(expected => Array.from(document.querySelectorAll('input')).some(input => input.value === expected), url);
    assert.equal(await field.inputValue() === url, true, "INVITATION_REVEAL_VIEW_DIVERGED_FROM_RESPONSE");
  });
  return url;
}

async function reissueInvitationMetadata(page, teamId, invitationId, trigger) {
  const reissueResponse = waitForInvitationResponse(page, teamId);
  await trigger();
  const replacement = invitation(await (await reissueResponse).json());
  assert.equal("url" in replacement, false, "INVITATION_REISSUE_RESPONSE_LEAKED_RAW_URL");
  assert.equal(replacement.id, invitationId, "manual rotation must retain the single invitation ID");
  return replacement;
}

async function assertSecretOnlyInTransientView(page, secret, marker) {
  const persistentSurface = await page.evaluate((value) => {
    const storageContains = (storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return `${key ?? ""}:${storage.getItem(key ?? "") ?? ""}`.includes(value);
    }).some(Boolean);
    return {
      route: location.href.includes(value),
      history: JSON.stringify(history.state ?? {}).includes(value),
      local: storageContains(localStorage),
      session: storageContains(sessionStorage),
    };
  }, secret);
  assert.deepEqual(
    persistentSurface,
    { route: false, history: false, local: false, session: false },
    `${marker}_PERSISTENT_BROWSER_SECRET_PRESENT`,
  );
}

function assertSafeInvitationList(payload, marker) {
  assert.equal(Boolean(payload) && typeof payload === "object" && !Array.isArray(payload), true, `${marker}_NOT_OBJECT`);
  const items = payload.items;
  assert.equal(Array.isArray(items), true, `${marker}_ITEMS_NOT_ARRAY`);
  const allowed = ["canReveal", "expiresAt", "id", "linkRecoverability", "revision", "role", "state"];
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), allowed, `${marker}_ITEM_FIELDS_NOT_ALLOWLISTED`);
  }
  assert.equal(JSON.stringify(payload).includes("url"), false, `${marker}_RAW_URL_IN_MANAGER_LIST`);
  assert.equal(JSON.stringify(payload).includes("token"), false, `${marker}_TOKEN_IN_MANAGER_LIST`);
}

function assertSafeRoster(payload, marker) {
  assert.equal(Boolean(payload) && typeof payload === "object" && !Array.isArray(payload), true, `${marker}_NOT_OBJECT`);
  assert.equal(Array.isArray(payload.items), true, `${marker}_ITEMS_NOT_ARRAY`);
  for (const item of payload.items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["displayName", "processes", "revision", "role", "state", "userId"],
      `${marker}_ITEM_FIELDS_NOT_ALLOWLISTED`,
    );
    assert.equal(Array.isArray(item.processes), true, `${marker}_PROCESSES_NOT_ARRAY`);
    for (const process of item.processes) {
      assert.deepEqual(Object.keys(process).sort(), ["trackId", "trackName", "vacancyId", "vacancyTitle"]);
    }
  }
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["url", "token", "email", "nickname", "login", "interview", "room", "candidate", "audit"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `${marker}_PRIVATE_${forbidden.toUpperCase()}_EXPOSED`);
  }
}

async function assertNoInvitationControls(page, marker) {
  assert.equal(
    await page.getByRole("button", { name: invitationControlPattern }).count(),
    0,
    `${marker}_INVITATION_CONTROL_VISIBLE`,
  );
}

async function assertNoRawInvitationSurface(page, marker) {
  const surface = await page.evaluate(() => {
    const storageHasFragment = (storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return `${key ?? ""}:${storage.getItem(key ?? "") ?? ""}`.includes("#token=");
    }).some(Boolean);
    return {
      url: location.href.includes("#token="),
      history: JSON.stringify(history.state ?? {}).includes("#token="),
      html: document.documentElement.innerHTML.includes("#token="),
      local: storageHasFragment(localStorage),
      session: storageHasFragment(sessionStorage),
    };
  });
  assert.deepEqual(surface, { url: false, history: false, html: false, local: false, session: false }, `${marker}_RAW_INVITATION_SURFACE_PRESENT`);
}

async function assertDetachedAfterParentRemount(page, handle, marker) {
  assert.ok(handle, `${marker}_OLD_ACTION_HANDLE_MISSING`);
  const isConnected = await page.waitForFunction((node) => !node.isConnected, handle)
    .then(async () => handle.evaluate((node) => node.isConnected).catch(() => false))
    .catch(async () => handle.evaluate((node) => node.isConnected).catch(() => false));
  assert.equal(isConnected, false, `${marker}_OLD_ACTION_HANDLE_REMAINED_CONNECTED`);
}

function isHiddenLifecycleEvent(event) {
  return event.type === "blur" || (event.type === "visibilitychange" && event.visibilityState === "hidden");
}

function isVisibleLifecycleEvent(event) {
  return (event.type === "focus" || event.type === "visibilitychange") && event.visibilityState === "visible";
}

async function foregroundForTeamRevalidation(context, targetPage, teamId, marker, { requireLifecycleWitness = false } = {}) {
  if (requireLifecycleWitness) {
    // Playwright enables focus emulation even for headed Chromium, making every
    // page report focused/visible. Remove that override to observe real events.
    const session = await context.newCDPSession(targetPage);
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await session.detach();
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.visibilityState === "visible" && document.hasFocus());
  }
  const lifecycleBaseline = requireLifecycleWitness
    ? await targetPage.evaluate(() => window.__ac03LifecycleEvents?.length ?? 0)
    : 0;
  let requestObservedAt = 0;
  let backgroundPage;
  const pendingObservations = [];
  const observe = (promise) => {
    // All observers are armed before switching tabs. A different observer can
    // fail first; retain that failure without an unhandled rejection or a waiter
    // continuing after the role exercise has closed its context.
    promise.catch(() => {});
    pendingObservations.push(promise);
    return promise;
  };
  const observeDetailRequest = (request) => {
    if (requestObservedAt === 0 && isExactTeamDetailRequest(request, teamId)) requestObservedAt = Date.now();
  };
  try {
    await targetPage.evaluate(() => {
      window.__ac03AllowNativeWindowFocus = true;
    });
    const hiddenLifecycle = requireLifecycleWitness
      ? observe(targetPage.waitForFunction((baseline) => {
        const events = window.__ac03LifecycleEvents ?? [];
        return events.slice(baseline).find((event) => event.type === "blur"
          || (event.type === "visibilitychange" && event.visibilityState === "hidden")) ?? null;
      }, lifecycleBaseline))
      : null;

    targetPage.on("request", observeDetailRequest);
    const detailRequest = observe(targetPage.waitForRequest((request) => isExactTeamDetailRequest(request, teamId)));
    const detailResponse = observe(targetPage.waitForResponse((response) =>
      isExactTeamDetailRequest(response.request(), teamId)));
    const visibleLifecycle = requireLifecycleWitness
      ? observe(targetPage.waitForFunction((baseline) => {
        const events = window.__ac03LifecycleEvents ?? [];
        return events.slice(baseline).find((event) => (event.type === "focus" || event.type === "visibilitychange")
          && event.visibilityState === "visible") ?? null;
      }, lifecycleBaseline))
      : null;
    if (requireLifecycleWitness) {
      backgroundPage = await context.newPage();
      const session = await context.newCDPSession(backgroundPage);
      await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await session.detach();
      await backgroundPage.goto(`${web}/`, { waitUntil: "domcontentloaded" });
      await backgroundPage.bringToFront();
      if (hiddenLifecycle) await hiddenLifecycle;
      await targetPage.bringToFront();
    } else {
      const revalidationUrl = new URL(targetPage.url());
      revalidationUrl.searchParams.set("__ac03Revalidation", `${Date.now()}`);
      await targetPage.goto(revalidationUrl.toString(), { waitUntil: "domcontentloaded" });
    }
    const hiddenEvent = hiddenLifecycle ? await (await hiddenLifecycle).jsonValue() : null;
    const [request, response] = await Promise.all([detailRequest, detailResponse]);
    assert.equal(isExactTeamDetailRequest(request, teamId), true, `${marker}_EXACT_DETAIL_GET_MISSING`);
    if (visibleLifecycle) {
      const visibleEvent = await (await visibleLifecycle).jsonValue();
      assert.equal(isHiddenLifecycleEvent(hiddenEvent), true, `${marker}_HIDDEN_OR_BLUR_WITNESS_MISSING`);
      assert.equal(isVisibleLifecycleEvent(visibleEvent), true, `${marker}_VISIBLE_FOCUS_WITNESS_MISSING`);
      assert.equal(hiddenEvent.isTrusted && visibleEvent.isTrusted, true, `${marker}_UNTRUSTED_LIFECYCLE_WITNESS`);
      assert.equal(hiddenEvent.order < visibleEvent.order, true, `${marker}_LIFECYCLE_EVENT_ORDER_INVALID`);
      assert.equal(hiddenEvent.timestamp <= visibleEvent.timestamp, true, `${marker}_LIFECYCLE_TIMESTAMP_ORDER_INVALID`);
      assert.equal(requestObservedAt >= visibleEvent.timestamp, true, `${marker}_DETAIL_GET_PRECEDES_VISIBLE_WITNESS`);
    }
    return response;
  } finally {
    targetPage.off("request", observeDetailRequest);
    await Promise.allSettled(pendingObservations);
    await targetPage.evaluate(() => {
      window.__ac03AllowNativeWindowFocus = false;
    }).catch(() => {});
    await backgroundPage?.close().catch(() => {});
  }
}

async function foregroundForRosterRevalidation(targetPage, teamId, marker) {
  const rosterRequest = targetPage.waitForRequest((request) => isExactRosterRequest(request, teamId));
  const rosterResponse = targetPage.waitForResponse((response) => isExactRosterRequest(response.request(), teamId));
  // Headless Chromium does not reliably emit a visibility transition for
  // bringToFront. Drive the same public browser lifecycle events instead.
  await targetPage.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const [request, response] = await Promise.all([rosterRequest, rosterResponse]);
  assert.equal(isExactRosterRequest(request, teamId), true, `${marker}_ROSTER_GET_MISSING_ON_FOCUS`);
  return response;
}

async function assertMemberInvitationBoundary(member, team, cell, marker) {
  let mutations = 0;
  const countInvitationMutation = (request) => {
    if (isInvitationMutation(request, team.id)) mutations += 1;
  };
  const { context, page } = await openAccount(
    member,
    `/workspace/teams/${team.id}/members`,
    cell.viewport,
    (pendingPage) => pendingPage.on("request", countInvitationMutation),
    { suppressNativeWindowFocus: !headedFocusLifecycleEnabled },
  );
  try {
    await page.getByText("Состав команды", { exact: true }).waitFor();
    await assertInvitationPageGeometry(page, `${marker}_MEMBER_INITIAL`);
    await assertNoInvitationControls(page, `${marker}_MEMBER_INITIAL`);
    await assertNoRawInvitationSurface(page, `${marker}_MEMBER_INITIAL`);
    const mutationsBeforeRemount = mutations;
    const response = await foregroundForTeamRevalidation(context, page, team.id, `${marker}_MEMBER_REMOUNT`);
    assert.equal(response.status(), 200, `${marker}_MEMBER_REMOUNT_DETAIL_DENIED`);
    await page.getByText("Состав команды", { exact: true }).waitFor();
    await assertInvitationPageGeometry(page, `${marker}_MEMBER_REMOUNT`);
    await assertNoInvitationControls(page, `${marker}_MEMBER_REMOUNT`);
    await assertNoRawInvitationSurface(page, `${marker}_MEMBER_REMOUNT`);
    for (let attempt = 0; attempt < 40; attempt += 1) await page.keyboard.press("Tab");
    await assertInvitationPageGeometry(page, `${marker}_MEMBER_KEYBOARD_TRAVERSAL`);
    assert.equal(mutationsBeforeRemount, 0, `${marker}_MEMBER_INITIAL_INVITATION_MUTATION_SENT`);
    assert.equal(mutations, mutationsBeforeRemount, `${marker}_MEMBER_REMOUNT_INVITATION_MUTATION_SENT`);
  } finally {
    page.off("request", countInvitationMutation);
    await context.close();
  }
}

async function assertUnavailableInvitationBoundary(owner, team, cell, marker) {
  const invitationMutationPaths = [];
  const countInvitationMutation = (request) => {
    if (isInvitationMutation(request, team.id)) invitationMutationPaths.push(new URL(request.url()).pathname);
  };
  const { context, page } = await openAccount(
    owner,
    `/workspace/teams/${team.id}/members`,
    cell.viewport,
    (pendingPage) => pendingPage.on("request", countInvitationMutation),
    { suppressNativeWindowFocus: !headedFocusLifecycleEnabled },
  );
  const detailPattern = `**/api/teams/${team.id}`;
  let interceptedDetailCount = 0;
  let routeInstalled = false;
  try {
    await page.getByText("Состав команды", { exact: true }).waitFor();
    const create = page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ });
    await assertInvitationControls(page, `${marker}_UNAVAILABLE_INITIAL`, [["CREATE", create]]);
    const created = await createInvitationMetadata(page, team.id, () => page.keyboard.press("Enter"));
    const createdUrl = await revealInvitationUrl(page, team.id, created.id);
    const secret = secretFromUrl(createdUrl);

    await withRedactedSecrets([secret], async () => {
      const copy = page.getByRole("button", { name: "Копировать ссылку", exact: true });
      const reissue = invitationControl(page, created.id, "Перевыпустить ссылку");
      await copy.waitFor();
      await focusWithKeyboard(page, copy, `${marker}_UNAVAILABLE_COPY`);
      await page.keyboard.press("Enter");
      await page.getByText("Ссылка приглашения готова к отправке.", { exact: true }).waitFor();
      await reissue.waitFor();
      const oldReissueHandle = await reissue.elementHandle();
      assert.ok(oldReissueHandle, `${marker}_UNAVAILABLE_OLD_REISSUE_HANDLE_MISSING`);
      assert.equal(await invitationLinkField(page, created.id).inputValue(), createdUrl, `${marker}_UNAVAILABLE_COPY_CLEARED_CURRENT_VIEW`);
      await assertSecretOnlyInTransientView(page, secret, `${marker}_UNAVAILABLE_COPY`);

      await page.route(detailPattern, async (route) => {
        const request = route.request();
        if (interceptedDetailCount !== 0 || !isExactTeamDetailRequest(request, team.id)) {
          await route.fallback();
          return;
        }
        interceptedDetailCount += 1;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "TEAM_NOT_FOUND" }),
        });
      });
      routeInstalled = true;
      const mutationsBeforeUnavailable = invitationMutationPaths.length;
      const response = await foregroundForTeamRevalidation(context, page, team.id, `${marker}_UNAVAILABLE_REMOUNT`);
      assert.equal(response.status(), 404, `${marker}_UNAVAILABLE_DETAIL_STATUS_NOT_404`);
      assert.equal(interceptedDetailCount, 1, `${marker}_UNAVAILABLE_DETAIL_INTERCEPTION_NOT_EXACTLY_ONCE`);
      await assertDetachedAfterParentRemount(page, oldReissueHandle, `${marker}_UNAVAILABLE_REISSUE`);
      await page.getByRole("alert").filter({ hasText: "Команда недоступна" }).waitFor();
      await assertNoInvitationControls(page, `${marker}_UNAVAILABLE`);
      await assertInvitationPageGeometry(page, `${marker}_UNAVAILABLE`);
      await assertSecretAbsent(page, secret, `${marker}_UNAVAILABLE_LEFT_SECRET`);
      await assertNoRawInvitationSurface(page, `${marker}_UNAVAILABLE`);
      assert.equal(
        invitationMutationPaths.length,
        mutationsBeforeUnavailable,
        `${marker}_UNAVAILABLE_INVITATION_MUTATION_SENT`,
      );
    });
  } finally {
    if (routeInstalled) await page.unroute(detailPattern);
    page.off("request", countInvitationMutation);
    await context.close();
  }
}

async function navigateToTeamMembersWithKeyboard(page, team, marker) {
  const switcher = page.getByRole("button", { name: /Команды:.*Сменить команду/ });
  await focusWithKeyboard(page, switcher, `${marker}_WORKSPACE_SWITCHER`);
  await page.keyboard.press("Enter");
  await page.getByRole("menu", { name: "Выбор команды" }).waitFor();
  const choice = page.getByRole("menuitemradio", { name: new RegExp(team.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await focusWithKeyboard(page, choice, `${marker}_TEAM_CHOICE`, "ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
  await page.getByRole("main", { name: `Команда ${team.name}: Интервью`, exact: true }).waitFor();

  const settingsGear = page.getByRole("link", { name: "Настройки команды", exact: true });
  await settingsGear.waitFor();
  await focusWithKeyboard(page, settingsGear, `${marker}_SETTINGS_GEAR`);
  await assertKeyboardTarget(page, settingsGear, `${marker}_SETTINGS_GEAR`);
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/workspace/teams/${team.id}/settings`);
}

async function assertKeyboardLogoutReloginCleanup(owner, team, cell, marker) {
  const invitationMutationPaths = [];
  const countInvitationMutation = (request) => {
    if (isInvitationMutation(request, team.id)) invitationMutationPaths.push(new URL(request.url()).pathname);
  };
  const { context, page } = await openAccount(
    owner,
    `/workspace/teams/${team.id}/members`,
    cell.viewport,
    (pendingPage) => pendingPage.on("request", countInvitationMutation),
    { suppressNativeWindowFocus: !headedFocusLifecycleEnabled },
  );
  try {
    await page.getByText("Состав команды", { exact: true }).waitFor();
    const create = page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ });
    await assertInvitationControls(page, `${marker}_LOGOUT_INITIAL`, [["CREATE", create]]);
    const created = await createInvitationMetadata(page, team.id, () => page.keyboard.press("Enter"));
    const createdUrl = await revealInvitationUrl(page, team.id, created.id);
    const secret = secretFromUrl(createdUrl);

    await withRedactedSecrets([secret], async () => {
      const copy = page.getByRole("button", { name: "Копировать ссылку", exact: true });
      const reissue = invitationControl(page, created.id, "Перевыпустить ссылку");
      await copy.waitFor();
      await focusWithKeyboard(page, copy, `${marker}_LOGOUT_COPY`);
      await page.keyboard.press("Enter");
      await page.getByText("Ссылка приглашения готова к отправке.", { exact: true }).waitFor();
      await reissue.waitFor();
      const oldReissueHandle = await reissue.elementHandle();
      assert.ok(oldReissueHandle, `${marker}_LOGOUT_OLD_REISSUE_HANDLE_MISSING`);
      const remountResponse = await foregroundForTeamRevalidation(context, page, team.id, `${marker}_LOGOUT_REMOUNT`);
      assert.equal(remountResponse.status(), 200, `${marker}_LOGOUT_REMOUNT_DETAIL_DENIED`);
      await assertDetachedAfterParentRemount(page, oldReissueHandle, `${marker}_LOGOUT_REMOUNT_REISSUE`);
      const recoveredReissue = invitationControl(page, created.id, "Перевыпустить ссылку");
      await recoveredReissue.waitFor();
      const recoveredBeforeLogout = await recoveredReissue.count();

      const logout = page.getByRole("button", { name: "Выйти", exact: true });
      await focusWithKeyboard(page, logout, `${marker}_LOGOUT`);
      await page.keyboard.press("Enter");
      await page.waitForURL(`${web}/`);
      const accountLink = page.getByRole("link", { name: "Личный кабинет", exact: true });
      await focusWithKeyboard(page, accountLink, `${marker}_LOGIN_LINK`);
      await page.keyboard.press("Enter");
      await page.waitForURL(`${web}/login`);
      const nickname = page.getByLabel("Ник", { exact: true });
      const userPassword = page.getByLabel("Пароль", { exact: true });
      const login = page.getByRole("button", { name: "Войти в кабинет", exact: true });
      await focusWithKeyboard(page, nickname, `${marker}_LOGIN_NICKNAME`);
      await page.keyboard.type(owner.user.nickname);
      await focusWithKeyboard(page, userPassword, `${marker}_LOGIN_PASSWORD`);
      await page.keyboard.type(password);
      await focusWithKeyboard(page, login, `${marker}_LOGIN_SUBMIT`);
      await page.keyboard.press("Enter");
      await page.waitForURL("**/workspace/personal/interviews");
      await navigateToTeamMembersWithKeyboard(page, team, `${marker}_POST_LOGIN`);
      await page.getByText("Состав команды", { exact: true }).waitFor();
      await assertDetachedAfterParentRemount(page, oldReissueHandle, `${marker}_LOGOUT_OLD_ACTION`);
      await assertInvitationPageGeometry(page, `${marker}_POST_LOGIN`);
      await invitationLinkField(page, created.id).waitFor();
      await assertSecretOnlyInTransientView(page, secret, `${marker}_POST_LOGIN_TRANSIENT_ONLY`);
      assert.equal(await invitationControl(page, created.id, "Перевыпустить ссылку").count(), 1, `${marker}_POST_LOGIN_REISSUE_MISSING`);
      assert.equal(await invitationControl(page, created.id, "Отозвать приглашение").count(), 1, `${marker}_POST_LOGIN_REVOKE_MISSING`);
      assert.equal(await revealInvitationUrl(page, team.id, created.id), createdUrl, `${marker}_POST_LOGIN_REVEAL_ROTATED_LINK`);
      assert.equal(invitationMutationPaths.length, 1, `${marker}_POST_LOGIN_INVITATION_MUTATION_SENT`);
      assert.equal(recoveredBeforeLogout, 1, `${marker}_PRE_LOGOUT_RECOVERY_NOT_RENDERED`);
    });
  } finally {
    page.off("request", countInvitationMutation);
    await context.close();
  }
}

async function exerciseInvitationManagementByKeyboard(auth, role, team, cell, teamName, marker) {
  let lifecycleBrowser;
  if (headedFocusLifecycleEnabled) lifecycleBrowser = await chromium.launch({ headless: false });
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/settings`, cell.viewport, undefined, {
    browserInstance: lifecycleBrowser ?? browser,
    observeLifecycle: headedFocusLifecycleEnabled,
    suppressNativeWindowFocus: !headedFocusLifecycleEnabled,
  });
  const mutations = [];
  page.on("request", request => { if (isInvitationMutation(request, team.id)) mutations.push(new URL(request.url()).pathname); });
  const secrets = [];
  try {
    await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
    await assertLongTeamHeaderAccessible(page, teamName, `${marker}_${role}`);
    const issue = page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ });
    await assertInvitationControls(page, `${marker}_${role}_INITIAL`, [["ISSUE", issue]]);
    const created = await createInvitationMetadata(page, team.id, () => page.keyboard.press("Enter"));
    const initialUrl = await revealInvitationUrl(page, team.id, created.id);
    const initialSecret = secretFromUrl(initialUrl); secrets.push(initialSecret);
    await withRedactedSecrets(secrets, async () => {
      const link = invitationLinkField(page, created.id);
      const copy = page.getByRole("button", { name: "Копировать ссылку", exact: true });
      const revoke = invitationControl(page, created.id, "Отозвать приглашение");
      await assertInvitationControls(page, `${marker}_${role}_ACTIVE`, [["LINK", link], ["COPY", copy], ["REVOKE", revoke]]);
      await page.evaluate(() => { window.__ac03ClipboardMode = "failure"; });
      await focusWithKeyboard(page, copy, `${marker}_${role}_COPY_FAILURE`);
      await page.keyboard.press("Enter");
      const retryCopy = page.getByRole("button", { name: "Повторить копирование", exact: true });
      await retryCopy.waitFor();
      await page.getByText("Разрешите доступ к буферу обмена и повторите попытку.", { exact: true }).waitFor();
      assert.equal((await link.inputValue()) === initialUrl, true, `${marker}_${role}_COPY_FAILURE_CHANGED_LINK`);
      await page.evaluate(() => { window.__ac03ClipboardMode = "success"; });
      await focusWithKeyboard(page, retryCopy, `${marker}_${role}_COPY_RETRY`);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.__ac03ClipboardWrites.length === 1);
      assert.equal(await page.evaluate(value => window.__ac03ClipboardWrites[0] === value, initialUrl), true);
      await page.evaluate(() => { window.__ac03ClipboardWrites = []; });
      await assertSecretOnlyInTransientView(page, initialSecret, `${marker}_${role}_COPY`);
      const oldHandle = await link.elementHandle();
      const beforeRevalidation = mutations.length;
      const refreshed = await foregroundForTeamRevalidation(context, page, team.id, `${marker}_${role}_REVALIDATION`, { requireLifecycleWitness: headedFocusLifecycleEnabled });
      assert.equal(refreshed.status(), 200);
      if (headedFocusLifecycleEnabled) {
        assert.equal(await oldHandle.evaluate(node => node.isConnected), true, `${marker}_${role}_CONFIRMED_CONTEXT_FOCUS_REMOUNTED_LINK`);
      } else {
        // The headless revalidation seam navigates/reloads the document; this
        // verifies recovery/cleanup, not a native background/foreground event.
        await assertDetachedAfterParentRemount(page, oldHandle, `${marker}_${role}_OLD_RELOADED_LINK`);
      }
      assert.equal((await revealInvitationUrl(page, team.id, created.id)) === initialUrl, true, `${marker}_${role}_REVALIDATION_ROTATED_LINK`);
      assert.equal(mutations.length, beforeRevalidation, `${marker}_${role}_REVALIDATION_MUTATED_INVITATION`);
      const rotate = invitationControl(page, created.id, "Перевыпустить ссылку");
      await focusWithKeyboard(page, rotate, `${marker}_${role}_ROTATE`);
      const rotated = await reissueInvitationMetadata(page, team.id, created.id, () => page.keyboard.press("Enter"));
      const rotatedUrl = await revealInvitationUrl(page, team.id, rotated.id);
      const rotatedSecret = secretFromUrl(rotatedUrl); secrets.push(rotatedSecret);
      assert.notEqual(rotatedSecret, initialSecret, `${marker}_${role}_ROTATION_REUSED_SECRET`);
      await assertSecretAbsent(page, initialSecret, `${marker}_${role}_ROTATION_LEFT_OLD_SECRET`);
      assert.equal((await json("/team-invitations/preview", { method: "POST", body: { token: initialSecret } })).response.status, 410);
      await assertInvitationControls(page, `${marker}_${role}_ROTATED`, [["LINK", invitationLinkField(page, rotated.id)], ["COPY", page.getByRole("button", { name: "Копировать ссылку", exact: true })]]);
      const currentRevoke = invitationControl(page, rotated.id, "Отозвать приглашение");
      await focusWithKeyboard(page, currentRevoke, `${marker}_${role}_REVOKE`);
      const revoked = waitForInvitationResponse(page, team.id, "revoke");
      await page.keyboard.press("Enter");
      assert.equal((await revoked).status(), 200);
      await page.getByRole("status").getByText("Приглашение отозвано", { exact: true }).waitFor();
      await assertSecretAbsent(page, rotatedSecret, `${marker}_${role}_REVOKE_LEFT_SECRET`);
      assert.equal((await json("/team-invitations/preview", { method: "POST", body: { token: rotatedSecret } })).response.status, 410);
      assert.equal(await page.getByRole("button", { name: "Копировать ссылку", exact: true }).count(), 0);
      const mutationCount = mutations.length;
      await foregroundForTeamRevalidation(context, page, team.id, `${marker}_${role}_REVOKED_REVALIDATION`);
      await assertNoRawInvitationSurface(page, `${marker}_${role}_REVOKED_REVALIDATION`);
      assert.equal(mutations.length, mutationCount, `${marker}_${role}_REVOKED_REVALIDATION_MUTATED`);
    });
  } finally { await context.close(); await lifecycleBrowser?.close(); }
}

function rgb(value) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert.equal(channels?.length, 3, `expected computed rgb color, got ${value}`);
  return channels;
}

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("AC-03 management: nested test failures redact invitation secrets before reporting", async () => {
  const secret = `redaction-contract-${randomUUID()}`;
  let reported;
  try {
    await withRedactedSecrets([secret], async () => {
      const cause = new Error(`nested cause ${secret}`);
      cause.actual = { token: secret };
      cause.expected = [secret];
      const error = new Error(`top-level message ${secret}`, { cause });
      error.stack = `stack ${secret}`;
      error.actual = { invitation: { token: secret } };
      error.expected = { token: secret };
      throw error;
    });
  } catch (error) {
    reported = error;
  }
  assert.equal(valueContainsSecret(reported, secret), false, "AC03_REDACTION_LEFT_SECRET_IN_REPORTED_ERROR");
  assert.equal(String(reported?.message).includes("[REDACTED]"), true, "AC03_REDACTION_MARKER_MISSING");
});

test("AC-03 management: OWNER recovers lost create metadata with the same key, then explicitly reissues", { timeout: 60000 }, async () => {
  const { owner, invitee, team } = await managementFixture("ac03_recovery");
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  const attempts = [];
  let lostInvitation;
  let recoveredInvitation;
  await page.route(`**/api/teams/${team.id}/invitations`, async (route) => {
    if (route.request().method() !== "POST") {
      if (attempts.length === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "INJECTED_LIST_UNAVAILABLE" }) });
      return route.continue();
    }
    attempts.push({
      key: await route.request().headerValue("Idempotency-Key"),
      body: route.request().postDataJSON(),
    });
    const upstream = await route.fetch();
    if (attempts.length === 1) {
      lostInvitation = invitation(await upstream.json());
      await route.abort("failed");
      return;
    }
    const recoveredBody = await upstream.body();
    recoveredInvitation = invitation(JSON.parse(recoveredBody.toString("utf8")));
    await route.fulfill({ response: upstream, body: recoveredBody });
  });

  try {
    await page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click();
    await page.getByRole("alert").getByText("Не удалось создать приглашение", { exact: true }).waitFor();
    const replay = waitForInvitationResponse(page, team.id);
    await page.getByRole("button", { name: "Повторить создание", exact: true }).click();
    assert.equal((await replay).status(), 201);
    await retryInvitationListIfFailed(page, team.id);
    await page.getByLabel("Ссылка для приглашения", { exact: true }).waitFor();

    assert.equal(attempts.length, 2, "lost response must retry the same logical create exactly once");
    assert.match(attempts[0].key, /^[0-9a-f-]{36}$/i);
    assert.equal(attempts[1].key, attempts[0].key, "retry must preserve Idempotency-Key");
    assert.deepEqual(attempts.map((attempt) => attempt.body), [{}, {}]);
    assert.equal(recoveredInvitation.id, lostInvitation.id, "recovery must identify the committed invitation");
    assert.equal(recoveredInvitation.state, "PENDING");
    assert.equal(recoveredInvitation.role, "MEMBER");
    assert.equal(typeof recoveredInvitation.expiresAt, "string");
    assert.equal("url" in recoveredInvitation, false, "recovery metadata must never reconstruct the secret");
    assert.equal("url" in lostInvitation, false, "AC03_LOST_CREATE_RESPONSE_LEAKED_RAW_URL");
    await invitationLinkField(page, recoveredInvitation.id).waitFor();
    const oldUrl = await revealInvitationUrl(page, team.id, recoveredInvitation.id);
    const oldSecret = secretFromUrl(oldUrl);
    await withRedactedSecrets([oldSecret], async () => {
      await assertSecretOnlyInTransientView(page, oldSecret, "AC03_RECOVERED_CREATE");
    });
    assert.equal(await invitationControl(page, recoveredInvitation.id, "Перевыпустить ссылку").count(), 1);

    const replacement = await reissueInvitationMetadata(
      page,
      team.id,
      recoveredInvitation.id,
      () => invitationControl(page, recoveredInvitation.id, "Перевыпустить ссылку").click(),
    );
    const newUrl = await revealInvitationUrl(page, team.id, replacement.id);
    const newSecret = secretFromUrl(newUrl);
    await withRedactedSecrets([oldSecret, newSecret], async () => {
      assert.notEqual(newSecret, oldSecret, "manual rotation must mint a distinct reusable-link secret");
      await page.getByLabel("Ссылка для приглашения", { exact: true }).waitFor();

      const oldPreview = await json("/team-invitations/preview", { method: "POST", body: { token: oldSecret } });
      assert.equal(oldPreview.response.status, 410, "reissue must make old preview generically unavailable");
      const oldAccept = await json("/team-invitations/accept", {
        token: invitee.token,
        method: "POST",
        key: randomUUID(),
        body: { token: oldSecret },
      });
      assert.equal(oldAccept.response.status, 410, "reissue must make old accept generically unavailable");
      const freshPreview = await json("/team-invitations/preview", { method: "POST", body: { token: newSecret } });
      assert.equal(freshPreview.response.status, 200, "replacement preview must remain usable");
      const beforeAccept = await json("/me/workspaces", { token: invitee.token });
      assert.equal(JSON.stringify(beforeAccept.body).includes(team.id), false, "pending invitation is not membership");
      const freshAccept = await json("/team-invitations/accept", {
        token: invitee.token,
        method: "POST",
        key: randomUUID(),
        body: { token: newSecret },
      });
      assert.equal(freshAccept.response.status, 200, "replacement accept must work exactly once");
      const afterAccept = await json("/me/workspaces", { token: invitee.token });
      assert.equal(JSON.stringify(afterAccept.body).match(new RegExp(team.id, "g"))?.length, 1);
    });
  } finally {
    await page.unroute(`**/api/teams/${team.id}/invitations`);
    await context.close();
  }
});

test("AC-03 management: committed reissue response recovers the same replacement without a second mutation", { timeout: 60000 }, async () => {
  const { owner, team } = await managementFixture("ac03_mutation_replay");
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  const secrets = [];
  try {
    const original = await createInvitationMetadata(
      page,
      team.id,
      () => page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click(),
    );
    const originalUrl = await revealInvitationUrl(page, team.id, original.id);
    const originalSecret = secretFromUrl(originalUrl);
    secrets.push(originalSecret);


    const reissueAttempts = [];
    const reissueOutcomes = [];
    let replacementSecret;
    const reissuePattern = `**/api/teams/${team.id}/invitations`;
    await page.route(reissuePattern, async (route) => {
      if (route.request().method() !== "POST") {
        if (reissueAttempts.length === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "INJECTED_LIST_UNAVAILABLE" }) });
        return route.continue();
      }
      reissueAttempts.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postDataJSON(),
      });
      const upstream = await route.fetch();
      const responseBody = await upstream.body();
      const outcome = invitation(JSON.parse(responseBody.toString("utf8")));
      reissueOutcomes.push(outcome);
      if (reissueAttempts.length === 1) {
        return route.abort("failed");
      }
      return route.fulfill({ response: upstream, body: responseBody });
    });

    await withRedactedSecrets(secrets, async () => {
      await invitationControl(page, original.id, "Перевыпустить ссылку").click();
      await page.getByRole("alert").getByText("Не удалось создать приглашение", { exact: true }).waitFor();
      const replay = waitForInvitationResponse(page, team.id);
      await page.getByRole("button", { name: "Повторить создание", exact: true }).click();
      assert.equal((await replay).status(), 201);
      await retryInvitationListIfFailed(page, team.id);
      await invitationLinkField(page, original.id).waitFor();

      assert.equal(reissueAttempts.length, 2, "lost committed reissue must be replayed exactly once");
      assert.match(reissueAttempts[0].key, /^[0-9a-f-]{36}$/i);
      assert.equal(reissueAttempts[1].key, reissueAttempts[0].key, "reissue retry must preserve Idempotency-Key");
      assert.deepEqual(reissueAttempts.map((attempt) => attempt.body), [{}, {}]);
      assert.equal(reissueOutcomes[0].id, original.id, "rotation retains the current invitation ID");
      assert.equal(reissueOutcomes[0].revision, original.revision + 1);
      assert.equal(reissueOutcomes[1].id, reissueOutcomes[0].id, "reissue replay must recover the same replacement id");
      assert.equal("url" in reissueOutcomes[1], false, "reissue replay returns metadata only");
      await invitationLinkField(page, original.id).waitFor(); // recovered metadata triggers an authorized automatic GET
      await page.waitForTimeout(250);
      assert.equal(reissueAttempts.length, 2, "reissue recovery must not automatically mint another replacement");
      const replacementUrl = await revealInvitationUrl(page, team.id, reissueOutcomes[0].id);
      replacementSecret = secretFromUrl(replacementUrl);
      secrets.push(replacementSecret);
      await assertSecretOnlyInTransientView(page, replacementSecret, "AC03_REISSUE_REPLAY");

      const oldPreview = await json("/team-invitations/preview", { method: "POST", body: { token: originalSecret } });
      assert.equal(oldPreview.response.status, 410, "one committed reissue invalidates the original invitation");
    });
    await page.unroute(reissuePattern);
  } finally {
    await context.close();
  }
});

test("AC-03 management: committed revoke response replays the same revoked outcome", { timeout: 60000 }, async () => {
  const { owner, team } = await managementFixture("ac03_revoke_replay");
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  let secret;
  try {
    const original = await createInvitationMetadata(
      page,
      team.id,
      () => page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click(),
    );
    secret = secretFromUrl(await revealInvitationUrl(page, team.id, original.id));


    const attempts = [];
    const outcomes = [];
    const revokePattern = `**/api/teams/${team.id}/invitations/${original.id}/revoke`;
    await page.route(revokePattern, async (route) => {
      attempts.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postDataJSON(),
      });
      const upstream = await route.fetch();
      const responseBody = await upstream.body();
      outcomes.push(invitation(JSON.parse(responseBody.toString("utf8"))));
      if (attempts.length === 1) return route.abort("failed");
      return route.fulfill({ response: upstream, body: responseBody });
    });

    await withRedactedSecrets([secret], async () => {
      await invitationControl(page, original.id, "Отозвать приглашение").click();
      await page.getByRole("alert").getByText("Не удалось отозвать приглашение", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Повторить", exact: true }).click();
      await page.getByRole("status").getByText("Приглашение отозвано", { exact: true }).waitFor();

      assert.equal(attempts.length, 2, "lost committed revoke must be replayed exactly once");
      assert.match(attempts[0].key, /^[0-9a-f-]{36}$/i);
      assert.equal(attempts[1].key, attempts[0].key, "revoke retry must preserve Idempotency-Key");
      assert.deepEqual(attempts.map((attempt) => attempt.body), [{ revision: 0 }, { revision: 0 }]);
      assert.deepEqual(outcomes[1], outcomes[0], "revoke replay must recover the same revoked outcome");
      assert.equal(outcomes[1].state, "REVOKED");
      const preview = await json("/team-invitations/preview", { method: "POST", body: { token: secret } });
      assert.equal(preview.response.status, 410, "one logical revoke makes the invitation generically unavailable");
      await assertSecretAbsent(page, secret, "AC03_REVOKE_REPLAY_LEFT_RAW_URL");
    });
    await page.unroute(revokePattern);
  } finally {
    await context.close();
  }
});

test("AC-03 management: committed accept response replays the same key and creates one membership", { timeout: 60000 }, async () => {
  const { owner, invitee, team } = await managementFixture("ac03_accept_replay");
  const ownerSession = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  let inviteeSession;
  try {
    const created = await createInvitationMetadata(
      ownerSession.page,
      team.id,
      () => ownerSession.page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click(),
    );
    const rawInvitationUrl = await revealInvitationUrl(ownerSession.page, team.id, created.id);
    const secret = secretFromUrl(rawInvitationUrl);

    await withRedactedSecrets([secret], async () => {
      inviteeSession = await openAccount(invitee, rawInvitationUrl);
      const { page } = inviteeSession;
    const attempts = [];
    const outcomes = [];
    await page.route("**/api/team-invitations/accept", async (route) => {
      attempts.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postDataJSON(),
      });
      const upstream = await route.fetch();
      const responseBody = await upstream.body();
      outcomes.push(JSON.parse(responseBody.toString("utf8")));
      if (attempts.length === 1) return route.abort("failed");
      return route.fulfill({ response: upstream, body: responseBody });
    });
    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
      await page.getByRole("button", { name: "Повторить принятие", exact: true }).click();
      await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);

      assert.equal(attempts.length, 2, "lost committed accept must be replayed exactly once");
      assert.match(attempts[0].key, /^[0-9a-f-]{36}$/i);
      assert.equal(attempts[1].key, attempts[0].key, "accept retry must preserve Idempotency-Key");
      assert.deepEqual(attempts.map((attempt) => attempt.body), [{ token: secret }, { token: secret }]);
      assert.deepEqual(outcomes[1], outcomes[0], "accept replay must return the same terminal outcome");
      const workspaces = await json("/me/workspaces", { token: invitee.token });
      assert.equal(JSON.stringify(workspaces.body).match(new RegExp(team.id, "g"))?.length, 1, "accept replay creates one logical membership");
      await assertSecretAbsent(page, secret, "AC03_ACCEPT_REPLAY_LEFT_RAW_TOKEN");
    } finally {
      await page.unroute("**/api/team-invitations/accept");
    }
    });
  } finally {
    if (inviteeSession) await inviteeSession.context.close();
    await ownerSession.context.close();
  }
});

test("P0.1 management: OWNER and ADMIN actions and MEMBER boundary use current themes and settings", { timeout: 60000 }, async () => {
  const { owner, admin, member, team } = await managementFixture("ac03_roles");
  for (const [auth, viewport] of [[owner, { width: 1280, height: 720 }], [admin, { width: 768, height: 1024 }]]) {
    const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/settings`, viewport);
    try {
      const issue = page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ });
      await issue.waitFor();
      const backgrounds = [];
      for (const theme of ["light", "dark"]) {
        if ((await page.locator('html').getAttribute('data-theme')) !== theme) await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
        await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, theme);
        await assertInvitationPageGeometry(page, `P01_${theme}_ROLE_GEOMETRY`);
        const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        backgrounds.push(color);
        const [r,,b] = rgb(await issue.evaluate(node => getComputedStyle(node).backgroundColor));
        assert.equal(b > r + 20, true, "invitation primary action must follow the blue theme token");
      }
      assert.notEqual(backgrounds[0], backgrounds[1], "theme change must update the settings surface");
      const created = await createInvitationMetadata(page, team.id, () => issue.click());
      const url = await revealInvitationUrl(page, team.id, created.id);
      await withRedactedSecrets([secretFromUrl(url)], () => assertSecretOnlyInTransientView(page, secretFromUrl(url), "P01_MANAGER_TRANSIENT_LINK"));
    } finally { await context.close(); }
  }
  const memberSession = await openAccount(member, `/workspace/teams/${team.id}/settings`, { width: 768, height: 1024 });
  try {
    await memberSession.page.getByText("Состав команды", { exact: true }).waitFor();
    await assertNoInvitationControls(memberSession.page, "P01_MEMBER_TABLET");
    await assertNoRawInvitationSurface(memberSession.page, "P01_MEMBER_TABLET");
    await assertInvitationPageGeometry(memberSession.page, "P01_MEMBER_TABLET");
    assert.equal((await raw(`/teams/${team.id}/invitations`, { token: member.token })).status, 403, "UI hiding must retain server-side membership boundary");
  } finally { await memberSession.context.close(); }
});

test("AC-03 management: copy failure allows retry, success preserves the view, while revoke/team/account changes clear it", { timeout: 90000 }, async () => {
  const { owner, team } = await managementFixture("ac03_cleanup");
  const otherTeam = await createTeam(owner, `Orbit ${unique()}`);
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  const secrets = [];
  try {
    const managementCreate = page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ });
    await managementCreate.waitFor();
    const created = await createInvitationMetadata(page, team.id, () => managementCreate.click());
    const createdUrl = await revealInvitationUrl(page, team.id, created.id);
    const firstSecret = secretFromUrl(createdUrl);
    secrets.push(firstSecret);
    await withRedactedSecrets(secrets, async () => {
      const link = page.getByLabel("Ссылка для приглашения", { exact: true });
      await link.waitFor();
      await page.evaluate(() => { window.__ac03ClipboardMode = "failure"; });
      await page.getByRole("button", { name: "Копировать ссылку", exact: true }).click();
      await page.getByText("Разрешите доступ к буферу обмена и повторите попытку.", { exact: true }).waitFor();
      assert.equal(await link.inputValue(), createdUrl, "copy failure retains the current reusable URL for retry");

      await page.evaluate(() => { window.__ac03ClipboardMode = "success"; });
      await page.getByRole("button", { name: "Повторить копирование", exact: true }).click();
      assert.equal(await page.evaluate((value) => window.__ac03ClipboardWrites.includes(value), createdUrl), true);
      await page.evaluate(() => { window.__ac03ClipboardWrites = []; });
      await page.getByText("Ссылка приглашения готова к отправке.", { exact: true }).waitFor();
      assert.equal(await link.inputValue(), createdUrl, "AC03_COPY_SUCCESS_CLEARED_CURRENT_VIEW");
      await assertSecretOnlyInTransientView(page, firstSecret, "AC03_COPY_SUCCESS");
    });

    const dismissed = await createInvitationMetadata(
      page,
      team.id,
      () => page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click(),
    );
    const dismissedUrl = await revealInvitationUrl(page, team.id, dismissed.id);
    const dismissedSecret = secretFromUrl(dismissedUrl);
    secrets.push(dismissedSecret);
    await withRedactedSecrets(secrets, async () => {
      await invitationLinkField(page, dismissed.id).waitFor();
      const revokeResponse = waitForInvitationResponse(page, team.id, "revoke");
      await invitationControl(page, dismissed.id, "Отозвать приглашение").click();
      assert.equal((await revokeResponse).status(), 200, "explicit revoke must confirm the management mutation");
      await assertSecretAbsent(page, dismissedSecret, "AC03_REVOKE_LEFT_RAW_URL");
      const revokedPreview = await json("/team-invitations/preview", { method: "POST", body: { token: dismissedSecret } });
      assert.equal(revokedPreview.response.status, 410, "revoked URL must be generically unavailable");
    });

    let releaseTeamResponse;
    const teamGate = new Promise((resolve) => { releaseTeamResponse = resolve; });
    let interceptedTeam;
    const teamIntercepted = new Promise((resolve) => { interceptedTeam = resolve; });
    await page.route(`**/api/teams/${team.id}/invitations`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      interceptedTeam();
      await teamGate;
      const upstream = await route.fetch();
      assert.equal("url" in invitation(await upstream.json()), false, "AC03_TEAM_SWITCH_CREATE_RESPONSE_LEAKED_URL");
      await route.fulfill({ response: upstream });
    });
    await page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click();
    await teamIntercepted;
    await page.goto(`${web}/workspace/teams/${otherTeam.id}/members`, { waitUntil: "domcontentloaded" });
    releaseTeamResponse();
    await page.waitForTimeout(500);
    await assertNoRawInvitationSurface(page, "AC03_LATE_TEAM_RESPONSE");
    await page.unroute(`**/api/teams/${team.id}/invitations`);

    let releaseAccountResponse;
    const accountGate = new Promise((resolve) => { releaseAccountResponse = resolve; });
    let interceptedAccount;
    const accountIntercepted = new Promise((resolve) => { interceptedAccount = resolve; });
    await page.route(`**/api/teams/${otherTeam.id}/invitations`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      interceptedAccount();
      await accountGate;
      const upstream = await route.fetch();
      assert.equal("url" in invitation(await upstream.json()), false, "AC03_ACCOUNT_SWITCH_CREATE_RESPONSE_LEAKED_URL");
      await route.fulfill({ response: upstream });
    });
    await page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click();
    await accountIntercepted;
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    releaseAccountResponse();
    await page.waitForTimeout(500);
    await assertNoRawInvitationSurface(page, "AC03_LATE_ACCOUNT_RESPONSE");
  } finally {
    await context.close();
  }
});

test("P0.1 continuity: copy and reload automatically restore the same active link without browser persistence", { timeout: 60000 }, async () => {
  const { owner, team } = await managementFixture("p01_reload");
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/settings`);
  const mutations = [];
  page.on("request", request => { if (isInvitationMutation(request, team.id)) mutations.push(new URL(request.url()).pathname); });
  try {
    const metadata = await createInvitationMetadata(page, team.id, () => page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click());
    const url = await revealInvitationUrl(page, team.id, metadata.id); const secret = secretFromUrl(url);
    await withRedactedSecrets([secret], async () => {
      await assertSecretOnlyInTransientView(page, secret, "P01_INITIAL_LINK");
      await page.getByRole("button", { name: "Копировать ссылку", exact: true }).click();
      await page.waitForFunction(() => window.__ac03ClipboardWrites.length === 1);
      assert.equal(await page.evaluate(value => window.__ac03ClipboardWrites[0] === value, url), true);
      assert.equal((await invitationLinkField(page, metadata.id).inputValue()) === url, true);
      const automaticLink = waitForInvitationRevealResponse(page, team.id, metadata.id);
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal((await automaticLink).status(), 200, "reload must authorize and fetch the current link automatically");
      assert.equal((await revealInvitationUrl(page, team.id, metadata.id)) === url, true, "reload must not rotate the link");
      await assertSecretOnlyInTransientView(page, secret, "P01_RELOADED_LINK");
      assert.equal(mutations.length, 1, "copy/reload must not create a new invitation mutation");
      assert.equal(await page.getByRole("button", { name: /Показать ссылку|Закрыть ссылку/ }).count(), 0);
      const listed = await json(`/teams/${team.id}/invitations`, { token: owner.token });
      assertSafeInvitationList(listed.body, "P01_LIST_SAFE");
      assert.equal(listed.body.items.filter(item => item.state === "PENDING").length, 1);
      assert.equal(listed.body.items[0].id, metadata.id);
    });
  } finally { await context.close(); }
});

test("P0.1 continuity: manual rotations retain one invitation ID and invalidate both earlier tokens", { timeout: 60000 }, async () => {
  const { owner, invitee, team } = await managementFixture("p01_rotation");
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/settings`);
  const secrets = [];
  try {
    let metadata = await createInvitationMetadata(page, team.id, () => page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click());
    const originalId = metadata.id;
    secrets.push(secretFromUrl(await revealInvitationUrl(page, team.id, metadata.id)));
    await withRedactedSecrets(secrets, async () => {
      for (let index = 0; index < 2; index++) {
        const next = await reissueInvitationMetadata(page, team.id, originalId, () => invitationControl(page, originalId, "Перевыпустить ссылку").click());
        assert.equal(next.revision, metadata.revision + 1);
        metadata = next;
        const nextSecret = secretFromUrl(await revealInvitationUrl(page, team.id, originalId));
        assert.equal(secrets.includes(nextSecret), false, "manual rotation must use a new token"); secrets.push(nextSecret);
      }
      for (const oldSecret of secrets.slice(0, -1)) {
        assert.equal((await json("/team-invitations/preview", { method: "POST", body: { token: oldSecret } })).response.status, 410);
        assert.equal((await json("/team-invitations/accept", { token: invitee.token, method: "POST", key: randomUUID(), body: { token: oldSecret } })).response.status, 410);
        await assertSecretAbsent(page, oldSecret, "P01_ROTATION_OLD_RAW_ABSENT");
      }
      assert.equal((await json("/team-invitations/preview", { method: "POST", body: { token: secrets.at(-1) } })).response.status, 200);
      const listed = await json(`/teams/${team.id}/invitations`, { token: owner.token });
      assertSafeInvitationList(listed.body, "P01_ROTATION_LIST");
      assert.equal(listed.body.items.filter(item => item.state === "PENDING").length, 1);
      assert.equal(listed.body.items.find(item => item.state === "PENDING").id, originalId);
    });
  } finally { await context.close(); }
});

test("P0.1 continuity: team switch and logout remove the old transient view; returning authorizes the same link", { timeout: 60000 }, async () => {
  const { owner, team } = await managementFixture("p01_context");
  const otherTeam = await createTeam(owner, `Other ${unique()}`);
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/settings`);
  const mutations = []; page.on("request", request => { if (isInvitationMutation(request, team.id)) mutations.push(request.method()); });
  try {
    const created = await createInvitationMetadata(page, team.id, () => page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click());
    const url = await revealInvitationUrl(page, team.id, created.id); const secret = secretFromUrl(url);
    await withRedactedSecrets([secret], async () => {
      const previousLink = await invitationLinkField(page, created.id).elementHandle();
      await page.goto(`${web}/workspace/teams/${otherTeam.id}/settings`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
      await assertDetachedAfterParentRemount(page, previousLink, "P01_TEAM_SWITCH_DETACHED");
      await assertSecretAbsent(page, secret, "P01_OTHER_TEAM_RAW_ABSENT");
      await assertNoRawInvitationSurface(page, "P01_OTHER_TEAM_NO_RAW");
      const automaticLink = waitForInvitationRevealResponse(page, team.id, created.id);
      await page.goto(`${web}/workspace/teams/${team.id}/settings`, { waitUntil: "domcontentloaded" });
      assert.equal((await automaticLink).status(), 200);
      assert.equal((await revealInvitationUrl(page, team.id, created.id)) === url, true);
      await assertSecretOnlyInTransientView(page, secret, "P01_RETURN_TEAM_TRANSIENT");
      const returnedLink = await invitationLinkField(page, created.id).elementHandle();
      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await page.waitForURL(`${web}/`);
      await assertDetachedAfterParentRemount(page, returnedLink, "P01_LOGOUT_LINK_DETACHED");
      await assertSecretAbsent(page, secret, "P01_LOGOUT_RAW_ABSENT");
      await assertNoRawInvitationSurface(page, "P01_LOGOUT_NO_RAW");
      assert.equal(mutations.length, 1, "context changes must not rotate the invitation");
    });
  } finally { await context.close(); }
});

test("AC-06 participant roster: accepted second account is visible to owner and sees its own safe roster without invitation controls", { timeout: 90000 }, async () => {
  const { owner, invitee, team } = await managementFixture("ac06_two_account_roster");
  const ownerSession = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  let inviteeSession;
  const memberMutationPaths = [];
  try {
    const createResponse = waitForInvitationResponse(ownerSession.page, team.id);
    await ownerSession.page.getByRole("button", { name: /^(Выпустить|Перевыпустить) ссылку$/ }).click();
    const created = invitation(await (await createResponse).json());
    assert.equal("url" in created, false, "AC06_ROSTER_CREATE_RESPONSE_LEAKED_URL");
    const joinUrl = await revealInvitationUrl(ownerSession.page, team.id, created.id);
    const secret = secretFromUrl(joinUrl);

    await withRedactedSecrets([secret], async () => {
      inviteeSession = await openAccount(invitee, joinUrl);
      await inviteeSession.page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      const acceptInvitation = inviteeSession.page.getByRole("button", { name: "Принять приглашение", exact: true });
      await acceptInvitation.waitFor({ timeout: 15_000 });
      await acceptInvitation.click();
      await inviteeSession.page.waitForURL(`**/workspace/teams/${team.id}/interviews`);

      const secondInvitee = await account("p01_reusable_member");
      const secondAccept = await json("/team-invitations/accept", {
        token: secondInvitee.token,
        method: "POST",
        key: randomUUID(),
        body: { token: secret },
      });
      assert.equal(secondAccept.response.status, 200, "the same active link must admit a second distinct user");

      const ownerRoster = await foregroundForRosterRevalidation(
        ownerSession.page,
        team.id,
        "AC06_OWNER_ACCEPT_FOCUS_REFRESH",
      );
      assert.equal(ownerRoster.status(), 200, "AC06_OWNER_ROSTER_UNAVAILABLE_AFTER_ACCEPT");
      assert.equal(await ownerRoster.headerValue("cache-control"), "private, no-store", "AC06_OWNER_ROSTER_CACHE_POLICY_INVALID");
      const ownerRosterPayload = await ownerRoster.json();
      assertSafeRoster(ownerRosterPayload, "AC06_OWNER_ROSTER");
      assert.equal(
        ownerRosterPayload.items.some((item) => item.userId === invitee.user.id && item.role === "MEMBER" && item.state === "ACTIVE"),
        true,
        "AC06_OWNER_ROSTER_MISSING_ACCEPTED_MEMBER",
      );
      assert.equal(ownerRosterPayload.items.some(item => item.userId === secondInvitee.user.id && item.role === "MEMBER" && item.state === "ACTIVE"), true, "owner roster must contain both users from the same invitation");
      assert.equal((await json("/team-invitations/preview", { method: "POST", body: { token: secret } })).response.status, 200, "acceptance must not consume the reusable invitation");
      const stillActive = await json(`/teams/${team.id}/invitations`, { token: owner.token });
      assertSafeInvitationList(stillActive.body, "P01_REUSABLE_LIST_SAFE");
      assert.equal(stillActive.body.items.filter(item => item.state === "PENDING").length, 1);
      await ownerSession.page.getByText(invitee.user.displayName, { exact: true }).waitFor();
      await ownerSession.page.getByText(secondInvitee.user.displayName, { exact: true }).waitFor();

      inviteeSession.page.on("request", (request) => {
        if (isInvitationMutation(request, team.id)) memberMutationPaths.push(new URL(request.url()).pathname);
      });
      let releaseUnavailableRoster;
      const unavailableRosterGate = new Promise((resolve) => { releaseUnavailableRoster = resolve; });
      let unavailableRosterObserved;
      const unavailableRosterRequest = new Promise((resolve) => { unavailableRosterObserved = resolve; });
      const rosterPattern = `**/api/teams/${team.id}/members**`;
      await inviteeSession.page.route(rosterPattern, async (route) => {
        unavailableRosterObserved();
        await unavailableRosterGate;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify({ error: "TEAM_MEMBER_DIRECTORY_UNAVAILABLE" }),
        });
      });
      const unavailableRosterResponse = waitForRosterResponse(inviteeSession.page, team.id);
      const memberNavigation = inviteeSession.page.goto(`${web}/workspace/teams/${team.id}/members`, { waitUntil: "domcontentloaded" });
      await unavailableRosterRequest;
      await inviteeSession.page.getByRole("status", { name: "Загружаем участников" }).waitFor();
      releaseUnavailableRoster();
      await memberNavigation;
      const unavailableRoster = await unavailableRosterResponse;
      assert.equal(unavailableRoster.status(), 503, "AC06_MEMBER_ROSTER_UNAVAILABLE_STATE_NOT_EXERCISED");
      await inviteeSession.page.getByText("Состав команды", { exact: true }).waitFor();
      await inviteeSession.page.getByRole("alert", { name: "Не удалось загрузить участников" }).waitFor();
      assert.equal(await inviteeSession.page.getByText("Раздел готовится", { exact: true }).count(), 0, "AC06_MEMBER_STAGED_PLACEHOLDER_VISIBLE");
      await assertNoInvitationControls(inviteeSession.page, "AC06_MEMBER_ROSTER");
      assert.deepEqual(memberMutationPaths, [], "AC06_MEMBER_SENT_INVITATION_MUTATION");
      await inviteeSession.page.unroute(rosterPattern);

      const memberRosterResponse = waitForRosterResponse(inviteeSession.page, team.id);
      await inviteeSession.page.getByRole("button", { name: "Повторить", exact: true }).click();
      const memberRoster = await memberRosterResponse;
      assert.equal(memberRoster.status(), 200, "AC06_MEMBER_ROSTER_UNAVAILABLE");
      assertSafeRoster(await memberRoster.json(), "AC06_MEMBER_ROSTER");
      await inviteeSession.page.getByRole("table", { name: "Состав команды", exact: true }).getByText(invitee.user.displayName, { exact: true }).waitFor();
      await inviteeSession.page.getByText("Вы", { exact: true }).waitFor();
      assert.equal(await inviteeSession.page.getByLabel("Поиск участников", { exact: true }).count(), 0, "AC06_ROSTER_SEARCH_REMOVED");
      await inviteeSession.page.getByRole("navigation", { name: "Пагинация участников" }).waitFor();

      const emptyRoster = { items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 };
      await inviteeSession.page.route(rosterPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify(emptyRoster),
        });
      });
      const emptyRosterResponse = waitForRosterResponse(inviteeSession.page, team.id);
      await inviteeSession.page.reload({ waitUntil: "domcontentloaded" });
      const emptyResponse = await emptyRosterResponse;
      assert.equal(emptyResponse.status(), 200, "AC06_ROSTER_EMPTY_STATE_NOT_EXERCISED");
      assert.equal(new URL(emptyResponse.url()).searchParams.has("q"), false, "AC06_ROSTER_UI_SENT_SEARCH_QUERY");
      await inviteeSession.page.getByText("Участники не найдены", { exact: true }).waitFor();
      await inviteeSession.page.unroute(rosterPattern);

      await inviteeSession.page.route(rosterPattern, async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify({ error: "Некорректный параметр списка", code: "INVALID_LIST_QUERY" }),
        });
      });
      const invalidRosterResponse = waitForRosterResponse(inviteeSession.page, team.id);
      await inviteeSession.page.reload({ waitUntil: "domcontentloaded" });
      assert.equal((await invalidRosterResponse).status(), 400, "AC06_ROSTER_INVALID_QUERY_STATE_NOT_EXERCISED");
      await inviteeSession.page.getByRole("alert", { name: "Не удалось загрузить участников" }).getByText(
        "Не удалось открыть эту страницу состава. Обновите данные и повторите попытку.",
        { exact: true },
      ).waitFor();
      assert.equal(await inviteeSession.page.getByText("Участники не найдены", { exact: true }).count(), 0, "AC06_ROSTER_INVALID_QUERY_LEFT_STALE_EMPTY_STATE");
      await inviteeSession.page.unroute(rosterPattern);

      await inviteeSession.page.route(rosterPattern, async (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify(emptyRoster),
      }));
      const invalidRetryResponse = waitForRosterResponse(inviteeSession.page, team.id);
      await inviteeSession.page.getByRole("button", { name: "Повторить", exact: true }).click();
      assert.equal((await invalidRetryResponse).status(), 200, "AC06_ROSTER_INVALID_QUERY_RETRY_UNAVAILABLE");
      await inviteeSession.page.getByText("Участники не найдены", { exact: true }).waitFor();
      assert.equal(await inviteeSession.page.getByRole("alert", { name: "Не удалось загрузить участников" }).count(), 0, "AC06_ROSTER_INVALID_QUERY_RETRY_LEFT_ERROR");
      await inviteeSession.page.unroute(rosterPattern);

      const pageZero = {
        items: [{ userId: invitee.user.id, displayName: invitee.user.displayName, role: "MEMBER", state: "ACTIVE", revision: 0 }],
        page: 0,
        size: 25,
        totalElements: 26,
        totalPages: 2,
      };
      const pageOne = {
        items: [{ userId: "safe-page-two-member", displayName: "Участник второй страницы", role: "MEMBER", state: "ACTIVE", revision: 0 }],
        page: 1,
        size: 25,
        totalElements: 26,
        totalPages: 2,
      };
      const paginationRequests = [];
      await inviteeSession.page.route(rosterPattern, async (route) => {
        const requested = new URL(route.request().url());
        const requestedPage = Number(requested.searchParams.get("page") ?? "0");
        paginationRequests.push({ page: requestedPage, size: requested.searchParams.get("size") ?? "25" });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          body: JSON.stringify(requestedPage === 1 ? pageOne : pageZero),
        });
      });
      const paginatedInitial = waitForRosterResponse(inviteeSession.page, team.id);
      await inviteeSession.page.goto(`${web}/workspace/teams/${team.id}/members`, { waitUntil: "domcontentloaded" });
      assert.equal((await paginatedInitial).status(), 200, "AC06_ROSTER_PAGINATION_INITIAL_UNAVAILABLE");
      await inviteeSession.page.getByRole("table", { name: "Состав команды", exact: true }).getByText(invitee.user.displayName, { exact: true }).waitFor();
      const nextPage = inviteeSession.page.getByRole("navigation", { name: "Пагинация участников" }).getByTitle("2", { exact: true });
      await nextPage.waitFor();
      const paginatedNext = waitForRosterResponse(inviteeSession.page, team.id);
      await nextPage.click();
      assert.equal((await paginatedNext).status(), 200, "AC06_ROSTER_PAGINATION_NEXT_UNAVAILABLE");
      await inviteeSession.page.getByText("Участник второй страницы", { exact: true }).waitFor();
      assert.equal(
        paginationRequests.some((request) => request.page === 1 && request.size === "25"),
        true,
        "AC06_ROSTER_PAGINATION_DID_NOT_REQUEST_PAGE_TWO",
      );
      await inviteeSession.page.unroute(rosterPattern);
    });
  } finally {
    if (inviteeSession) await inviteeSession.context.close();
    await ownerSession.context.close();
  }
});

const longInvitationTeamName = "Команда технических интервью с длинным русским названием для проверки интерфейса";

async function runShortViewportInvitationCell(cell, marker) {
  const { owner, admin, member, team } = await managementFixture(
    `ac03_keyboard_${cell.viewport.width}_${cell.viewport.height}`,
    `${longInvitationTeamName} ${unique()}`,
  );
  const teamName = team.name;
  const unavailableTeam = await createTeam(owner, `Недоступная команда ${unique()}`);
  const logoutTeam = await createTeam(owner, `Повторный вход ${unique()}`);
  const failures = [];
  try {
    for (const [name, action] of [
      ["OWNER", () => exerciseInvitationManagementByKeyboard(owner, "OWNER", team, cell, teamName, marker)],
      ["ADMIN", () => exerciseInvitationManagementByKeyboard(admin, "ADMIN", team, cell, teamName, marker)],
      ["MEMBER", () => assertMemberInvitationBoundary(member, team, cell, marker)],
      ["UNAVAILABLE", () => assertUnavailableInvitationBoundary(owner, unavailableTeam, cell, marker)],
      ["LOGOUT_RELOGIN", () => assertKeyboardLogoutReloginCleanup(owner, logoutTeam, cell, marker)],
    ]) {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const failureSummary = failures
        .map((error) => error instanceof Error ? error.message : String(error))
        .join(" | ");
      throw new AggregateError(failures, `${marker}_TASK_1_3_BEHAVIOURAL_CONTRACT_FAILED: ${failureSummary}`);
    }
  } finally {
    // Contexts are cleaned up inside each role exercise. The isolated runner
    // drops its disposable schema after the independently registered suite.
  }
}

test("navigation overflow Enter activates its autofocus menuitem and preserves pointer link navigation", { timeout: 30000 }, async () => {
  const owner = await account("overflow_keyboard");
  const team = await createTeam(owner, `Keyboard overflow ${unique()}`);
  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/interviews`, { width: 384, height: 512 });
  try {
    await page.getByRole("main", { name: `Команда ${team.name}: Интервью`, exact: true }).waitFor();
    const opener = page.getByRole("button", { name: /Меню разделов/ });
    await focusWithKeyboard(page, opener, "OVERFLOW_INITIAL_OPENER");
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Дополнительные разделы", exact: true });
    await menu.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Дополнительные разделы"] [role="menuitem"]') === document.activeElement);
    const firstLink = menu.getByRole("menuitem").first().getByRole("link");
    const firstHref = await firstLink.getAttribute("href");
    assert.equal(firstHref.startsWith(`/workspace/teams/${team.id}/`), true, "overflow retains the real team link context");
    await page.keyboard.press("Enter");
    await page.waitForURL(new URL(firstHref, web).href);
    assert.equal(new URL(page.url()).pathname, firstHref, "Enter on the initial menuitem navigates without an extra arrow key");

    await opener.click();
    await menu.waitFor();
    const settings = menu.getByRole("link", { name: "Треки и вакансии", exact: true });
    const settingsHref = await settings.getAttribute("href");
    const newTab = context.waitForEvent("page");
    const modifier = await page.evaluate(() => navigator.platform.includes("Mac") ? "Meta" : "Control");
    await settings.click({ modifiers: [modifier] });
    const destination = await newTab;
    await destination.waitForURL(new URL(settingsHref, web).href);
    assert.equal(new URL(page.url()).pathname, firstHref, "modified pointer activation retains the original tab");
    await destination.close();
    // A closing dropdown can remain visible while its retained menu is inert.
    await page.waitForFunction(() => document.querySelector('button[aria-label^="Меню разделов"]')?.getAttribute("aria-expanded") === "false");
    await opener.click();
    await page.waitForFunction(() => document.querySelector('button[aria-label^="Меню разделов"]')?.getAttribute("aria-expanded") === "true"
      && document.querySelector('[role="menu"][aria-label="Дополнительные разделы"]')?.inert === false);
    await menu.getByRole("link", { name: "Треки и вакансии", exact: true }).click();
    await page.waitForURL(new URL(settingsHref, web).href);
    assert.equal(new URL(page.url()).pathname, settingsHref, "ordinary pointer activation reaches the same link once");
  } finally { await context.close(); }
});

test("BUG-AC03-QA-001: invitation management remains keyboard-operable at 1280x720 → 640x360", { timeout: 300000 }, async () => {
  await runShortViewportInvitationCell(
    { source: "1280x720", viewport: { width: 640, height: 360 } },
    "BUG_AC03_QA_001_1280x720_TO_640x360",
  );
});

test("BUG-AC03-QA-002: invitation management remains keyboard-operable at 768x1024 → 384x512", { timeout: 300000 }, async () => {
  await runShortViewportInvitationCell(
    { source: "768x1024", viewport: { width: 384, height: 512 } },
    "BUG_AC03_QA_002_768x1024_TO_384x512",
  );
});

test(
  nativeAxTestId,
  { skip: !nativeAxLifecycleRequested },
  async () => {
    let launcher;
    try {
      launcher = await import(nativeAxLauncherUrl.href);
    } catch {
      assert.fail("NATIVE_AX_LAUNCHER_SOURCE_MISSING");
    }
    const {
      collectNativeBrowserEvidence,
      evaluateNativeBrowserBarriers,
      assertNativeBrowserSeamPolicy,
    } = launcher;
    const operations = [];
    const fakePage = {
      addInitScript(script) {
        operations.push("observer:init-script-armed");
        assert.equal(
          String(script).includes("dispatchEvent("),
          false,
          "NATIVE_AX_BROWSER_OBSERVER_SCRIPT_SYNTHETIC",
        );
        return Promise.resolve();
      },
      evaluate(fn) {
        operations.push("observer:visibilitychange");
        operations.push("observer:focus");
        assert.equal(
          String(fn).includes("document.visibilityState ="),
          false,
          "NATIVE_AX_BROWSER_OBSERVER_MUTATES_VISIBILITY",
        );
        return Promise.resolve({
          foregroundLifecycleObserved: true,
        });
      },
      waitForRequest(predicate) {
        operations.push("waitForRequest:armed");
        assert.equal(
          predicate({ method: () => "GET", url: () => `${api}/teams/team-1` }),
          true,
          "NATIVE_AX_BROWSER_REQUEST_PREDICATE_NOT_EXACT",
        );
        return Promise.resolve({ url: () => `${api}/teams/team-1` });
      },
      waitForResponse(predicate) {
        operations.push("waitForResponse:armed");
        assert.equal(
          predicate({ status: () => 200, request: () => ({ method: () => "GET", url: () => `${api}/teams/team-1` }) }),
          true,
          "NATIVE_AX_BROWSER_RESPONSE_PREDICATE_NOT_EXACT",
        );
        return Promise.resolve({ status: () => 200 });
      },
      elementHandle() {
        operations.push("elementHandle:captured");
        return {
          waitForElementState(state) {
            operations.push(`elementHandle:${state}`);
            return Promise.resolve();
          },
        };
      },
      waitForSelector(selector) {
        operations.push(`dom:${selector}`);
        return Promise.resolve();
      },
    };
    const evidence = await collectNativeBrowserEvidence({
      page: fakePage,
      teamId: "team-1",
      apiBaseUrl: api,
      runNativeFocus: async () => {
        operations.push("nativeFocus:called");
        return { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED" };
      },
    });
    assert.deepEqual(
      operations.slice(0, 4),
      ["observer:init-script-armed", "waitForRequest:armed", "waitForResponse:armed", "elementHandle:captured"],
      "NATIVE_AX_BROWSER_OBSERVERS_NOT_PREARMED_BEFORE_NATIVE_FOCUS",
    );
    assert.equal(
      operations.indexOf("nativeFocus:called") > operations.indexOf("elementHandle:captured"),
      true,
      "NATIVE_AX_BROWSER_NATIVE_FOCUS_RAN_BEFORE_OBSERVERS",
    );
    assert.equal(
      operations.indexOf("observer:visibilitychange") > operations.indexOf("nativeFocus:called"),
      true,
      "NATIVE_AX_BROWSER_LIFECYCLE_NOT_OBSERVED_AFTER_NATIVE_FOCUS",
    );
    assert.deepEqual(
      evidence,
      {
        foregroundLifecycleObserved: true,
        exactUnmockedTeamDetailGetObserved: true,
        previousHandleDetached: true,
        currentDomActionRendered: true,
      },
      "NATIVE_AX_BROWSER_EVIDENCE_NOT_DERIVED_FROM_COLLECTOR",
    );
    const noLifecyclePage = { ...fakePage, addInitScript: undefined, evaluate: undefined };
    assert.deepEqual(
      await collectNativeBrowserEvidence({
        page: noLifecyclePage,
        teamId: "team-1",
        apiBaseUrl: api,
        runNativeFocus: async () => ({ outcome: "LOCAL_MANUAL_WITNESS_REQUIRED" }),
      }),
      {
        foregroundLifecycleObserved: false,
        exactUnmockedTeamDetailGetObserved: true,
        previousHandleDetached: true,
        currentDomActionRendered: true,
      },
      "NATIVE_AX_BROWSER_LIFECYCLE_ABSENCE_NOT_REFLECTED",
    );
    const completeEvidence = {
      nativeReceipt: {
        outcome: "LOCAL_MANUAL_WITNESS_REQUIRED",
        checks: {
          manualWitness: true,
          sinkRaised: true,
          browserRaised: true,
        },
      },
      browserEvidence: {
        foregroundLifecycleObserved: true,
        exactUnmockedTeamDetailGetObserved: true,
        previousHandleDetached: true,
        currentDomActionRendered: true,
      },
    };
    assert.deepEqual(
      evaluateNativeBrowserBarriers(completeEvidence),
      { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED", productResult: false },
      "NATIVE_AX_BROWSER_AUTHORITATIVE_BARRIERS_REJECTED",
    );
    for (const [marker, evidence] of [
      ["NATIVE_TE", { ...completeEvidence, nativeReceipt: { outcome: "TE", checks: {} } }],
      ["NO_WITNESS", { ...completeEvidence, nativeReceipt: { ...completeEvidence.nativeReceipt, checks: { ...completeEvidence.nativeReceipt.checks, manualWitness: false } } }],
      ["NO_FOREGROUND", { ...completeEvidence, browserEvidence: { ...completeEvidence.browserEvidence, foregroundLifecycleObserved: false } }],
      ["NO_GET", { ...completeEvidence, browserEvidence: { ...completeEvidence.browserEvidence, exactUnmockedTeamDetailGetObserved: false } }],
      ["NO_HANDLE_DETACH", { ...completeEvidence, browserEvidence: { ...completeEvidence.browserEvidence, previousHandleDetached: false } }],
      ["NO_DOM", { ...completeEvidence, browserEvidence: { ...completeEvidence.browserEvidence, currentDomActionRendered: false } }],
    ]) {
      assert.deepEqual(
        evaluateNativeBrowserBarriers(evidence),
        { outcome: "TE", productResult: false },
        `NATIVE_AX_BROWSER_BARRIER_MISSING:${marker}`,
      );
    }
    assert.deepEqual(
      assertNativeBrowserSeamPolicy({
        invokedOperations: [
          "observer:visibilitychange",
          "observer:focus",
          "waitForRequest:isExactTeamDetailRequest",
          "waitForResponse:isExactTeamDetailRequest",
          "elementHandle:detached",
          "dom:currentAction",
        ],
      }),
      { accepted: true },
      "NATIVE_AX_BROWSER_SAFE_POLICY_REJECTED",
    );
    for (const operation of [
      "dispatchEvent",
      "document.visibilityState:set",
      "window.focus",
      "page.reload",
      "route.fulfill",
      "cdp.lifecycleEvent",
      "foregroundForTeamRevalidation",
      "bringToFront",
    ]) {
      assert.deepEqual(
        assertNativeBrowserSeamPolicy({ invokedOperations: [operation] }),
        { accepted: false, outcome: "TE" },
        `NATIVE_AX_BROWSER_FORBIDDEN_SHORTCUT_ACCEPTED:${operation}`,
      );
    }
  },
);
