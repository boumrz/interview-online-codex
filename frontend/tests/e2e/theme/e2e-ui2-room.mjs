import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('room editors, steps, participants and notes follow both themes without losing the document', async () => {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
  const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'UI.2 редактор', ownerDisplayName: 'Владелец UI.2', language: 'nodejs' }) });
  assert.ok(response.ok);
  const room = await response.json();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(({ inviteCode, ownerToken }) => { localStorage.setItem(`owner_token_${inviteCode}`, ownerToken); localStorage.setItem(`guest_display_name_${inviteCode}`, 'Владелец UI.2'); }, room);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
    const fallbackEditor = page.getByTestId('room-code-editor-host').locator('.cm-editor');
    await fallbackEditor.waitFor();
    assert.equal(await page.getByTestId('room-published-step-status').count(), 0, 'duplicate published step label must be removed');
    const initialCode = await fallbackEditor.locator('.cm-content').innerText();
    const codeInput = fallbackEditor.locator('.cm-content');
    await codeInput.click();
    await codeInput.press('ControlOrMeta+End');
    await codeInput.press('End');
    await page.keyboard.insertText('// UI.2 theme retention');
    const code = await codeInput.innerText();
    const editorState = await page.getByTestId('room-code-editor-host').evaluate(host => {
      const view = host.__roomEditorView;
      window.__ui2View = view;
      return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
    });

    await page.evaluate(() => { window.__ui2Editor = document.querySelector('.cm-editor'); });
    for (const mode of ['light', 'dark', 'light']) {
      await page.evaluate(mode => { localStorage.setItem('interview-online:ui-theme', mode); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })); }, mode);
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.cm-editor')).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue('--app-editor-bg').trim() || (() => { const probe = document.createElement('span'); probe.style.color = 'var(--app-editor-bg)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(document.querySelector('.cm-editor')).backgroundColor === color; })());
      assert.equal(await page.evaluate(() => window.__ui2Editor === document.querySelector('.cm-editor')), true, 'theme must keep the editor instance');
      assert.equal(await fallbackEditor.locator('.cm-content').innerText(), code);
      assert.deepEqual(await page.getByTestId('room-code-editor-host').evaluate(host => ({ anchor: host.__roomEditorView.state.selection.main.anchor, head: host.__roomEditorView.state.selection.main.head })), editorState);
      assert.equal(await page.getByTestId('room-code-editor-host').evaluate(host => host.__roomEditorView === window.__ui2View), true);

    }
    await codeInput.press('ControlOrMeta+z');
    assert.equal(await codeInput.innerText(), initialCode, 'undo history survives theme changes');
    const candidateContext = await browser.newContext();
    await candidateContext.addInitScript(({ inviteCode }) => localStorage.setItem(`guest_display_name_${inviteCode}`, 'Кандидат UI.2'), room);
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto(`${base}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
    await candidatePage.getByTestId('room-code-editor-host').locator('.cm-editor').waitFor();
    const participant = page.getByRole('button', { name: /^Кандидат UI.2,/ });
    await participant.waitFor();
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => { localStorage.setItem('interview-online:ui-theme', mode); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })); }, mode);
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
      const nameColor = await participant.evaluate(el => getComputedStyle(el.querySelector('span')).color);
      await participant.hover();
      assert.equal(await participant.evaluate(el => getComputedStyle(el.querySelector('span')).color), nameColor, 'participant hover keeps readable text');
      assert.equal(Math.round((await participant.boundingBox()).height), 32);
      await page.getByTestId('participants-help-hint').hover();
      await page.getByRole('tooltip', { name: 'Нажмите на участника, чтобы открыть доступные действия' }).waitFor();
      await participant.focus();
      await participant.press('Enter');
      const assign = page.getByRole('menuitem', { name: 'Назначить интервьюером' });
      await assign.waitFor();
      await assign.hover();
      await page.waitForFunction(() => {
        const item = document.querySelector('.ant-dropdown-menu-item');
        return item && getComputedStyle(item).backgroundColor !== 'rgba(0, 0, 0, 0)';
      });
      await page.keyboard.press('Escape');
      await assign.waitFor({ state: 'hidden' });
      await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
      const row = page.getByTestId('room-step-row-0');
      await row.hover();
      const style = await row.evaluate(element => { const s = getComputedStyle(element); return { background: s.backgroundColor, border: s.borderTopWidth, outline: s.outlineStyle }; });
      assert.equal(style.background, 'rgba(0, 0, 0, 0)', 'outer row owns fill');
      assert.equal(style.border, '0px');
      assert.equal(style.outline, 'none');
      await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
      await page.getByTestId('room-private-notes-export').waitFor();
      const exportBox = await page.getByTestId('room-private-notes-export').boundingBox();
      assert.ok(exportBox && exportBox.height >= 32);
      if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
      const markdown = page.getByRole("region", {name:"Условие", exact:true}).getByTestId('room-markdown-editor').locator('.cm-editor');
      if (await markdown.count()) {
        await markdown.waitFor();
        assert.equal(await markdown.evaluate(el => getComputedStyle(el).backgroundColor), await fallbackEditor.evaluate(el => getComputedStyle(el).backgroundColor));
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
