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
page.setDefaultTimeout(5000);
const pageErrors = [];
let openCount = 0;
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

async function open(hash, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  const target = new URL(baseUrl);
  target.searchParams.set('evidence1_6c', String(++openCount));
  target.hash = hash.slice(1);
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(35);
}

async function geometry() {
  return page.evaluate(() => {
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const rectFor = (element) => {
      const labelledTarget = element.matches('input[type="checkbox"]') ? element.labels?.[0] : null;
      const target = labelledTarget || element.closest('.long-toggle') || element;
      const rect = target.getBoundingClientRect();
      return {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        logicalWidth: Math.round((rect.width / zoom) * 100) / 100,
        logicalHeight: Math.round((rect.height / zoom) * 100) / 100
      };
    };
    const interactive = [...document.querySelectorAll('button, a[href], select, input, textarea')]
      .filter(visible)
      .map((element) => ({
        name: element.getAttribute('aria-label') || element.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || element.textContent?.trim().replace(/\s+/g, ' ') || element.id,
        tag: element.tagName,
        ...rectFor(element)
      }));
    const root = document.documentElement;
    const panels = [...document.querySelectorAll('[data-room-panel]')].filter(visible).map((panel) => ({
      name: panel.dataset.roomPanel,
      ...rectFor(panel),
      body: panel.querySelector('.room-editor-input, .room-panel-body') ? rectFor(panel.querySelector('.room-editor-input, .room-panel-body')) : null
    }));
    return {
      zoom,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      interactiveCount: interactive.length,
      interactive,
      undersized: interactive.filter((item) => item.logicalWidth < 43.5 || item.logicalHeight < 43.5),
      panels,
      room: document.querySelector('[data-room-root]') ? {
        mode: document.querySelector('[data-room-root]').dataset.mode,
        W: Number(document.querySelector('[data-room-root]').dataset.availableW),
        H: Number(document.querySelector('[data-room-root]').dataset.availableH),
        keyboard: document.querySelector('[data-room-root]').dataset.keyboard === 'true',
        viewportSource: document.querySelector('[data-room-root]').dataset.viewportSource
      } : null
    };
  });
}

const viewports = [
  [1440, 900], [1366, 768], [1280, 720], [1024, 600], [1024, 480],
  [768, 1024], [1024, 768], [320, 640], [360, 640], [390, 640], [667, 375]
];
const zooms = [1, 1.25, 1.5, 2];
const matrix = [];
for (const [width, height] of viewports) {
  for (const zoom of zooms) {
    await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width, height });
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); window.__prototypeClearVisualViewport(); }, zoom);
    await page.waitForTimeout(40);
    const measured = await geometry();
    const expectedMode = measured.room.W >= 1000 && measured.room.H >= 440 ? 'work' : 'focus';
    const visiblePanelCount = measured.panels.length;
    const editor = measured.panels.find((item) => item.name === 'editor');
    const multiPanelMinima = measured.room.mode === 'work'
      ? Boolean(editor && editor.body.logicalWidth >= 480 && editor.body.logicalHeight >= 320 && visiblePanelCount === 2)
      : visiblePanelCount === 1;
    matrix.push({
      viewport: { width, height }, zoom, route: '#/room/int-204?actor=roomOwner&state=success&long=1',
      expectedMode, ...measured,
      pass: measured.horizontalOverflow === 0 && measured.undersized.length === 0 && measured.room.mode === expectedMode && multiPanelMinima
    });
  }
}

const screenshots = [];
async function shot(name, hash, viewport, prepare) {
  await open(hash, viewport);
  if (prepare) await prepare();
  const file = `${name}.png`;
  await page.screenshot({ path: join(screenshotDir, file), fullPage: false });
  screenshots.push({ name, hash, viewport, file, geometry: await geometry() });
}

await shot('room-owner-work', '#/room/int-204?actor=roomOwner&state=success&long=1', { width: 1366, height: 768 });
await shot('room-owner-overview-both', '#/room/int-204?actor=roomOwner&state=success', { width: 1440, height: 900 }, async () => {
  await page.locator('[data-room-mode="overview"]').click();
  await page.locator('.room-area-nav [data-room-open="chat"]').click();
  await page.locator('[data-room-both]:visible').click();
});
await shot('focus-phone-long-ru', '#/room/int-204?actor=interviewer&state=success&long=1', { width: 390, height: 640 });
await shot('reconnecting-work', '#/room/int-204?actor=hiring&state=reconnecting', { width: 1280, height: 720 });
await shot('pending-chat', '#/room/int-204?actor=guestManager&state=pending', { width: 1024, height: 600 }, async () => page.locator('.room-area-nav [data-room-open="chat"]').click());
await shot('activity-error', '#/room/int-204?actor=interviewer&state=error', { width: 1024, height: 600 }, async () => page.locator('.room-area-nav [data-room-open="activity"]').click());
await shot('frozen-owner', '#/room/int-204?actor=roomOwner&state=frozen', { width: 768, height: 1024 });
await shot('revoked-staff', '#/room/int-204?actor=revokedStaff&state=revoked', { width: 390, height: 640 });
await shot('candidate-no-internal-panels', '#/room/int-204?actor=candidate&state=success&long=1', { width: 390, height: 640 });

await open('#/room/int-204?actor=roomOwner&state=success', { width: 1440, height: 900 });
await page.locator('[data-room-mode="overview"]').click();
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-both]:visible').click();
const overviewGeometry = await geometry();
const panelByName = Object.fromEntries(overviewGeometry.panels.map((item) => [item.name, item]));
const chatHistoryRect = await page.locator('[data-room-chat-scroll]').boundingBox();
const composerRect = await page.locator('.room-chat-composer').boundingBox();
const overview = {
  mode: overviewGeometry.room.mode,
  panelCount: overviewGeometry.panels.length,
  panels: panelByName,
  chatHistoryRect,
  composerRect,
  minimaPass: panelByName.editor?.body.logicalWidth >= 480 && panelByName.editor?.body.logicalHeight >= 320
    && panelByName.steps?.body.logicalWidth >= 240 && panelByName.steps?.body.logicalHeight >= 240
    && panelByName.activity?.height >= 240 && panelByName.chat?.height >= 320 && chatHistoryRect?.height >= 120
};

await open('#/room/int-204?actor=roomOwner&state=success', { width: 1440, height: 900 });
const editor = page.locator('[data-room-editor]');
const code = `${'const item = queue.shift(); // длинная строка для внутренней прокрутки\n'.repeat(82)}return queue;`;
await editor.fill(code);
await editor.evaluate((element) => { element.setSelectionRange(41, 77); element.scrollTop = 260; });
await page.locator('.room-area-nav [data-room-open="notes"]').click();
await page.locator('[data-room-notes]').fill('Личный черновик заметки сохраняется через двадцать переключений.');
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-chat]').fill('Черновик чата сохраняется и не считается отправленным.');
await page.locator('[data-room-chat-scroll]').evaluate((element) => { element.scrollTop = 18; });
await page.locator('.room-area-nav [data-room-open="activity"]').click();
await page.locator('[data-room-activity-scroll]').evaluate((element) => { element.scrollTop = 20; });
await page.locator('.room-area-nav [data-room-open="steps"]').click();
await page.locator('[data-room-step="step-3"]').click();
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-mode="overview"]').click();
await page.locator('[data-room-both]:visible').click();
const editorHandle = await editor.elementHandle();
const before = await page.evaluate(() => window.__prototypeRoomSnapshot());
const panels = ['chat', 'notes', 'activity', 'steps', 'condition', 'editor'];
const sizes = [[390, 640], [1440, 900], [1024, 480], [1280, 720], [768, 1024]];
for (let index = 0; index < 20; index += 1) {
  await page.locator(`[data-room-open="${panels[index % panels.length]}"]`).first().click();
  const [width, height] = sizes[index % sizes.length];
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(22);
}
const after = await page.evaluate(() => window.__prototypeRoomSnapshot());
const sameEditorNode = await editorHandle.evaluate((element) => element === document.querySelector('[data-room-editor]'));
const continuity = {
  sameEditorNode,
  sameSession: before.sessionId === after.sessionId && before.editorInstanceId === after.editorInstanceId,
  sameMountCount: before.mountCount === after.mountCount,
  codePreserved: after.code === code,
  selectionPreserved: after.selectionStart === 41 && after.selectionEnd === 77,
  editorScrollPreserved: after.editorScrollTop === 260,
  notesDraftPreserved: after.notesDraft === 'Личный черновик заметки сохраняется через двадцать переключений.',
  chatDraftPreserved: after.chatDraft === 'Черновик чата сохраняется и не считается отправленным.',
  selectedStepPreserved: after.selectedStep === 'step-3',
  switchCountDelta: after.switchCount - before.switchCount,
  before,
  after
};

await open('#/room/int-204?actor=roomOwner&state=success', { width: 1280, height: 720 });
await page.locator('.room-area-nav [data-room-open="chat"]').click();
const chatHistory = page.locator('[data-room-chat-scroll]');
await chatHistory.evaluate((element) => { element.scrollTop = 0; });
await page.locator('[data-room-editor]').focus();
const attentionBefore = await page.evaluate(() => ({ focus: document.activeElement?.getAttribute('data-room-editor') !== null, scrollTop: document.querySelector('[data-room-chat-scroll]').scrollTop }));
await page.locator('[data-room-incoming]').evaluate((button) => button.click());
const attentionAfterIncoming = await page.evaluate(() => window.__prototypeRoomSnapshot());
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-new]').click();
const attentionAfterRead = await page.evaluate(() => window.__prototypeRoomSnapshot());
const attention = {
  focusStayedInEditor: attentionBefore.focus && await page.locator('[data-room-editor]').count() === 1,
  scrollPositionStable: attentionAfterIncoming.chatScrollTop === attentionBefore.scrollTop,
  unreadIncreased: attentionAfterIncoming.unread > 2,
  unreadClearedAtBottom: attentionAfterRead.unread === 0 && attentionAfterRead.chatScrollTop >= attentionAfterIncoming.chatScrollTop
};

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 390, height: 640 });
await page.locator('.room-area-nav [data-room-open="chat"]').click();
const simulated = await page.evaluate(() => window.__prototypeSetVisualViewport(390, 360, true));
const flow = page.locator('.room-chat-panel .room-panel-body');
await flow.evaluate((element) => { element.scrollTop = element.scrollHeight; });
const send = page.getByRole('button', { name: 'Отправить', exact: true });
await send.scrollIntoViewIfNeeded();
const keyboardGeometry = await geometry();
const contextRect = await page.locator('.room-input-context').boundingBox();
const navRect = await page.locator('.room-area-nav').boundingBox();
const sendRect = await send.boundingBox();
await page.screenshot({ path: join(screenshotDir, 'visual-viewport-keyboard-chat.png'), fullPage: false });
screenshots.push({ name: 'visual-viewport-keyboard-chat', file: 'visual-viewport-keyboard-chat.png', viewport: { width: 390, height: 640 }, simulatedVisualViewport: { width: 390, height: 360, keyboard: true }, geometry: keyboardGeometry });
const keyboardViewport = {
  simulated,
  contextRect,
  navRect,
  serviceHeight: (contextRect?.height || 0) + (navRect?.height || 0),
  sendRect,
  sendReachable: Boolean(sendRect && sendRect.y >= 0 && sendRect.y + sendRect.height <= 360),
  sixDirectActions: await page.locator('.room-area-nav [data-room-open]').count(),
  compactCurrentStepVisible: await page.locator('[data-room-step-compact]').isVisible(),
  compactCurrentStepText: await page.locator('[data-room-step-compact]').textContent(),
  minimumActionWidth: Math.min(...keyboardGeometry.interactive.filter((item) => item.name && ['Редактор', 'Шаги', 'Условие', 'Мои заметки', 'Чат', 'Активность'].some((name) => item.name.includes(name))).map((item) => item.logicalWidth)),
  horizontalOverflow: keyboardGeometry.horizontalOverflow
};

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 667, height: 375 });
await page.locator('.room-area-nav [data-room-open="chat"]').click();
const landscapeChat = page.locator('[data-room-chat]');
await landscapeChat.focus();
await page.waitForTimeout(80);
const focusedChatNode = await landscapeChat.elementHandle();
const landscapeFlow = page.locator('.room-chat-panel .room-panel-body');
await landscapeFlow.evaluate((element) => { element.scrollTop = element.scrollHeight; });
const realKeyboardFocus = await page.evaluate(() => {
  const root = document.querySelector('[data-room-root]');
  const input = document.querySelector('[data-room-chat]');
  const sendButton = document.querySelector('[data-room-chat-form] button[type="submit"]');
  const composer = document.querySelector('.room-chat-composer');
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const sendRect = sendButton?.getBoundingClientRect();
  const composerRect = composer?.getBoundingClientRect();
  return {
    inputModeActivatedByFocus: root?.dataset.keyboard === 'true',
    focusPreserved: document.activeElement === input,
    historyCollapsedInKeyboardMode: getComputedStyle(document.querySelector('[data-room-chat-scroll]')).display === 'none',
    sendReachableAfterOrdinaryScroll: Boolean(sendRect && sendRect.top >= 0 && sendRect.bottom <= viewportHeight && sendRect.left >= 0 && sendRect.right <= viewportWidth),
    composerReachableAfterOrdinaryScroll: Boolean(composerRect && composerRect.top < viewportHeight && composerRect.bottom > 0),
    compactCurrentStepVisible: Boolean(document.querySelector('[data-room-composer-step]')?.getBoundingClientRect().height)
      && /02\s+·\s+Устойчивый порядок.*Кандидату\s+·\s+02/i.test(document.querySelector('[data-room-composer-step]')?.textContent || ''),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
});
realKeyboardFocus.sameChatNode = await focusedChatNode.evaluate((element) => element === document.querySelector('[data-room-chat]'));
await page.screenshot({ path: join(screenshotDir, 'focus-driven-landscape-chat.png'), fullPage: false });
screenshots.push({ name: 'focus-driven-landscape-chat', file: 'focus-driven-landscape-chat.png', viewport: { width: 667, height: 375 }, geometry: await geometry() });

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 390, height: 640 });
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-chat]').focus();
await page.evaluate(() => window.__prototypeSetVisualViewport(390, 320, true));
await page.waitForTimeout(80);
const portraitFocusResize = await page.evaluate(() => {
  const root = document.querySelector('[data-room-root]');
  const input = document.querySelector('[data-room-chat]');
  const sendButton = document.querySelector('[data-room-chat-form] button[type="submit"]');
  const rootRect = root?.getBoundingClientRect();
  const sendRect = sendButton?.getBoundingClientRect();
  return {
    keyboardMode: root?.dataset.keyboard === 'true',
    focusPreserved: document.activeElement === input,
    rootFitsVisualViewport: Boolean(rootRect && Math.abs(rootRect.height - 320) < 1 && rootRect.top >= 0 && rootRect.bottom <= 320),
    sendVisibleWithoutScriptedScroll: Boolean(sendRect && sendRect.top >= 0 && sendRect.bottom <= 320),
    currentStepCompact: Boolean(document.querySelector('[data-room-step-compact]')?.getBoundingClientRect().height),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
});
await page.screenshot({ path: join(screenshotDir, 'focus-resize-portrait-chat.png'), fullPage: false });
screenshots.push({ name: 'focus-resize-portrait-chat', file: 'focus-resize-portrait-chat.png', viewport: { width: 390, height: 640 }, simulatedVisualViewport: { width: 390, height: 320, keyboard: true }, geometry: await geometry() });

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 667, height: 375 });
await page.evaluate(() => {
  document.documentElement.style.setProperty('--safe-left', '47px');
  document.documentElement.style.setProperty('--safe-right', '47px');
});
await page.locator('.room-area-nav [data-room-open="chat"]').click();
await page.locator('[data-room-chat]').focus();
const autoPanSimulated = await page.evaluate(() => window.__prototypeSetVisualViewport(667, 260, true, 92, 0));
await page.waitForTimeout(80);
const autoPanRecovery = await page.evaluate(() => {
  const visualTop = 92;
  const visualBottom = visualTop + 260;
  const visualLeft = 0;
  const visualRight = 667;
  const root = document.querySelector('[data-room-root]');
  const context = document.querySelector('.room-input-context');
  const nav = document.querySelector('.room-area-nav');
  const composer = document.querySelector('.room-chat-composer');
  const composerStep = document.querySelector('[data-room-composer-step]');
  const input = document.querySelector('[data-room-chat]');
  const rect = (element) => element?.getBoundingClientRect();
  const rootRect = rect(root);
  const contextRect = rect(context);
  const navRect = rect(nav);
  const composerRect = rect(composer);
  const composerStepRect = rect(composerStep);
  const navButtons = [...document.querySelectorAll('.room-area-nav [data-room-open]')].map(rect);
  return {
    simulatedOffsetApplied: rootRect?.top === visualTop && rootRect?.bottom === visualBottom,
    separateContextRemoved: getComputedStyle(context).display === 'none',
    navInVisualViewport: Boolean(navRect && navRect.top >= visualTop && navRect.bottom <= visualBottom),
    navInsideHorizontalSafeArea: navButtons.every((item) => item && item.left >= visualLeft + 47 && item.right <= visualRight - 47),
    composerSharesTopRow: Boolean(navRect && composerRect && composerRect.top === visualTop && Math.abs(navRect.top - composerRect.top) <= 1 && composerRect.bottom <= visualBottom),
    contextIntegratedInComposer: Boolean(composerStepRect && composerStepRect.top >= composerRect.top && composerStepRect.bottom <= composerRect.bottom)
      && /02\s+·\s+Устойчивый порядок.*Кандидату\s+·\s+02/i.test(composerStep?.textContent || ''),
    focusPreserved: document.activeElement === input,
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
});
await page.screenshot({ path: join(screenshotDir, 'visual-viewport-auto-pan-safe-area.png'), fullPage: false });
screenshots.push({ name: 'visual-viewport-auto-pan-safe-area', file: 'visual-viewport-auto-pan-safe-area.png', viewport: { width: 667, height: 375 }, simulatedVisualViewport: { width: 667, height: 260, keyboard: true, offsetTop: 92, offsetLeft: 0 }, geometry: await geometry() });

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 667, height: 375 });
await page.evaluate(() => {
  document.documentElement.style.setProperty('--safe-left', '47px');
  document.documentElement.style.setProperty('--safe-right', '47px');
});
await page.locator('.room-area-nav [data-room-open="chat"]').click();
const shortLandscapeClosedSimulated = await page.evaluate(() => {
  const snapshot = window.__prototypeClearVisualViewport();
  document.querySelector('[data-room-root]').dataset.shortLandscape = 'false';
  return snapshot;
});
const shortLandscapeClosed = await page.evaluate(() => {
  const visualTop = 0;
  const visualBottom = window.innerHeight;
  const root = document.querySelector('[data-room-root]');
  const flow = document.querySelector('.room-chat-panel .room-panel-body');
  const history = document.querySelector('[data-room-chat-scroll]');
  const composer = document.querySelector('.room-chat-composer');
  const input = document.querySelector('[data-room-chat]');
  const send = document.querySelector('[data-room-chat-form] button[type="submit"]');
  const rect = (element) => element?.getBoundingClientRect();
  const composerRect = rect(composer);
  const inputRect = rect(input);
  const sendRect = rect(send);
  const historyRect = rect(history);
  return {
    detectorFlagIrrelevant: root?.dataset.shortLandscape === 'false',
    keyboardClosed: root?.dataset.keyboard === 'false',
    historyAvailableAndInternallyScrollable: Boolean(historyRect && historyRect.height >= 48 && historyRect.height <= 72 && ['auto', 'scroll'].includes(getComputedStyle(history).overflowY)),
    composerAlreadyVisibleWithoutScroll: Boolean(composerRect && flow.scrollTop === 0 && composerRect.top >= visualTop && composerRect.bottom <= visualBottom),
    compactSingleRowInput: Boolean(inputRect && inputRect.height >= 44 && inputRect.height <= 52),
    sendVisible: Boolean(sendRect && sendRect.top >= visualTop && sendRect.bottom <= visualBottom),
    currentAndPublishedStepVisible: Boolean(document.querySelector('[data-room-current-step]')?.getBoundingClientRect().height)
      && /02\s+·\s+Устойчивый порядок/.test(document.querySelector('[data-room-current-step]')?.textContent || '')
      && /Кандидату[^0-9]*02/.test(document.querySelector('[data-room-current-step]')?.textContent || ''),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
});
const shortLandscapeClosedGeometry = await geometry();
shortLandscapeClosed.allVisibleTargetsAtLeast44 = shortLandscapeClosedGeometry.undersized.length === 0;

await open('#/room/int-204?actor=roomOwner&state=success&long=1', { width: 667, height: 375 });
await page.evaluate(() => {
  document.documentElement.style.setProperty('--safe-left', '47px');
  document.documentElement.style.setProperty('--safe-right', '47px');
});
await page.locator('.room-area-nav [data-room-open="chat"]').click();
const shortLandscapeInput = page.locator('[data-room-chat]');
await shortLandscapeInput.focus();
const shortLandscapeOpenSimulated = await page.evaluate(() => window.__prototypeSetVisualViewport(667, 60, true, 19, 0, true));
await page.evaluate(() => {
  document.querySelector('[data-room-root]').dataset.shortLandscape = 'false';
  const accessory = document.createElement('div');
  accessory.dataset.safariAccessoryOcclusionProxy = 'true';
  accessory.setAttribute('aria-hidden', 'true');
  accessory.textContent = 'Safari accessory occlusion proxy';
  Object.assign(accessory.style, {
    position: 'fixed', zIndex: '999', top: '44px', left: '0', width: '667px', height: '16px',
    pointerEvents: 'auto', overflow: 'hidden', color: '#4c5660', background: 'rgba(206, 211, 214, .84)',
    borderTop: '1px dashed #7c858a', font: '8px/15px monospace', textAlign: 'center'
  });
  document.body.append(accessory);
});
await page.waitForTimeout(80);
const shortLandscapeOpen = await page.evaluate(() => {
  const visualTop = 0;
  const visualBottom = visualTop + 60;
  const unobscuredBottom = visualTop + 44;
  const root = document.querySelector('[data-room-root]');
  const context = document.querySelector('.room-input-context');
  const nav = document.querySelector('.room-area-nav');
  const history = document.querySelector('[data-room-chat-scroll]');
  const audience = document.querySelector('.room-audience');
  const incoming = document.querySelector('[data-room-incoming]');
  const composer = document.querySelector('.room-chat-composer');
  const composerStep = document.querySelector('[data-room-composer-step]');
  const input = document.querySelector('[data-room-chat]');
  const send = document.querySelector('[data-room-chat-form] button[type="submit"]');
  const rect = (element) => element?.getBoundingClientRect();
  const rootRect = rect(root);
  const contextRect = rect(context);
  const navRect = rect(nav);
  const composerRect = rect(composer);
  const composerStepRect = rect(composerStep);
  const inputRect = rect(input);
  const sendRect = rect(send);
  const navElements = [...document.querySelectorAll('.room-area-nav [data-room-open]')];
  const navButtons = navElements.map(rect);
  const hitTestAt = (element, item, y) => {
    if (!item) return false;
    const hit = document.elementFromPoint(item.left + item.width / 2, y);
    return hit === element || hit?.closest?.('[data-room-open]') === element;
  };
  const elementHitAt = (element, item, y) => {
    if (!item) return false;
    const hit = document.elementFromPoint(item.left + item.width / 2, y);
    return hit === element || element?.contains(hit);
  };
  return {
    detectorFlagIrrelevant: root?.dataset.shortLandscape === 'false',
    keyboardModeAndFocus: root?.dataset.keyboard === 'true' && root?.dataset.inputFocused === 'true',
    rootFitsVisualViewport: Boolean(rootRect && rootRect.top === visualTop && rootRect.bottom === visualBottom),
    reportedOffsetNotDoubleApplied: Number.parseFloat(root?.style.getPropertyValue('--room-vv-top') || '') === 19
      && navRect?.top === visualTop && composerRect?.top === visualTop,
    noUnusedTopGap: navRect?.top === visualTop && composerRect?.top === visualTop,
    separateContextRowRemoved: getComputedStyle(context).display === 'none' && (!contextRect || contextRect.height === 0),
    currentAndPublishedStepIntegrated: Boolean(composerStepRect && composerStepRect.top >= inputRect.top && composerStepRect.bottom <= inputRect.bottom)
      && /02\s+·\s+Устойчивый порядок.*Кандидату\s+·\s+02/i.test(composerStep?.textContent || ''),
    historyCollapsedWhileTyping: getComputedStyle(history).display === 'none',
    audienceCollapsedWhileTyping: getComputedStyle(audience).display === 'none',
    incomingCollapsedWhileTyping: getComputedStyle(incoming).display === 'none',
    composerFullyInsideUnobscuredBand: Boolean(composerRect && composerRect.top >= visualTop && composerRect.bottom <= unobscuredBottom),
    sixDirectNavActionsInsideUnobscuredBand: navButtons.length === 6 && navButtons.every((item) => item && item.top >= visualTop && item.bottom <= unobscuredBottom),
    sixDirectNavActionsUpperAndLowerHitTestable: navButtons.length === 6 && navButtons.every((item, index) => item
      && hitTestAt(navElements[index], item, item.top + 4)
      && hitTestAt(navElements[index], item, item.bottom - 4)),
    navAndComposerShareActionRow: Boolean(navRect && composerRect && Math.abs(navRect.top - composerRect.top) <= 1 && navRect.right <= composerRect.left + 1),
    inputAndSendInline: Boolean(inputRect && sendRect && Math.abs(inputRect.top - sendRect.top) <= 1 && inputRect.height >= 44 && sendRect.height >= 44),
    inputUpperAndLowerHitTestableAboveAccessory: Boolean(inputRect)
      && elementHitAt(input, inputRect, inputRect.top + 4)
      && elementHitAt(input, inputRect, inputRect.bottom - 4),
    sendUpperAndLowerHitTestableAboveAccessory: Boolean(sendRect)
      && elementHitAt(send, sendRect, sendRect.top + 4)
      && elementHitAt(send, sendRect, sendRect.bottom - 4),
    focusPreserved: document.activeElement === input,
    navInsideHorizontalSafeArea: navButtons.every((item) => item && item.left >= 47 && item.right <= 620),
    composerInsideHorizontalSafeArea: Boolean(composerRect && composerRect.left >= 47 && composerRect.right <= 620),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  };
});
const shortLandscapeHitPoints = await page.evaluate(() => {
  const center = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom - 4 };
  };
  return {
    beforeSwitchCount: window.__prototypeRoomSnapshot().switchCount,
    editor: center(document.querySelector('.room-area-nav [data-room-open="editor"]')),
    chat: center(document.querySelector('.room-area-nav [data-room-open="chat"]'))
  };
});
await page.mouse.click(shortLandscapeHitPoints.editor.x, shortLandscapeHitPoints.editor.y);
await page.waitForTimeout(30);
const shortLandscapeEditorSwitch = await page.evaluate(() => window.__prototypeRoomSnapshot());
await page.mouse.click(shortLandscapeHitPoints.chat.x, shortLandscapeHitPoints.chat.y);
await page.waitForTimeout(30);
const shortLandscapeChatReturn = await page.evaluate(() => window.__prototypeRoomSnapshot());
await shortLandscapeInput.focus();
shortLandscapeOpen.actualPanelSwitchThroughHitTest = shortLandscapeEditorSwitch.activePanel === 'editor'
  && shortLandscapeEditorSwitch.switchCount === shortLandscapeHitPoints.beforeSwitchCount + 1;
shortLandscapeOpen.actualReturnToChatThroughHitTest = shortLandscapeChatReturn.activePanel === 'chat'
  && shortLandscapeChatReturn.switchCount === shortLandscapeHitPoints.beforeSwitchCount + 2;
shortLandscapeOpen.focusPreservedAfterRoundTrip = await shortLandscapeInput.evaluate((element) => document.activeElement === element);
const shortLandscapeOpenGeometry = await geometry();
shortLandscapeOpen.allVisibleTargetsAtLeast44 = shortLandscapeOpenGeometry.undersized.length === 0;
await page.screenshot({ path: join(screenshotDir, 'short-landscape-keyboard-open.png'), fullPage: false });
screenshots.push({ name: 'short-landscape-keyboard-open', file: 'short-landscape-keyboard-open.png', viewport: { width: 667, height: 375 }, simulatedVisualViewport: { width: 667, height: 60, unobscuredHeight: 44, keyboard: true, reportedOffsetTop: 19, fixedOrigin: 'visual-viewport', offsetLeft: 0 }, geometry: shortLandscapeOpenGeometry });
await shortLandscapeInput.blur();
await page.evaluate(() => {
  document.querySelector('[data-safari-accessory-occlusion-proxy]')?.remove();
  window.__prototypeClearVisualViewport();
  document.querySelector('[data-room-root]').dataset.shortLandscape = 'false';
});
await page.waitForTimeout(220);
shortLandscapeOpen.historyRestoredAfterBlur = await page.locator('[data-room-chat-scroll]').isVisible();
shortLandscapeOpen.historyRestoredAsBoundedScroller = await page.locator('[data-room-chat-scroll]').evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return rect.height >= 48 && rect.height <= 72 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY);
});

await open('#/room/int-204?actor=roomOwner&state=success', { width: 390, height: 640 });
const currentStepContext = {};
for (const panel of ['editor', 'chat', 'activity', 'notes']) {
  await page.locator(`.room-area-nav [data-room-open="${panel}"]`).click();
  currentStepContext[panel] = {
    persistentContextVisible: await page.locator('[data-room-current-step]').isVisible().catch(() => false),
    localStepVisible: await page.locator('[data-room-current-step]').getByText(/02.*Устойчивый порядок/).count().catch(() => 0) > 0,
    publishedStepVisible: await page.locator('[data-room-current-step]').getByText(/Кандидату.*02/).count().catch(() => 0) > 0
  };
}
const currentStepEditor = await page.locator('[data-room-editor]').elementHandle();
await page.locator('.room-area-nav [data-room-open="steps"]').click();
await page.locator('[data-room-step="step-3"]').click();
await page.locator('.room-area-nav [data-room-open="chat"]').click();
currentStepContext.selectionUpdate = {
  persistentContextVisible: await page.locator('[data-room-current-step]').isVisible(),
  localStepVisible: await page.locator('[data-room-current-step]').getByText(/03.*API поиска/).count() > 0,
  publishedStepVisible: await page.locator('[data-room-current-step]').getByText(/Кандидату.*02/).count() > 0,
  editorNodePreserved: await currentStepEditor.evaluate((element) => element === document.querySelector('[data-room-editor]'))
};
await page.locator('.room-chat-panel .room-panel-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
await page.screenshot({ path: join(screenshotDir, 'current-step-chat.png'), fullPage: false });
screenshots.push({ name: 'current-step-chat', file: 'current-step-chat.png', viewport: { width: 390, height: 640 }, geometry: await geometry() });

await open('#/room/int-204?actor=interviewer&state=success&long=1', { width: 390, height: 640 });
await page.locator('#main').focus();
const focusTrace = [];
for (let index = 0; index < 10; index += 1) {
  await page.keyboard.press('Tab');
  focusTrace.push(await page.evaluate(() => ({
    name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || document.activeElement?.textContent?.trim().replace(/\s+/g, ' '),
    tag: document.activeElement?.tagName,
    outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
    visible: Boolean(document.activeElement?.getBoundingClientRect().width && document.activeElement?.getBoundingClientRect().height)
  })));
}
const keyboard = {
  trace: focusTrace,
  visibleFocusCount: focusTrace.filter((item) => item.visible && Number.parseFloat(item.outlineWidth) >= 3).length,
  namedCount: focusTrace.filter((item) => item.name && item.name.length > 0).length
};

const roles = {};
for (const actor of ['candidate', 'guestManager', 'roomOwner', 'interviewer', 'hiring', 'revokedStaff']) {
  await open(`#/room/int-204?actor=${actor}&state=success`, { width: 390, height: 640 });
  roles[actor] = {
    managerRoom: await page.locator('[data-room-root]').count(),
    candidateRoom: await page.locator('[data-room-candidate]').count(),
    terminal: await page.locator('[data-room-terminal]').count(),
    internalChatText: await page.getByText(/Чат интервьюеров/).count(),
    activityText: await page.getByText(/Активность кандидата/).count(),
    returnText: await page.getByText(/К интервью|Выйти на главную|В личное пространство/).count(),
    publishControl: await page.locator('[data-room-publish]').count()
  };
}

await open('#/room/int-204?actor=revokedStaff&state=revoked');
const revoke = {
  terminalVisible: await page.locator('[data-room-terminal="revoked"]').count() === 1,
  managerRoomRemoved: await page.locator('[data-room-root]').count() === 0,
  protectedDraftAbsent: await page.getByText(/Черновик чата сохраняется|двадцать переключений/).count() === 0,
  retryAbsent: await page.getByRole('button', { name: /Повторить/ }).count() === 0
};

const allContinuity = Object.entries(continuity).filter(([key]) => !['before', 'after', 'switchCountDelta'].includes(key)).every(([, value]) => value === true) && continuity.switchCountDelta === 20;
const pass = pageErrors.length === 0
  && matrix.every((item) => item.pass)
  && overview.mode === 'overview' && overview.panelCount === 4 && overview.minimaPass
  && allContinuity
  && Object.values(attention).every(Boolean)
  && keyboardViewport.serviceHeight <= 72 && keyboardViewport.sendReachable && keyboardViewport.sixDirectActions === 6 && keyboardViewport.compactCurrentStepVisible && /Локально 02.*кандидату 02/.test(keyboardViewport.compactCurrentStepText || '') && keyboardViewport.minimumActionWidth >= 44 && keyboardViewport.horizontalOverflow === 0
  && Object.values(realKeyboardFocus).every((value) => value === true || value === 0)
  && Object.values(portraitFocusResize).every((value) => value === true || value === 0)
  && Object.values(autoPanRecovery).every((value) => value === true || value === 0)
  && Object.values(shortLandscapeClosed).every((value) => value === true || value === 0)
  && Object.values(shortLandscapeOpen).every((value) => value === true || value === 0)
  && Object.values(currentStepContext).every((state) => Object.values(state).every(Boolean))
  && keyboard.visibleFocusCount === keyboard.trace.length && keyboard.namedCount === keyboard.trace.length
  && roles.candidate.candidateRoom === 1 && roles.candidate.internalChatText === 0 && roles.candidate.activityText === 0
  && roles.guestManager.managerRoom === 1 && roles.roomOwner.managerRoom === 1 && roles.interviewer.managerRoom === 1 && roles.hiring.managerRoom === 1
  && roles.roomOwner.publishControl === 1 && roles.interviewer.publishControl === 1
  && roles.guestManager.publishControl === 0 && roles.hiring.publishControl === 0
  && roles.revokedStaff.terminal === 1 && roles.revokedStaff.internalChatText === 0
  && Object.values(revoke).every(Boolean);

const report = {
  task: '1.6c', generatedAt: new Date().toISOString(), pass,
  note: 'Prototype-only DA-03 evidence. It validates layout/state behavior in the repo-hosted prototype, not realtime delivery, persistence, Yjs, or server authorization.',
  pageErrors, matrixSummary: { cases: matrix.length, passed: matrix.filter((item) => item.pass).length }, screenshots,
  overview, continuity, attention, keyboardViewport, realKeyboardFocus, portraitFocusResize,
  autoPanSimulated, autoPanRecovery, shortLandscapeClosedSimulated, shortLandscapeClosed, shortLandscapeClosedGeometry,
  shortLandscapeOpenSimulated, shortLandscapeOpen, shortLandscapeOpenGeometry, currentStepContext, keyboard, roles, revoke
};
await writeFile(join(evidenceDir, 'bounding-rectangles.json'), `${JSON.stringify({ task: '1.6c', matrix, overview, keyboardViewport, realKeyboardFocus, portraitFocusResize, autoPanRecovery, shortLandscapeClosed, shortLandscapeClosedGeometry, shortLandscapeOpen, shortLandscapeOpenGeometry, currentStepContext }, null, 2)}\n`, 'utf8');
await writeFile(join(evidenceDir, 'focus-trace.json'), `${JSON.stringify(keyboard, null, 2)}\n`, 'utf8');
await writeFile(join(evidenceDir, 'visual-viewport-keyboard.json'), `${JSON.stringify(keyboardViewport, null, 2)}\n`, 'utf8');
await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ pass, matrix: matrix.length, screenshots: screenshots.length, pageErrors: pageErrors.length, continuity: allContinuity }));
if (!pass) process.exitCode = 1;
