import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.PROGRAMMES_PROTOTYPE_URL || 'http://127.0.0.1:4174/programmes.html';
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
  target.searchParams.set('evidence1_6e', String(++visit));
  target.hash = hash.startsWith('#') ? hash.slice(1) : hash;
  await page.goto(target.toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(50);
}

async function geometry() {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const interactive = [...document.querySelectorAll('button, a[href], select, input, textarea')]
      .filter(visible)
      .map((element) => {
        const target = element.matches('input[type="checkbox"]') ? element.closest('label') || element : element;
        const rect = target.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') || element.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || element.textContent?.trim().replace(/\s+/g, ' ') || element.id,
          tag: element.tagName,
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
      undersized: interactive.filter((item) => item.width < 44 || item.height < 44),
      unnamed: interactive.filter((item) => !item.name)
    };
  });
}

const viewports = [
  [1440, 900], [1366, 768], [1280, 720], [1024, 600], [1024, 480],
  [768, 1024], [1024, 768], [320, 640], [360, 640], [390, 640], [667, 375]
];
const zooms = [1, 1.25, 1.5, 2];
const matrixRoutes = [
  '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=published&long=1',
  '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=firstDraft&long=1',
  '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=vacancyUpdate&long=1',
  '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createPublished&long=1',
  '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createConflict&long=1',
  '#/teams/atlas/interviews/int-204?surface=room&actor=creator&state=programmedRoom&long=1'
];
const matrix = [];
let routeIndex = 0;
for (const [width, height] of viewports) {
  for (const zoom of zooms) {
    const hash = matrixRoutes[routeIndex++ % matrixRoutes.length];
    await open(hash, { width, height });
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);
    await page.waitForTimeout(30);
    const measured = await geometry();
    matrix.push({ viewport: { width, height }, zoom, hash, ...measured, pass: measured.horizontalOverflow === 0 && measured.undersized.length === 0 && measured.unnamed.length === 0 });
  }
}

const stateCases = [
  ['member-published', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=published&long=1', [1366, 768]],
  ['admin-none', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=none', [1366, 768]],
  ['admin-first-draft', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=firstDraft&long=1', [390, 640]],
  ['admin-published-draft', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=publishedDraft', [1366, 768]],
  ['duplicate-source', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=duplicate', [1024, 600]],
  ['stale-publish', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=stale', [390, 640]],
  ['vacancy-inherited', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=vacancyInherited', [1366, 768]],
  ['vacancy-update', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=vacancyUpdate&long=1', [390, 640]],
  ['programme-archived', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=archived', [1024, 600]],
  ['programme-restored', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=restored', [1366, 768]],
  ['create-none', '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createNone', [390, 640]],
  ['create-draft-blocked', '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createDraft', [390, 640]],
  ['create-archive-blocked', '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createArchived', [390, 640]],
  ['create-inherited', '#/teams/atlas/interviews/new?surface=create&actor=creator&state=vacancyInherited&long=1', [390, 640]],
  ['create-conflict', '#/teams/atlas/interviews/new?surface=create&actor=creator&state=createConflict', [1024, 600]],
  ['programmed-room', '#/teams/atlas/interviews/int-204?surface=room&actor=creator&state=programmedRoom&long=1', [1366, 768]],
  ['loading', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=loading', [390, 640]],
  ['empty-filter', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=empty', [390, 640]],
  ['error', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=error', [390, 640]],
  ['revoked', '#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=revoked', [390, 640]]
];
const screenshots = [];
for (const [name, hash, [width, height]] of stateCases) {
  await open(hash, { width, height });
  const file = `${name}.png`;
  await page.screenshot({ path: join(screenshotDir, file), fullPage: true });
  screenshots.push({ name, hash, viewport: { width, height }, file, geometry: await geometry() });
}

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=member&state=published');
const member = {
  roleVisible: await page.getByText('MEMBER', { exact: true }).count() > 0,
  publishedVisible: await page.getByText('Опубликована', { exact: true }).count() > 0,
  versionVisible: await page.getByText('Версия 3', { exact: true }).count() > 0,
  createVersionCount: await page.getByRole('button', { name: 'Создать новую версию' }).count(),
  archiveCount: await page.getByRole('button', { name: 'Архивировать программу' }).count()
};

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=published');
const admin = {
  roleVisible: await page.getByText('ADMIN', { exact: true }).count() > 0,
  createVersionCount: await page.getByRole('button', { name: 'Создать новую версию' }).count(),
  archiveCount: await page.getByRole('button', { name: 'Архивировать программу' }).count()
};

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=published');
const owner = {
  roleVisible: await page.getByText('ВЛАДЕЛЕЦ КОМАНДЫ', { exact: true }).count() > 0,
  createVersionCount: await page.getByRole('button', { name: 'Создать новую версию' }).count(),
  archiveCount: await page.getByRole('button', { name: 'Архивировать программу' }).count()
};

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createPublished');
const creator = {
  roleVisible: await page.getByText('СОЗДАТЕЛЬ КОМНАТЫ', { exact: true }).count() > 0,
  programmeVisible: await page.getByText(/Разрешена программа вакансии · v3/).count() > 0,
  createVisible: await page.getByRole('button', { name: 'Создать и открыть комнату' }).count() === 1
};

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=publishedDraft');
await page.getByRole('button', { name: 'Проверить и опубликовать' }).click();
const publishDialog = {
  visible: await page.getByRole('dialog').isVisible(),
  futureOnlyText: await page.getByText(/только к новым интервью/).count() > 0,
  focusInside: await page.evaluate(() => document.activeElement?.closest('dialog')?.id === 'confirmDialog')
};
await page.getByRole('button', { name: 'Опубликовать v4' }).click();
publishDialog.successToast = await page.getByRole('status').textContent();

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=firstDraft');
await page.getByRole('button', { name: 'Удалить настройку' }).click();
const discard = {
  dialogVisible: await page.getByRole('dialog').isVisible(),
  allowedOnlyInitialText: await page.getByText(/Публикаций ещё не было/).count() > 0
};
await page.getByRole('button', { name: 'Удалить настройку', exact: true }).last().click();
discard.noneVisible = await page.getByText(/Состояние NONE/).count() > 0;

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=published');
await page.getByRole('button', { name: 'Архивировать программу' }).click();
const archive = {
  noFallbackText: await page.getByText(/без свободного fallback/).count() > 0
};
await page.getByRole('button', { name: 'Архивировать', exact: true }).click();
archive.blockerVisible = await page.getByText(/создание заблокировано/i).count() > 0;
archive.freeChoiceCount = await page.getByText('Свободный состав', { exact: true }).count();
await page.getByRole('button', { name: 'Восстановить программу' }).click();
archive.restoreDialogVisible = await page.getByRole('dialog').isVisible();
await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
archive.restoredVisible = await page.getByText('Программа восстановлена', { exact: true }).count() > 0;

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=duplicate');
const duplicate = {
  duplicateRows: await page.locator('[data-source-id="task-31"]').count(),
  errorVisible: await page.getByText(/sourceTaskId task-31 повторяется/).count() > 0,
  publishDisabled: await page.getByRole('button', { name: 'Проверить и опубликовать' }).isDisabled()
};

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=admin&state=stale');
const stale = {
  sourceAddressed: await page.getByText(/выбрана task v3, актуальна task v4/).count() > 0,
  noAutomaticReplacement: await page.getByText(/Автоматической подмены нет/).count() > 0,
  publishDisabled: await page.getByRole('button', { name: 'Проверить и опубликовать' }).isDisabled()
};

await open('#/teams/atlas/tracks/frontend/programme?surface=manage&actor=owner&state=vacancyUpdate');
const vacancyUpdate = {
  updateVisible: await page.getByText(/Доступно обновление программы трека/).count() > 0,
  pinnedBaseVisible: await page.getByText(/сохраняет базу v3/).count() > 0
};
await page.getByRole('button', { name: 'Просмотреть и применить' }).click();
vacancyUpdate.appliedToDraft = await page.getByText(/Frontend v4 · обновление применено в черновик/).count() > 0;
vacancyUpdate.futurePublishNeeded = await page.getByText(/только после отдельной публикации/).count() > 0;

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createArchived');
const createArchived = {
  blockerVisible: await page.getByText('Программа недоступна для новых интервью', { exact: true }).count() > 0,
  noFallbackVisible: await page.getByText(/Нет автоматического перехода/).count() > 0,
  freeChoiceCount: await page.getByText('Свободный состав', { exact: true }).count()
};

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createNone');
const createNone = {
  noneVisible: await page.getByText(/Программа не настроена · NONE/).count() > 0,
  freeChoiceVisible: await page.getByText('Свободный состав', { exact: true }).count() > 0
};

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createPublished');
const createPublished = {
  mandatoryCount: await page.locator('.programme-row.locked').count(),
  mandatoryDeleteCount: await page.locator('.programme-row.locked').getByRole('button', { name: /Удалить/ }).count(),
  provenanceVisible: await page.getByText('Vacancy programme', { exact: true }).count() > 0
};
await page.getByRole('button', { name: 'Проверить дубликат основы' }).click();
createPublished.duplicateExtraBlocked = await page.getByText(/sourceTaskId task-31 уже есть/).count() > 0;

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createConflict', { width: 390, height: 640 });
await page.locator('#candidateName').fill('Кандидат с сохранённым длинным именем');
await page.locator('#interviewTitle').fill('Сохранённые поля после конфликта версии');
const createConflict = {
  conflictVisible: await page.getByText(/Программа изменилась: v3 → v4/).count() > 0,
  submitInitiallyDisabled: await page.getByRole('button', { name: 'Создать и открыть комнату' }).isDisabled()
};
await page.locator('#reviewVersion').check();
createConflict.fieldsPreserved = await page.locator('#candidateName').inputValue() === 'Кандидат с сохранённым длинным именем' && await page.locator('#interviewTitle').inputValue() === 'Сохранённые поля после конфликта версии';
createConflict.submitEnabledAfterReview = !(await page.getByRole('button', { name: 'Создать и открыть комнату' }).isDisabled());

await open('#/teams/atlas/interviews/int-204?surface=room&actor=creator&state=programmedRoom');
const room = {
  pinnedVersionVisible: await page.getByText('Закреплена программа v3', { exact: true }).count() > 0,
  futureOnlyVisible: await page.getByText(/только будущим интервью/).count() > 0,
  mandatoryCount: await page.locator('.programme-row.locked').count(),
  mandatoryDeleteCount: await page.locator('.programme-row.locked').getByRole('button', { name: /Удалить/ }).count(),
  solutionEditable: !(await page.locator('#solutionCode').isDisabled()) && !(await page.locator('#solutionCode').getAttribute('readonly')),
  contextLocked: await page.locator('#lockedContext').getAttribute('readonly') !== null
};

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createPublished&long=1', { width: 360, height: 640 });
await page.locator('#candidateName').fill('Очень длинное русское имя кандидата, сохранённое при двадцати изменениях размеров');
await page.locator('#interviewTitle').fill('Черновик подготовки с сохранением при resize');
const resizeTrace = [];
for (let index = 0; index < 20; index += 1) {
  const width = [320, 360, 390, 667][index % 4];
  const height = [640, 480, 375, 720][index % 4];
  await page.setViewportSize({ width, height });
  resizeTrace.push({
    index: index + 1,
    viewport: { width, height },
    candidatePreserved: await page.locator('#candidateName').inputValue() === 'Очень длинное русское имя кандидата, сохранённое при двадцати изменениях размеров',
    titlePreserved: await page.locator('#interviewTitle').inputValue() === 'Черновик подготовки с сохранением при resize',
    horizontalOverflow: (await geometry()).horizontalOverflow
  });
}

await open('#/teams/atlas/interviews/new?surface=create&actor=creator&state=createConflict&long=1&keyboard=1', { width: 360, height: 640 });
await page.evaluate(() => document.body.focus());
const focusableCount = await page.evaluate(() => [...document.querySelectorAll('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), textarea:not([disabled])')].filter((element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}).length);
const focusTrace = [];
for (let index = 0; index < focusableCount; index += 1) {
  await page.keyboard.press('Tab');
  focusTrace.push(await page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName,
      name: element?.getAttribute('aria-label') || element?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || element?.textContent?.trim().replace(/\s+/g, ' ') || element?.id,
      outlineWidth: getComputedStyle(element).outlineWidth,
      visible: Boolean(element && element.getBoundingClientRect().bottom > 0 && element.getBoundingClientRect().top < window.innerHeight)
    };
  }));
}
const keyboard = {
  emulationLabelVisible: await page.evaluate(() => document.body.classList.contains('keyboard-open')),
  focusableCount,
  visualViewport: await page.evaluate(() => ({ width: visualViewport?.width, height: visualViewport?.height })),
  trace: focusTrace,
  namedCount: focusTrace.filter((entry) => entry.name).length,
  focusStyledCount: focusTrace.filter((entry) => Number.parseFloat(entry.outlineWidth) >= 3).length
};

const assertions = {
  runtimeClean: runtimeErrors.length === 0,
  geometryPass: matrix.every((entry) => entry.pass),
  screenshotGeometryPass: screenshots.every((entry) => entry.geometry.horizontalOverflow === 0 && entry.geometry.undersized.length === 0 && entry.geometry.unnamed.length === 0),
  rolePermissions: member.roleVisible && member.publishedVisible && member.versionVisible && member.createVersionCount === 0 && member.archiveCount === 0 && admin.roleVisible && admin.createVersionCount === 1 && admin.archiveCount === 1 && owner.roleVisible && owner.createVersionCount === 1 && owner.archiveCount === 1 && creator.roleVisible && creator.programmeVisible && creator.createVisible,
  publishFlow: publishDialog.visible && publishDialog.futureOnlyText && publishDialog.focusInside && /только для будущих интервью/.test(publishDialog.successToast || ''),
  discardFlow: discard.dialogVisible && discard.allowedOnlyInitialText && discard.noneVisible,
  archiveRestoreFlow: archive.noFallbackText && archive.blockerVisible && archive.freeChoiceCount === 0 && archive.restoreDialogVisible && archive.restoredVisible,
  conflicts: duplicate.duplicateRows === 2 && duplicate.errorVisible && duplicate.publishDisabled && stale.sourceAddressed && stale.noAutomaticReplacement && stale.publishDisabled,
  vacancyExplicitUpdate: vacancyUpdate.updateVisible && vacancyUpdate.pinnedBaseVisible && vacancyUpdate.appliedToDraft && vacancyUpdate.futurePublishNeeded,
  stateSemantics: createArchived.blockerVisible && createArchived.noFallbackVisible && createArchived.freeChoiceCount === 0 && createNone.noneVisible && createNone.freeChoiceVisible,
  createIntegrity: createPublished.mandatoryCount >= 3 && createPublished.mandatoryDeleteCount === 0 && createPublished.provenanceVisible && createPublished.duplicateExtraBlocked && createConflict.conflictVisible && createConflict.submitInitiallyDisabled && createConflict.fieldsPreserved && createConflict.submitEnabledAfterReview,
  roomIntegrity: room.pinnedVersionVisible && room.futureOnlyVisible && room.mandatoryCount >= 3 && room.mandatoryDeleteCount === 0 && room.solutionEditable && room.contextLocked,
  resizePersistence: resizeTrace.length === 20 && resizeTrace.every((entry) => entry.candidatePreserved && entry.titlePreserved && entry.horizontalOverflow === 0),
  keyboardPass: keyboard.emulationLabelVisible && keyboard.namedCount === keyboard.trace.length && keyboard.focusStyledCount === keyboard.trace.length
};
const pass = Object.values(assertions).every(Boolean);
const report = {
  task: '1.6e',
  designAcceptance: 'DA-05',
  generatedAt: new Date().toISOString(),
  baseUrl,
  pass,
  assertions,
  runtimeErrors,
  matrix,
  screenshots,
  roleEvidence: { member, admin, owner, creator },
  interactionEvidence: { publishDialog, discard, archive, duplicate, stale, vacancyUpdate, createArchived, createNone, createPublished, createConflict, room },
  resizeTrace,
  keyboard
};
await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const viewportLines = matrix.map((entry) => `| ${entry.viewport.width}×${entry.viewport.height} | ${Math.round(entry.zoom * 100)}% | \`${entry.hash}\` | ${entry.horizontalOverflow}px | ${entry.undersized.length} | ${entry.unnamed.length} | ${entry.pass ? 'PASS' : 'FAIL'} |`).join('\n');
await writeFile(join(evidenceDir, 'viewport-zoom-report.md'), `# 1.6e — viewport / zoom / geometry\n\nАвтоматическая проверка \`${matrix.length}\` комбинаций. Это prototype evidence, не доказательство production programme integrity.\n\n| Viewport | Zoom | Route | Horizontal overflow | <44×44 | Без имени | Result |\n|---|---:|---|---:|---:|---:|---|\n${viewportLines}\n`, 'utf8');

const focusLines = focusTrace.map((entry, index) => `| ${index + 1} | ${entry.tag || '—'} | ${String(entry.name || '—').replace(/\|/g, '\\|')} | ${entry.outlineWidth} | ${entry.visible ? 'в viewport' : 'достижим скроллом'} |`).join('\n');
await writeFile(join(evidenceDir, 'keyboard-report.md'), `# 1.6e — keyboard / focus / visual viewport\n\n- Эмуляция открытой экранной клавиатуры: ${keyboard.emulationLabelVisible ? 'PASS' : 'FAIL'}.\n- Именованные focus stops: ${keyboard.namedCount}/${keyboard.trace.length}.\n- Видимый focus outline ≥3px: ${keyboard.focusStyledCount}/${keyboard.trace.length}.\n- Visual viewport: ${keyboard.visualViewport.width}×${keyboard.visualViewport.height}.\n- 20 resize-переключений: ${assertions.resizePersistence ? 'PASS, поля сохранены, горизонтального overflow нет' : 'FAIL'}.\n\n| # | Element | Accessible name | Outline | Reachability |\n|---:|---|---|---:|---|\n${focusLines}\n\nЭмуляция не заменяет обязательный DA-07 follow-up в реальном мобильном браузере с открытой/закрытой клавиатурой.\n`, 'utf8');

await writeFile(join(evidenceDir, 'verification.md'), `# 1.6e — automated programme prototype verification\n\nКоманда (при запущенном static server из \`prototypes/\` на порту 4174):\n\n\`\`\`sh\nnode openspec/changes/design-team-interview-journey/prototypes/evidence/1.6e/automated-check.mjs\n\`\`\`\n\nРезультат: **${pass ? 'PASS' : 'FAIL'}**.\n\n- Viewport × zoom: ${matrix.filter((entry) => entry.pass).length}/${matrix.length}.\n- Representative screenshots: ${screenshots.length}; geometry-valid: ${screenshots.filter((entry) => entry.geometry.horizontalOverflow === 0 && entry.geometry.undersized.length === 0 && entry.geometry.unnamed.length === 0).length}/${screenshots.length}.\n- Runtime/page errors: ${runtimeErrors.length}.\n- Role permissions: ${assertions.rolePermissions ? 'PASS' : 'FAIL'} — MEMBER read-only; ADMIN/team OWNER manage; room creator uses resolved programme.\n- NONE / first draft / published+draft / archive / restore / allowed initial discard: ${assertions.discardFlow && assertions.archiveRestoreFlow && assertions.stateSemantics ? 'PASS' : 'FAIL'}.\n- Version/provenance/future-only and explicit vacancy update: ${assertions.publishFlow && assertions.vacancyExplicitUpdate ? 'PASS' : 'FAIL'}.\n- Duplicate/stale conflict without silent replacement: ${assertions.conflicts ? 'PASS' : 'FAIL'}.\n- Mandatory foundation / extras / programmed room: ${assertions.createIntegrity && assertions.roomIntegrity ? 'PASS' : 'FAIL'}.\n- 20 resize changes preserve draft values: ${assertions.resizePersistence ? 'PASS' : 'FAIL'}.\n- Keyboard/focus/visual viewport emulation: ${assertions.keyboardPass ? 'PASS' : 'FAIL'}.\n\nMachine-readable evidence: [report.json](report.json). Screenshots: [screenshots/](screenshots/). This is prototype-only evidence and does not replace AC-18/AC-19, INT-08, server authorization, atomicy or programme-integrity proof.\n`, 'utf8');

await browser.close();
if (!pass) {
  console.error(JSON.stringify({ pass, assertions, runtimeErrors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ pass, assertions, screenshots: screenshots.length, matrix: matrix.length }, null, 2));
}
