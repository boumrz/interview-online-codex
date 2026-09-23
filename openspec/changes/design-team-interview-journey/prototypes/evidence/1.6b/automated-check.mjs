import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.PROTOTYPE_URL || 'http://localhost:4173/';
const screenshotDir = join(evidenceDir, 'screenshots');
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
let openCount = 0;
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

async function open(hash, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  const target = new URL(baseUrl);
  target.searchParams.set('evidence1_6b', String(++openCount));
  target.hash = hash.slice(1);
  await page.goto(target.toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(60);
}

async function geometry() {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const interactive = [...document.querySelectorAll('button, a[href], select, input, textarea')]
      .filter(visible)
      .map((element) => {
        const labelledTarget = element.matches('input[type="checkbox"]') ? element.labels?.[0] : null;
        const target = labelledTarget || element.closest('.long-toggle') || element;
        const rect = target.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') || element.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || element.textContent?.trim().replace(/\s+/g, ' ') || element.id,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100
        };
      });
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      interactiveCount: interactive.length,
      undersized: interactive.filter((item) => item.width < 44 || item.height < 44)
    };
  });
}

const viewports = [
  [1440, 900], [1366, 768], [1280, 720], [1024, 600], [1024, 480],
  [768, 1024], [1024, 768], [320, 640], [360, 640], [390, 640], [667, 375]
];
const zooms = [1, 1.25, 1.5, 2];
const matrixRoutes = [
  '#/teams/atlas/tracks?actor=admin&state=success&long=1',
  '#/teams/atlas/library?actor=author&state=success&long=1',
  '#/teams/atlas/library?actor=member&state=success&tab=sets&long=1',
  '#/teams/atlas/interviews?actor=roomOwner&state=success&long=1',
  '#/teams/atlas/interviews/new?actor=member&state=success&programme=published&long=1',
  '#/teams/atlas/interviews/int-204?actor=interviewer&state=success&long=1'
];
const matrix = [];
let routeIndex = 0;
for (const [width, height] of viewports) {
  for (const zoom of zooms) {
    const route = matrixRoutes[routeIndex++ % matrixRoutes.length];
    await open(route, { width, height });
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
    await page.waitForTimeout(40);
    const measured = await geometry();
    matrix.push({ viewport: { width, height }, zoom, route, ...measured, pass: measured.horizontalOverflow === 0 && measured.undersized.length === 0 });
  }
}

const stateCases = [
  ['tracks-admin', '#/teams/atlas/tracks?actor=admin&state=success&long=1'],
  ['track-member-process-empty', '#/teams/atlas/tracks/frontend?actor=member&state=success'],
  ['tracks-conflict', '#/teams/atlas/tracks?actor=admin&state=conflict'],
  ['tracks-archive', '#/teams/atlas/tracks?actor=member&state=archived'],
  ['library-member', '#/teams/atlas/library?actor=member&state=success'],
  ['library-sets', '#/teams/atlas/library?actor=author&state=success&tab=sets'],
  ['library-conflict', '#/teams/atlas/library/tasks/task-1/edit?actor=author&state=conflict&long=1'],
  ['library-filter-empty', '#/teams/atlas/library?actor=member&state=filterEmpty'],
  ['library-archive', '#/teams/atlas/library?actor=admin&state=archived'],
  ['personal-publish-copy', '#/personal/library?actor=personal&state=success&publish=1'],
  ['interviews-room-owner', '#/teams/atlas/interviews?actor=roomOwner&state=success&long=1'],
  ['interviews-admin-no-grant', '#/teams/atlas/interviews?actor=admin&state=success'],
  ['interviews-filter-empty', '#/teams/atlas/interviews?actor=interviewer&state=filterEmpty'],
  ['interviews-archive', '#/teams/atlas/interviews?actor=hiring&state=archived'],
  ['create-programme', '#/teams/atlas/interviews/new?actor=member&state=success&programme=published&long=1'],
  ['create-free', '#/teams/atlas/interviews/new?actor=member&state=success&programme=none'],
  ['create-draft-blocked', '#/teams/atlas/interviews/new?actor=member&state=success&programme=draft'],
  ['create-conflict', '#/teams/atlas/interviews/new?actor=member&state=conflict&programme=published'],
  ['preparation-room-owner', '#/teams/atlas/interviews/int-204?actor=roomOwner&state=success'],
  ['preparation-interviewer', '#/teams/atlas/interviews/int-204?actor=interviewer&state=success']
];
const states = [];
for (const [name, hash] of stateCases) {
  const viewport = name === 'library-conflict' || name === 'create-programme' ? { width: 390, height: 640 } : { width: 1366, height: 768 };
  await open(hash, viewport);
  const screenshot = `${name}.png`;
  await page.screenshot({ path: join(screenshotDir, screenshot), fullPage: true });
  states.push({ name, hash, viewport, screenshot, geometry: await geometry() });
}

const roles = {};
for (const role of ['member', 'author', 'admin', 'owner', 'roomOwner', 'interviewer', 'hiring']) {
  await open(`#/teams/atlas/interviews?actor=${role}&state=success`);
  roles[role] = {
    labelVisible: await page.getByText(({ member: 'Участник', author: 'Автор задачи', admin: 'Администратор', owner: 'Владелец команды', roomOwner: 'Владелец комнаты', interviewer: 'Интервьюер', hiring: 'Нанимающий' })[role], { exact: true }).count() > 0,
    settingsVisible: await page.getByText('Настройки команды', { exact: true }).count() > 0,
    candidatesVisible: await page.getByText('Кандидаты', { exact: true }).count() > 0,
    interviewRowVisible: await page.locator('.collection-row').count() > 0
  };
}

await open('#/teams/atlas/library?actor=member&state=success');
const memberLibrary = {
  editVisible: await page.getByRole('link', { name: 'Редактировать' }).count() > 0,
  copyVisible: await page.getByRole('button', { name: 'Создать копию' }).count() > 0,
  trackFilterVisible: await page.getByLabel(/Трек/).count() > 0
};
await open('#/teams/atlas/library?actor=author&state=success');
const authorLibrary = { editVisible: await page.getByRole('link', { name: 'Редактировать' }).count() > 0 };

await open('#/teams/atlas/library/tasks/task-1/edit?actor=author&state=success');
const localTaskTitle = 'Локальный черновик — длинное русское название';
const localTaskCondition = 'Локальный текст условия, который не должен исчезнуть после HTTP 409 и перехода.';
await page.locator('#taskTitle').fill(localTaskTitle);
await page.locator('#taskCondition').fill(localTaskCondition);
await page.getByRole('button', { name: 'Смоделировать 409' }).click();
await page.waitForTimeout(50);
const taskConflict = {
  state: await page.locator('#stateSelect').inputValue(),
  titlePreserved: await page.locator('#taskTitle').inputValue() === localTaskTitle,
  conditionPreserved: await page.locator('#taskCondition').inputValue() === localTaskCondition,
  conflictVisible: await page.getByText(/уже сохранена версия 4/).count() > 0
};
await page.getByRole('link', { name: 'Перейти к трекам' }).click();
await page.goBack();
await page.waitForTimeout(50);
taskConflict.afterNavigationPreserved = await page.locator('#taskTitle').inputValue() === localTaskTitle && await page.locator('#taskCondition').inputValue() === localTaskCondition;

await open('#/teams/atlas/interviews/new?actor=member&state=success&programme=published', { width: 390, height: 640 });
const localInterviewTitle = 'Интервью с локальным черновиком';
await page.locator('#formTitle').fill(localInterviewTitle);
await page.locator('#formCandidate').fill('Кандидат с очень длинным русским именем');
await page.locator('#formTrack').selectOption('backend');
const contextReset = {
  vacancy: await page.locator('#formVacancy').inputValue(),
  message: await page.locator('#contextChangeMessage').textContent()
};
await page.getByRole('button', { name: 'Открыть рабочую навигацию' }).click();
await page.getByRole('button', { name: /Atlas/ }).click();
const unsavedGuardVisible = await page.getByRole('heading', { name: 'Сменить пространство?' }).count() === 1;
await page.getByRole('button', { name: 'Остаться' }).click();
const afterStayPreserved = await page.locator('#formTitle').inputValue() === localInterviewTitle;
await page.getByRole('button', { name: 'Смоделировать 409' }).click();
await page.waitForTimeout(50);
const interviewConflict = {
  state: await page.locator('#stateSelect').inputValue(),
  titlePreserved: await page.locator('#formTitle').inputValue() === localInterviewTitle,
  conflictVisible: await page.getByText(/Данные изменились после открытия формы/).count() === 1,
  unsavedGuardVisible,
  afterStayPreserved,
  contextReset
};

await open('#/teams/atlas/interviews/new?actor=member&state=success&programme=published');
const publishedProgramme = {
  mandatoryCount: await page.locator('.task-row.mandatory').count(),
  mandatoryRemoveCount: await page.locator('.task-row.mandatory').getByRole('button', { name: /Убрать|Удалить/ }).count(),
  submitDisabled: await page.getByRole('button', { name: 'Создать интервью', exact: true }).isDisabled()
};
await open('#/teams/atlas/interviews/new?actor=member&state=success&programme=none');
const noneProgramme = {
  freeChoiceVisible: await page.getByRole('button', { name: 'Выбрать задачи' }).count() === 1,
  submitDisabled: await page.getByRole('button', { name: 'Создать интервью', exact: true }).isDisabled()
};
await open('#/teams/atlas/interviews/new?actor=member&state=success&programme=draft');
const draftProgramme = {
  blockerVisible: await page.getByText(/Есть черновик, но нет опубликованной версии/).count() === 1,
  submitDisabled: await page.getByRole('button', { name: 'Создать интервью', exact: true }).isDisabled()
};

await open('#/teams/atlas/interviews/new?actor=member&state=success&programme=published&long=1', { width: 390, height: 360 });
const primary = page.getByRole('button', { name: 'Создать и открыть комнату' });
await primary.scrollIntoViewIfNeeded();
const primaryRect = await primary.boundingBox();
const compactForm = {
  visualViewport: await page.evaluate(() => ({ width: visualViewport?.width, height: visualViewport?.height })),
  primaryRect,
  primaryReachable: Boolean(primaryRect && primaryRect.y >= 0 && primaryRect.y + primaryRect.height <= 360),
  horizontalOverflow: (await geometry()).horizontalOverflow
};

await open('#/personal/interviews?actor=personal&state=success&long=1', { width: 667, height: 375 });
await page.evaluate(() => {
  document.documentElement.style.setProperty('--safe-left', '47px');
  document.documentElement.style.setProperty('--safe-right', '47px');
});
const safeAreaProbe = async (scope) => page.evaluate(({ selector, left, right }) => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.left < window.innerWidth;
  };
  const controls = [...document.querySelectorAll(`${selector} button, ${selector} a[href], ${selector} select, ${selector} input, ${selector} textarea`)]
    .filter((element) => !element.matches('.scrim'))
    .filter(visible)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.getAttribute('aria-label') || element.textContent?.trim() || element.id, left: rect.left, right: rect.right };
    });
  return {
    count: controls.length,
    allInside: controls.length > 0 && controls.every((item) => item.left >= left && item.right <= right),
    controls,
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
}, { selector: scope, left: 47, right: 620 });
const personalSafeAreaClosed = await safeAreaProbe('body');
await page.locator('.mobile-menu-button').click();
await page.waitForTimeout(250);
const personalSafeAreaOpen = await safeAreaProbe('.sidebar');
const safeArea = {
  closed: personalSafeAreaClosed,
  open: personalSafeAreaOpen,
  pass: personalSafeAreaClosed.allInside && personalSafeAreaOpen.allInside
    && personalSafeAreaClosed.horizontalOverflow === 0 && personalSafeAreaOpen.horizontalOverflow === 0
};

await open('#/teams/atlas/library/tasks/task-1/edit?actor=author&state=conflict&long=1', { width: 360, height: 640 });
await page.evaluate(() => document.body.focus());
const focusTrace = [];
for (let index = 0; index < 18; index += 1) {
  await page.keyboard.press('Tab');
  focusTrace.push(await page.evaluate(() => ({
    name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || document.activeElement?.textContent?.trim().replace(/\s+/g, ' '),
    tag: document.activeElement?.tagName,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth
  })));
}
const keyboard = {
  trace: focusTrace,
  visibleFocusCount: focusTrace.filter((item) => Number.parseFloat(item.outlineWidth) >= 3).length,
  namedCount: focusTrace.filter((item) => item.name && item.name.length > 0).length
};

const pass = pageErrors.length === 0
  && matrix.every((item) => item.pass)
  && states.every((item) => item.geometry.horizontalOverflow === 0 && item.geometry.undersized.length === 0)
  && Object.values(roles).every((role) => role.labelVisible)
  && roles.member.settingsVisible === false && roles.member.candidatesVisible === false && roles.member.interviewRowVisible === false
  && roles.admin.settingsVisible && roles.owner.settingsVisible
  && roles.admin.interviewRowVisible === false && roles.owner.interviewRowVisible === false
  && roles.roomOwner.interviewRowVisible && roles.interviewer.interviewRowVisible && roles.hiring.interviewRowVisible
  && roles.hiring.candidatesVisible
  && memberLibrary.editVisible === false && memberLibrary.copyVisible && memberLibrary.trackFilterVisible === false
  && authorLibrary.editVisible
  && Object.values(taskConflict).every(Boolean)
  && interviewConflict.state === 'conflict' && interviewConflict.titlePreserved && interviewConflict.conflictVisible && interviewConflict.unsavedGuardVisible && interviewConflict.afterStayPreserved
  && interviewConflict.contextReset.vacancy === 'none' && interviewConflict.contextReset.message.includes('очищена')
  && publishedProgramme.mandatoryCount === 2 && publishedProgramme.mandatoryRemoveCount === 0 && publishedProgramme.submitDisabled === false
  && noneProgramme.freeChoiceVisible && noneProgramme.submitDisabled === false
  && draftProgramme.blockerVisible && draftProgramme.submitDisabled
  && compactForm.primaryReachable && compactForm.horizontalOverflow === 0
  && safeArea.pass
  && keyboard.visibleFocusCount === keyboard.trace.length && keyboard.namedCount === keyboard.trace.length;

const report = {
  task: '1.6b', generatedAt: new Date().toISOString(), pass,
  note: 'Prototype-only DA-02 evidence; not application acceptance or server authorization evidence.',
  pageErrors, matrix, states, roles, memberLibrary, authorLibrary, taskConflict, interviewConflict,
  programmeResolver: { publishedProgramme, noneProgramme, draftProgramme }, compactForm, safeArea, keyboard
};
await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ pass, matrix: matrix.length, screenshots: states.length, pageErrors: pageErrors.length }));
if (!pass) process.exitCode = 1;
