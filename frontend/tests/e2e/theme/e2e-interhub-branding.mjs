import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';

async function request(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

async function assertBrand(page, path, monogram = false) {
  await page.goto(`${web}${path}`);
  const header = page.locator('header').first();
  await header.waitFor();
  assert.equal(await page.title(), 'InterHub', `${path}: browser title uses the production name`);
  await header.getByText('InterHub', { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /interview[ -]?online/i, `${path}: old product name is absent`);
  assert.doesNotMatch(await header.innerText(), /\bIO\b/, `${path}: old monogram is absent`);
  if (monogram) assert.equal(await header.getByText('IH', { exact: true }).isVisible(), true);
}

for (const path of ['/', '/login']) {
  test(`InterHub identifies the public ${path} page and its browser tab`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await assertBrand(page, path);
      const brandLink = page.getByRole('link', { name: /InterHub.*главн|главн.*InterHub/ });
      assert.equal(await brandLink.isVisible(), true, 'brand link has the production name for assistive technology');
    } finally { await browser.close(); }
  });
}

test('InterHub and IH identify both personal and team workspaces', async () => {
  const auth = await request('/auth/register', null, {
    nickname: `brand_${crypto.randomUUID().slice(0, 12)}`,
    displayName: 'Проверка InterHub', password: 'test-password-123', isHr: true,
  });
  const { team } = await request('/teams', auth.token, { name: 'Команда InterHub' });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
    }, auth);
    const page = await context.newPage();
    await assertBrand(page, '/workspace/personal/interviews', true);
    await assertBrand(page, `/workspace/teams/${team.id}/interviews`, true);
  } finally { await browser.close(); }
});

test('InterHub starts with local IBM Plex when external font CSS is unavailable and tolerates a failed local font', async () => {
  const browser = await chromium.launch();
  const origin = new URL(web).origin;
  const expectedFaces = [
    ...[400, 500, 600, 700].map(weight => ({ family: 'IBM Plex Sans', weight })),
    ...[400, 500, 600].map(weight => ({ family: 'IBM Plex Mono', weight })),
  ];
  try {
    for (const failLocalFont of [false, true]) {
      const context = await browser.newContext();
      try {
        let release;
        const closed = new Promise(resolve => { release = resolve; });
        context.on('close', release);
        await context.route(url => url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2', async () => { await closed; });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const externalFontRequests = [];
        const localFontRequests = [];
        const localFontResponses = [];
        const failedLocalFonts = [];
        page.on('request', request => {
          const url = new URL(request.url());
          if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) externalFontRequests.push(url.pathname);
          if (request.resourceType() === 'font' && url.origin === origin) localFontRequests.push(url.pathname);
        });
        page.on('response', response => {
          const url = new URL(response.url());
          if (response.request().resourceType() === 'font' && url.origin === origin) localFontResponses.push({ path: url.pathname, status: response.status() });
        });
        if (failLocalFont) {
          await context.route(url => url.origin === origin && url.pathname.startsWith('/fonts/ibm-plex/') && url.pathname.endsWith('.woff2'), async route => {
            failedLocalFonts.push(new URL(route.request().url()).pathname);
            await route.abort('failed');
          });
        }
        await page.goto(`${web}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Запускайте интервью за 30 секунд.', exact: true }).waitFor();
        await page.locator('header').getByText('InterHub', { exact: true }).waitFor();
        assert.equal(await page.title(), 'InterHub');
        assert.equal(await page.getByRole('link', { name: /InterHub.*главн|главн.*InterHub/ }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'Создать комнату', exact: true }).isVisible(), true);
        const typography = await page.evaluate(async ({ expectedFaces, failLocalFont }) => {
          const normalizeFamily = family => family.replaceAll('"', '').replaceAll("'", '');
          const loaded = failLocalFont ? [] : await Promise.all(expectedFaces.map(async ({ family, weight }) => ({
            family, weight,
            faces: (await document.fonts.load(`${weight} 15px "${family}"`, 'Hello Интервью')).map(face => ({ family: normalizeFamily(face.family), weight: face.weight, display: face.display, status: face.status })),
          })));
          await document.fonts.ready;
          const brand = [...document.querySelectorAll('header *')].find(node => node.textContent?.trim() === 'InterHub');
          return {
            loaded,
            bodyFamily: getComputedStyle(document.body).fontFamily,
            codeFamily: getComputedStyle(document.querySelector('pre')).fontFamily,
            codeWeight: getComputedStyle(document.querySelector('pre')).fontWeight,
            brandWeight: getComputedStyle(brand).fontWeight,
            fontErrors: [...document.fonts].filter(face => face.status === 'error').length,
          };
        }, { expectedFaces, failLocalFont });
        assert.match(typography.bodyFamily, /^"?IBM Plex Sans"?,/);
        assert.match(typography.codeFamily, /^"?IBM Plex Mono"?,/);
        assert.equal(typography.codeWeight, '400');
        assert.equal(typography.brandWeight, '600');
        assert.equal(externalFontRequests.length, 0, 'Startup and font rendering stay independent of external font services');
        assert.ok(localFontRequests.length > 0, 'The application requests IBM Plex from its own origin');
        assert.ok(localFontRequests.every(path => /^\/fonts\/ibm-plex\/.+\.woff2$/.test(path)));
        if (failLocalFont) {
          assert.ok(failedLocalFonts.length > 0, 'The fallback scenario actually denies local font bytes');
          assert.ok(typography.fontErrors > 0, 'The interface remains ready despite a real FontFace load error');
          assert.equal(await page.getByRole('heading', { name: 'Запускайте интервью за 30 секунд.', exact: true }).isVisible(), true);
        } else {
          assert.ok(localFontResponses.length > 0);
          assert.ok(localFontResponses.every(response => response.status === 200), 'Real same-origin WOFF2 responses load successfully');
          assert.equal(typography.loaded.length, expectedFaces.length);
          for (const { family, weight, faces } of typography.loaded) {
            assert.ok(faces.length > 0, `${family} ${weight} loads Latin and Cyrillic text`);
            assert.ok(faces.every(face => face.family === family && face.weight === String(weight) && face.display === 'swap' && face.status === 'loaded'));
          }
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
