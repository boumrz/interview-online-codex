import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const password = "test-password-123";
const invitationSessionKey = "interview-online:team-invitation";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
let browserClientIpSequence = Math.floor(Math.random() * 130_000);

let browser;

function nextBrowserClientIp() {
  // RFC 2544 reserves 198.18.0.0/15 for benchmarking. Browser contexts get
  // distinct synthetic clients; direct raw() coverage remains on loopback.
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
  const { response, body } = await json("/auth/register", {
    method: "POST",
    body: {
      nickname: `${prefix}_${suffix}`.slice(0, 32),
      displayName: `${prefix} ${suffix}`,
      password,
      isHr: false,
    },
  });
  assert.equal(response.status, 200, "AC03 account fixture must be available");
  return body;
}

async function createTeam(auth, name) {
  const { response, body } = await json("/teams", {
    token: auth.token,
    method: "POST",
    key: randomUUID(),
    body: { name },
  });
  assert.equal(response.status, 201, "AC03 team fixture must be available");
  return body.team ?? body;
}

function invitationMetadata(body, marker) {
  const value = body?.invitation ?? body;
  const valid = Boolean(
    value
      && typeof value === "object"
      && typeof value.id === "string"
      && value.id.length > 0,
  );
  assert.equal(valid, true, `${marker}_METADATA_MISSING`);
  assert.equal("url" in value, false, `${marker}_GENERIC_RESPONSE_LEAKED_URL`);
  assert.equal("token" in value, false, `${marker}_GENERIC_RESPONSE_LEAKED_TOKEN`);
  return value;
}

function invitationSecret(url, marker) {
  let fragment = "";
  try {
    fragment = typeof url === "string" ? new URL(url, web).hash : "";
  } catch {
    fragment = "";
  }
  assert.equal(/^#token=[A-Za-z0-9_-]{43}$/.test(fragment), true, `${marker}_MALFORMED_FRAGMENT`);
  return fragment.slice("#token=".length);
}

async function issueInvitationWithCreatorLink(owner, team, marker) {
  const created = await json(`/teams/${team.id}/invitations`, {
    token: owner.token,
    method: "POST",
    key: randomUUID(),
    body: {},
  });
  assert.equal(created.response.status, 201, `${marker}_CREATE_MISSING`);
  const metadata = invitationMetadata(created.body, marker);

  const revealed = await json(`/teams/${team.id}/invitations/${metadata.id}/link`, {
    token: owner.token,
  });
  assert.equal(revealed.response.status, 200, `${marker}_CREATOR_REVEAL_MISSING`);
  const url = typeof revealed.body?.url === "string" ? revealed.body.url : "";
  const token = invitationSecret(url, marker);
  return { invitation: metadata, url, token };
}

async function openAccount(auth, path) {
  const pathToken = new URL(path, web).hash.slice("#token=".length);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
  if (auth) {
    await context.addInitScript(({ token, user }) => {
      const accountSeedKey = "__ac03-e2e-account-seeded";
      if (sessionStorage.getItem(accountSeedKey) === "1") return;
      sessionStorage.setItem(accountSeedKey, "1");
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.setItem("display_name", user.displayName);
    }, auth);
  }
  await context.addInitScript(() => {
    const originalReplaceState = history.replaceState.bind(history);
    window.__ac03ReplaceStateCalls = 0;
    window.__ac03FirstFetchHadFragment = null;
    window.__ac03FirstXhrHadFragment = null;
    window.__ac03FirstBeaconHadFragment = null;
    history.replaceState = (...args) => {
      window.__ac03ReplaceStateCalls += 1;
      return originalReplaceState(...args);
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      if (window.__ac03FirstFetchHadFragment === null) {
        window.__ac03FirstFetchHadFragment = window.location.hash !== "";
      }
      return originalFetch(...args);
    };
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function ac03Send(...args) {
      if (window.__ac03FirstXhrHadFragment === null) {
        window.__ac03FirstXhrHadFragment = window.location.hash !== "";
      }
      return originalXhrSend.apply(this, args);
    };
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (...args) => {
      if (window.__ac03FirstBeaconHadFragment === null) {
        window.__ac03FirstBeaconHadFragment = window.location.hash !== "";
      }
      return originalSendBeacon(...args);
    };
  });
  const page = await context.newPage();
  let unsafeDiagnostics = false;
  const captureDiagnostic = (value) => {
    const text = String(value);
    if (/#token=[A-Za-z0-9_-]+/.test(text) || (pathToken && text.includes(pathToken))) unsafeDiagnostics = true;
  };
  page.on("console", (message) => captureDiagnostic(message.text()));
  page.on("pageerror", (error) => captureDiagnostic(error.message));
  page.__ac03UnsafeDiagnostics = () => unsafeDiagnostics;
  page.setDefaultTimeout(10000);
  try {
    await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const redacted = new Error("AC03_JOIN_NAVIGATION_FAILED_WITH_REDACTED_FRAGMENT");
    redacted.stack = String(error.stack || redacted.stack).replace(/#token=[A-Za-z0-9_-]+/g, "#token=[REDACTED]");
    throw redacted;
  }
  await page.locator("#root").waitFor({ state: "attached" });
  return { context, page };
}

async function assertSecretClearedWithoutDiagnostics(page, token, marker) {
  const clean = await page.evaluate((secret) => {
    const everyStorageValueIsClean = (storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)))
      .every((value) => !String(value).includes(secret));
    return window.location.hash === ""
      && !window.location.href.includes(secret)
      && !document.referrer.includes(secret)
      && !JSON.stringify(history.state ?? {}).includes(secret)
      && !document.body.innerText.includes(secret)
      && !Array.from(document.querySelectorAll('[role="alert"], [role="status"], .error, .notification')).some((node) => node.textContent?.includes(secret))
      && everyStorageValueIsClean(localStorage)
      && everyStorageValueIsClean(sessionStorage);
  }, token);
  assert.equal(clean && !page.__ac03UnsafeDiagnostics(), true, marker);
}

async function assertSecretOnlyInInvitationSessionStorage(page, token, marker) {
  const isolated = await page.evaluate(({ key, secret }) => {
    const localValues = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)));
    const otherSessionValues = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((candidate) => candidate !== key)
      .map((candidate) => sessionStorage.getItem(candidate));
    const visibleText = [
      window.location.href,
      document.referrer,
      JSON.stringify(history.state ?? {}),
      document.body.innerText,
      ...Array.from(document.querySelectorAll('[role="alert"], [role="status"], .error, .notification')).map((node) => node.textContent ?? ""),
    ].join("\n");
    return sessionStorage.getItem(key) === secret
      && !visibleText.includes(secret)
      && localValues.every((value) => !String(value).includes(secret))
      && otherSessionValues.every((value) => !String(value).includes(secret));
  }, { key: invitationSessionKey, secret: token });
  assert.equal(isolated && !page.__ac03UnsafeDiagnostics(), true, marker);
}

async function assertSynchronousFragmentScrub(page, token, marker) {
  const scrubbedBeforeRouteWork = await page.evaluate((secret) => (
    window.__ac03ReplaceStateCalls > 0
      && window.__ac03FirstFetchHadFragment === false
      && window.__ac03FirstXhrHadFragment !== true
      && window.__ac03FirstBeaconHadFragment !== true
      && window.location.hash === ""
      && !window.location.href.includes(secret)
      && document.querySelector('meta[name="referrer"]')?.getAttribute("content") === "no-referrer"
  ), token);
  assert.equal(scrubbedBeforeRouteWork, true, marker);
}

async function withRedactedSecret(token, work) {
  try {
    return await work();
  } catch (error) {
    const redact = (value) => String(value || "")
      .replace(/#token=[A-Za-z0-9_-]+/g, "#token=[REDACTED]")
      .replaceAll(token, "[REDACTED]");
    error.message = redact(error.message);
    error.stack = redact(error.stack);
    throw error;
  }
}

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("AC-03: fragment is cleared before login and explicit accept adds one team without exposing its contents", { timeout: 60000 }, async () => {
  const owner = await account("ac03_owner");
  const colleague = await account("ac03_colleague");
  const oldTeam = await createTeam(colleague, "Existing colleague team");
  const invitedTeam = await createTeam(owner, "Explicit acceptance team");

  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    invitedTeam,
    "AC03_INVITATION",
  );

  return withRedactedSecret(token, async () => {
  const { context, page } = await openAccount(colleague, `${invitationUrl}`);
  try {
    await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
    await assertSynchronousFragmentScrub(page, token, "AC03_FRAGMENT_NOT_CLEARED_BEFORE_ROUTE_WORK");
    assert.equal(await page.getByText("Explicit acceptance team", { exact: true }).count(), 1, "only invitation preview identifies the team");
    assert.equal(await page.getByText(/кандидат|интервью|библиотек/i).count(), 0, "preview must not disclose protected team surfaces");
    await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${invitedTeam.id}/interviews`);
    const switcher = page.getByRole("button", { name: /^Рабочее пространство:/ });
    await switcher.click();
    const dialog = page.getByRole("dialog", { name: "Выбор рабочего пространства", exact: true });
    await dialog.getByRole("button", { name: new RegExp(oldTeam.id.slice(0, 8), "i") }).waitFor();
    await dialog.getByRole("button", { name: new RegExp(invitedTeam.id.slice(0, 8), "i") }).waitFor();
    await assertSecretClearedWithoutDiagnostics(page, token, "AC03_ACCEPT_LEFT_INVITATION_SECRET_RESIDUE");
  } finally {
    await context.close();
  }
  });
});

test("AC-03: alreadyMember is a terminal 200 outcome and clears the invitee token", { timeout: 60000 }, async () => {
  const owner = await account("ac03_already_member_owner");
  const team = await createTeam(owner, "Existing membership team");
  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_ALREADY_MEMBER_FIXTURE",
  );
  return withRedactedSecret(token, async () => {
    const { context, page } = await openAccount(owner, invitationUrl);
    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      const accepted = page.waitForResponse((response) => (
        new URL(response.url()).pathname === "/api/team-invitations/accept"
        && response.request().method() === "POST"
      ));
      await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
      const outcome = await (await accepted).json();
      assert.equal(outcome.outcome, "alreadyMember", "fixture must exercise the terminal alreadyMember branch");
      await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
      await assertSecretClearedWithoutDiagnostics(page, token, "AC03_ALREADY_MEMBER_LEFT_INVITATION_SECRET_RESIDUE");
    } finally {
      await context.close();
    }
  });
});

test("AC-03: unauthenticated invitation returns through login and does not leave its secret in URL or session after cancellation", { timeout: 60000 }, async () => {
  const owner = await account("ac03_return_owner");
  const existing = await account("ac03_return_existing");
  const team = await createTeam(owner, "Login return team");
  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_LOGIN_RETURN_FIXTURE",
  );
  return withRedactedSecret(token, async () => {
  const { context, page } = await openAccount(null, invitationUrl);
  try {
    await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
    await assertSynchronousFragmentScrub(page, token, "AC03_GUEST_FRAGMENT_NOT_CLEARED_BEFORE_LOGIN");
    await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
    await page.getByRole("link", { name: "Войти", exact: true }).click();
    await page.waitForURL("**/login");
    await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_LOGIN_TOKEN_NOT_ISOLATED_IN_EXACT_SESSION_KEY");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL("**/login");
    await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_LOGIN_RELOAD_DROPPED_OR_EXPOSED_INVITATION_TOKEN");
    await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(existing.user.nickname);
    await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill(password);
    await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
    await assertSecretClearedWithoutDiagnostics(page, token, "AC03_LOGIN_ACCEPT_LEFT_INVITATION_SECRET_RESIDUE");
  } finally {
    await context.close();
  }
  });
});

test("AC-03: unauthenticated invitation returns through registration and succeeds without retaining its fragment", { timeout: 60000 }, async () => {
  const owner = await account("ac03_register_owner");
  const team = await createTeam(owner, "Registration return team");
  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_REGISTER_RETURN_FIXTURE",
  );
  const suffix = unique();
  return withRedactedSecret(token, async () => {
  const { context, page } = await openAccount(null, invitationUrl);
  try {
    await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
    await assertSynchronousFragmentScrub(page, token, "AC03_REGISTRATION_FRAGMENT_NOT_CLEARED_BEFORE_ROUTE_WORK");
    await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
    await page.getByRole("link", { name: "Регистрация", exact: true }).click();
    await page.waitForURL("**/login");
    await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_REGISTRATION_TOKEN_NOT_ISOLATED_IN_EXACT_SESSION_KEY");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL("**/login");
    await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_REGISTRATION_RELOAD_DROPPED_OR_EXPOSED_INVITATION_TOKEN");
    await page.getByRole("radio", { name: "Регистрация", exact: true }).check();
    await page.getByLabel("Ник", { exact: true }).fill(`ac03_new_${suffix}`.slice(0, 32));
    await page.getByLabel("Имя для комнаты", { exact: true }).fill(`New colleague ${suffix}`);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
    await assertSecretClearedWithoutDiagnostics(page, token, "AC03_REGISTER_ACCEPT_LEFT_INVITATION_SECRET_RESIDUE");
  } finally {
    await context.close();
  }
  });
});

test("AC-03: guest cancellation is explicit, clears the fragment, and never creates membership", { timeout: 60000 }, async () => {
  const owner = await account("ac03_cancel_owner");
  const recipient = await account("ac03_cancel_recipient");
  const team = await createTeam(owner, "Cancelled invitation team");
  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_CANCEL_FIXTURE",
  );

  return withRedactedSecret(token, async () => {
    const { context, page } = await openAccount(null, invitationUrl);
    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      await assertSynchronousFragmentScrub(page, token, "AC03_CANCEL_FRAGMENT_NOT_CLEARED_SYNCHRONOUSLY");
      assert.equal(await page.getByRole("button", { name: "Принять приглашение", exact: true }).count(), 1, "guest consent must be offered before any login or registration intent");
      await page.getByRole("button", { name: "Отменить приглашение", exact: true }).click();
      await page.waitForURL((url) => url.pathname !== "/join/team");
      await assertSecretClearedWithoutDiagnostics(page, token, "AC03_CANCEL_LEFT_INVITATION_SECRET_RESIDUE");
      const workspaces = await json("/me/workspaces", { token: recipient.token });
      assert.equal(workspaces.response.status, 200, "AC03_CANCEL_MEMBERSHIP_CHECK_MISSING");
      assert.equal(JSON.stringify(workspaces.body).includes(team.id), false, "cancel must not queue or automatically join the invitation");
    } finally {
      await context.close();
    }
  });
});

test("AC-03: accept preserves one scoped intent across network, 429, 503, 401 and a committed response loss", { timeout: 90000 }, async () => {
  const owner = await account("ac03_accept_policy_owner");
  const recipient = await account("ac03_accept_policy_recipient");
  const team = await createTeam(owner, "Retryable acceptance team");
  const { url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_ACCEPT_POLICY_FIXTURE",
  );

  return withRedactedSecret(token, async () => {
    const { context, page } = await openAccount(recipient, invitationUrl);
    const attempts = [];
    const committedOutcomes = [];
    await page.route("**/api/team-invitations/accept", async (route) => {
      attempts.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postDataJSON(),
      });
      if (attempts.length === 1) return route.abort("failed");
      if (attempts.length === 2) {
        return route.fulfill({
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "5", "Cache-Control": "private, no-store" },
          body: JSON.stringify({ code: "RATE_LIMITED", error: "Попробуйте позже" }),
        });
      }
      if (attempts.length === 3) {
        return route.fulfill({
          status: 503,
          headers: { "Content-Type": "application/json", "Retry-After": "5", "Cache-Control": "private, no-store" },
          body: JSON.stringify({ code: "RATE_LIMIT_UNAVAILABLE", error: "Сервис временно недоступен" }),
        });
      }
      if (attempts.length === 4) {
        return route.fulfill({
          status: 401,
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
          body: JSON.stringify({ code: "UNAUTHORIZED", error: "Требуется вход" }),
        });
      }
      const upstream = await route.fetch();
      const responseBody = await upstream.body();
      committedOutcomes.push(JSON.parse(responseBody.toString("utf8")));
      if (attempts.length === 5) return route.abort("failed");
      return route.fulfill({ response: upstream, body: responseBody });
    });

    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
      for (const marker of [
        "AC03_ACCEPT_NETWORK_MUST_OFFER_EXPLICIT_RETRY",
        "AC03_ACCEPT_429_MUST_OFFER_EXPLICIT_RETRY",
        "AC03_ACCEPT_503_MUST_OFFER_EXPLICIT_RETRY",
      ]) {
        await page.getByRole("button", { name: "Повторить принятие", exact: true }).waitFor();
        await assertSecretOnlyInInvitationSessionStorage(page, token, `${marker}_TOKEN_LIFECYCLE`);
        if (attempts.length < 3) await page.getByRole("button", { name: "Повторить принятие", exact: true }).click();
      }
      await page.getByRole("button", { name: "Повторить принятие", exact: true }).click();
      await page.getByRole("link", { name: "Войти", exact: true }).click();
      await page.waitForURL("**/login");
      await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_ACCEPT_401_DROPPED_OR_EXPOSED_TOKEN");
      await page.reload({ waitUntil: "domcontentloaded" });
      await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_ACCEPT_401_LOGIN_RELOAD_DROPPED_OR_EXPOSED_TOKEN");
      await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(recipient.user.nickname);
      await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill(password);
      await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();

      await page.getByRole("button", { name: "Повторить принятие", exact: true }).waitFor();
      await assertSecretOnlyInInvitationSessionStorage(page, token, "AC03_COMMITTED_ACCEPT_LOSS_CLEARED_TOKEN_BEFORE_REPLAY");
      await page.getByRole("button", { name: "Повторить принятие", exact: true }).click();
      await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
      await assertSecretClearedWithoutDiagnostics(page, token, "AC03_ACCEPT_REPLAY_LEFT_INVITATION_SECRET_RESIDUE");

      assert.equal(attempts.length, 6, "explicit retries must produce one attempt per user action");
      assert.match(attempts[0].key, /^[0-9a-f-]{36}$/i);
      assert.equal(new Set(attempts.slice(0, 4).map((attempt) => attempt.key)).size, 1, "network, 429 and 503 retries must preserve the scoped UUID until authentication is required");
      assert.match(attempts[4].key, /^[0-9a-f-]{36}$/i);
      assert.equal(attempts[5].key, attempts[4].key, "committed accept retry must preserve its post-authentication UUID");
      assert.equal(new Set(attempts.map((attempt) => JSON.stringify(attempt.body))).size, 1, "all accept retries must preserve the exact body");
      assert.equal(committedOutcomes.length, 2);
      assert.deepEqual(committedOutcomes[1], committedOutcomes[0], "committed accept replay must return the same outcome");
      const workspaces = await json("/me/workspaces", { token: recipient.token });
      assert.equal(JSON.stringify(workspaces.body).match(new RegExp(team.id, "g"))?.length, 1, "accept replay creates one logical membership");
    } finally {
      await page.unroute("**/api/team-invitations/accept");
      await context.close();
    }
  });
});

test("AC-03: a revoked invitation synchronously scrubs its fragment and shows only generic recovery", { timeout: 60000 }, async () => {
  const owner = await account("ac03_revoked_owner");
  const recipient = await account("ac03_revoked_recipient");
  const team = await createTeam(owner, "Revoked invitation team");
  const { invitation, url: invitationUrl, token } = await issueInvitationWithCreatorLink(
    owner,
    team,
    "AC03_REVOKED_BROWSER_FIXTURE",
  );
  const revoked = await raw(`/teams/${team.id}/invitations/${invitation.id}/revoke`, {
    token: owner.token,
    method: "POST",
    key: randomUUID(),
    body: { revision: invitation.revision },
  });
  assert.equal(revoked.status, 200, "AC03_REVOKED_BROWSER_ENDPOINT_MISSING");

  return withRedactedSecret(token, async () => {
    const { context, page } = await openAccount(recipient, invitationUrl);
    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      await assertSynchronousFragmentScrub(page, token, "AC03_REVOKED_FRAGMENT_NOT_CLEARED_SYNCHRONOUSLY");
      await page.getByText("Приглашение недоступно", { exact: true }).waitFor();
      assert.equal(await page.getByText("Revoked invitation team", { exact: true }).count(), 0, "revoked recovery must not disclose team content");
      assert.equal(await page.getByRole("button", { name: "Принять приглашение", exact: true }).count(), 0, "revoked invitation cannot be accepted");
      await assertSecretClearedWithoutDiagnostics(page, token, "AC03_REVOKED_LEFT_INVITATION_SECRET_RESIDUE");
      const workspaces = await json("/me/workspaces", { token: recipient.token });
      assert.equal(JSON.stringify(workspaces.body).includes(team.id), false, "revoked invitation must not create membership");
    } finally {
      await context.close();
    }
  });
});

test("AC-03: an exactly expired invitation synchronously scrubs its fragment and exposes only generic recovery", {
  timeout: 60000,
}, async () => {
  // The test-profile endpoint creates an already-expired persisted row. It is
  // unavailable in production and returns the raw secret only in this URL.
  const owner = await account("ac03_expired_owner");
  const recipient = await account("ac03_expired_recipient");
  const team = await createTeam(owner, "Expired invitation team");
  const fixture = await json("/test-fixtures/team-invitations/expired", {
    token: owner.token,
    method: "POST",
    body: { teamId: team.id },
  });
  assert.equal(fixture.response.status, 201, "AC03_EXPIRED_SERVER_FIXTURE_REQUIRED");
  const invitationUrl = typeof fixture.body?.url === "string" ? fixture.body.url : "";
  const token = invitationSecret(invitationUrl, "AC03_EXPIRED_SERVER_FIXTURE");
  return withRedactedSecret(token, async () => {
    const { context, page } = await openAccount(recipient, invitationUrl);
    try {
      await page.waitForURL((url) => url.pathname === "/join/team" && url.hash === "");
      await assertSynchronousFragmentScrub(page, token, "AC03_EXPIRED_FRAGMENT_NOT_CLEARED_SYNCHRONOUSLY");
      await page.getByText("Приглашение недоступно", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Принять приглашение", exact: true }).count(), 0, "expired invitation cannot be accepted");
      await assertSecretClearedWithoutDiagnostics(page, token, "AC03_EXPIRED_LEFT_INVITATION_SECRET_RESIDUE");
      const workspaces = await json("/me/workspaces", { token: recipient.token });
      assert.equal(JSON.stringify(workspaces.body).includes(team.id), false, "exactly expired invitation must not create membership");
    } finally {
      await context.close();
    }
  });
});
