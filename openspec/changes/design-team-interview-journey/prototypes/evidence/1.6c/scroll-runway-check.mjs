import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const baseUrl = process.env.PROTOTYPE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 667, height: 375 } });
page.setDefaultTimeout(5000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const cases = [];
for (const safeArea of [
  { name: 'island-left', left: 47, right: 0 },
  { name: 'island-right', left: 0, right: 47 }
]) {
  const target = new URL(baseUrl);
  target.searchParams.set('scroll_runway', safeArea.name);
  target.hash = '/room/int-204?actor=roomOwner&state=success&long=1';
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ left, right }) => {
    document.documentElement.style.setProperty('--safe-left', `${left}px`);
    document.documentElement.style.setProperty('--safe-right', `${right}px`);
  }, safeArea);
  await page.locator('.room-area-nav [data-room-open="chat"]').click();
  const input = page.locator('[data-room-chat]');
  await input.fill(`Черновик runway · ${safeArea.name}`);
  await input.focus();
  await page.evaluate(() => window.__prototypeSetVisualViewport(667, 24, true, 0, 0, true));
  await page.waitForTimeout(80);

  const before = await page.evaluate(({ left, right }) => {
    const root = document.querySelector('[data-room-root]');
    return {
      keyboard: root?.dataset.keyboard,
      stabilized: root?.dataset.chromeStabilized,
      scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      draft: document.querySelector('[data-room-chat]')?.value,
      focus: document.activeElement === document.querySelector('[data-room-chat]'),
      unobscuredHeight: 24,
      safeArea: { left, right }
    };
  }, safeArea);

  // Exactly one ordinary upward gesture. The visualViewport expansion below is
  // conditional on real document movement, matching Safari chrome collapse.
  await page.mouse.move(400, 20);
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(120);
  const moved = await page.evaluate(() => scrollY > 0);
  if (moved) {
    await page.evaluate(() => window.__prototypeSetVisualViewport(667, 60, true, 0, 0, true));
    await page.waitForTimeout(120);
  }

  const after = await page.evaluate(({ left, right }) => {
    const root = document.querySelector('[data-room-root]');
    const nav = document.querySelector('.room-area-nav');
    const composer = document.querySelector('.room-chat-composer');
    const input = document.querySelector('[data-room-chat]');
    const send = document.querySelector('[data-room-chat-form] button[type="submit"]');
    const navElements = [...document.querySelectorAll('.room-area-nav [data-room-open]')];
    const boxes = navElements.map((element) => ({ element, box: element.getBoundingClientRect() }));
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? Object.fromEntries(['top', 'bottom', 'left', 'right', 'width', 'height'].map((key) => [key, Math.round(box[key] * 100) / 100])) : null;
    };
    const hit = (element, x, y) => {
      const found = document.elementFromPoint(x, y);
      return found === element || element?.contains(found);
    };
    const elementBox = (element) => element?.getBoundingClientRect();
    const inputBox = elementBox(input);
    const sendBox = elementBox(send);
    const navBox = elementBox(nav);
    const composerBox = elementBox(composer);
    return {
      keyboard: root?.dataset.keyboard,
      stabilized: root?.dataset.chromeStabilized,
      gestureCount: Number(root?.dataset.chromeGestureCount || 0),
      scrollY,
      visualHeight: Number.parseFloat(root?.style.getPropertyValue('--room-vv-height') || '0'),
      nav: rect(nav),
      composer: rect(composer),
      input: rect(input),
      send: rect(send),
      focus: document.activeElement === input,
      draft: input?.value,
      sixNav: boxes.length === 6,
      fullNavBoxes: boxes.every(({ box }) => box.width >= 44 && box.height >= 44 && box.top >= 0 && box.bottom <= 44),
      navUpperLowerHits: boxes.every(({ element, box }) => hit(element, box.left + box.width / 2, box.top + 4) && hit(element, box.left + box.width / 2, box.bottom - 4)),
      fullInputBox: Boolean(inputBox && inputBox.width >= 44 && inputBox.height >= 44 && inputBox.top >= 0 && inputBox.bottom <= 44),
      inputUpperLowerHits: Boolean(inputBox && hit(input, inputBox.left + inputBox.width / 2, inputBox.top + 4) && hit(input, inputBox.left + inputBox.width / 2, inputBox.bottom - 4)),
      fullSendBox: Boolean(sendBox && sendBox.width >= 44 && sendBox.height >= 44 && sendBox.top >= 0 && sendBox.bottom <= 44),
      sendUpperLowerHits: Boolean(sendBox && hit(send, sendBox.left + sendBox.width / 2, sendBox.top + 4) && hit(send, sendBox.left + sendBox.width / 2, sendBox.bottom - 4)),
      sameRow: Boolean(navBox && composerBox && Math.abs(navBox.top - composerBox.top) <= 1 && navBox.right <= composerBox.left + 1),
      safeHorizontal: boxes.every(({ box }) => box.left >= left && box.right <= 667 - right)
        && Boolean(composerBox && composerBox.left >= left && composerBox.right <= 667 - right),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    };
  }, safeArea);

  let roundTrip = { passed: false };
  if (moved && after.navUpperLowerHits) {
    const beforeSnapshot = await page.evaluate(() => window.__prototypeRoomSnapshot());
    const editor = page.locator('.room-area-nav [data-room-open="editor"]');
    const editorBox = await editor.boundingBox();
    await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height - 4);
    await page.waitForTimeout(30);
    const editorSnapshot = await page.evaluate(() => window.__prototypeRoomSnapshot());
    const chat = page.locator('.room-area-nav [data-room-open="chat"]');
    const chatBox = await chat.boundingBox();
    await page.mouse.click(chatBox.x + chatBox.width / 2, chatBox.y + chatBox.height - 4);
    await page.waitForTimeout(30);
    await input.focus();
    const chatSnapshot = await page.evaluate(() => window.__prototypeRoomSnapshot());
    roundTrip = {
      passed: editorSnapshot.activePanel === 'editor' && chatSnapshot.activePanel === 'chat'
        && chatSnapshot.chatDraft === beforeSnapshot.chatDraft
        && chatSnapshot.editorInstanceId === beforeSnapshot.editorInstanceId
        && chatSnapshot.sessionId === beforeSnapshot.sessionId,
      editorPanel: editorSnapshot.activePanel,
      chatPanel: chatSnapshot.activePanel,
      draftPreserved: chatSnapshot.chatDraft === beforeSnapshot.chatDraft,
      editorPreserved: chatSnapshot.editorInstanceId === beforeSnapshot.editorInstanceId,
      sessionPreserved: chatSnapshot.sessionId === beforeSnapshot.sessionId
    };
  }

  const pass = before.unobscuredHeight < 44
    && before.keyboard === 'true' && before.focus
    && before.scrollHeight > before.clientHeight && !['hidden', 'clip'].includes(before.bodyOverflowY)
    && moved && after.scrollY > 0 && after.keyboard === 'true' && after.stabilized === 'true'
    && after.gestureCount === 1 && after.visualHeight >= 44
    && after.focus && after.draft === before.draft
    && after.sixNav && after.fullNavBoxes && after.navUpperLowerHits
    && after.fullInputBox && after.inputUpperLowerHits
    && after.fullSendBox && after.sendUpperLowerHits
    && after.sameRow && after.safeHorizontal && after.horizontalOverflow === 0
    && roundTrip.passed;
  cases.push({ safeArea, before, movedAfterOneGesture: moved, after, roundTrip, pass });
}

const report = {
  task: '1.6c-scroll-runway',
  generatedAt: new Date().toISOString(),
  note: 'Prototype-only deterministic model of the accepted one-gesture Safari chrome-collapse path; real Safari remains the 1.6g gate.',
  pageErrors,
  cases,
  pass: pageErrors.length === 0 && cases.every((item) => item.pass)
};
await writeFile(join(evidenceDir, 'scroll-runway-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(JSON.stringify({ pass: report.pass, cases: cases.map((item) => ({ name: item.safeArea.name, pass: item.pass, moved: item.movedAfterOneGesture, stabilized: item.after.stabilized })) }));
if (!report.pass) process.exitCode = 1;
