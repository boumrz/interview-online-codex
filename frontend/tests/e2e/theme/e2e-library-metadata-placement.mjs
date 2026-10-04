import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const widths = [1920, 1366, 1024, 768, 390];
const longTitle = "Очень длинное название задачи для проверки расположения языка и доступности карандаша при переносе текста на небольшом экране";

async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function fixture() {
  const auth = await request("/auth/register", null, { nickname: `metadata_${crypto.randomUUID().slice(0, 12)}`, displayName: "Проверка карточек", password: "test-password-123" });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light" });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("interview-online:ui-theme", "light");
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const cleanup = [];
  return {
    auth, page,
    async create(path, body, key) {
      const result = await request(path, auth.token, body);
      const entity = key ? result[key] : result;
      cleanup.unshift(`${path}/${entity.id}`);
      return entity;
    },
    async close() {
      await browser.close();
      for (const path of cleanup) {
        try { await request(path, auth.token, null, "DELETE"); } catch { /* Preserve the original test failure. */ }
      }
    },
  };
}

async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function matrix(page, name, verify) {
  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole("button", { name: /^(Тёмная|Светлая) тема$/ }).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1080 });
      await settled(page);
      await verify();
      await page.screenshot({ path: `.run/metadata-${name}-${theme}-${width}.png`, fullPage: true });
    }
  }
}

async function metadataBesideContent(card, title, label, description = "", hasAuthor = false) {
  const titleBox = await card.getByText(title, { exact: true }).boundingBox();
  const metadata = card.getByText(label, { exact: true });
  const metadataBox = await metadata.boundingBox();
  assert.ok(titleBox && metadataBox, "name and metadata are visible");
  assert.ok(Math.abs(metadataBox.x - titleBox.x) <= 8, `${label} aligns with its title, not the card centre: delta=${metadataBox.x - titleBox.x}`);
  const precedingBox = description ? await card.getByText(description, { exact: true }).boundingBox() : titleBox;
  assert.ok(metadataBox.y >= precedingBox.y + precedingBox.height + 6, "metadata follows the title or description with a readable gap");
  assert.ok(metadataBox.y <= precedingBox.y + precedingBox.height + 20, "metadata stays close to the related content");
  if (hasAuthor) {
    const authorBox = await card.getByText(/^Автор:/).boundingBox();
    assert.ok(Math.abs(authorBox.y + authorBox.height / 2 - metadataBox.y - metadataBox.height / 2) <= 4, "author and metadata share a compact row");
    assert.ok(authorBox.x >= metadataBox.x + metadataBox.width + 6 && authorBox.x <= metadataBox.x + metadataBox.width + 18, "author stays beside metadata");
  }
  const bounds = await card.boundingBox();
  for (const button of await card.getByRole("button").all()) {
    const box = await button.boundingBox();
    assert.ok(box.x >= bounds.x + 8 && box.x + box.width <= bounds.x + bounds.width - 8, "pencil and actions remain inside the card");
    const overlap = Math.min(box.x + box.width, metadataBox.x + metadataBox.width) > Math.max(box.x, metadataBox.x) && Math.min(box.y + box.height, metadataBox.y + metadataBox.height) > Math.max(box.y, metadataBox.y);
    assert.equal(overlap, false, "metadata does not overlap any action");
  }
}

test("personal task languages follow their descriptions and stay beside the title at every width", async () => {
  const f = await fixture();
  try {
    await f.create("/me/tasks", { title: "Короткая задача", language: "nodejs", starterCode: "example", description: "" });
    const description = "Подробное описание задачи с входными данными и ожидаемым результатом. ".repeat(5).trim();
    await f.create("/me/tasks", { title: longTitle, language: "nodejs", starterCode: "example", description });
    await f.page.goto(`${web}/workspace/personal/library`);
    const card = title => f.page.getByRole("region", { name: `Личная задача ${title}`, exact: true });
    await card(longTitle).waitFor();
    await matrix(f.page, "personal-tasks", async () => {
      await metadataBesideContent(card("Короткая задача"), "Короткая задача", "Node JS");
      await metadataBesideContent(card(longTitle), longTitle, "Node JS", description);
    });
  } finally { await f.close(); }
});

test("team task languages and authors form a left-aligned information row", async () => {
  const f = await fixture();
  try {
    const { team } = await request("/teams", f.auth.token, { name: "Метаданные задач" });
    await f.create(`/teams/${team.id}/tasks`, { title: "Короткая задача", language: "nodejs", starterCode: "example", description: "" }, "task");
    const description = "Условие задачи и ожидаемый результат с длинным описанием. ".repeat(6).trim();
    await f.create(`/teams/${team.id}/tasks`, { title: longTitle, language: "nodejs", starterCode: "example", description }, "task");
    await f.page.goto(`${web}/workspace/teams/${team.id}/library`);
    const card = title => f.page.getByRole("region", { name: `Командная задача ${title}`, exact: true });
    await card(longTitle).waitFor();
    await matrix(f.page, "team-tasks", async () => {
      await metadataBesideContent(card("Короткая задача"), "Короткая задача", "Node JS", "", true);
      await metadataBesideContent(card(longTitle), longTitle, "Node JS", description, true);
    });
  } finally { await f.close(); }
});

test("team set counts stay with their composition and author instead of occupying a middle column", async () => {
  const f = await fixture();
  try {
    const { team } = await request("/teams", f.auth.token, { name: "Метаданные наборов" });
    const first = await f.create(`/teams/${team.id}/tasks`, { title: "Первая задача", language: "nodejs" }, "task");
    const second = await f.create(`/teams/${team.id}/tasks`, { title: "Вторая задача", language: "nodejs" }, "task");
    const name = "Длинное название набора для проверки количества задач при переносе содержания карточки на следующую строку";
    await f.create(`/teams/${team.id}/task-sets`, { name, taskIds: [first.id, second.id] }, "taskSet");
    await f.create(`/teams/${team.id}/task-sets`, { name: "Одна задача", taskIds: [first.id] }, "taskSet");
    await f.page.goto(`${web}/workspace/teams/${team.id}/library`);
    await f.page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const card = value => f.page.getByRole("region", { name: `Командный набор ${value}`, exact: true });
    await card(name).waitFor();
    await matrix(f.page, "team-sets", async () => {
      await metadataBesideContent(card(name), name, "2 задачи", "Первая задача → Вторая задача", true);
      await metadataBesideContent(card("Одна задача"), "Одна задача", "1 задача", "Первая задача", true);
    });
  } finally { await f.close(); }
});

test("personal set counts and language summaries remain grouped with short and long names", async () => {
  const f = await fixture();
  try {
    const task = await f.create("/me/tasks", { title: "Задача набора", language: "nodejs" });
    const names = ["Набор задач", longTitle];
    const presets = await Promise.all(names.map(name => f.create("/me/presets", { name, taskTemplateIds: [task.id] })));
    await f.page.goto(`${web}/workspace/personal/library?tab=sets`);
    await f.page.getByTestId(`preset-card-${presets[0].id}`).waitFor();
    await matrix(f.page, "personal-sets", async () => {
      for (const preset of presets) {
        const card = f.page.getByTestId(`preset-card-${preset.id}`);
        const nameBox = await card.getByText(preset.name, { exact: true }).boundingBox();
        const countBox = await card.getByText("1 задача", { exact: true }).boundingBox();
        const summaryBox = await card.getByText("Node JS · 1", { exact: true }).boundingBox();
        const editBox = await card.getByRole("button", { name: `Редактировать набор ${preset.name}`, exact: true }).boundingBox();
        assert.ok(Math.abs(summaryBox.x - nameBox.x) <= 8, "language summary is below the set name");
        assert.ok(countBox.x + countBox.width <= Math.max(nameBox.x + nameBox.width, editBox.x + editBox.width) + countBox.width + 16, "count remains beside its name and pencil");
        assert.ok(countBox.y >= nameBox.y - 8 && countBox.y <= nameBox.y + nameBox.height + 48, "wrapped count stays with its heading");
        const box = await card.boundingBox();
        assert.ok(countBox.x + countBox.width <= box.x + box.width - 8 && summaryBox.x + summaryBox.width <= box.x + box.width - 8, "metadata stays inside the set card");
      }
    });
  } finally { await f.close(); }
});

test("legacy task links use the same grouped personal metadata", async () => {
  const f = await fixture();
  try {
    await f.create("/me/tasks", { title: "Задача по старой ссылке", language: "nodejs", description: "Старые адреса ведут в актуальную библиотеку" });
    await f.page.goto(`${web}/dashboard/tasks?lang=nodejs`);
    await f.page.waitForURL(/\/workspace\/personal\/library\?language=nodejs$/);
    const card = f.page.getByRole("region", { name: "Личная задача Задача по старой ссылке", exact: true });
    await card.waitFor();
    await metadataBesideContent(card, "Задача по старой ссылке", "Node JS", "Старые адреса ведут в актуальную библиотеку");
  } finally { await f.close(); }
});
