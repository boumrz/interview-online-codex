import { chromium } from "playwright";

const devServerBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const devServerPort = new URL(devServerBaseUrl).port || "5173";
const counterId = 109032539;
const productionHosts = ["interview.vtools.tech", "interview.domiknote.ru"];

async function openWithHost(browser, host) {
  const context = await browser.newContext();
  await context.route("https://mc.yandex.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    });
  });
  if (host !== "localhost") {
    await context.route(`http://${host}:${devServerPort}/**`, async (route) => {
      const requestUrl = new URL(route.request().url());
      const localUrl = `${devServerBaseUrl}${requestUrl.pathname}${requestUrl.search}`;
      const response = await route.fetch({ url: localUrl });
      await route.fulfill({ response });
    });
  }
  const page = await context.newPage();
  await page.goto(`http://${host}:${devServerPort}/`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(300);
  return { context, page };
}

async function assertMetrikaEnabled(browser, host) {
  const { context, page } = await openWithHost(browser, host);
  try {
    const result = await page.evaluate((expectedCounterId) => {
      const ym = window.ym;
      const calls = Array.isArray(ym?.a) ? ym.a : [];
      return {
        hasYm: typeof ym === "function",
        calls,
        initCalls: calls.filter((call) => call[0] === expectedCounterId && call[1] === "init").length,
        hitCalls: calls.filter((call) => call[0] === expectedCounterId && call[1] === "hit").length,
      };
    }, counterId);

    if (!result.hasYm || result.initCalls < 1 || result.hitCalls < 1) {
      throw new Error(`METRIKA_NOT_ENABLED host=${host} result=${JSON.stringify(result)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertMetrikaBlocked(browser, host) {
  const { context, page } = await openWithHost(browser, host);
  try {
    const result = await page.evaluate(() => ({
      hasYm: typeof window.ym === "function",
      calls: Array.isArray(window.ym?.a) ? window.ym.a.length : 0,
    }));

    if (result.hasYm || result.calls !== 0) {
      throw new Error(`METRIKA_SHOULD_BE_BLOCKED host=${host} result=${JSON.stringify(result)}`);
    }
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  for (const host of productionHosts) {
    await assertMetrikaEnabled(browser, host);
  }
  await assertMetrikaBlocked(browser, "localhost");
  console.log("METRIKA_HOSTS_OK");
} catch (error) {
  console.error("METRIKA_HOSTS_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
