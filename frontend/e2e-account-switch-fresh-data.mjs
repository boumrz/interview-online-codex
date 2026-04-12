import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function registerAccount(prefix) {
  const entropy = Math.random().toString(36).slice(2, 8);
  const nickname = `${prefix}_${entropy}`.slice(0, 24);
  const password = "pass12345";
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname,
      displayName: nickname,
      password
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return { nickname, password, auth: payload };
}

async function loginViaForm(page, nickname, password) {
  await page.goto(`${webBaseUrl}/login`, { waitUntil: "networkidle" });
  await page.locator("form input:not([type='radio']):not([type='password'])").first().waitFor({ timeout: 30000 });
  await page.locator("form input:not([type='radio']):not([type='password'])").first().fill(nickname);
  await page.locator("form input[type='password']").first().waitFor({ timeout: 30000 });
  await page.locator("form input[type='password']").first().fill(password);
  await page.locator("form button[type='submit']").first().click();
  await page.waitForURL(/\/dashboard\//, { timeout: 20000 });
}

async function logoutFromDashboard(page) {
  const logoutByRole = page.getByRole("button", { name: /Выйти/i }).first();
  const hasRoleButton = await logoutByRole.isVisible().catch(() => false);
  if (hasRoleButton) {
    await logoutByRole.click();
  } else {
    await page.locator("header button").last().click();
  }
  await page.waitForURL(`${webBaseUrl}/`, { timeout: 15000 });
}

const browser = await chromium.launch({ headless: true });

try {
  const accountA = await registerAccount("switch_a");
  const accountB = await registerAccount("switch_b");
  const uniqueTaskTitle = `Switch ownership ${Date.now()}`;

  const context = await browser.newContext();
  const page = await context.newPage();

  // Login as account A and create a unique task.
  await loginViaForm(page, accountA.nickname, accountA.password);
  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=nodejs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="task-bank-panel"]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="open-create-task-modal"]').click();
  await page.locator("#create-task-title").fill(uniqueTaskTitle);
  await page.locator("#create-task-description").fill("Account-switch regression test task");
  await page.locator("#create-task-code").fill("function solve(){ return 1; }");
  await page.locator('[data-testid="create-task-submit-button"]').click();
  await page.locator(`[data-testid="task-bank-panel"] >> text=${uniqueTaskTitle}`).waitFor({ timeout: 15000 });

  // Switch to account B in the same browser session.
  await logoutFromDashboard(page);
  await loginViaForm(page, accountB.nickname, accountB.password);
  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=nodejs`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="task-bank-panel"]').waitFor({ timeout: 15000 });

  // Unique task from account A must not leak into account B.
  const leakedTaskCount = await page.locator(`[data-testid="task-bank-panel"] >> text=${uniqueTaskTitle}`).count();
  if (leakedTaskCount > 0) {
    throw new Error(`ACCOUNT_SWITCH_DATA_LEAK: task '${uniqueTaskTitle}' is visible for second account`);
  }

  console.log("ACCOUNT_SWITCH_FRESH_DATA_OK");
  await context.close();
} catch (error) {
  console.error("ACCOUNT_SWITCH_FRESH_DATA_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
