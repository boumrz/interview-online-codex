import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL;
const evidenceDirectory = process.env.EVIDENCE_DIR ?? ".run/ui1-evidence";
await mkdir(evidenceDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const firstPage = await context.newPage();
  const errors = [];
  const apiRequests = [];
  firstPage.on("pageerror", (error) => errors.push(error.message));
  firstPage.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  firstPage.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await firstPage.goto(baseUrl, { waitUntil: "networkidle" });
  await firstPage.getByRole("heading", { name: "Запускайте интервью за 30 секунд." }).waitFor();
  assert.equal(await firstPage.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await firstPage.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(243, 245, 251)");
  await firstPage.screenshot({ path: `${evidenceDirectory}/landing-light.png`, fullPage: true });

  const themeButton = firstPage.getByRole("button", { name: "Тёмная тема" });
  await themeButton.click();
  await firstPage.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await firstPage.waitForFunction(() => {
    const input = document.querySelector("input");
    return input && getComputedStyle(input).backgroundColor === "rgb(17, 21, 28)";
  });
  assert.equal(await themeButton.getAttribute("aria-pressed"), "true");
  assert.equal(await firstPage.evaluate(() => localStorage.getItem("interview-online:ui-theme")), "dark");
  assert.equal(await firstPage.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(15, 17, 21)");
  await firstPage.mouse.move(0, 0);
  await firstPage.waitForTimeout(200);
  await firstPage.screenshot({ path: `${evidenceDirectory}/landing-dark.png`, fullPage: true });

  const secondPage = await context.newPage();
  await secondPage.addInitScript(() => {
    requestAnimationFrame(() => {
      window.__themeAtFirstFrame = document.documentElement.dataset.theme;
    });
  });
  await secondPage.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await secondPage.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await secondPage.evaluate(() => window.__themeAtFirstFrame), "dark");
  await themeButton.click();
  await secondPage.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await secondPage.waitForFunction(() => {
    const input = document.querySelector("input");
    return input && getComputedStyle(input).backgroundColor === "rgb(255, 255, 255)";
  });
  assert.equal(await secondPage.getByRole("button", { name: "Тёмная тема" }).getAttribute("aria-pressed"), "false");

  await firstPage.evaluate(() => localStorage.setItem("interview-online:ui-theme", "system"));
  await firstPage.reload({ waitUntil: "networkidle" });
  assert.equal(await firstPage.locator("html").getAttribute("data-theme"), "light");
  assert.deepEqual(apiRequests, [], "changing the visual theme does not call the room API");
  assert.deepEqual(errors, [], "landing theme flow does not emit browser errors");

  await secondPage.goto(`${baseUrl}/login?next=%2Fworkspace%2Fpersonal%2Finterviews`, { waitUntil: "networkidle" });
  await secondPage.getByRole("heading", { name: "Личный кабинет", exact: true }).waitFor();
  await secondPage.getByRole("button", { name: "Тёмная тема" }).click();
  await secondPage.locator(".ant-segmented-item").filter({ hasText: "Регистрация" }).click();
  await secondPage.getByLabel("Ник").fill("alice");
  await secondPage.getByLabel("Имя для комнаты").fill("Alice");
  await secondPage.getByLabel("Пароль").fill("123");
  await secondPage.getByRole("button", { name: "Создать аккаунт" }).click();
  await secondPage.getByRole("alert").filter({ hasText: "Пароль должен быть не короче 6 символов" }).waitFor();
  const nickname = `theme_${Date.now().toString(36)}`;
  await secondPage.getByLabel(/^Ник$/).fill(nickname);
  await secondPage.getByLabel("Имя для комнаты").fill("Тест темы");
  await secondPage.getByLabel("Пароль").fill("theme-password-123");
  await secondPage.getByRole("button", { name: "Создать аккаунт" }).click();
  await secondPage.waitForURL("**/workspace/personal/interviews");
  const workspaceThemeButton = secondPage.getByRole("button", { name: "Тёмная тема" });
  const profileLink = secondPage.getByRole("link", { name: `Открыть профиль @${nickname}` });
  const [themeBox, profileBox] = await Promise.all([
    workspaceThemeButton.boundingBox(),
    profileLink.boundingBox(),
  ]);
  assert.ok(themeBox && profileBox, "THEME_AND_PROFILE_CONTROLS_MUST_BE_VISIBLE");
  assert.ok(
    Math.abs(themeBox.height - profileBox.height) <= 1,
    `THEME_CONTROL_HEIGHT_MUST_MATCH_PROFILE:${themeBox.height}:${profileBox.height}`,
  );
  assert.ok(
    Math.abs(themeBox.y + themeBox.height / 2 - (profileBox.y + profileBox.height / 2)) <= 1,
    "THEME_AND_PROFILE_CONTROLS_MUST_SHARE_VERTICAL_CENTER",
  );
  assert.equal(await secondPage.evaluate(() => localStorage.getItem("interview-online:ui-theme")), "dark");
  await context.close();
} finally {
  await browser.close();
}
