import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.PROTOTYPE_URL || 'http://127.0.0.1:4175/hiring.html';
const screenshotDir = join(evidenceDir, 'screenshots');
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
let openCount = 0;
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

async function open(hash, viewport = { width: 1366, height: 768 }, zoom = 1) {
  await page.setViewportSize(viewport);
  const target = new URL(baseUrl);
  target.searchParams.set('evidence1_6d', String(++openCount));
  target.hash = hash.slice(1);
  await page.goto(target.toString(), { waitUntil: 'networkidle' });
  await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
  await page.waitForTimeout(60);
}

async function geometry() {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const interactive = [...document.querySelectorAll('button, a[href], select, input')]
      .filter(visible)
      .map((element) => {
        const target = element.matches('input[type="checkbox"]') ? element.closest('.check-control') : element;
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

async function screenshot(name, hash, viewport = { width: 1366, height: 768 }) {
  await open(hash, viewport);
  const file = `${name}.png`;
  await page.screenshot({ path: join(screenshotDir, file), fullPage: true });
  return { name, hash, viewport, file, geometry: await geometry() };
}

const viewports = [
  [1440, 900], [1366, 768], [1280, 720], [1024, 600], [1024, 480],
  [768, 1024], [1024, 768], [320, 640], [360, 640], [390, 640], [667, 375]
];
const zooms = [1, 1.25, 1.5, 2];
const matrixRoutes = [
  '#/teams/atlas/candidates?actor=hiring&state=success&isHr=false&long=1',
  '#/teams/atlas/candidates/room-204?actor=hiring&state=success&isHr=true&long=1',
  '#/teams/atlas/members?actor=member&state=success&long=1',
  '#/teams/atlas/members?actor=admin&state=error&long=1',
  '#/teams/atlas/interviews?actor=owner&state=filterEmpty&trackId=frontend&vacancyId=lead-ui&long=1',
  '#/teams/atlas/candidates?actor=owner&state=success&long=1'
];
const matrix = [];
let routeIndex = 0;
for (const [width, height] of viewports) {
  for (const zoom of zooms) {
    const route = matrixRoutes[routeIndex++ % matrixRoutes.length];
    await open(route, { width, height }, zoom);
    const measured = await geometry();
    matrix.push({ viewport: { width, height }, zoom, route, ...measured, pass: measured.horizontalOverflow === 0 && measured.undersized.length === 0 });
  }
}

const states = [];
const stateCases = [
  ['candidates-hiring-no-personal-hr', '#/teams/atlas/candidates?actor=hiring&state=success&isHr=false&long=1'],
  ['candidates-hiring-personal-hr', '#/teams/atlas/candidates?actor=hiring&state=success&isHr=true'],
  ['candidates-member-denied', '#/teams/atlas/candidates?actor=member&state=success&isHr=true'],
  ['candidates-admin-denied', '#/teams/atlas/candidates?actor=admin&state=success&isHr=true'],
  ['candidates-owner-denied', '#/teams/atlas/candidates?actor=owner&state=success&isHr=true'],
  ['candidates-assigned-denied', '#/teams/atlas/candidates?actor=assigned&state=success&isHr=true'],
  ['candidates-loading', '#/teams/atlas/candidates?actor=hiring&state=loading&isHr=false'],
  ['candidates-empty', '#/teams/atlas/candidates?actor=hiring&state=empty&isHr=false'],
  ['candidates-filter-empty', '#/teams/atlas/candidates?actor=hiring&state=filterEmpty&isHr=false'],
  ['candidates-error', '#/teams/atlas/candidates?actor=hiring&state=error&isHr=false'],
  ['candidates-revoked', '#/teams/atlas/candidates?actor=hiring&state=revoked&isHr=false'],
  ['result-hiring', '#/teams/atlas/candidates/room-204?actor=hiring&state=success&isHr=false'],
  ['result-assigned-manager', '#/teams/atlas/candidates/room-204?actor=assigned&state=success&isHr=false'],
  ['result-team-owner-denied', '#/teams/atlas/candidates/room-204?actor=owner&state=success&isHr=true'],
  ['result-archive-readonly', '#/teams/atlas/candidates/room-204?actor=hiring&state=success&archived=1'],
  ['result-empty', '#/teams/atlas/candidates/room-204?actor=hiring&state=empty'],
  ['members-success', '#/teams/atlas/members?actor=member&state=success'],
  ['members-long-russian', '#/teams/atlas/members?actor=admin&state=success&long=1'],
  ['members-process-error', '#/teams/atlas/members?actor=member&state=error'],
  ['members-empty', '#/teams/atlas/members?actor=member&state=empty'],
  ['members-filter-empty', '#/teams/atlas/members?actor=member&state=filterEmpty'],
  ['members-revoked', '#/teams/atlas/members?actor=member&state=revoked'],
  ['process-current-caller-empty', '#/teams/atlas/interviews?actor=member&state=filterEmpty&trackId=frontend&vacancyId=lead-ui'],
  ['process-assigned-manager', '#/teams/atlas/interviews?actor=assigned&state=success&trackId=frontend&vacancyId=lead-ui']
];
for (const [name, hash] of stateCases) {
  const compact = ['candidates-filter-empty','members-long-russian','members-process-error','process-current-caller-empty'].includes(name);
  states.push(await screenshot(name, hash, compact ? { width: 390, height: 640 } : { width: 1366, height: 768 }));
}

const roleMatrix = {};
for (const actor of ['hiring','assigned','member','admin','owner']) {
  roleMatrix[actor] = {};
  for (const isHr of [false, true]) {
    await open(`#/teams/atlas/candidates?actor=${actor}&state=success&isHr=${isHr}`);
    roleMatrix[actor][`isHr_${isHr}`] = {
      sensitiveRows: await page.locator('[data-sensitive="candidate-record"]').count(),
      accessDenied: await page.getByRole('heading', { name: 'Кандидаты недоступны' }).count() === 1,
      candidatesNavigation: await page.locator('[data-nav-candidates]').count()
    };
  }
}

const resultMatrix = {};
for (const actor of ['hiring','assigned','member','admin','owner']) {
  await open(`#/teams/atlas/candidates/room-204?actor=${actor}&state=success&isHr=true`);
  resultMatrix[actor] = {
    sensitiveResult: await page.locator('[data-sensitive="candidate-result"]').count(),
    denied: await page.getByRole('heading', { name: 'Результат недоступен' }).count() === 1
  };
}

await open('#/teams/atlas/members?actor=member&state=success&long=1');
const projectionPayloads = await page.locator('[data-process-payload]').evaluateAll((elements) => elements.map((element) => ({
  payload: JSON.parse(element.dataset.processPayload),
  href: element.getAttribute('href'),
  text: element.textContent.trim()
})));
const projectionCardsText = await page.locator('[data-member-projection]').allTextContents();
const allowedProjectionKeys = new Set(['trackId','trackName','vacancyId','vacancyName']);
const projectionPrivacy = {
  count: projectionPayloads.length,
  onlyAllowedFields: projectionPayloads.every(({ payload }) => Object.keys(payload).every((key) => allowedProjectionKeys.has(key))),
  noCandidateTerms: projectionCardsText.every((text) => !/Денис Орлов|Мария Лебедева|INT-\d+|room-\d+|Сильный hire/.test(text)),
  noTargetIdentityInLinks: projectionPayloads.every(({ href }) => !/userId|memberId|91BC|7A2F|Денис|Мария|room-/.test(href)),
  callerOnlyLabel: projectionPayloads.every(({ text }) => text.startsWith('Мои интервью:'))
};

await page.locator('[data-process-link]').nth(1).click();
await page.waitForTimeout(60);
const callerOnlyNavigation = {
  actorPreserved: new URLSearchParams(locationHashSearch(await page.evaluate(() => location.hash))).get('actor') === 'member',
  noTargetIdentity: !/userId|memberId|91BC|7A2F/.test(await page.evaluate(() => location.hash)),
  foreignRows: await page.locator('[data-sensitive="caller-interview"]').count(),
  emptyExplanation: await page.getByText(/его кандидаты и число встреч вам не раскрываются/).count() === 1
};

function locationHashSearch(hash) {
  return hash.split('?')[1] || '';
}

await open('#/teams/atlas/candidates?actor=hiring&state=success&isHr=false');
await page.locator('#q').fill('Денис');
await page.locator('#candidateFilters').evaluate((form) => form.requestSubmit());
await page.waitForTimeout(80);
const listSignature = await page.locator('[data-sensitive-list]').getAttribute('data-filter-signature');
await page.getByRole('button', { name: 'Выгрузить Excel' }).click();
const exportSignature = await page.locator('[data-export-filter-signature]').getAttribute('data-export-filter-signature');
const filterParity = {
  listSignature,
  exportSignature,
  matches: listSignature === exportSignature,
  allPagesCopy: await page.getByText(/включает все страницы/).count() === 1,
  selectedRowDoesNotChangeScope: await page.getByText(/Выделенная строка не меняет область/).count() === 1
};

const exportScreenshots = [];
for (const state of ['ready','forming','downloaded','empty','error','tooLarge','busy','revoked']) {
  await page.getByRole('button', { name: ({ ready:'Готово', forming:'Формируется', downloaded:'Скачивание', empty:'Пустой файл', error:'Ошибка', tooLarge:'Превышен объём', busy:'Занято', revoked:'Отзыв' })[state], exact: true }).click();
  const file = `export-${state}.png`;
  await page.screenshot({ path: join(screenshotDir, file), fullPage: true });
  exportScreenshots.push(file);
}
await page.getByRole('button', { name: 'Закрыть выгрузку' }).click();

await open('#/teams/atlas/candidates?actor=hiring&state=success&isHr=false');
await page.getByRole('button', { name: 'Выгрузить Excel' }).click();
await page.getByRole('button', { name: 'Сформировать Excel' }).click();
const formingVisible = await page.getByRole('heading', { name: 'Формируем файл' }).count() === 1;
await page.waitForTimeout(520);
const downloadedVisible = await page.getByRole('heading', { name: 'Скачивание инициировано' }).count() === 1;
await page.getByRole('button', { name: 'Закрыть выгрузку' }).click();

await open('#/teams/atlas/candidates?actor=hiring&state=success&isHr=false');
await page.getByRole('button', { name: 'Выгрузить Excel' }).click();
await page.locator('#stateSelect').selectOption('revoked');
await page.waitForTimeout(80);
const revokedText = await page.locator('body').innerText();
const revokeClearing = {
  appSensitiveNodes: await page.locator('#app [data-sensitive]').count(),
  protectedTermsAbsent: ['Денис Орлов','Мария Лебедева','INT-204','Сильный hire'].every((term) => !revokedText.includes(term)),
  exportSignatureCleared: await page.locator('[data-export-filter-signature]').count() === 0,
  revokedDialogVisible: await page.getByRole('heading', { name: 'Право на выгрузку отозвано' }).count() === 1
};
await page.getByRole('button', { name: 'Закрыть выгрузку' }).click();

await open('#/teams/atlas/members?actor=member&state=success&long=1', { width: 360, height: 640 });
await page.evaluate(() => document.activeElement?.blur());
const focusTrace = [];
for (let index = 0; index < 28; index += 1) {
  await page.keyboard.press('Tab');
  focusTrace.push(await page.evaluate(() => ({
    name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || document.activeElement?.textContent?.trim().replace(/\s+/g, ' ') || document.activeElement?.id,
    tag: document.activeElement?.tagName,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
    visible: document.activeElement?.matches(':focus-visible') || false
  })));
}
const keyboard = {
  trace: focusTrace,
  visibleFocusCount: focusTrace.filter((item) => item.visible && Number.parseFloat(item.outlineWidth) >= 3).length,
  namedCount: focusTrace.filter((item) => item.name && item.name.length > 0).length,
  processLinkReached: focusTrace.some((item) => item.name?.startsWith('Мои интервью:'))
};

await open('#/teams/atlas/candidates?actor=hiring&state=success&isHr=false&keyboard=1&long=1', { width: 390, height: 640 });
const primary = page.getByRole('button', { name: 'Выгрузить Excel' }).first();
await primary.scrollIntoViewIfNeeded();
const primaryRect = await primary.boundingBox();
const keyboardSimulation = await page.evaluate(() => ({
  visualViewport: { width: visualViewport?.width, height: visualViewport?.height },
  safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
  keyboardInset: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim(),
  scrollHeight: document.documentElement.scrollHeight,
  clientHeight: document.documentElement.clientHeight
}));
keyboardSimulation.primaryRect = primaryRect;
keyboardSimulation.primaryReachable = Boolean(primaryRect && primaryRect.y >= 0 && primaryRect.y + primaryRect.height <= 640);
keyboardSimulation.horizontalOverflow = (await geometry()).horizontalOverflow;
await page.screenshot({ path: join(screenshotDir, 'keyboard-simulation-390x640.png'), fullPage: true });

const matrixPass = matrix.every((item) => item.pass);
const stateGeometryPass = states.every((item) => item.geometry.horizontalOverflow === 0 && item.geometry.undersized.length === 0);
const rolePass = [false,true].every((isHr) => roleMatrix.hiring[`isHr_${isHr}`].sensitiveRows === 2 && !roleMatrix.hiring[`isHr_${isHr}`].accessDenied)
  && ['assigned','member','admin','owner'].every((actor) => [false,true].every((isHr) => roleMatrix[actor][`isHr_${isHr}`].sensitiveRows === 0 && roleMatrix[actor][`isHr_${isHr}`].accessDenied))
  && [false,true].every((isHr) => roleMatrix.hiring[`isHr_${isHr}`].candidatesNavigation > 0)
  && ['assigned','member','admin','owner'].every((actor) => [false,true].every((isHr) => roleMatrix[actor][`isHr_${isHr}`].candidatesNavigation === 0));
const resultPass = ['hiring','assigned'].every((actor) => resultMatrix[actor].sensitiveResult === 1 && !resultMatrix[actor].denied)
  && ['member','admin','owner'].every((actor) => resultMatrix[actor].sensitiveResult === 0 && resultMatrix[actor].denied);
const pass = pageErrors.length === 0
  && matrixPass
  && stateGeometryPass
  && rolePass
  && resultPass
  && projectionPrivacy.count >= 3
  && Object.values(projectionPrivacy).every(Boolean)
  && callerOnlyNavigation.actorPreserved && callerOnlyNavigation.noTargetIdentity && callerOnlyNavigation.foreignRows === 0 && callerOnlyNavigation.emptyExplanation
  && filterParity.matches && filterParity.allPagesCopy && filterParity.selectedRowDoesNotChangeScope
  && formingVisible && downloadedVisible
  && revokeClearing.appSensitiveNodes === 0 && revokeClearing.protectedTermsAbsent && revokeClearing.exportSignatureCleared && revokeClearing.revokedDialogVisible
  && keyboard.visibleFocusCount >= 12 && keyboard.namedCount === keyboard.trace.length && keyboard.processLinkReached
  && keyboardSimulation.primaryReachable && keyboardSimulation.horizontalOverflow === 0;

const report = {
  generatedAt: new Date().toISOString(),
  prototype: baseUrl,
  pass,
  disclaimer: 'Prototype-only automated UX evidence. This does not prove backend authorization, response filtering, or XLSX privacy.',
  pageErrors,
  matrix,
  matrixPass,
  states,
  stateGeometryPass,
  roleMatrix,
  rolePass,
  resultMatrix,
  resultPass,
  projectionPrivacy,
  callerOnlyNavigation,
  filterParity,
  exportLifecycle: { formingVisible, downloadedVisible, screenshots: exportScreenshots },
  revokeClearing,
  keyboard,
  keyboardSimulation
};
await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const viewportRows = matrix.map((item) => `| ${item.viewport.width}×${item.viewport.height} | ${item.zoom * 100}% | ${item.horizontalOverflow}px | ${item.undersized.length} | ${item.pass ? 'PASS' : 'FAIL'} |`).join('\n');
await writeFile(join(evidenceDir, 'viewport-zoom-report.md'), `# 1.6d viewport / zoom report\n\nPrototype-only geometry evidence; it is not permission proof.\n\n| Viewport | Zoom | Horizontal overflow | Targets <44×44 | Result |\n|---|---:|---:|---:|---|\n${viewportRows}\n\nOverall: **${matrixPass && stateGeometryPass ? 'PASS' : 'FAIL'}**.\n`, 'utf8');

const focusRows = keyboard.trace.map((item, index) => `| ${index + 1} | ${String(item.name).replace(/\|/g, '\\|')} | ${item.tag} | ${item.visible ? 'yes' : 'no'} | ${item.outlineWidth} |`).join('\n');
await writeFile(join(evidenceDir, 'keyboard-report.md'), `# 1.6d keyboard / focus report\n\nPrototype-only keyboard evidence. Native mobile keyboard remains a DA-07 follow-up.\n\n| # | Accessible name | Element | Focus visible | Outline |\n|---:|---|---|---|---|\n${focusRows}\n\n- Named controls: ${keyboard.namedCount}/${keyboard.trace.length}.\n- Visible focus samples: ${keyboard.visibleFocusCount}.\n- Process action reached: ${keyboard.processLinkReached ? 'yes' : 'no'}.\n- Simulated keyboard inset: ${keyboardSimulation.keyboardInset}; visual viewport ${keyboardSimulation.visualViewport.width}×${keyboardSimulation.visualViewport.height}; primary action reachable: ${keyboardSimulation.primaryReachable ? 'yes' : 'no'}.\n`, 'utf8');

await browser.close();
if (!pass) {
  console.error(JSON.stringify({ pass, pageErrors, matrixPass, stateGeometryPass, rolePass, resultPass, projectionPrivacy, callerOnlyNavigation, filterParity, revokeClearing, keyboard, keyboardSimulation }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`1.6d prototype checks PASS: ${matrix.length} viewport/zoom rows, ${states.length + exportScreenshots.length + 1} screenshots.`);
}
