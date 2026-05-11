import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const artifactsRoot = path.resolve("../.run/demo");
const videoDir = path.join(artifactsRoot, "video");
const downloadsDir = path.join(artifactsRoot, "downloads");
const execFileAsync = promisify(execFile);

async function ensureDirs() {
  await fs.mkdir(videoDir, { recursive: true });
  await fs.mkdir(downloadsDir, { recursive: true });
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Demo interview room ${Date.now()}`,
      ownerDisplayName: "Interviewer Demo",
      language: "nodejs",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  if (!payload.ownerToken || !payload.inviteCode) {
    throw new Error("CREATE_ROOM_INVALID_PAYLOAD");
  }
  return payload;
}

async function ensureDemoTaskTitles(room) {
  if (!room.ownerToken || !room.inviteCode) {
    throw new Error("ROOM_OWNER_CONTEXT_MISSING");
  }

  const desiredTitles = [
    "Two Sum — индексы пары",
    "Valid Parentheses — проверка скобок",
  ];

  const ownerToken = room.ownerToken;
  let roomState = room;
  if ((roomState.tasks?.length ?? 0) < desiredTitles.length) {
    const addResponse = await fetch(`${apiBaseUrl}/rooms/${room.inviteCode}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Room-Owner-Token": room.ownerToken,
      },
      body: JSON.stringify({
        customTasks: [
          {
            title: desiredTitles[1],
            description: "Нужно проверить, корректно ли расставлены скобки в строке.",
            starterCode:
              "function isValid(s) {\n  // TODO: implement\n  return true;\n}\n",
            language: "nodejs",
          },
        ],
      }),
    });
    const addPayload = await addResponse.json();
    if (!addResponse.ok) {
      throw new Error(`ADD_DEMO_TASKS_FAILED ${JSON.stringify(addPayload)}`);
    }
    roomState = {
      ...addPayload,
      ownerToken: ownerToken ?? addPayload.ownerToken ?? null,
    };
  }

  for (let stepIndex = 0; stepIndex < desiredTitles.length; stepIndex += 1) {
    const patchResponse = await fetch(
      `${apiBaseUrl}/rooms/${room.inviteCode}/tasks/${stepIndex}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Room-Owner-Token": room.ownerToken,
        },
        body: JSON.stringify({ title: desiredTitles[stepIndex] }),
      },
    );
    const patchPayload = await patchResponse.json();
    if (!patchResponse.ok) {
      throw new Error(`PATCH_DEMO_TASK_TITLE_FAILED ${JSON.stringify(patchPayload)}`);
    }
    roomState = {
      ...patchPayload,
      ownerToken: ownerToken ?? patchPayload.ownerToken ?? null,
    };
  }

  return roomState;
}

async function enterNameIfPrompted(page, name) {
  const promptTitle = page.getByText("Представьтесь перед входом в комнату");
  const nameInput = page.getByLabel("Ваше имя");

  const promptVisibleNow = await promptTitle.isVisible().catch(() => false);
  if (!promptVisibleNow) {
    await nameInput.waitFor({ state: "visible", timeout: 1200 }).catch(() => {});
  }

  const promptVisible = await promptTitle.isVisible().catch(() => false);
  if (!promptVisible) return;

  await nameInput.fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await promptTitle.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function openTasksPanelIfNeeded(page) {
  const privateInput = page.locator('[data-testid="room-private-notes-input"]');
  if (await privateInput.isVisible().catch(() => false)) return;

  const tasksRailButton = page.locator('[data-testid="room-rail-tasks"]');
  if (await tasksRailButton.isVisible().catch(() => false)) {
    await tasksRailButton.click();
    await page.waitForTimeout(350);
    if (await privateInput.isVisible().catch(() => false)) return;
  }

  const toolsRailButton = page.locator('[data-testid="room-rail-tools"]');
  if (await toolsRailButton.isVisible().catch(() => false)) {
    await toolsRailButton.click();
    await page.waitForTimeout(250);
    const notesTab = page.getByRole("tab", { name: /^(Заметки|Чат)$/ }).first();
    if (await notesTab.isVisible().catch(() => false)) {
      await notesTab.click();
      await page.waitForTimeout(300);
    }
  }

  const tabMatchers = [/^Tasks$/i, /^Team$/i, /^Editor$/i, /^Задачи$/i, /^Команда$/i];
  for (const matcher of tabMatchers) {
    const tab = page.getByRole("tab", { name: matcher }).first();
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    await page.waitForTimeout(320);
    if (await privateInput.isVisible().catch(() => false)) return;
  }
}

async function addPrivateNote(page, noteText) {
  const privateInput = page.locator('[data-testid="room-private-notes-input"]');
  const privateSend = page.locator('[data-testid="room-private-notes-send"]');

  await privateInput.waitFor({ timeout: 10000 });
  await privateInput.fill(noteText);
  await privateSend.click();
  await page.getByText(noteText, { exact: false }).waitFor({ timeout: 8000 });
}

async function addCustomBlockNote(page, blockTitle, noteText) {
  const privateInput = page.locator('[data-testid="room-private-notes-input"]');
  const privateSend = page.locator('[data-testid="room-private-notes-send"]');

  await privateInput.waitFor({ timeout: 10000 });
  await privateInput.fill(`/block ${blockTitle}`);
  await privateSend.click();
  await page.getByText(`Блок: ${blockTitle}`, { exact: false }).waitFor({
    timeout: 5000,
  });
  await addPrivateNote(page, noteText);
}

async function typeSharedCode(interviewerPage, candidatePage) {
  const codeSnippet = [
    "function twoSum(nums, target) {",
    "  const seen = new Map();",
    "  for (let i = 0; i < nums.length; i += 1) {",
    "    const need = target - nums[i];",
    "    if (seen.has(need)) return [seen.get(need), i];",
    "    seen.set(nums[i], i);",
    "  }",
    "  return [];",
    "}",
  ].join("\n");

  const editor = interviewerPage.locator(".cm-editor");
  await editor.waitFor({ timeout: 15000 });
  await editor.click();

  // Programmatic "typing" avoids auto-closing bracket side effects and keeps
  // the final snippet strictly deterministic for demo recording.
  const ready = await interviewerPage.evaluate(() => {
    const host =
      document.querySelector(".cm-host") ??
      Array.from(document.querySelectorAll("div")).find(
        (node) => Boolean(node?.__roomEditorView),
      );
    const view = host?.__roomEditorView ?? null;
    return Boolean(view);
  });
  if (!ready) {
    throw new Error("DEMO_EDITOR_VIEW_NOT_FOUND");
  }

  await interviewerPage.evaluate(() => {
    const host =
      document.querySelector(".cm-host") ??
      Array.from(document.querySelectorAll("div")).find(
        (node) => Boolean(node?.__roomEditorView),
      );
    const view = host?.__roomEditorView ?? null;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    });
  });
  await interviewerPage.waitForTimeout(280);

  for (let i = 1; i <= codeSnippet.length; i += 2) {
    const nextText = codeSnippet.slice(0, i);
    await interviewerPage.evaluate((text) => {
      const host =
        document.querySelector(".cm-host") ??
        Array.from(document.querySelectorAll("div")).find(
          (node) => Boolean(node?.__roomEditorView),
        );
      const view = host?.__roomEditorView ?? null;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    }, nextText);
    await interviewerPage.waitForTimeout(22);
  }

  await interviewerPage.evaluate((expected) => {
    const host =
      document.querySelector(".cm-host") ??
      Array.from(document.querySelectorAll("div")).find(
        (node) => Boolean(node?.__roomEditorView),
      );
    const view = host?.__roomEditorView ?? null;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: expected },
    });
  }, codeSnippet);

  await interviewerPage.waitForFunction(
    (expected) => {
      const host =
        document.querySelector(".cm-host") ??
        Array.from(document.querySelectorAll("div")).find(
          (node) => Boolean(node?.__roomEditorView),
        );
      const view = host?.__roomEditorView ?? null;
      return view?.state?.doc?.toString?.() === expected;
    },
    codeSnippet,
    { timeout: 8000 },
  );

  await candidatePage
    .locator(".cm-content")
    .getByText("function twoSum(nums, target)", { exact: false })
    .waitFor({ timeout: 10000 });
  await candidatePage.waitForFunction(
    (expected) => {
      const host =
        document.querySelector(".cm-host") ??
        Array.from(document.querySelectorAll("div")).find(
          (node) => Boolean(node?.__roomEditorView),
        );
      const view = host?.__roomEditorView ?? null;
      return view?.state?.doc?.toString?.() === expected;
    },
    codeSnippet,
    { timeout: 12000 },
  );
  await interviewerPage.waitForTimeout(1200);
}

async function renderPdfPreviewPng(pdfPath) {
  const previewPath = `${pdfPath}.png`;
  await execFileAsync("qlmanage", [
    "-t",
    "-s",
    "1400",
    "-o",
    downloadsDir,
    pdfPath,
  ]);
  return previewPath;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const browser = await chromium.launch({ headless: true });

let interviewerVideoPath;
let candidateVideoPath;

try {
  await ensureDirs();
  const room = await ensureDemoTaskTitles(await createGuestRoom());

  const interviewerContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 960, height: 1080 },
    recordVideo: { dir: videoDir, size: { width: 960, height: 1080 } },
  });
  const candidateContext = await browser.newContext({
    viewport: { width: 960, height: 1080 },
    recordVideo: { dir: videoDir, size: { width: 960, height: 1080 } },
  });

  const interviewerPage = await interviewerContext.newPage();
  const candidatePage = await candidateContext.newPage();

  await interviewerPage.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await interviewerPage.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Interviewer Demo");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Interviewer Demo");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken,
  });

  await interviewerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, {
    waitUntil: "domcontentloaded",
  });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await interviewerPage.waitForTimeout(900);

  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, {
    waitUntil: "domcontentloaded",
  });
  await enterNameIfPrompted(candidatePage, "Candidate Demo");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await candidatePage.waitForTimeout(900);

  await typeSharedCode(interviewerPage, candidatePage);

  await openTasksPanelIfNeeded(interviewerPage);
  await addCustomBlockNote(
    interviewerPage,
    "Шаг 1",
    "Кандидат быстро нашел идею с hash map, но вначале упустил крайний случай с пустым массивом.",
  );
  await interviewerPage.waitForTimeout(900);
  await addCustomBlockNote(
    interviewerPage,
    "Шаг 2",
    "Во второй задаче хорошо объяснил сложность O(n), уверенно прошел по примерам.",
  );
  await interviewerPage.waitForTimeout(900);
  await addCustomBlockNote(
    interviewerPage,
    "Итог",
    "Итог: strong middle, хорошая коммуникация и уверенный алгоритмический фундамент.",
  );
  await interviewerPage.waitForTimeout(1200);

  await interviewerPage.locator('[data-testid="room-private-notes-export"]').click();
  await interviewerPage
    .getByRole("heading", { name: "Экспорт личных заметок" })
    .waitFor({ timeout: 5000 });
  await interviewerPage.waitForTimeout(900);

  const timestamp = nowStamp();
  const pdfDownloadPromise = interviewerPage.waitForEvent("download", { timeout: 12000 }).catch(() => null);
  await interviewerPage.getByRole("button", { name: "Скачать .pdf" }).click();

  const pdfDownload = await pdfDownloadPromise;
  if (pdfDownload) {
    const pdfPath = path.join(downloadsDir, `private-notes-${timestamp}.pdf`);
    await pdfDownload.saveAs(pdfPath);
    console.log(`DEMO_PDF_SAVED ${pdfPath}`);
    await interviewerPage.waitForTimeout(700);
    try {
      const previewPath = await renderPdfPreviewPng(pdfPath);
      const previewBase64 = await fs.readFile(previewPath, { encoding: "base64" });
      await interviewerPage.setContent(
        `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Exported interview notes PDF preview</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0d1117; }
      .frame {
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        color: #e6edf3;
        font-family: Inter, Arial, sans-serif;
      }
      .bar {
        padding: 10px 14px;
        font-size: 13px;
        border-bottom: 1px solid #273242;
        background: #101924;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #0b1220;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="bar">Экспортированный PDF личных заметок (предпросмотр первой страницы)</div>
      <img alt="PDF preview" src="data:image/png;base64,${previewBase64}" />
    </div>
  </body>
</html>`,
        { waitUntil: "load" },
      );
      await interviewerPage.waitForTimeout(3500);
    } catch {
      await interviewerPage.setContent(
        `<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;display:grid;place-items:center;height:100vh">
    <div style="max-width:720px;padding:24px;border:1px solid #273242;border-radius:12px;background:#101924">
      <h3 style="margin:0 0 10px 0;font-size:18px">PDF сохранен</h3>
      <p style="margin:0 0 8px 0;line-height:1.5">Экспортированный файл успешно скачан.</p>
      <p style="margin:0;word-break:break-all;opacity:.9">${pdfPath}</p>
    </div>
  </body>
</html>`,
        { waitUntil: "load" },
      );
      await interviewerPage.waitForTimeout(2400);
    }
  } else {
    await interviewerPage
      .waitForFunction(
        () => window.__roomLastDownload?.fileName?.endsWith(".pdf") === true,
        null,
        { timeout: 60000 },
      )
      .catch(() => {});
    const lastDownload = await interviewerPage.evaluate(
      () => window.__roomLastDownload ?? null,
    );
    if (!lastDownload || !lastDownload.fileName?.endsWith(".pdf")) {
      throw new Error("DEMO_PDF_EXPORT_NOT_TRIGGERED");
    }
    console.log(`DEMO_PDF_TRIGGERED ${lastDownload.fileName}`);
  }

  await interviewerPage.waitForTimeout(1400);

  await interviewerContext.close();
  await candidateContext.close();

  interviewerVideoPath = await interviewerPage.video()?.path();
  candidateVideoPath = await candidatePage.video()?.path();

  console.log(`DEMO_ROOM_URL ${webBaseUrl}/room/${room.inviteCode}`);
  console.log(`DEMO_VIDEO_INTERVIEWER ${interviewerVideoPath}`);
  console.log(`DEMO_VIDEO_CANDIDATE ${candidateVideoPath}`);
  console.log("DEMO_INTERVIEW_SCENARIO_OK");
} catch (error) {
  console.error("DEMO_INTERVIEW_SCENARIO_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
