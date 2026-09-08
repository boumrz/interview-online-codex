import { chromium } from "playwright";

const devServerBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const devServerPort = new URL(devServerBaseUrl).port || "5173";
const counterId = 109032539;
const productionHosts = ["interview.vtools.tech", "interview.domiknote.ru"];

async function openWithHost(browser, host, pathname = "/") {
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
  await page.goto(`http://${host}:${devServerPort}${pathname}`, {
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
      const init = calls.find((call) => call[0] === expectedCounterId && call[1] === "init");
      return {
        hasYm: typeof ym === "function",
        calls,
        initOptions: init?.[2] ?? null,
        initCalls: calls.filter((call) => call[0] === expectedCounterId && call[1] === "init").length,
        hitCalls: calls.filter((call) => call[0] === expectedCounterId && call[1] === "hit").length,
      };
    }, counterId);

    if (
      !result.hasYm || result.initCalls < 1 || result.hitCalls < 1
      || result.initOptions?.webvisor !== false
      || result.initOptions?.clickmap !== false
      || result.initOptions?.trackLinks !== false
      || result.initOptions?.referrer !== ""
    ) {
      throw new Error(`METRIKA_NOT_ENABLED host=${host} result=${JSON.stringify(result)}`);
    }
  } finally {
    // Let this finite, mocked page finish its proxied lazy assets before teardown.
    await page.waitForLoadState("networkidle");
    await context.close();
  }
}

async function assertInviteRouteIsRedacted(browser) {
  const invite = "sensitive-invite-value";
  const query = "?next=%2Froom%2Fsensitive-invite-value";
  const { context, page } = await openWithHost(browser, productionHosts[0], `/room/${invite}${query}`);
  try {
    const calls = await page.evaluate(() => Array.isArray(window.ym?.a) ? window.ym.a : []);
    const serialised = JSON.stringify(calls);
    const roomHit = calls.find((call) => call[1] === "hit");
    if (serialised.includes(invite) || serialised.includes("next=") || roomHit?.[2] !== "/room/:invite") {
      throw new Error(`METRIKA_ROUTE_LEAK result=${serialised}`);
    }
  } finally {
    await page.waitForLoadState("networkidle");
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
    await page.waitForLoadState("networkidle");
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  for (const host of productionHosts) {
    await assertMetrikaEnabled(browser, host);
  }
  await assertInviteRouteIsRedacted(browser);
  await assertMetrikaBlocked(browser, "localhost");
  console.log("METRIKA_HOSTS_OK");
} catch (error) {
  console.error("METRIKA_HOSTS_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
