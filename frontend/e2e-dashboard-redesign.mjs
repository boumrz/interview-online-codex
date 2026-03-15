import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const nickname = `ux${Date.now().toString().slice(-8)}`;
const password = "secret123";

async function register() {
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

function rgbChannels(rgbText) {
  const match = rgbText.match(/\d+/g);
  if (!match || match.length < 3) return [0, 0, 0];
  return match.slice(0, 3).map((value) => Number(value));
}

const browser = await chromium.launch({ headless: true });

try {
  const auth = await register();
  const context = await browser.newContext();
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  }, auth);

  const page = await context.newPage();

  const createdTaskTitle = `UI Task ${Date.now()}`;
  const createdTaskDescription = "Task description for redesigned dashboard test";

  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=javascript`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="task-bank-panel"]').waitFor({ timeout: 15000 });

  const taskBankWidthShare = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="task-bank-panel"]');
    if (!panel) return 0;
    const rect = panel.getBoundingClientRect();
    return rect.width / window.innerWidth;
  });
  if (taskBankWidthShare < 0.6) {
    throw new Error(`TASK_BANK_NOT_FULL_WIDTH_ENOUGH:${taskBankWidthShare}`);
  }

  const taskBankBackground = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="task-bank-panel"]');
    if (!panel) return "rgb(0,0,0)";
    return getComputedStyle(panel).backgroundColor;
  });
  const [taskR, taskG, taskB] = rgbChannels(taskBankBackground);
  if (taskR > 120 || taskG > 120 || taskB > 120) {
    throw new Error(`TASK_BANK_THEME_TOO_LIGHT:${taskBankBackground}`);
  }

  await page.locator('[data-testid="open-create-task-modal"]').click();
  await page.locator("#create-task-title").waitFor({ timeout: 15000 });
  await page.locator("#create-task-title").fill(createdTaskTitle);
  await page.locator("#create-task-description").fill(createdTaskDescription);
  await page.locator("#create-task-code").fill("function solve(){ return 42; }");
  await page.locator('[data-testid="create-task-submit-button"]').click();
  await page.locator(`[data-testid="task-bank-panel"] >> text=${createdTaskTitle}`).waitFor({ timeout: 15000 });

  await page.goto(`${webBaseUrl}/dashboard/rooms`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="create-room-card"]').waitFor({ timeout: 15000 });

  const roomPanelWidthShare = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="create-room-card"]');
    if (!panel) return 0;
    const rect = panel.getBoundingClientRect();
    return rect.width / window.innerWidth;
  });
  if (roomPanelWidthShare < 0.6) {
    throw new Error(`ROOM_LAYOUT_NOT_FULL_WIDTH_ENOUGH:${roomPanelWidthShare}`);
  }

  const roomPanelBackground = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="create-room-card"]');
    if (!panel) return "rgb(0,0,0)";
    return getComputedStyle(panel).backgroundColor;
  });
  const [roomR, roomG, roomB] = rgbChannels(roomPanelBackground);
  if (roomR > 120 || roomG > 120 || roomB > 120) {
    throw new Error(`ROOM_PANEL_THEME_TOO_LIGHT:${roomPanelBackground}`);
  }

  const taskSelectInput = page.locator('[data-testid="room-task-select"]').first();
  await taskSelectInput.click();
  await taskSelectInput.fill(createdTaskTitle);
  await page.getByRole("option", { name: createdTaskTitle }).click();

  await page.locator('[data-testid="selected-task-preview"]').getByText(createdTaskTitle).waitFor({ timeout: 15000 });
  await page
    .locator('[data-testid="selected-task-preview"]')
    .getByText(createdTaskDescription)
    .waitFor({ timeout: 15000 });

  console.log("DASHBOARD_REDESIGN_OK");
  await context.close();
} catch (error) {
  console.error("DASHBOARD_REDESIGN_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
