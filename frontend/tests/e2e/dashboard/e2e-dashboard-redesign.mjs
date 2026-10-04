import assert from "node:assert/strict";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const nickname = `ux${Date.now().toString().slice(-8)}`;
const password = "secret123";

async function register() {
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function assertThemeSurface(page, surface, theme, token = '--app-surface-soft') {
  await page.evaluate(value => { localStorage.setItem('interview-online:ui-theme', value); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: value })); }, theme);
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
  const expected = await page.evaluate(token => {
    const probe = document.createElement('span'); probe.style.color = `var(${token})`; document.body.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }, token);
  await page.waitForFunction(({ element, expected }) => getComputedStyle(element).backgroundColor === expected, { element: await surface.elementHandle(), expected });
}

const browser = await chromium.launch({ headless: true });

try {
  const auth = await register();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("interview-online:ui-theme", "dark");
  }, auth);

  const page = await context.newPage();

  const createdTaskTitle = `UI Task ${Date.now()}`;
  const createdTaskDescription = "Task description for redesigned dashboard test";

  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=nodejs`, { waitUntil: "domcontentloaded" });
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

  const taskBank = page.getByTestId('task-bank-panel');
  assert.equal(await taskBank.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'task list shares the workspace canvas');

  await page.locator('[data-testid="open-create-task-modal"]').click();
  await page.locator("#create-task-title").waitFor({ timeout: 15000 });
  await page.locator("#create-task-title").fill(createdTaskTitle);
  await page.locator("#create-task-description").fill(createdTaskDescription);
  await page.locator("#create-task-code").fill("function solve(){ return 42; }");
  await page.locator('[data-testid="create-task-submit-button"]').click();
  await page.locator(`[data-testid="task-bank-panel"] >> text=${createdTaskTitle}`).waitFor({ timeout: 15000 });
  const taskCard = taskBank.locator(".ant-card").filter({ hasText: createdTaskTitle });
  for (const theme of ["light", "dark"]) await assertThemeSurface(page, taskCard, theme);

  await page.goto(`${webBaseUrl}/workspace/personal/interviews/new`, { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole('dialog', { name: 'Создать интервью', exact: true });
  await dialog.waitFor();
  assert.equal(await page.getByTestId('create-room-card').count(), 1, 'creation has a single modal surface');
  const modalSurface = dialog.locator('.ant-modal-container');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('interview-online:ui-theme', value); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: value })); }, theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    const expected = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--app-surface-elevated)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    await page.waitForFunction(({ element, expected }) => getComputedStyle(element).backgroundColor === expected, { element: await modalSurface.elementHandle(), expected });
  }
  const taskSelectInput = dialog.getByRole('combobox', { name: 'Задачи для интервью', exact: true });
  await taskSelectInput.click();
  await taskSelectInput.fill(createdTaskTitle);
  await page.getByRole('option', { name: `${createdTaskTitle} · Node JS`, exact: true }).waitFor({ state: 'attached' });
  await taskSelectInput.press('ArrowDown');
  await taskSelectInput.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.getByText(`${createdTaskTitle} · Node JS`, { exact: true }).count(), 1, 'selected task is shown once as a selector chip');
  assert.equal(await dialog.getByTestId('selected-task-preview').count(), 0, 'selected tasks must not have a duplicate preview card');
  assert.equal(await dialog.getByText(createdTaskDescription, { exact: true }).count(), 0, 'task description must not create another selected-task list');
  await dialog.getByLabel('Название интервью', { exact: true }).fill(`UI interview ${Date.now()}`);
  const submitted = page.waitForRequest(request => request.url().endsWith('/api/rooms') && request.method() === 'POST');
  await dialog.getByRole('button', { name: 'Создать интервью', exact: true }).click();
  const payload = JSON.parse((await submitted).postData());
  const taskGroups = await fetch(`${apiBaseUrl}/me/tasks`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(response => response.json());
  const task = taskGroups.flatMap(group => group.tasks).find(task => task.title === createdTaskTitle);
  assert.ok(task, 'created task remains in the personal library');
  assert.deepEqual(payload.taskIds, [task.id], 'creation submits the selected task exactly once');
  assert.equal(Object.hasOwn(payload, 'hiringManagerIds'), false, 'empty optional hiring-manager selection is omitted');
  await page.waitForURL(/\/room\//);
  await page.getByTestId('room-code-editor-host').waitFor();

  console.log("DASHBOARD_REDESIGN_OK");
  await context.close();
} catch (error) {
  console.error("DASHBOARD_REDESIGN_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
