import { chromium } from "playwright";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const outputDirectory = path.join(repositoryRoot, "output", "playwright", "markdown-analyst-demo");
const videoPath = path.join(outputDirectory, "interview-online-markdown-analyst-demo.webm");
const storageStatePath = path.join(outputDirectory, "analyst-demo-storage-state.json");
const baseUrl = process.env.DEMO_BASE_URL ?? "http://localhost:5174";
const candidateBaseUrl = baseUrl.replace("localhost", "127.0.0.1");

const initialMarkdown = `# Кейс: бронирование переговорной

Сотрудник выбирает переговорную и интервал времени. Система не допускает пересечения активных броней.

## Схема данных

\`\`\`text
ROOM 1 ───< BOOKING >─── 1 USER
\`\`\`

| Сущность | Ключевые поля |
| --- | --- |
| ROOM | id, name, capacity |
| BOOKING | room_id, user_id, starts_at, ends_at, status |
| USER | id, name |
`;

const rulesMarkdown = `

## Вопрос 1. Правила

> Какие два правила нужно зафиксировать до проектирования?

**Предложение кандидата**

1. \`starts_at\` раньше \`ends_at\`.
2. Активные брони одной комнаты не пересекаются.
`;

const statusesMarkdown = `

## Вопрос 2. Статусы

| Статус | Значение |
| --- | --- |
| CREATED | активная бронь |
| CANCELLED | отменена пользователем |
| COMPLETED | интервал завершён |
`;

const acceptanceMarkdown = `

## Вопрос 3. Конкурентное бронирование

**Критерий приёмки**

Дано: переговорная свободна с 14:00 до 15:00.  
Когда: два пользователя одновременно создают бронь.  
Тогда: сохраняется только одна бронь, а второй получает сообщение, что интервал занят.
`;

const sleep = (page, milliseconds) => page.waitForTimeout(milliseconds);

async function typeSlowly(locator, value, delay = 24) {
  await locator.click();
  await locator.press("ControlOrMeta+A").catch(() => undefined);
  await locator.pressSequentially(value, { delay });
}

async function appendSlowly(locator, value, delay = 24) {
  await locator.click();
  await locator.press("ControlOrMeta+End").catch(() => undefined);
  await locator.pressSequentially(value, { delay });
}

async function selectRoomLanguage(page, language) {
  const input = page.getByRole("textbox", { name: "Язык комнаты" });
  await input.click();
  await page.getByRole("option", { name: language, exact: true }).click();
  await sleep(page, 1000);
}

async function closeTaskPanel(page) {
  const rail = page.getByTestId("room-rail-tasks");
  if ((await rail.getAttribute("aria-pressed")) === "true") {
    await rail.click();
    await sleep(page, 700);
  }
}

async function registerAndPrepareRoom(page) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const nickname = `analyst_demo_${suffix}`;
  const roomName = "Системный аналитик — бронирование переговорной";

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByText("Регистрация", { exact: true }).click();
  await sleep(page, 450);
  await typeSlowly(page.getByRole("textbox", { name: "Ник" }), nickname, 20);
  await typeSlowly(page.getByRole("textbox", { name: "Имя для комнаты" }), "Алексей, интервьюер", 26);
  await page.getByRole("textbox", { name: "Пароль" }).fill("DemoPass2026");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 20_000 });
  await sleep(page, 1200);

  await page.getByRole("textbox", { name: "Название комнаты" }).fill(roomName);
  await page.getByRole("button", { name: "Создать и открыть" }).click();
  await page.waitForURL(/\/room\//, { timeout: 20_000 });
  await page.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
  await sleep(page, 1500);

  await selectRoomLanguage(page, "Plain text");
  const markdownEditor = page.locator("[data-testid='room-markdown-editor'] .cm-content");
  await markdownEditor.waitFor({ state: "visible", timeout: 20_000 });
  await typeSlowly(markdownEditor, initialMarkdown, 4);
  await sleep(page, 1600);
  await closeTaskPanel(page);

  return page.url().split("/room/")[1].split(/[?#]/)[0];
}

async function joinCandidate(candidatePage, inviteCode) {
  await candidatePage.goto(`${candidateBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  const nameInput = candidatePage.getByRole("textbox", { name: "Ваше имя" });
  const namePromptVisible = await candidatePage
    .getByRole("heading", { name: "Представьтесь перед входом в комнату", exact: true })
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (namePromptVisible) {
    await typeSlowly(nameInput, "Мария, кандидат", 24);
    await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  }
  await candidatePage.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 30_000 });
  await candidatePage.getByText("Кейс: бронирование переговорной", { exact: true }).waitFor({ timeout: 20_000 });
  await sleep(candidatePage, 1000);
}

function splitScreenHtml(inviteCode) {
  const interviewerUrl = `${baseUrl}/room/${inviteCode}`;
  const candidateUrl = `${candidateBaseUrl}/room/${inviteCode}`;

  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; overflow: hidden; background: #0d1016; color: #eef1f7; font-family: Arial, sans-serif; }
        header { height: 68px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; background: #171c26; border-bottom: 1px solid #3a4355; }
        header strong { font-size: 25px; font-weight: 600; }
        header span { margin-left: 14px; color: #b6c0d2; font-size: 16px; }
        .marker { color: #b99cff; font-size: 15px; letter-spacing: 0; }
        main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; height: calc(100vh - 68px); padding: 16px; }
        section { min-width: 0; overflow: hidden; border: 2px solid #3b4559; border-radius: 12px; background: #0b0e14; }
        h2 { height: 42px; margin: 0; padding: 10px 16px; background: #202735; border-bottom: 1px solid #3b4559; font-size: 18px; font-weight: 600; }
        .candidate h2 { color: #c2a6ff; }
        iframe { display: block; width: 100%; height: calc(100% - 42px); border: 0; background: #10141b; }
      </style>
    </head>
    <body>
      <header>
        <div><strong>Интервью системного аналитика</strong><span>Markdown как общее рабочее поле</span></div>
        <div class="marker">Два взгляда на одну комнату</div>
      </header>
      <main>
        <section><h2>Интервьюер</h2><iframe id="interviewer" src="${interviewerUrl}"></iframe></section>
        <section class="candidate"><h2>Кандидат</h2><iframe id="candidate" src="${candidateUrl}"></iframe></section>
      </main>
    </body>
  </html>`;
}

async function ensureCandidateFrameReady(candidate) {
  const nameInput = candidate.getByRole("textbox", { name: "Ваше имя" });
  const namePromptVisible = await candidate
    .getByRole("heading", { name: "Представьтесь перед входом в комнату", exact: true })
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (namePromptVisible) {
    await typeSlowly(nameInput, "Мария, кандидат", 24);
    await candidate.getByRole("button", { name: "Войти в комнату" }).click();
  }
  await candidate.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 30_000 });
}

async function recordInterview(browser, inviteCode) {
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    recordVideo: { dir: outputDirectory, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    // Keep the wrapper on localhost so the interviewer iframe receives the
    // authenticated same-origin localStorage created during setup.
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.setContent(splitScreenHtml(inviteCode));
    const interviewer = page.frameLocator("#interviewer");
    const candidate = page.frameLocator("#candidate");

    await interviewer.getByText("Системный аналитик — бронирование переговорной", { exact: true }).waitFor({ timeout: 20_000 });
    await ensureCandidateFrameReady(candidate);
    await interviewer.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
    await candidate.getByText("Кейс: бронирование переговорной", { exact: true }).waitFor({ timeout: 20_000 });
    const interviewerTaskRail = interviewer.getByTestId("room-rail-tasks");
    if ((await interviewerTaskRail.getAttribute("aria-pressed")) === "true") {
      await interviewerTaskRail.click();
      await sleep(page, 900);
    }
    await sleep(page, 6500);

    await interviewer.getByTestId("briefing-focus-toggle").click();
    await interviewer.getByTestId("briefing-focus-toggle").waitFor({ state: "visible", timeout: 10_000 });
    await candidate.locator("[data-testid='room-code-editor-host']").waitFor({ state: "hidden", timeout: 15_000 });
    await sleep(page, 6500);

    const editor = interviewer.locator("[data-testid='room-markdown-editor'] .cm-content");
    await appendSlowly(editor, rulesMarkdown, 30);
    await candidate.getByText("Вопрос 1. Правила", { exact: true }).waitFor({ timeout: 15_000 });
    await sleep(page, 8500);

    await appendSlowly(editor, statusesMarkdown, 30);
    await candidate.getByText("Вопрос 2. Статусы", { exact: true }).waitFor({ timeout: 15_000 });
    await sleep(page, 8500);

    await appendSlowly(editor, acceptanceMarkdown, 28);
    await candidate.getByText("Вопрос 3. Конкурентное бронирование", { exact: true }).waitFor({ timeout: 15_000 });
    await sleep(page, 2600);
    await Promise.all([
      interviewer.getByText("Критерий приёмки", { exact: true }).last().scrollIntoViewIfNeeded(),
      candidate.getByText("Критерий приёмки", { exact: true }).scrollIntoViewIfNeeded(),
    ]);
    await Promise.all([
      interviewer.getByText("Тогда: сохраняется только одна бронь", { exact: false }).last().scrollIntoViewIfNeeded(),
      candidate.getByText("Тогда: сохраняется только одна бронь", { exact: false }).scrollIntoViewIfNeeded(),
    ]);
    await sleep(page, 10_000);
  } finally {
    await context.close();
    const sourceVideoPath = await video.path();
    if (sourceVideoPath) await copyFile(sourceVideoPath, videoPath);
  }
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await rm(videoPath, { force: true });
  await rm(storageStatePath, { force: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const setupContext = await browser.newContext({
      viewport: { width: 1440, height: 980 },
      screen: { width: 1440, height: 980 },
    });
    const interviewerPage = await setupContext.newPage();
    const inviteCode = await registerAndPrepareRoom(interviewerPage);
    const candidatePage = await setupContext.newPage();
    await joinCandidate(candidatePage, inviteCode);
    await setupContext.storageState({ path: storageStatePath });
    await setupContext.close();

    await recordInterview(browser, inviteCode);
  } finally {
    await browser.close();
  }

  console.log(videoPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
