import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const api = process.env.E2E_API_URL ?? "http://localhost:18080/api";
const web = process.env.E2E_BASE_URL ?? "http://localhost:15173";
const titles = ["лорор", "Длинное название интервью с несколькими строками и важным уточнением для проверки расстояний", "Название".repeat(18)];
const candidateName = "Синтетический кандидат с длинным отображаемым именем";
const position = "Синтетическая позиция для проверки переноса текста";

async function request(path, auth, body, method = body ? "POST" : "GET") {
  const response = await fetch(api + path, { method, headers: {
    "Content-Type": "application/json", "Idempotency-Key": randomUUID(),
    ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function fixture() {
  const auth = await request("/auth/register", null, { nickname: `spacing_${randomUUID().slice(0, 12)}`, displayName: "Синтетическая проверка карточек", password: "test-password-123", isHr: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("interview-online:ui-theme", "light");
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const cleanup = [];
  return { auth, page, cleanup, async close() {
    await browser.close();
    for (const path of cleanup.reverse()) {
      try { await request(path, auth, null, "DELETE"); } catch { /* Keep the original assertion. */ }
    }
  } };
}

async function matrix(page, verify) {
  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole("button", { name: /^(Тёмная|Светлая) тема$/ }).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    }
    for (const width of [1366, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await verify(`${theme}/${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${theme}/${width}: the document has no horizontal overflow`);
    }
  }
}

function overlaps(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 0.5
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 0.5;
}

async function inside(locator, container, label) {
  const bounds = await container.boundingBox();
  const box = await locator.boundingBox();
  assert.ok(box && bounds, `${label}: visible geometry`);
  assert.ok(box.x >= bounds.x + 4 && box.x + box.width <= bounds.x + bounds.width - 4, `${label}: content stays inside its surface (${JSON.stringify({ box, bounds })})`);
  return box;
}

test("team interview names and creation dates remain separate, with readable chips and actions", async () => {
  const f = await fixture();
  try {
    const { team } = await request("/teams", f.auth, { name: "Синтетическая команда отступов" });
    const { track } = await request(`/teams/${team.id}/tracks`, f.auth, { name: "ДлинныйТрек".repeat(8) });
    const { vacancy } = await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, f.auth, { title: "ДлиннаяВакансия".repeat(7) });
    for (const title of titles) {
      const { interview } = await request(`/teams/${team.id}/interviews`, f.auth, { title, selectedTaskIds: [], trackId: track.id, vacancyId: vacancy.id });
      f.cleanup.push(`/teams/${team.id}/interviews/${interview.id}`);
    }
    await f.page.goto(`${web}/workspace/teams/${team.id}/interviews`);
    await f.page.getByRole("region", { name: `Командное интервью ${titles[0]}`, exact: true }).waitFor();
    await matrix(f.page, async size => {
      for (const title of titles) {
        const card = f.page.getByRole("region", { name: `Командное интервью ${title}`, exact: true });
        const name = await inside(card.getByText(title, { exact: true }), card, `${size}: name`);
        const date = await inside(card.getByText(/^Создано /), card, `${size}: creation date`);
        assert.ok(date.y - name.y - name.height >= 7.5, `${size}: name and creation date need at least 8px between separate rows; actual=${date.y - name.y - name.height}`);
        assert.ok(date.y - name.y - name.height <= 20, `${size}: related date remains close to the name`);
        for (const text of ["Трек: " + track.name, "Вакансия: " + vacancy.title, "Задачи не добавлены"]) {
          const box = await inside(card.getByText(text, { exact: true }), card, `${size}: ${text.slice(0, 12)}`);
          assert.equal(overlaps(box, name) || overlaps(box, date), false, `${size}: metadata does not overlap the heading`);
        }
        const actions = await card.getByRole("button").all();
        const actionBoxes = [];
        for (const action of actions) {
          const box = await inside(action, card, `${size}: action`);
          assert.equal(overlaps(box, name) || overlaps(box, date), false, `${size}: actions do not overlap name/date`);
          for (const previous of actionBoxes) assert.equal(overlaps(box, previous), false, `${size}: actions do not overlap each other`);
          actionBoxes.push(box);
        }
      }
    });
  } finally { await f.close(); }
});

async function tableRowGeometry(row, size) {
  const cells = await row.getByRole("cell").all();
  for (const cell of cells) {
    const geometry = await cell.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return { cell: { left: rect.left, right: rect.right }, content: [...range.getClientRects()].filter(r => r.width && r.height).map(r => ({ left: r.left, right: r.right })) };
    });
    for (const rect of geometry.content) {
      assert.ok(rect.left >= geometry.cell.left + 3 && rect.right <= geometry.cell.right - 3, `${size}: table text and controls stay in their own padded cell`);
    }
  }
}

test("personal interview title, candidate, date and actions retain distinct padded table cells", async () => {
  const f = await fixture();
  try {
    const room = await request("/rooms", f.auth, { title: titles[2], taskIds: [] });
    f.cleanup.push(`/me/rooms/${room.id}`);
    await request(`/rooms/${room.inviteCode}/interview-metadata`, f.auth, { candidateName, position, scheduledAt: "2030-10-12T11:30:00Z", revision: 0 }, "PUT");
    await f.page.goto(`${web}/workspace/personal/interviews`);
    const row = f.page.getByRole("row", { name: titles[2], exact: true });
    await row.getByText(candidateName, { exact: true }).waitFor();
    await matrix(f.page, size => tableRowGeometry(row, size));
  } finally { await f.close(); }
});

test("personal and team candidate lists wrap names, positions, titles and dates without colliding with actions", async () => {
  const f = await fixture();
  try {
    const room = await request("/rooms", f.auth, { title: titles[2], taskIds: [] });
    f.cleanup.push(`/me/rooms/${room.id}`);
    await request(`/rooms/${room.inviteCode}/interview-metadata`, f.auth, { candidateName, position, scheduledAt: "2030-10-12T11:30:00Z", revision: 0 }, "PUT");
    await request(`/rooms/${room.inviteCode}/hr-tracking`, f.auth, null, "POST");
    const { team } = await request("/teams", f.auth, { name: "Синтетическая команда кандидатов" });
    const { interview } = await request(`/teams/${team.id}/interviews`, f.auth, { title: titles[2], candidateName, position, scheduledAt: "2030-10-12T11:30:00Z", selectedTaskIds: [] });
    f.cleanup.push(`/teams/${team.id}/interviews/${interview.id}`);
    for (const path of ["/workspace/personal/candidates", `/workspace/teams/${team.id}/candidates`]) {
      await f.page.goto(web + path);
      const row = f.page.getByRole("row").filter({ has: f.page.getByRole("cell", { name: candidateName, exact: true }) });
      await row.first().waitFor();
      await matrix(f.page, async size => {
        for (const currentRow of await row.all()) await tableRowGeometry(currentRow, `${path}/${size}`);
      });
    }
  } finally { await f.close(); }
});

test("personal header keeps the entire selector clickable and follows the same visual and keyboard order", async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${web}/workspace/personal/library`);
    const selector = f.page.getByRole("button", { name: "Команды: Личное. Сменить команду", exact: true });
    const navigation = f.page.getByRole("navigation", { name: "Разделы личного раздела", exact: true });
    const profile = f.page.getByRole("link", { name: `Открыть профиль @${f.auth.user.nickname}`, exact: true });
    const logout = f.page.getByRole("button", { name: "Выйти", exact: true });
    await selector.waitFor();
    await matrix(f.page, async size => {
      const theme = f.page.getByRole("button", { name: /^(Тёмная|Светлая) тема$/ });
      for (const control of [selector, profile, logout, theme]) {
        const hit = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return [0.08, 0.5, 0.92].flatMap(x => [0.15, 0.5, 0.85].map(y => {
            const target = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
            return element.contains(target);
          }));
        });
        assert.ok(hit.every(Boolean), `${size}: every point of ${await control.getAttribute("aria-label") || await control.textContent()} remains clickable without a neighbour covering it`);
      }
      await selector.focus();
      await selector.press("Enter");
      const menu = f.page.getByRole("menu", { name: "Выбор команды", exact: true });
      await menu.waitFor();
      await f.page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      await f.page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Команды: Личное. Сменить команду");
      await f.page.keyboard.press("Tab");
      assert.equal(await navigation.evaluate(element => element.contains(document.activeElement)), true, `${size}: Tab goes from context to sections before account controls`);
      if (f.page.viewportSize().width <= 640) {
        const contextBox = await selector.boundingBox();
        const navigationBox = await navigation.boundingBox();
        const accountBox = await profile.boundingBox();
        assert.ok(navigationBox.y >= contextBox.y + contextBox.height + 6, `${size}: sections occupy a separate second row`);
        assert.ok(accountBox.y >= navigationBox.y + navigationBox.height + 6, `${size}: account follows sections in the third row`);
      }
    });
  } finally { await f.close(); }
});
