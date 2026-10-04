import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
async function request(path, body, room) {
  const response = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(room ? { 'X-Room-Owner-Token': room.ownerToken } : {}) }, body: JSON.stringify(body) });
  assert.ok(response.ok, `own fixture ${path}: HTTP ${response.status}`);
  return response.json();
}
async function exportedMarkdown(page) {
  await page.getByTestId('room-private-notes-export').click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать .md', exact: true }).click();
  const content = await readFile(await (await downloading).path(), 'utf8');
  await page.keyboard.press('Escape');
  return content;
}
for (const transition of ['finished', 'frozen']) for (const kind of ['private', 'chat']) {
  test(transition === 'finished'
    ? `finished owner delivers queued ${kind} text and preserves the next draft`
    : `frontend frozen state_sync contract retains cancelled ${kind} text without confirmed history`, async () => {
    const room = await request('/public/rooms', { title: `Queued ${kind} ${transition} regression`, ownerDisplayName: 'Queue owner', language: 'nodejs' });
    const browser = await chromium.launch();
    let release; const gate = new Promise(resolve => { release = resolve; });
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
      await context.addInitScript(room => {
        localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
        localStorage.setItem(`guest_display_name_${room.inviteCode}`, 'Queue owner');
        // Frozen cases inject only lifecycle status into real SSE state_sync.
        // This verifies frontend cancellation, not server freeze permissions.
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
          set onmessage(handler) {
            let latestState;
            let forceFrozen = false;
            window.__emitFrozenRoomState = () => {
              if (!latestState) return false;
              forceFrozen = true;
              handler(new MessageEvent('message', { data: JSON.stringify({ ...latestState, payload: { ...latestState.payload, status: 'frozen' } }) }));
              return true;
            };
            super.onmessage = event => {
              const message = JSON.parse(event.data);
              if (message.type === 'state_sync') latestState = message;
              if (message.type === 'state_sync' && forceFrozen) {
                handler(new MessageEvent('message', { data: JSON.stringify({ ...message, payload: { ...message.payload, status: 'frozen' } }) }));
              } else handler(event);
            };
          }
        };
      }, room);
      const page = await context.newPage();
      await page.goto(`${web}/room/${room.inviteCode}`);
      await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
      let acknowledge; const accepted = new Promise(resolve => { acknowledge = resolve; });
      let gated = false; const relayEvents = [];
      await page.route('**/api/realtime/rooms/*/events', async route => {
        const event = route.request().postDataJSON();
        relayEvents.push({ type: event?.type, hasDelta: !!event?.yjsUpdate });
        if (event?.type !== 'yjs_update' || !event.yjsUpdate || gated) return route.continue();
        gated = true;
        const response = await route.fetch();
        assert.ok(response.ok(), 'Yjs gate must hold an already accepted update');
        acknowledge();
        await gate;
        await route.fulfill({ response });
      });
      await page.getByTestId('room-code-editor-host').locator('.cm-content').fill('const queueGate = 1;');
      await Promise.race([accepted, new Promise((_, reject) => setTimeout(() => reject(new Error(`Yjs gate not reached: ${JSON.stringify(relayEvents)}`)), 5000))]);
      await page.getByRole('tab', { name: kind === 'private' ? 'Мои заметки' : 'Чат', exact: true }).click();
      const input = page.getByTestId(kind === 'private' ? 'room-private-notes-input' : 'room-notes-input');
      const send = page.getByTestId(kind === 'private' ? 'room-private-notes-send' : 'room-notes-send');
      const queuedText = `Текст в очереди ${kind} ${transition}`;
      await input.fill(queuedText);
      await send.click();
      assert.equal(await input.inputValue(), '', 'entry is queued behind the held editor ACK');
      const nextDraft = 'Следующий несохранённый черновик';
      await input.fill(nextDraft);
      if (kind === 'private') assert.equal((await exportedMarkdown(page)).includes(queuedText), false, 'pending entry is excluded from confirmed-history export');
      const surface = page.locator(`[data-room-context-surface="${kind === 'private' ? 'notes' : 'chat'}"]`);
      if (transition === 'finished') {
        await request(`/rooms/${room.inviteCode}/verdict`, { verdict: 'HIRE' }, room);
        const stored = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === (kind === 'private' ? 'private_note_entry' : 'note_message'));
        // The client defers state_sync while an editor ACK is unresolved.
        // Release after the server finishes, before waiting for its UI status.
        release();
        assert.ok((await stored).ok(), 'queued manager text is accepted after finishing');
        await page.getByText(/Интервью завершено/).first().waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await input.getAttribute('readonly'), null, 'finished owner composer must stay writable');
        await page.waitForFunction(({ selector, text }) => {
          const cards = [...document.querySelectorAll(`${selector} article`)].filter(card => card.textContent.includes(text));
          return cards.length === 1 && !/Не сохранено|Не отправлено|Сохранение|Отправка|Сохраняем|Отправляем/.test(cards[0].textContent);
        }, { selector: `[data-room-context-surface="${kind === 'private' ? 'notes' : 'chat'}"]`, text: queuedText });
        assert.equal(await input.inputValue(), nextDraft, 'ACK preserves the subsequent draft exactly');
        await page.waitForFunction(testId => {
          const button = document.querySelector(`[data-testid="${testId}"]`);
          return button && !button.disabled;
        }, kind === 'private' ? 'room-private-notes-send' : 'room-notes-send', { timeout: 5000 });
        assert.equal(await send.isDisabled(), false, 'confirmed manager delivery must restore the send action');
        assert.equal(await surface.locator('article').filter({ hasText: queuedText }).count(), 1);
        if (kind === 'private') {
          const exported = await exportedMarkdown(page);
          assert.equal(exported.includes(queuedText), true, 'ACKed queued note is included in saved-history export');
          assert.equal(exported.includes(nextDraft), false, 'following unsent draft remains excluded');
        }
        await page.reload();
        await page.getByText(/Интервью завершено/).first().waitFor();
        await page.getByRole('tab', { name: kind === 'private' ? 'Мои заметки' : 'Чат', exact: true }).click();
        await page.locator('article').filter({ hasText: queuedText }).waitFor();
        assert.equal(await page.locator('article').filter({ hasText: queuedText }).count(), 1, 'reload confirms exactly one persisted entry');
        assert.equal(await page.getByTestId(kind === 'private' ? 'room-private-notes-input' : 'room-notes-input').getAttribute('readonly'), null);
      } else {
        assert.equal(await page.evaluate(() => window.__emitFrozenRoomState()), true);
        await page.getByText(/Изменения приостановлены/).first().waitFor();
        assert.equal(await input.getAttribute('readonly'), '', 'frozen always prevents writing');
        release();
        await page.waitForFunction(({ selector, text, draft }) => {
          const input = document.querySelector(selector);
          const cards = [...document.querySelectorAll('article')].filter(card => card.textContent.includes(text));
          return input?.value.includes(draft) && (input.value.includes(text) || cards.some(card => /Не сохранено|Не отправлено/.test(card.textContent)));
        }, { selector: `[data-testid="${kind === 'private' ? 'room-private-notes-input' : 'room-notes-input'}"]`, text: queuedText, draft: nextDraft });
        const restoredDraft = await input.inputValue();
        assert.ok(restoredDraft.includes(nextDraft), 'cancellation preserves the subsequent draft');
        const failedCard = surface.locator('article').filter({ hasText: queuedText }).filter({ hasText: kind === 'private' ? 'Не сохранено' : 'Не отправлено' });
        assert.ok(restoredDraft.includes(queuedText) || await failedCard.count() === 1, 'cancelled text remains a draft or explicitly unsent entry');
        assert.equal(await surface.locator('article').filter({ hasText: queuedText }).count(), await failedCard.count(), 'cancelled entries are not confirmed or indefinitely pending history');
        if (kind === 'private') assert.equal((await exportedMarkdown(page)).includes(queuedText), false);
        await page.reload();
        await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
        await page.getByRole('tab', { name: kind === 'private' ? 'Мои заметки' : 'Чат', exact: true }).click();
        assert.equal(await page.locator('article').filter({ hasText: queuedText }).count(), 0, 'canonical history excludes the cancelled entry');
      }
    } finally { release(); await browser.close(); }
  });
}
