import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const playwrightUrl = pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href;
const { chromium } = await import(playwrightUrl);

const baseUrl = process.env.PROTOTYPE_URL || 'http://localhost:4173/';
const screenshotDir = join(evidenceDir, 'screenshots');
await mkdir(screenshotDir, { recursive: true });

const viewports = [
  { name: 'desktop-wide', width: 1440, height: 900 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'laptop-compact', width: 1280, height: 720 },
  { name: 'short', width: 1024, height: 600 },
  { name: 'short-480', width: 1024, height: 480 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'phone-320', width: 320, height: 640 },
  { name: 'phone-360', width: 360, height: 640 },
  { name: 'phone-390', width: 390, height: 640 },
  { name: 'phone-landscape', width: 667, height: 375 }
];
const zooms = [1, 1.25, 1.5, 2];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let openCount = 0;
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});

async function open(hash, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  const target = new URL(baseUrl);
  target.searchParams.set('evidenceRun', String(++openCount));
  target.hash = hash.slice(1);
  await page.goto(target.toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(80);
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; window.scrollTo(0, 0); });
}

async function geometrySnapshot() {
  return page.evaluate(() => {
    const root = document.documentElement;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const interactive = [...document.querySelectorAll('button, a[href], select, input')]
      .filter(visible)
      .map((element) => {
        const target = element.matches('input[type="checkbox"]') ? element.closest('label') || element : element;
        const rect = target.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ') || element.getAttribute('name') || element.id,
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100
        };
      });
    const undersized = interactive.filter((item) => item.width < 44 || item.height < 44);
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      interactiveCount: interactive.length,
      undersized
    };
  });
}

const matrix = [];
for (const viewport of viewports) {
  for (const zoom of zooms) {
    await open('#/teams/atlas/interviews?actor=owner&state=success&long=1', viewport);
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
    await page.waitForTimeout(60);
    const geometry = await geometrySnapshot();
    const screenshot = `shell-${viewport.width}x${viewport.height}-z${Math.round(zoom * 100)}.png`;
    await page.screenshot({ path: join(screenshotDir, screenshot), fullPage: true });
    matrix.push({ viewport, zoom, screenshot, ...geometry, pass: geometry.horizontalOverflow === 0 && geometry.undersized.length === 0 });
  }
}

const stateCases = [
  ['personal-success', '#/personal/interviews?actor=personal&state=success'],
  ['personal-no-teams', '#/personal/interviews?actor=personal&state=empty'],
  ['team-owner-success', '#/teams/atlas/interviews?actor=owner&state=success'],
  ['team-admin-empty', '#/teams/atlas/interviews?actor=admin&state=empty'],
  ['team-member-loading', '#/teams/atlas/interviews?actor=member&state=loading'],
  ['team-error', '#/teams/atlas/interviews?actor=owner&state=error'],
  ['team-revoked', '#/teams/atlas/interviews?actor=member&state=revoked'],
  ['profile-success', '#/profile?actor=owner&state=success&fromTeam=1'],
  ['profile-error', '#/profile?actor=personal&state=error'],
  ['invite-anonymous', '#/join/team?actor=anonymous&state=success&invite=preview'],
  ['invite-account', '#/join/team?actor=invited&state=success&invite=preview'],
  ['invite-expired', '#/join/team?actor=invited&state=success&invite=expired'],
  ['invite-revoked', '#/join/team?actor=invited&state=success&invite=revoked'],
  ['invite-error', '#/join/team?actor=invited&state=error&invite=error'],
  ['invite-success', '#/join/team?actor=invited&state=success&invite=success'],
  ['invite-already-member', '#/join/team?actor=member&state=success&invite=already'],
  ['old-route-map', '#/prototype/routes?actor=personal&state=success']
];
const states = [];
for (const [name, hash] of stateCases) {
  await open(hash);
  const screenshot = `state-${name}.png`;
  await page.screenshot({ path: join(screenshotDir, screenshot), fullPage: true });
  states.push({ name, hash, screenshot, geometry: await geometrySnapshot() });
}

const roleAssertions = [];
for (const role of ['member', 'admin', 'owner']) {
  await open(`#/teams/atlas/interviews?actor=${role}&state=success`);
  roleAssertions.push({
    role,
    settingsVisible: await page.getByText('Настройки команды', { exact: true }).count() > 0,
    candidatesVisible: await page.getByText('Кандидаты', { exact: true }).count() > 0,
    roleLabelVisible: await page.getByText(role === 'member' ? 'Участник' : role === 'admin' ? 'Администратор' : 'Владелец команды', { exact: true }).count() > 0
  });
}

await open('#/personal/interviews?actor=personal&state=success');
await page.getByRole('button', { name: /Личное пространство/ }).click();
const personalWorkspaceChoices = {
  atlasAbsent: await page.getByRole('button', { name: /^Atlas/ }).count() === 0,
  createTeamVisible: await page.getByRole('button', { name: /Создать команду/ }).count() === 1
};
await page.getByRole('button', { name: /Создать команду/ }).click();
await page.getByRole('button', { name: 'Создать команду', exact: true }).click();
const createValidation = {
  error: await page.locator('#teamNameError').textContent(),
  focusedField: await page.evaluate(() => document.activeElement?.id)
};
await page.locator('#teamName').fill('Отдел перспективных интерфейсных платформ и инструментов совместной разработки');
await page.getByRole('button', { name: 'Создать команду', exact: true }).click();
await page.waitForTimeout(600);
const createSuccess = {
  hash: await page.evaluate(() => location.hash),
  heading: await page.locator('h1').first().textContent(),
  role: await page.locator('.context-tag.owner').textContent()
};

const oldRoutes = {};
for (const oldPath of ['/dashboard', '/dashboard/rooms', '/dashboard/manage', '/dashboard/tasks', '/dashboard/presets', '/dashboard/hr', '/dashboard/admin', '/dashboard/agents']) {
  await open('#/prototype/routes?actor=personal&state=success');
  await page.locator(`[data-legacy="${oldPath}"]`).click();
  await page.waitForTimeout(50);
  oldRoutes[oldPath] = await page.evaluate(() => ({ hash: location.hash, text: document.body.innerText, created: location.hash.includes('created=1') }));
}

await open('#/join/team?actor=anonymous&state=success&invite=preview', { width: 390, height: 640 });
const privacyText = await page.locator('main').innerText();
const invitePrivacy = {
  containsCandidateName: /Денис Волков/.test(privacyText),
  containsMemberDirectory: /Александра|Борис|Вера|Максим/.test(privacyText),
  explicitRole: /Участник/.test(privacyText),
  explicitConsent: await page.getByRole('link', { name: 'Войти и продолжить' }).count() === 1
};
await page.getByRole('link', { name: 'Войти и продолжить' }).click();
await page.getByRole('button', { name: 'Войти и вернуться' }).click();
await page.waitForTimeout(100);
const returnedToInvite = (await page.evaluate(() => location.hash)).includes('/join/team') && await page.getByRole('button', { name: 'Вступить как участник' }).count() === 1;

await open('#/personal/interviews?actor=personal&state=success', { width: 320, height: 640 });
for (let index = 0; index < 5; index += 1) await page.keyboard.press('Tab');
const menuButtonFocused = await page.evaluate(() => document.activeElement?.hasAttribute('data-mobile-menu'));
await page.keyboard.press('Enter');
const mobileMenuOpened = await page.locator('.sidebar').getAttribute('data-open');
const focusedAfterOpen = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().replace(/\s+/g, ' '), outline: getComputedStyle(document.activeElement).outlineWidth }));
await page.keyboard.press('Escape');

await open('#/personal/interviews?actor=personal&state=success&long=1', { width: 390, height: 360 });
await page.getByRole('button', { name: 'Открыть рабочую навигацию' }).click();
await page.getByRole('button', { name: /Личное пространство/ }).click();
await page.getByRole('button', { name: /Создать команду/ }).click();
const visualViewportBefore = await page.evaluate(() => ({ width: visualViewport?.width, height: visualViewport?.height, pageHeight: document.documentElement.scrollHeight }));
await page.locator('#teamName').focus();
await page.locator('#teamName').fill('Очень длинное название команды для проверки открытой экранной клавиатуры');
const primary = page.getByRole('button', { name: 'Создать команду', exact: true });
await primary.scrollIntoViewIfNeeded();
const primaryRect = await primary.boundingBox();
const keyboardSimulation = {
  mode: 'headless viewport-height reduction; not a real software keyboard',
  viewport: visualViewportBefore,
  primaryRect,
  primaryReachable: Boolean(primaryRect && primaryRect.y >= 0 && primaryRect.y + primaryRect.height <= 360),
  safeAreaVariablePresent: await page.evaluate(() => document.querySelector('style')?.textContent.includes('safe-area-inset-bottom') === true)
};

const report = {
  task: '1.6a',
  generatedAt: new Date().toISOString(),
  source: 'prototypes/index.html',
  note: 'Prototype-only evidence; not production authorization or application acceptance evidence.',
  pageErrors,
  matrix,
  states,
  roleAssertions,
  personalWorkspaceChoices,
  createValidation,
  createSuccess,
  oldRoutes,
  invitePrivacy,
  returnedToInvite,
  keyboard: { menuButtonFocused, mobileMenuOpened, focusedAfterOpen },
  keyboardSimulation,
  pass: pageErrors.length === 0
    && matrix.every((item) => item.pass)
    && roleAssertions.every((item) => item.roleLabelVisible)
    && roleAssertions.find((item) => item.role === 'member').settingsVisible === false
    && roleAssertions.find((item) => item.role === 'admin').settingsVisible === true
    && roleAssertions.find((item) => item.role === 'owner').settingsVisible === true
    && personalWorkspaceChoices.atlasAbsent
    && personalWorkspaceChoices.createTeamVisible
    && createValidation.focusedField === 'teamName'
    && !createSuccess.hash.includes('created=0')
    && Object.values(oldRoutes).every((entry) => entry.created === false)
    && invitePrivacy.containsCandidateName === false
    && invitePrivacy.containsMemberDirectory === false
    && invitePrivacy.explicitConsent
    && returnedToInvite
    && menuButtonFocused
    && mobileMenuOpened === 'true'
    && keyboardSimulation.primaryReachable
};

await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ pass: report.pass, matrix: matrix.length, states: states.length, screenshots: matrix.length + states.length, pageErrors: pageErrors.length }));
if (!report.pass) process.exitCode = 1;
