import { chromium } from "playwright";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const outputDirectory = path.join(repositoryRoot, "output", "playwright", "presentation-demo");
const videoPath = path.join(outputDirectory, "interview-online-presentation-demo.webm");
const markdownPreviewPath = path.join(outputDirectory, "interview-notes-preview.html");
const baseUrl = process.env.DEMO_BASE_URL ?? "http://localhost:5174";
const candidateBaseUrl = baseUrl.replace("localhost", "127.0.0.1");

const taskOne = {
  title: "Группировка анаграмм",
  description: "Сгруппируйте массив строк так, чтобы анаграммы оказались в одной группе.",
  starterCode: "function groupAnagrams(words) {\n  // your code\n}\n"
};

const taskTwo = {
  title: "Проверка палиндрома",
  description: "Реализуйте функцию isPalindrome, которая возвращает true для строки-палиндрома.",
  starterCode: "function isPalindrome(value) {\n  // your code\n}\n"
};

const solution = `function groupAnagrams(words) {
  const groups = new Map();

  for (const word of words) {
    const key = [...word].sort().join(\"\");
    const bucket = groups.get(key) ?? [];
    bucket.push(word);
    groups.set(key, bucket);
  }

  return [...groups.values()];
}`;

const sleep = (page, milliseconds) => page.waitForTimeout(milliseconds);

async function typeSlowly(locator, value, delay = 32) {
  await locator.click();
  await locator.press("ControlOrMeta+A").catch(() => undefined);
  await locator.pressSequentially(value, { delay });
}

async function createTask(page, task) {
  await page.getByTestId("open-create-task-modal").click();
  await sleep(page, 900);
  await typeSlowly(page.getByTestId("create-task-title-input"), task.title, 45);
  await sleep(page, 350);
  await typeSlowly(page.getByTestId("create-task-description-input"), task.description, 20);
  await sleep(page, 350);
  await typeSlowly(page.getByTestId("create-task-code-input"), task.starterCode, 18);
  await sleep(page, 900);
  await page.getByTestId("create-task-submit-button").click();
  await sleep(page, 2800);
}

async function selectMantineOption(page, input, optionName) {
  await input.click();
  await sleep(page, 500);
  await page.getByRole("option", { name: optionName, exact: true }).click();
  await sleep(page, 500);
}

async function ensureTaskPanelOpen(page) {
  const taskRail = page.getByTestId("room-rail-tasks");
  if ((await taskRail.getAttribute("aria-pressed")) !== "true") {
    await taskRail.click();
    await sleep(page, 700);
  }
}

async function showSplitScreen(page, inviteCode) {
  const interviewerUrl = `${baseUrl}/room/${inviteCode}`;
  const candidateUrl = `${candidateBaseUrl}/room/${inviteCode}`;

  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #111318; color: #f5f6f7; font-family: Arial, sans-serif; }
      header { height: 62px; display: flex; align-items: center; padding: 0 32px; background: #1a1e27; border-bottom: 1px solid #373d4a; }
      header strong { font-size: 24px; font-weight: 600; }
      header span { margin-left: 14px; color: #aeb6c7; font-size: 16px; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; height: calc(100vh - 62px); }
      section { min-width: 0; border: 2px solid #444c5d; border-radius: 12px; overflow: hidden; background: #0b0d12; }
      h2 { height: 42px; margin: 0; padding: 10px 16px; font-size: 18px; background: #202634; border-bottom: 1px solid #444c5d; }
      .candidate h2 { color: #c8a7ff; }
      iframe { display: block; border: 0; width: 100%; height: calc(100% - 42px); background: #101216; }
    </style>
    <header><strong>Совместная работа в одной комнате</strong><span>интервьюер и кандидат видят синхронный код</span></header>
    <main>
      <section><h2>Интервьюер</h2><iframe id="interviewer" src="${interviewerUrl}"></iframe></section>
      <section class="candidate"><h2>Кандидат</h2><iframe id="candidate" src="${candidateUrl}"></iframe></section>
    </main>
  `);

  const interviewer = page.frameLocator("#interviewer");
  const candidate = page.frameLocator("#candidate");

  await interviewer.getByText("Middle JavaScript — техническое интервью", { exact: true }).waitFor({ timeout: 20_000 });
  await candidate.getByRole("textbox", { name: "Ваше имя" }).waitFor({ timeout: 20_000 });
  await sleep(page, 1500);

  await typeSlowly(candidate.getByRole("textbox", { name: "Ваше имя" }), "Мария, кандидат", 55);
  await sleep(page, 650);
  await candidate.getByRole("button", { name: "Войти в комнату" }).click();
  await candidate.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
  await interviewer.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
  await sleep(page, 1500);

  const candidateCode = candidate.locator("[data-testid='room-code-editor-host'] .cm-content");
  await candidateCode.click();
  await candidateCode.press("ControlOrMeta+A");
  await candidateCode.pressSequentially(solution, { delay: 25 });
  await sleep(page, 7600);
}

function markdownPreviewHtml(markdown) {
  const escaped = markdown
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<!doctype html>
  <html lang="ru"><head><meta charset="utf-8"><style>
    body { margin: 0; min-height: 100vh; background: #13161e; color: #edf0f6; font-family: Arial, sans-serif; }
    header { padding: 28px 44px 20px; background: #1e2430; border-bottom: 1px solid #3c4557; }
    h1 { margin: 0; font-size: 30px; } p { margin: 8px 0 0; color: #b6c0d2; }
    main { padding: 36px 44px; } .file { color: #c8a7ff; font-size: 17px; margin-bottom: 16px; }
    pre { margin: 0; padding: 28px; border: 1px solid #3c4557; border-radius: 10px; background: #0e1117; color: #dfe6f3; white-space: pre-wrap; font: 18px/1.55 Consolas, monospace; }
  </style></head><body><header><h1>Предпросмотр выгрузки заметок</h1><p>Сформированный Markdown-документ интервью</p></header><main><div class="file">interview-notes.md</div><pre>${escaped}</pre></main></body></html>`;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await rm(videoPath, { force: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    recordVideo: { dir: outputDirectory, size: { width: 1920, height: 1080 } },
    acceptDownloads: true
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await sleep(page, 1700);
    await page.getByText("Регистрация", { exact: true }).click();
    await sleep(page, 650);
    await typeSlowly(page.getByRole("textbox", { name: "Ник" }), "demo_video_host", 65);
    await typeSlowly(page.getByRole("textbox", { name: "Имя для комнаты" }), "Алексей, интервьюер", 55);
    await page.getByRole("textbox", { name: "Пароль" }).fill("DemoPass2026");
    await sleep(page, 900);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await page.waitForURL(/\/dashboard\/rooms/, { timeout: 20_000 });
    await sleep(page, 3200);

    await page.getByRole("button", { name: "Задачи" }).click();
    await sleep(page, 1200);
    await createTask(page, taskOne);
    await createTask(page, taskTwo);

    await page.getByRole("button", { name: "Пресеты" }).click();
    await sleep(page, 2100);
    await page.getByRole("button", { name: "Создать пресет" }).click();
    await sleep(page, 700);
    await typeSlowly(page.getByRole("textbox", { name: "Название пресета" }), "Middle JavaScript разработчик", 45);
    const presetTasks = page.getByRole("textbox", { name: "Задачи" });
    await presetTasks.click();
    await sleep(page, 500);
    await page.getByRole("option", { name: `${taskOne.title} (Node JS)`, exact: true }).click();
    await page.getByRole("option", { name: `${taskTwo.title} (Node JS)`, exact: true }).click();
    await page.keyboard.press("Escape");
    await sleep(page, 600);
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await sleep(page, 3300);

    await page.getByRole("button", { name: "Комнаты" }).click();
    await sleep(page, 1000);
    await typeSlowly(page.getByRole("textbox", { name: "Название комнаты" }), "Middle JavaScript — техническое интервью", 40);
    await selectMantineOption(page, page.getByRole("textbox", { name: "Загрузить пресет задач" }), "Middle JavaScript разработчик");
    await sleep(page, 3100);
    await page.getByRole("button", { name: "Создать и открыть" }).click();
    await page.waitForURL(/\/room\//, { timeout: 20_000 });
    await page.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
    await sleep(page, 4200);

    const inviteCode = page.url().split("/room/")[1].split(/[?#]/)[0];
    await showSplitScreen(page, inviteCode);

    await page.goto(`${baseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
    await sleep(page, 2500);
    await ensureTaskPanelOpen(page);

    await typeSlowly(page.getByTestId("room-private-notes-input"), "Верно выбрала ключ группировки и объяснила сложность решения.", 28);
    await page.getByTestId("room-private-notes-input").press("Enter");
    await sleep(page, 2500);
    await selectMantineOption(page, page.getByRole("textbox", { name: "Оценка шага" }), "4");
    await sleep(page, 2600);

    await page.getByRole("button", { name: `2. ${taskTwo.title}`, exact: true }).click();
    await sleep(page, 2600);
    await typeSlowly(page.getByTestId("room-private-notes-input"), "Быстро перешла к нормализации строки и уверенно покрыла крайние случаи.", 27);
    await page.getByTestId("room-private-notes-input").press("Enter");
    await sleep(page, 2500);
    await selectMantineOption(page, page.getByRole("textbox", { name: "Оценка шага" }), "5");
    await sleep(page, 3300);

    await page.getByTestId("room-private-notes-export").click();
    await sleep(page, 4000);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать .md" }).click();
    const download = await downloadPromise;
    const markdownPath = await download.path();
    const markdown = markdownPath ? await (await import("node:fs/promises")).readFile(markdownPath, "utf8") : "# Заметки интервью\n\nЭкспорт сформирован.";
    await sleep(page, 900);
    await writeFile(markdownPreviewPath, markdownPreviewHtml(markdown), "utf8");
    await page.goto(`file:///${markdownPreviewPath.replaceAll("\\", "/")}`);
    await sleep(page, 8500);

    await page.goto(`${baseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-testid='room-code-editor-host'] .cm-content").waitFor({ timeout: 20_000 });
    await sleep(page, 2500);
    await ensureTaskPanelOpen(page);
    await page.getByRole("button", { name: "Завершить интервью" }).click();
    await sleep(page, 2200);
    await typeSlowly(page.getByRole("textbox", { name: "Обоснование" }), "Уверенное решение задач, прозрачные рассуждения и сильная коммуникация.", 24);
    await sleep(page, 2000);
    await page.getByRole("button", { name: "Сохранить вердикт" }).click();
    await sleep(page, 6500);
  } finally {
    await context.close();
    const sourceVideoPath = await video.path();
    if (sourceVideoPath) {
      await copyFile(sourceVideoPath, videoPath);
    }
    await browser.close();
  }

  console.log(videoPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
