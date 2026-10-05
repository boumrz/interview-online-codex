import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const evidence = process.env.EVIDENCE_DIR ?? '.run/team-settings-typography';

async function create(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `own fixture ${path}: HTTP ${response.status}`);
  return response.json();
}

async function visibleTextBox(locator) {
  await locator.waitFor({ state: 'visible' });
  return locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { x, y, width, height, bottom } = range.getBoundingClientRect();
    return { x, y, width, height, bottom };
  });
}

for (const theme of ['light', 'dark']) {
  test(`team settings separate identity, invitations and roster into readable lines in ${theme}`, async () => {
    const auth = await create('/auth/register', null, {
      nickname: `qatypo_${randomUUID().slice(0, 12).replaceAll('-', '')}`,
      displayName: 'Владелец проверки типографики',
      password: 'test-password-123',
    });
    const { team } = await create('/teams', auth.token, { name: 'Команда проверки типографики' });
    await mkdir(evidence, { recursive: true });
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await context.routeWebSocket('**/ws', socket => socket.close());
      await context.addInitScript(({ auth, theme }) => {
        localStorage.setItem('auth_token', auth.token);
        localStorage.setItem('auth_user', JSON.stringify(auth.user));
        localStorage.setItem('interview-online:ui-theme', theme);
      }, { auth, theme });
      const page = await context.newPage();
      await page.goto(`${web}/workspace/teams/${team.id}/settings`);
      await page.getByRole('button', { name: 'Переименовать команду', exact: true }).waitFor();
      const switcher = page.getByRole('button', {
        name: `Команды: ${team.name}. Сменить команду`, exact: true,
      });
      // The root theme changes before Ant's ConfigProvider has updated all controls.
      // Await the real rendered control color, fonts and two complete paint frames.
      await page.waitForFunction(({ theme, label }) => {
        const control = [...document.querySelectorAll('button')]
          .find(button => button.getAttribute('aria-label') === label);
        if (!control || document.documentElement.dataset.theme !== theme) return false;
        const channels = getComputedStyle(control).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        return channels?.length === 3 && (theme === 'dark'
          ? channels.every(channel => channel < 80)
          : channels.every(channel => channel > 200));
      }, { theme, label: await switcher.getAttribute('aria-label') });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });

      assert.doesNotMatch(await page.getByRole('main').innerText(), /ID команды|УПРАВЛЕНИЕ ДОСТУПОМ/);
      const boxes = {
        name: await visibleTextBox(page.getByRole('main').getByText(team.name, { exact: true })),
        role: await visibleTextBox(page.getByRole('main').getByText('Владелец', { exact: true }).first()),
        invitationTitle: await visibleTextBox(page.getByRole('heading', { name: 'Приглашения', exact: true })),
        rosterTitle: await visibleTextBox(page.getByText('Состав команды', { exact: true })),
      };
      const pairs = [
        ['identity → invitations', { bottom: Math.max(boxes.name.bottom, boxes.role.bottom) }, boxes.invitationTitle],
        ['invitation title → roster', boxes.invitationTitle, boxes.rosterTitle],
      ];
      const gaps = pairs.map(([label, previous, next]) => ({ label, gap: next.y - previous.bottom }));
      await writeFile(`${evidence}/${theme}-measurements.json`, JSON.stringify({ theme, boxes, gaps }, null, 2));
      await page.screenshot({ path: `${evidence}/${theme}-team-settings.png`, fullPage: true });
      const failures = gaps.filter(({ gap }) => gap < 1.5)
        .map(({ label, gap }) => `${theme}/${label}: next line must have visible spacing; actual gap ${gap.toFixed(2)}px`);
      assert.deepEqual(failures, [], failures.join('\n'));
    } finally {
      await browser.close();
    }
  });
}
