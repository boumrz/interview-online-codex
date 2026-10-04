import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const artifacts = new URL('../../../.run/rename-alignment/', import.meta.url);

async function create(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `fixture ${path}: ${response.status}`);
  return response.json();
}

// Use the rendered text's range as well as its element box: flex stretching can
// make the element appear centered while the text itself remains at the top.
async function measure(button, title, completeEditor = false) {
  await button.waitFor();
  return button.evaluate((button, { title, completeEditor }) => {
    const parent = completeEditor ? button : button.parentElement;
    const visibleLabel = completeEditor ? 'Редактировать' : title;
    const text = [...parent.querySelectorAll('*')].find(node => node.children.length === 0 && node.textContent === visibleLabel);
    if (!text) throw new Error(`Cannot find visible title beside pencil: ${title}`);
    const svg = button.querySelector('svg');
    if (!svg && !completeEditor) throw new Error(`Pencil SVG missing: ${title}`);
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height, centerY: y + height / 2 };
    };
    const textRect = rect(text);
    const glyphRect = rect(range);
    const iconRect = rect(svg ?? button);
    const buttonRect = rect(button);
    const styles = getComputedStyle(parent);
    return {
      title, reference: svg ? 'pencil' : 'complete edit action', text: textRect, renderedText: glyphRect, icon: iconRect, button: buttonRect,
      difference: iconRect.centerY - glyphRect.centerY,
      elementDifference: iconRect.centerY - textRect.centerY,
      layout: { display: styles.display, alignItems: styles.alignItems, parentClass: parent.className, textLineHeight: getComputedStyle(text).lineHeight },
    };
  }, { title, completeEditor });
}

const auth = await create('/auth/register', null, { nickname: `uxalign_${Date.now().toString(36)}`, displayName: 'Имя владельца', password: 'test-password-123' });
const { team } = await create('/teams', auth.token, { name: 'Название команды' });
const { task } = await create(`/teams/${team.id}/tasks`, auth.token, { title: 'Название задачи', description: 'Описание задачи', starterCode: '', language: 'nodejs' });
await create(`/teams/${team.id}/task-sets`, auth.token, { name: 'Название набора', taskIds: [task.id] });
const { track } = await create(`/teams/${team.id}/tracks`, auth.token, { name: 'Название трека' });
await create(`/teams/${team.id}/tracks/${track.id}/vacancies`, auth.token, { title: 'Название вакансии' });
await create(`/teams/${team.id}/interviews`, auth.token, { title: 'Название командного интервью', selectedTaskIds: [task.id], interviewerIds: [auth.user.id] });
await create('/rooms', auth.token, { title: 'Название личного интервью', taskTemplateIds: [] });
const personalTask = await create('/me/tasks', auth.token, { title: 'Личная задача', description: '', starterCode: '', language: 'nodejs' });
await create('/me/presets', auth.token, { name: 'Название личного набора', taskTemplateIds: [personalTask.id] });
const room = await create('/public/rooms', null, { title: 'Комната выравнивания', ownerDisplayName: auth.user.displayName, language: 'nodejs' });

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const measurements = [];
const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.routeWebSocket('**/ws', socket => socket.close());
  await context.addInitScript(({ auth, room }) => {
    localStorage.setItem('auth_token', auth.token);
    localStorage.setItem('auth_user', JSON.stringify(auth.user));
    localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, auth.user.displayName);
  }, { auth, room });
  const page = await context.newPage();
  const scenarios = [
    { id: 'team-name', path: `/workspace/teams/${team.id}/settings`, title: team.name, trigger: 'Переименовать команду' },
    { id: 'team-interview', path: `/workspace/teams/${team.id}/interviews`, title: 'Название командного интервью', trigger: 'Редактировать интервью Название командного интервью', completeEditor: true },
    { id: 'team-task', path: `/workspace/teams/${team.id}/library`, title: task.title, trigger: `Редактировать задачу ${task.title}`, completeEditor: true },
    { id: 'team-set', path: `/workspace/teams/${team.id}/library`, tab: 'Наборы задач', title: 'Название набора', trigger: 'Редактировать набор Название набора', completeEditor: true },
    { id: 'team-track', path: `/workspace/teams/${team.id}/tracks`, title: track.name, trigger: `Переименовать трек ${track.name}` },
    { id: 'team-vacancy', path: `/workspace/teams/${team.id}/tracks`, title: 'Название вакансии', trigger: 'Переименовать вакансию Название вакансии' },
    { id: 'personal-interview', path: '/workspace/personal/interviews', title: 'Название личного интервью', trigger: 'Переименовать интервью Название личного интервью' },
    { id: 'personal-set', path: '/workspace/personal/library', tab: 'Наборы задач', title: 'Название личного набора', trigger: 'Редактировать набор Название личного набора', completeEditor: true },
    { id: 'profile-name', path: '/profile', title: auth.user.displayName, trigger: 'Изменить имя' },
    { id: 'room-step', path: `/room/${room.inviteCode}`, tab: 'Шаги', testId: 'room-task-rename-0' },
  ];
  for (const theme of ['light', 'dark']) {
    for (const scenario of scenarios) {
      await page.goto(`${web}${scenario.path}`);
      // A full navigation replaces the provider and its storage listener.
      // Wait for its initial effect and the surface before switching theme.
      await page.waitForFunction(() => ['light', 'dark'].includes(document.documentElement.dataset.theme));
      if (scenario.tab) await page.getByRole('tab', { name: scenario.tab, exact: true }).click();
      const button = scenario.testId ? page.getByTestId(scenario.testId) : page.getByRole('button', { name: scenario.trigger, exact: true });
      await button.waitFor();
      await page.evaluate(theme => {
        localStorage.setItem('interview-online:ui-theme', theme);
        window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: theme }));
      }, theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      // Ant's control styles can lag behind the root theme attribute. Wait for
      // the semantic surface color before recording final visual evidence.
      await page.waitForFunction(() => {
        const surface = getComputedStyle(document.documentElement).getPropertyValue('--app-surface').trim();
        const probe = document.createElement('span');
        probe.style.backgroundColor = surface;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        document.body.appendChild(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const toggle = document.querySelector('button[data-theme-toggle="true"]');
        const switcher = [...document.querySelectorAll('button')]
          .find(element => element.getAttribute('aria-label')?.startsWith('Команды:'));
        return toggle && [toggle, switcher].filter(Boolean)
          .every(element => getComputedStyle(element).backgroundColor === expectedBackground);
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const title = scenario.title ?? await page.getByTestId('room-step-row-0').locator(':scope > span').nth(1).innerText();
      const result = { surface: scenario.id, theme, ...await measure(button, title, scenario.completeEditor) };
      measurements.push(result);
      if (Math.abs(result.difference) > 2) failures.push(`${theme}/${scenario.id}: ${result.reference} differs from rendered label center by ${result.difference.toFixed(2)}px`);
      await page.screenshot({ path: new URL(`${theme}-${scenario.id}.png`, artifacts).pathname, fullPage: true });
    }
  }
  assert.equal(measurements.length, 20, 'all 10 surfaces must be measured in both themes');
  await writeFile(new URL('measurements.json', artifacts), JSON.stringify(measurements, null, 2));
  console.log(measurements.map(({ surface, theme, difference, elementDifference, layout }) => ({ surface, theme, difference, elementDifference, alignItems: layout.alignItems })));
  assert.deepEqual(failures, [], failures.join('\n'));
} finally {
  await browser.close();
}
