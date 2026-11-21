import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const protectedRequests = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    // Provider discovery belongs to the guest login page and needs no session.
    if (path !== "/api/auth/social/providers" && /^\/api\/(me|auth)\//.test(path)) protectedRequests.push(request.url());
  });
  const documents = [
    ["/privacy", "Политика конфиденциальности", "/terms", "Условия использования"],
    ["/terms", "Условия использования", "/privacy", "Политика конфиденциальности"],
  ];
  for (const [path, title, otherPath, otherTitle] of documents) {
    await page.goto(`${web}${path}`);
    await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
    assert.equal(new URL(page.url()).pathname, path, "Document must remain available directly without login");
    assert.equal(await page.title(), `${title} — InterHub`);
    const text = await page.locator("article").innerText();
    assert.ok(text.length > 1000, "Document includes its full text");
    assert.match(text, /через GitHub/);
    assert.doesNotMatch(text, /через Google/);
    await page.reload();
    await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
    await page.getByRole("link", { name: otherTitle, exact: true }).click();
    await page.getByRole("heading", { name: otherTitle, exact: true, level: 1 }).waitFor();
    assert.equal(new URL(page.url()).pathname, otherPath);
    assert.equal(await page.evaluate(() => scrollY), 0, "Opening the next document starts at its heading");
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, "A previously loaded document also opens at its heading");
    await page.getByRole("link", { name: "На главную", exact: true }).click();
    await page.getByRole("button", { name: "Создать комнату", exact: true }).waitFor();
  }
  for (const entry of ["/", "/login"]) {
    for (const [path, title] of documents) {
      await page.goto(`${web}${entry}`);
      await page.getByRole("link", { name: title, exact: true }).click();
      await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
      assert.equal(new URL(page.url()).pathname, path);
    }
  }
  await page.goto(`${web}/privacy`);
  await page.getByRole("heading", { name: "Политика конфиденциальности", level: 1 }).waitFor();
  await page.screenshot({ path: "/tmp/interhub-privacy-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Тёмная тема", exact: true }).getAttribute("aria-pressed"), "true");
  for (const [path, title] of documents) {
    await page.goto(`${web}${path}`);
    await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile document has no horizontal overflow");
    await page.screenshot({ path: `/tmp/interhub-${path.slice(1)}-mobile-dark.png`, fullPage: true });
  }
  assert.deepEqual(protectedRequests, [], "Public documents and their guest entry links do not require authentication");
  console.log("PUBLIC_DOCUMENTS_OK: direct routes, reload, crosslinks, entry links, mobile dark, no protected requests");
} finally {
  await browser.close();
}
