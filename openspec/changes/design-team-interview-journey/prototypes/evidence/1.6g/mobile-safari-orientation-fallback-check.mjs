import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.PROTOTYPE_URL || 'http://127.0.0.1:4173/';
const screenshotDir = join(evidenceDir, 'screenshots');
const artifactPrefix = process.env.FALLBACK_ARTIFACT_PREFIX || 'automated-tenth';
const reportName = process.env.FALLBACK_REPORT_NAME || 'mobile-safari-orientation-fallback-report.json';
await mkdir(screenshotDir, { recursive: true });
const iphoneSafariUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1';

const surfaces = [
  { id: 'DA-01', file: 'index.html', hash: '/profile?actor=personal&state=success', selector: '#profileName' },
  { id: 'DA-02', file: 'index.html', hash: '/teams/atlas/library/tasks/task-31/edit?actor=member&state=success', selector: '#taskTitle' },
  { id: 'DA-03', file: 'index.html', hash: '/room/int-204?actor=roomOwner&state=success', selector: '[data-room-chat]', prepare: async (page) => page.locator('.room-area-nav [data-room-open="chat"]').click() },
  { id: 'DA-04', file: 'hiring.html', hash: '/teams/atlas/candidates?actor=hiring&state=success&isHr=false', selector: '#q' },
  { id: 'DA-05', file: 'programmes.html', hash: '/teams/atlas/interviews/new?actor=creator&state=createPublished&surface=create', selector: '#candidateName' },
  { id: 'DA-06', file: 'merge.html', hash: '/merge?actor=sourceOwner&state=success&blocker=none&step=target&exact=1', selector: '#targetId' },
];

const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const directLandscape = [];
const rotateDuringInput = [];

const newSafariPage = async (viewport) => {
  const context = await browser.newContext({
    viewport,
    userAgent: iphoneSafariUa,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  await context.addInitScript(() => {
    window.__fallbackTestMutations = 0;
    document.addEventListener('submit', () => { window.__fallbackTestMutations += 1; }, true);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  return { context, page };
};

const visit = async (page, surface) => {
  const target = new URL(surface.file, baseUrl);
  target.hash = surface.hash;
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await surface.prepare?.(page);
  await page.waitForTimeout(30);
};

const seed = async (page, selector, value) => page.locator(selector).evaluate((input, next) => {
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof input.setSelectionRange === 'function') input.setSelectionRange(2, Math.min(8, next.length));
}, value);

const stateOf = async (page, selector) => page.evaluate((fieldSelector) => {
  const field = document.querySelector(fieldSelector);
  const fallback = document.querySelector('[data-iphone-safari-orientation-fallback]');
  const close = fallback?.querySelector('[data-orientation-fallback-close]');
  const box = (node) => {
    const rect = node?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height } : null;
  };
  const room = window.__prototypeRoomSnapshot?.();
  return {
    hash: location.hash,
    value: field?.value,
    selectionStart: field?.selectionStart,
    selectionEnd: field?.selectionEnd,
    focused: document.activeElement === field,
    activeTag: document.activeElement?.tagName,
    fallbackVisible: Boolean(fallback && !fallback.hidden && getComputedStyle(fallback).display !== 'none'),
    fallbackText: fallback?.textContent?.replace(/\s+/g, ' ').trim() || '',
    fallbackRole: fallback?.getAttribute('role'),
    fallbackBox: box(fallback),
    closeBox: box(close),
    fallbackState: document.body.dataset.iphoneSafariInputFallback || 'off',
    mutations: window.__fallbackTestMutations,
    scrollY,
    room: room ? {
      sessionId: room.sessionId,
      editorInstanceId: room.editorInstanceId,
      activePanel: room.activePanel,
      selectedStep: room.selectedStep,
      editorSelectionStart: room.selectionStart,
      editorSelectionEnd: room.selectionEnd,
      editorScrollTop: room.editorScrollTop,
      chatDraft: room.chatDraft,
      chatScrollTop: room.chatScrollTop,
    } : null,
    runwayActive: document.body.classList.contains('room-keyboard-landscape-runway'),
    visibleTargets: [...document.querySelectorAll('button, a[href], select')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return !node.disabled && style.display !== 'none' && style.visibility !== 'hidden'
          && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      })
      .map((node) => ({
        name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
  };
}, selector);

for (const [index, surface] of surfaces.entries()) {
  const safe = index % 2 === 0 ? { left: 47, right: 0 } : { left: 0, right: 47 };
  const { context, page } = await newSafariPage({ width: 844, height: 390 });
  await visit(page, surface);
  await page.evaluate(({ left, right }) => {
    document.documentElement.style.setProperty('--safe-left', `${left}px`);
    document.documentElement.style.setProperty('--safe-right', `${right}px`);
  }, safe);
  const draft = `Черновик ${surface.id} landscape`;
  await seed(page, surface.selector, draft);
  const before = await stateOf(page, surface.selector);
  await page.locator(surface.selector).tap({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(180);
  const after = await stateOf(page, surface.selector);
  const minTarget = after.closeBox?.width >= 44 && after.closeBox?.height >= 44;
  const safeHorizontal = after.fallbackBox?.left >= safe.left && after.fallbackBox?.right <= 844 - safe.right;
  const allVisibleTargets44 = after.visibleTargets.every((target) => target.width >= 44 && target.height >= 44);
  let navigationPreserved = true;
  if (surface.id === 'DA-03') {
    await page.locator('.room-area-nav [data-room-open="editor"]').click();
    navigationPreserved = (await page.evaluate(() => window.__prototypeRoomSnapshot().activePanel)) === 'editor';
    await page.locator('.room-area-nav [data-room-open="chat"]').click();
  }
  const pass = !after.focused
    && after.value === draft
    && after.hash === before.hash
    && after.mutations === 0
    && after.fallbackVisible
    && after.fallbackText.includes('Для ввода поверните iPhone вертикально')
    && ['alert', 'alertdialog'].includes(after.fallbackRole)
    && after.fallbackState === 'shown'
    && !after.runwayActive
    && minTarget
    && safeHorizontal
    && allVisibleTargets44
    && navigationPreserved;
  directLandscape.push({ surface: surface.id, safeArea: safe, before, after, minTarget, safeHorizontal, allVisibleTargets44, navigationPreserved, pass });
  if (surface.id === 'DA-03' || surface.id === 'DA-06') {
    await page.screenshot({ path: join(screenshotDir, `${artifactPrefix}-${surface.id.toLowerCase()}-direct-landscape-fallback.png`), fullPage: true });
  }
  await context.close();
}

for (const surface of surfaces) {
  const { context, page } = await newSafariPage({ width: 390, height: 844 });
  await visit(page, surface);
  const field = page.locator(surface.selector);
  const draft = `Поворот сохраняет ${surface.id}`;
  await field.focus();
  await field.fill(draft);
  await field.evaluate((input) => {
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(3, Math.min(11, input.value.length));
  });
  const portrait = await stateOf(page, surface.selector);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(260);
  const landscape = await stateOf(page, surface.selector);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(260);
  const returnedPortrait = await stateOf(page, surface.selector);
  await field.tap({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(50);
  const explicitRefocus = await stateOf(page, surface.selector);
  const roomPreserved = !portrait.room || (
    landscape.room?.sessionId === portrait.room.sessionId
    && landscape.room?.editorInstanceId === portrait.room.editorInstanceId
    && landscape.room?.activePanel === portrait.room.activePanel
    && landscape.room?.selectedStep === portrait.room.selectedStep
    && landscape.room?.editorSelectionStart === portrait.room.editorSelectionStart
    && landscape.room?.editorSelectionEnd === portrait.room.editorSelectionEnd
    && landscape.room?.editorScrollTop === portrait.room.editorScrollTop
    && landscape.room?.chatDraft === draft
    && landscape.room?.chatScrollTop === portrait.room.chatScrollTop
    && returnedPortrait.room?.sessionId === portrait.room.sessionId
    && returnedPortrait.room?.editorInstanceId === portrait.room.editorInstanceId
  );
  const pass = portrait.focused
    && !portrait.fallbackVisible
    && !landscape.focused
    && landscape.value === draft
    && landscape.selectionStart === portrait.selectionStart
    && landscape.selectionEnd === portrait.selectionEnd
    && landscape.hash === portrait.hash
    && landscape.mutations === 0
    && landscape.fallbackVisible
    && landscape.fallbackText.includes('Для ввода поверните iPhone вертикально')
    && !returnedPortrait.fallbackVisible
    && !returnedPortrait.focused
    && returnedPortrait.value === draft
    && returnedPortrait.mutations === 0
    && explicitRefocus.focused
    && explicitRefocus.value === draft
    && roomPreserved;
  rotateDuringInput.push({ surface: surface.id, portrait, landscape, returnedPortrait, explicitRefocus, roomPreserved, pass });
  if (surface.id === 'DA-03') {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(220);
    await page.screenshot({ path: join(screenshotDir, `${artifactPrefix}-da-03-rotate-from-focused-portrait.png`), fullPage: true });
  }
  await context.close();
}

const otherBrowserContext = await browser.newContext({ viewport: { width: 844, height: 390 } });
const otherBrowserPage = await otherBrowserContext.newPage();
await visit(otherBrowserPage, surfaces[0]);
await otherBrowserPage.locator(surfaces[0].selector).click();
const otherBrowser = await stateOf(otherBrowserPage, surfaces[0].selector);
otherBrowser.pass = otherBrowser.focused && !otherBrowser.fallbackVisible && otherBrowser.fallbackState === 'off';
await otherBrowserContext.close();

const report = {
  task: '1.6g-mobile-safari-orientation-fallback',
  generatedAt: new Date().toISOString(),
  note: 'Prototype-only deterministic iPhone Safari support-matrix check. Native keyboard behavior still requires the tenth real Safari review.',
  pageErrors,
  directLandscape,
  rotateDuringInput,
  otherBrowser,
  pass: pageErrors.length === 0
    && directLandscape.every((item) => item.pass)
    && rotateDuringInput.every((item) => item.pass)
    && otherBrowser.pass,
};
await writeFile(join(evidenceDir, reportName), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({
  pass: report.pass,
  direct: `${directLandscape.filter((item) => item.pass).length}/${directLandscape.length}`,
  rotate: `${rotateDuringInput.filter((item) => item.pass).length}/${rotateDuringInput.length}`,
  otherBrowser: otherBrowser.pass,
  pageErrors: pageErrors.length,
}));
if (!report.pass) process.exitCode = 1;
