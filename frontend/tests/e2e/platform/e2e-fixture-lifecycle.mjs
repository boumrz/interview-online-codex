import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { chromium } from "playwright";

test("isolated API fixtures belong to the runner schema and authenticate normally", async () => {
  const api = process.env.E2E_API_URL;
  const response = await fetch(`${api}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `fixture_${randomUUID().slice(0, 12)}`, displayName: "Изолированный тест", password: "test-password-123" }),
  });
  assert.equal(response.status, 200);
  const auth = await response.json();
  const profileResponse = await fetch(`${api}/me/profile`, { headers: { Authorization: `Bearer ${auth.token}` } });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.id, auth.user.id);
  const proofResponse = await fetch(`${api}/test-fixtures/e2e-isolation`, {
    headers: { "X-Interhub-E2E-Run": process.env.E2E_ISOLATED_RUN_ID },
  });
  assert.equal(proofResponse.status, 200);
  const proof = await proofResponse.json();
  assert.equal(proof.schema, process.env.E2E_ISOLATED_SCHEMA);
  assert.equal(proof.database, process.env.E2E_ISOLATED_DATABASE);
  assert.notEqual(proof.database, "interview_online");
});

test("browser API requests stay in the proved frontend proxy", async () => {
  const response = await fetch(`${process.env.E2E_API_URL}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `browser_${randomUUID().slice(0, 12)}`, displayName: "Изолированный браузер", password: "test-password-123" }),
  });
  assert.equal(response.status, 200);
  const auth = await response.json();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
    }, { token: auth.token, user: auth.user });
    const page = await context.newPage();
    const profileRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/me/profile"), { timeout: 15_000 });
    await page.goto(`${process.env.E2E_BASE_URL}/workspace/personal/interviews`, { waitUntil: "domcontentloaded" });
    assert.equal(new URL((await profileRequest).url()).origin, new URL(process.env.E2E_BASE_URL).origin,
      "compiled frontend must keep API requests in the proved proxy, regardless of inherited build configuration");
    await context.close();
  } finally {
    await browser.close();
  }
});
