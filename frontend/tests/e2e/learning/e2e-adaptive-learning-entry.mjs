import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const browser = await chromium.launch();
after(() => browser.close());

async function post(path, body, token, headers = {}) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}

async function account(t) {
  const auth = await post("/auth/register", {
    nickname: `lesson${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    displayName: "Проверка первого обучения",
    password: "learning-test-password",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript((token) => localStorage.setItem("auth_token", token), auth.token);
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const guide = page.locator("[data-learning-tour]");
  const welcome = guide.getByRole("heading", { name: "Знакомство с InterHub", exact: true });
  const action = (name) => guide.getByRole("button", { name, exact: true });
  const help = page.getByRole("button", { name: "Помощь", exact: true });
  const state = async () => {
    const response = await fetch(`${api}/me/learning/onboarding`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  return { ...auth, page, guide, welcome, action, help, state };
}

async function startAt(flow, path, heading) {
  await flow.page.goto(`${web}${path}`);
  await flow.welcome.waitFor();
  await flow.action("Начать обучение").click();
  await flow.guide.getByRole("heading", { name: heading, exact: true }).waitFor();
  assert.equal(new URL(flow.page.url()).pathname, new URL(`${web}${path}`).pathname);
  assert.equal(await flow.guide.count(), 1);
}

test("first entry on personal library starts the current section after a pause and reload", async (t) => {
  const flow = await account(t);
  const path = "/workspace/personal/library";
  const collected = [];
  flow.page.on("response", async (response) => {
    if (response.ok() && response.request().method() === "POST" &&
        response.url().includes("/me/learning/onboarding")) collected.push((await response.json()).events);
  });
  await flow.page.goto(`${web}${path}`);
  await flow.welcome.waitFor();
  await flow.action("Закрыть обучение").click();
  await flow.welcome.waitFor({ state: "hidden" });
  await flow.page.reload();
  await flow.welcome.waitFor();
  assert.equal((await flow.state()).status, "new");
  await flow.action("Начать обучение").click();
  const createTaskGuide = flow.guide.getByRole("heading", { name: "Создайте задачу", exact: true });
  await createTaskGuide.waitFor();
  assert.equal(new URL(flow.page.url()).pathname, path);
  assert.equal(collected.flat().filter((event) => event === "offer_seen").length, 1);
  assert.equal((await flow.state()).attempt, 1);
  await flow.page.reload();
  await createTaskGuide.waitFor();
  assert.equal(await flow.welcome.count(), 0);
});

test("first entry on the interview form starts its inline guide", async (t) => {
  const flow = await account(t);
  await flow.page.goto(`${web}/workspace/personal/interviews/new`);
  await flow.welcome.waitFor();
  const form = flow.page.getByTestId("create-room-card");
  const title = form.getByRole("textbox", { name: "Название интервью", exact: true });
  await title.focus();
  await flow.page.keyboard.press("Tab");
  assert.equal(await form.evaluate((element) => element.contains(document.activeElement) &&
    !document.activeElement.closest("[data-learning-form-guide-slot]")), true,
  "the inline welcome leaves the normal form tab order available");
  await flow.action("Начать обучение").click();
  await flow.guide.getByRole("heading", { name: "Укажите название", exact: true }).waitFor();
  await flow.page.locator("[data-learning-form-guide-slot] [data-learning-tour]").waitFor();
});

test("first entry on task sets starts with creating a set", async (t) => {
  const flow = await account(t);
  const path = "/workspace/personal/library?tab=sets";
  await startAt(flow, path, "Создайте набор задач");
  assert.equal(new URL(flow.page.url()).search, "?tab=sets");
  await flow.page.getByRole("tab", { name: "Наборы задач", exact: true }).and(
    flow.page.locator('[aria-selected="true"]'),
  ).waitFor();
});

test("first entry on team tracks starts the team section", async (t) => {
  const flow = await account(t);
  const { team } = await post("/teams", { name: "Команда первого обучения" }, flow.token, {
    "Idempotency-Key": randomUUID(),
  });
  await startAt(flow, `/workspace/teams/${team.id}/tracks`, "Найти трек");
});

test("a room offers its own first steps to a manager and makes no learning requests as a candidate", async (t) => {
  const owner = await account(t);
  const candidate = await account(t);
  const room = await post("/rooms", { title: "Первое обучение в комнате" }, owner.token);
  await startAt(owner, `/room/${room.inviteCode}`, "Личные заметки");
  const requests = [];
  candidate.page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/me/learning/")) requests.push(path);
  });
  await candidate.page.goto(`${web}/room/${room.inviteCode}`);
  await candidate.page.getByText("Первое обучение в комнате", { exact: true }).first().waitFor();
  await candidate.page.getByText("Кандидат", { exact: true }).first().waitFor();
  assert.equal(await candidate.help.count(), 0);
  assert.equal(await candidate.guide.count(), 0);
  assert.deepEqual(requests, []);
});

test("skip on a first non-interview tab stays global and help remains local after navigation", async (t) => {
  const flow = await account(t);
  await flow.page.goto(`${web}/workspace/personal/library`);
  await flow.welcome.waitFor();
  await flow.action("Пропустить обучение").click();
  await flow.welcome.waitFor({ state: "hidden" });
  assert.equal((await flow.state()).skipped, true);
  const path = "/workspace/personal/interviews/new";
  await flow.page.goto(`${web}${path}`);
  await flow.page.getByTestId("create-room-card").getByRole("button", { name: "Помощь", exact: true }).click();
  await flow.guide.getByRole("heading", { name: "Укажите название", exact: true }).waitFor();
  assert.equal(await flow.welcome.count(), 0);
  assert.equal(new URL(flow.page.url()).pathname, path);
});
