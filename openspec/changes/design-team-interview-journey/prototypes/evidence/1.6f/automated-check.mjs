import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.MERGE_PROTOTYPE_URL || 'http://127.0.0.1:4173/merge.html';
const screenshotDir = join(evidenceDir, 'screenshots');
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const runtimeErrors = [];
let visit = 0;
page.on('pageerror', (error) => runtimeErrors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

async function open(hash, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  const target = new URL(baseUrl);
  target.searchParams.set('evidence1_6f', String(++visit));
  target.hash = hash.startsWith('#') ? hash.slice(1) : hash;
  await page.goto(target.toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(40);
}

async function geometry() {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const targets = [...document.querySelectorAll('button, a[href], select, input, textarea')]
      .filter(visible)
      .map((element) => {
        let target = element;
        if (element.matches('input[type="checkbox"],input[type="radio"]')) {
          target = element.labels?.[0] || element.closest('label') || element.closest('.radio-row') || element;
        }
        const rect = target.getBoundingClientRect();
        const name = element.getAttribute('aria-label')
          || element.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ')
          || element.textContent?.trim().replace(/\s+/g, ' ')
          || element.getAttribute('title')
          || element.id;
        return {
          tag: element.tagName,
          type: element.getAttribute('type'),
          name,
          disabled: Boolean(element.disabled),
          x: Number(rect.x.toFixed(2)), y: Number(rect.y.toFixed(2)),
          width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2))
        };
      });
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      targetCount: targets.length,
      undersized: targets.filter((item) => item.width < 43.5 || item.height < 43.5),
      unnamed: targets.filter((item) => !item.name),
      targets
    };
  });
}

const viewports = [
  [1440, 900], [1366, 768], [1280, 720], [1024, 600], [1024, 480],
  [768, 1024], [1024, 768], [320, 640], [360, 640], [390, 640], [667, 375]
];
const zooms = [1, 1.25, 1.5, 2];
const matrixRoutes = [
  '#/merge?actor=sourceOwner&state=success&blocker=none&step=target&exact=1&long=1',
  '#/merge?actor=destinationOwner&state=success&blocker=none&step=inbox&long=1',
  '#/merge?actor=sourceOwner&state=success&blocker=none&step=plan&phase=teams&long=1',
  '#/merge?actor=destinationOwner&state=success&blocker=membership&step=plan&phase=members&long=1',
  '#/merge?actor=sameOwner&state=success&blocker=none&step=plan&phase=names&long=1',
  '#/merge?actor=destinationOwner&state=success&blocker=none&step=plan&phase=review&long=1',
  '#/merge?actor=sameOwner&state=success&blocker=live&step=plan&phase=approval&commit=1&long=1',
  '#/merge?actor=nonOwner&state=success&blocker=none&step=plan&phase=approval&long=1',
  '#/merge?actor=destinationOwner&state=revoked&blocker=none&step=plan&phase=approval&long=1',
  '#/merge?actor=nonOwner&state=revoked&blocker=none&step=redirect&authorized=0&long=1'
];
const matrix = [];
let routeIndex = 0;
for (const [width, height] of viewports) {
  for (const zoom of zooms) {
    const hash = matrixRoutes[routeIndex++ % matrixRoutes.length];
    await open(hash, { width, height });
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
    await page.waitForTimeout(25);
    const measured = await geometry();
    matrix.push({
      viewport: { width, height }, zoom, hash,
      clientWidth: measured.clientWidth, scrollWidth: measured.scrollWidth,
      horizontalOverflow: measured.horizontalOverflow,
      targetCount: measured.targetCount,
      undersized: measured.undersized,
      unnamed: measured.unnamed,
      pass: measured.horizontalOverflow === 0 && measured.undersized.length === 0 && measured.unnamed.length === 0
    });
  }
}

const screenshotCases = [
  ['exact-target-long', '#/merge?actor=sourceOwner&state=success&blocker=none&step=target&exact=1&long=1', [1366, 768]],
  ['request-name-hidden', '#/merge?actor=sourceOwner&state=success&blocker=none&step=request&exact=1', [390, 640]],
  ['destination-inbox', '#/merge?actor=destinationOwner&state=success&blocker=none&step=inbox&long=1', [1024, 600]],
  ['members-dedup-conflict', '#/merge?actor=destinationOwner&state=success&blocker=membership&step=plan&phase=members&long=1', [1366, 768]],
  ['name-collisions', '#/merge?actor=sameOwner&state=success&blocker=none&step=plan&phase=names&long=1', [390, 640]],
  ['review-private', '#/merge?actor=destinationOwner&state=success&blocker=none&step=plan&phase=review&long=1', [1366, 768]],
  ['approval-stale', '#/merge?actor=sameOwner&state=conflict&blocker=none&step=plan&phase=approval&commit=1', [1024, 600]],
  ['blocker-live', '#/merge?actor=destinationOwner&state=success&blocker=live&step=plan&phase=approval&commit=1', [390, 640]],
  ['failure-busy', '#/merge?actor=destinationOwner&state=error&blocker=busy&step=commit&commit=1', [1024, 600]],
  ['revoked-non-owner', '#/merge?actor=nonOwner&state=revoked&blocker=none&step=plan&phase=approval', [390, 640]],
  ['redirect-authorized', '#/merge?actor=destinationOwner&state=success&blocker=none&step=redirect&authorized=1', [1366, 768]],
  ['redirect-unauthorized', '#/merge?actor=nonOwner&state=revoked&blocker=none&step=redirect&authorized=0', [390, 640]]
];
const screenshots = [];
for (const [name, hash, [width, height]] of screenshotCases) {
  await open(hash, { width, height });
  const file = `${name}.png`;
  await page.screenshot({ path: join(screenshotDir, file), fullPage: true });
  const measured = await geometry();
  screenshots.push({ name, hash, viewport: { width, height }, file, geometry: {
    horizontalOverflow: measured.horizontalOverflow,
    targetCount: measured.targetCount,
    undersized: measured.undersized,
    unnamed: measured.unnamed
  }});
}

await open('#/merge?actor=sourceOwner&state=success&blocker=none&step=target&exact=1');
await page.locator('#targetId').fill('team-does-not-exist');
await page.getByRole('button', { name: 'Пригласить владельца к согласованию' }).click();
const unavailableCopy = await page.locator('#targetError').textContent();
const exactTarget = {
  invalidFocused: await page.locator('#targetId').evaluate((node) => node === document.activeElement),
  genericUnavailable: unavailableCopy?.trim() === 'Команда недоступна для объединения.',
  noDirectory: (await page.locator('body').innerText()).includes('Глобального поиска команд нет')
};

await open('#/merge?actor=sourceOwner&state=success&blocker=none&step=request&exact=1');
const requestText = await page.locator('#main').innerText();
const requestPrivacy = {
  exactTargetVisible: requestText.includes('team-be-204'),
  destinationNameHidden: !requestText.includes('Backend') && !requestText.includes('Engineering'),
  reviewNotApproval: /открытие review[^\n]*не является approval/.test(requestText.toLowerCase()) && requestText.toLowerCase().includes('не финальное согласие'),
  noCandidateOrRoomDetails: !/кандидат\s+[А-ЯЁ][а-яё]+|room-[a-z0-9-]+|int-\d+/i.test(requestText)
};

await open('#/merge?actor=destinationOwner&state=success&blocker=none&step=inbox');
await page.getByRole('button', { name: 'Открыть согласование' }).click();
await page.waitForTimeout(50);
const reviewOpening = {
  teamsPhaseVisible: await page.getByRole('heading', { name: 'Направление и итог' }).count() === 1,
  revisionVisible: await page.getByText('rev 7', { exact: true }).count() === 1,
  noApprovalYet: await page.getByText('СОГЛАСОВАНО', { exact: false }).count() === 0
};

await open('#/merge?actor=sameOwner&state=success&blocker=none&step=plan&phase=approval&commit=0');
const commitButton = page.getByRole('button', { name: /Объединить команды/ });
const dualApproval = {
  separateSealsBefore: await page.locator('.approval-seal').count() === 2,
  commitDisabledBefore: await commitButton.isDisabled()
};
await page.getByRole('button', { name: 'Я владею обеими: подтвердить две стороны' }).click();
dualApproval.twoSealsApproved = await page.locator('.approval-seal.approved').count() === 2;
dualApproval.sameRevision = (await page.locator('.approval-card').allTextContents()).every((text) => text.includes('rev 7'));
dualApproval.approvalNotCommit = await page.getByText(/Это не commit/).count() === 1 && await commitButton.isDisabled();
await page.locator('[data-commit-flag]').check();
await page.waitForTimeout(50);
dualApproval.commitEnabledAfterFlag = !(await page.locator('[data-commit]').isDisabled());

await open('#/merge?actor=sourceOwner&state=success&blocker=none&step=plan&phase=approval&commit=1');
const sourceOwner = {
  ownApprovalAction: await page.locator('[data-approve-source]').count() === 1,
  destinationApprovalAction: await page.locator('[data-approve-destination]').count() === 0,
  commitDisabled: await page.locator('[data-commit]').isDisabled()
};
await open('#/merge?actor=destinationOwner&state=success&blocker=none&step=plan&phase=approval&commit=1');
const destinationOwner = {
  ownApprovalAction: await page.locator('[data-approve-destination]').count() === 1,
  sourceApprovalAction: await page.locator('[data-approve-source]').count() === 0,
  commitDisabledWithoutBoth: await page.locator('[data-commit]').isDisabled()
};
await open('#/merge?actor=nonOwner&state=success&blocker=none&step=plan&phase=approval&commit=1');
const nonOwnerText = await page.locator('#main').innerText();
const nonOwner = {
  terminal: nonOwnerText.includes('Только владельцы согласуют объединение'),
  noPlanRevision: !nonOwnerText.includes('digest 7F·A2') && !nonOwnerText.includes('team-be-204'),
  noApproveOrCommit: await page.locator('[data-approve-source],[data-approve-destination],[data-approve-both],[data-commit]').count() === 0
};

const blockerEvidence = {};
for (const blocker of ['live', 'recovery', 'persistence', 'busy', 'membership']) {
  await open(`#/merge?actor=destinationOwner&state=success&blocker=${blocker}&step=plan&phase=${blocker === 'membership' ? 'members' : 'approval'}&commit=1`);
  const body = await page.locator('#main').innerText();
  blockerEvidence[blocker] = {
    visible: body.includes({ live: 'LIVE_SESSIONS_PRESENT', recovery: 'RECOVERY_PENDING', persistence: 'PERSISTENCE_PENDING', busy: 'MERGE_BUSY', membership: 'MEMBERSHIP_CONFLICT' }[blocker]),
    noSuccess: !body.includes('Команды объединены') && !body.includes('MERGED · confirmed'),
    commitDisabled: blocker === 'membership' ? true : await page.locator('[data-commit]').isDisabled()
  };
}

await open('#/merge?actor=sameOwner&state=success&blocker=none&step=plan&phase=approval&commit=1');
await page.locator('[data-approve-both]').click();
await page.locator('[data-commit]').click();
await page.waitForTimeout(100);
const commitProgress = {
  separateStep: locationSafe(await page.url()).includes('step=commit'),
  busyCopy: await page.getByText('Объединяем команды…', { exact: true }).count() === 1,
  noEarlySuccess: await page.getByText('Команды объединены', { exact: true }).count() === 0
};
await page.screenshot({ path: join(screenshotDir, 'commit-progress.png'), fullPage: true });
await page.waitForTimeout(700);
const result = {
  confirmedHeading: await page.getByRole('heading', { name: 'Команды объединены' }).count() === 1,
  receiptVisible: await page.getByText('merge-op-7fa2 · один результат при повторе', { exact: true }).count() === 1,
  sourceMerged: await page.getByText('team-fr-101 · MERGED', { exact: true }).count() === 1,
  noUndo: await page.getByText('Не предусмотрено', { exact: true }).count() === 1
};
await page.screenshot({ path: join(screenshotDir, 'confirmed-result.png'), fullPage: true });

await open('#/merge?actor=destinationOwner&state=error&blocker=busy&step=commit&commit=1');
const failure = {
  separateTeams: await page.getByText('Команды ещё раздельны', { exact: true }).count() === 1,
  noSuccessHeading: await page.getByText('Команды объединены', { exact: true }).count() === 0,
  noPartialCopy: await page.getByText(/Нет частичного результата/).count() === 1
};

await open('#/merge?actor=destinationOwner&state=success&blocker=none&step=plan&phase=approval&commit=1');
await page.locator('[data-approve-destination]').click();
await page.locator('[data-phase="teams"]').click();
await page.locator('#destinationName').fill('Engineering Platform');
await page.locator('#destinationName').press('Tab');
await page.locator('[data-phase="approval"]').click();
const staleAfterEdit = {
  revisionBumped: await page.getByText('rev 8', { exact: true }).count() === 1,
  approvalsCleared: await page.locator('.approval-seal.approved').count() === 0,
  commitDisabled: await page.locator('[data-commit]').isDisabled()
};

const stateHashes = {
  loading: '#/merge?actor=sourceOwner&state=loading&blocker=none&step=target',
  empty: '#/merge?actor=destinationOwner&state=empty&blocker=none&step=inbox',
  error: '#/merge?actor=sourceOwner&state=error&blocker=none&step=target',
  conflict: '#/merge?actor=sameOwner&state=conflict&blocker=none&step=plan&phase=approval',
  revoked: '#/merge?actor=destinationOwner&state=revoked&blocker=none&step=plan',
  success: '#/merge?actor=sourceOwner&state=success&blocker=none&step=target'
};
const states = {};
for (const [state, hash] of Object.entries(stateHashes)) {
  await open(hash, { width: 390, height: 640 });
  states[state] = {
    heading: (await page.locator('h1,h2').allTextContents()).join(' | '),
    ariaBusy: await page.locator('[aria-busy="true"]').count(),
    alertCount: await page.getByRole('alert').count()
  };
}

await open('#/merge?actor=sourceOwner&state=success&blocker=none&step=target&exact=1&long=1', { width: 390, height: 640 });
const focusTrace = [];
for (let index = 0; index < 14; index += 1) {
  await page.keyboard.press('Tab');
  focusTrace.push(await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      index: Number(element?.dataset?.focusIndex || 0),
      tag: element?.tagName,
      name: element?.getAttribute('aria-label') || element?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || element?.textContent?.trim().replace(/\s+/g, ' ') || element?.id,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      inViewport: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
    };
  }));
}

await open('#/merge?actor=sameOwner&state=success&blocker=none&step=plan&phase=approval&commit=1&long=1', { width: 390, height: 360 });
await page.locator('[data-approve-both]').click();
const compactAction = page.locator('[data-commit]');
await compactAction.scrollIntoViewIfNeeded();
const compactKeyboard = await compactAction.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return {
    visualViewport: { width: window.visualViewport?.width || innerWidth, height: window.visualViewport?.height || innerHeight },
    button: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
    insideViewport: rect.top >= 0 && rect.bottom <= (window.visualViewport?.height || innerHeight) && rect.left >= 0 && rect.right <= (window.visualViewport?.width || innerWidth),
    safeAreaDeclared: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').includes('safe-area-inset-bottom')
  };
});

function locationSafe(value) { return decodeURIComponent(value); }
const focusPass = focusTrace.every((item) => item.name && item.outlineStyle !== 'none' && Number.parseFloat(item.outlineWidth) >= 2);
const assertionGroups = {
  exactTarget, requestPrivacy, reviewOpening, dualApproval, sourceOwner, destinationOwner, nonOwner,
  blockerEvidence, commitProgress, result, failure, staleAfterEdit
};
const flattenBooleans = (value) => Object.values(value).flatMap((item) => typeof item === 'boolean' ? [item] : item && typeof item === 'object' ? flattenBooleans(item) : []);
const assertionsPass = flattenBooleans(assertionGroups).every(Boolean);
const matrixPass = matrix.every((entry) => entry.pass);
const screenshotsPass = screenshots.every((entry) => entry.geometry.horizontalOverflow === 0 && entry.geometry.undersized.length === 0 && entry.geometry.unnamed.length === 0);
const statesDistinct = new Set(Object.values(states).map((item) => `${item.heading}|busy:${item.ariaBusy}|alerts:${item.alertCount}`)).size === Object.keys(states).length;
const pass = matrixPass && screenshotsPass && runtimeErrors.length === 0 && assertionsPass && statesDistinct && focusPass && compactKeyboard.insideViewport && compactKeyboard.button.height >= 43.5;

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  disclaimer: 'Prototype-only evidence; not proof of server authorization, transaction atomicity, persistence or production redirect guards.',
  pass,
  summary: {
    matrix: `${matrix.filter((entry) => entry.pass).length}/${matrix.length}`,
    screenshots: screenshots.length + 2,
    runtimeErrors: runtimeErrors.length,
    assertionsPass,
    statesDistinct,
    focus: `${focusTrace.filter((item) => item.name && item.outlineStyle !== 'none').length}/${focusTrace.length}`,
    compactKeyboard: compactKeyboard.insideViewport
  },
  assertions: assertionGroups,
  states,
  matrix,
  screenshots: [...screenshots, { name: 'commit-progress', file: 'commit-progress.png' }, { name: 'confirmed-result', file: 'confirmed-result.png' }],
  focusTrace,
  compactKeyboard,
  runtimeErrors
};

await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(evidenceDir, 'bounding-rectangles.json'), `${JSON.stringify({ matrix, screenshots, compactKeyboard }, null, 2)}\n`);
await writeFile(join(evidenceDir, 'focus-trace.json'), `${JSON.stringify(focusTrace, null, 2)}\n`);
await writeFile(join(evidenceDir, 'visual-viewport-keyboard.json'), `${JSON.stringify(compactKeyboard, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify({ pass, ...report.summary }, null, 2));
if (!pass) process.exitCode = 1;
