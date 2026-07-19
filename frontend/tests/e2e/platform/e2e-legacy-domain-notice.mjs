import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError;
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();

  await gotoWithRetry(page, webBaseUrl);
  const defaultNoticeCount = await page.locator('[data-testid="legacy-domain-notice"]').count();
  if (defaultNoticeCount !== 0) {
    throw new Error(`LEGACY_DOMAIN_NOTICE_SHOULD_BE_HIDDEN_BY_DEFAULT count=${defaultNoticeCount}`);
  }

  await gotoWithRetry(page, `${webBaseUrl}/room/domain-check?legacyDomainNotice=1#notes`);
  const notice = page.locator('[data-testid="legacy-domain-notice"]');
  await notice.waitFor({ state: "visible", timeout: 8000 });
  await notice.getByText("interview.domiknote.ru", { exact: false }).waitFor({ timeout: 8000 });
  await notice.getByText("26 июля 2026 года", { exact: false }).waitFor({ timeout: 8000 });
  await notice.getByText("пользоваться инструментом", { exact: false }).waitFor({ timeout: 8000 });

  const link = page.locator('[data-testid="legacy-domain-notice-link"]');
  await link.waitFor({ state: "visible", timeout: 8000 });
  const href = await link.getAttribute("href");
  const expectedHref = "https://interview.vtools.tech/room/domain-check?legacyDomainNotice=1#notes";
  if (href !== expectedHref) {
    throw new Error(`LEGACY_DOMAIN_NOTICE_LINK_MISMATCH href=${href} expected=${expectedHref}`);
  }

  console.log("LEGACY_DOMAIN_NOTICE_OK");
} catch (error) {
  console.error("LEGACY_DOMAIN_NOTICE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
