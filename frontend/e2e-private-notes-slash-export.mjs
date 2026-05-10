import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Private notes room ${Date.now()}`,
      ownerDisplayName: "Owner QA",
      language: "nodejs",
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function openTasksPanelIfNeeded(page) {
  const privateInput = page.locator('[data-testid="room-private-notes-input"]');
  if (await privateInput.isVisible().catch(() => false)) return;

  const mobileTasksTab = page.getByRole("tab", { name: /^Tasks$/ }).first();
  if (await mobileTasksTab.isVisible().catch(() => false)) {
    await mobileTasksTab.click();
    if (await privateInput.isVisible().catch(() => false)) return;
  }

  // The left-rail "Задачи" button (was "Открыть панель задач" before we
  // added a caption + new aria-label). Using data-testid so future copy
  // tweaks don't break this test.
  const tasksRailButton = page.locator('[data-testid="room-rail-tasks"]');
  if (await tasksRailButton.isVisible().catch(() => false)) {
    await tasksRailButton.click();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();
  if (!room.ownerToken) {
    throw new Error("ROOM_OWNER_TOKEN_MISSING");
  }

  const ownerContext1 = await browser.newContext({ acceptDownloads: true });
  const ownerContext2 = await browser.newContext({ acceptDownloads: true });
  const ownerPage1 = await ownerContext1.newPage();
  const ownerPage2 = await ownerContext2.newPage();

  await ownerPage1.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage1.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Owner QA 1");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner QA 1");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken,
  });
  await ownerPage1.goto(`${webBaseUrl}/room/${room.inviteCode}`, {
    waitUntil: "domcontentloaded",
  });
  await ownerPage1.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openTasksPanelIfNeeded(ownerPage1);

  const privateInput = ownerPage1.locator(
    '[data-testid="room-private-notes-input"]',
  );
  const privateSend = ownerPage1.locator(
    '[data-testid="room-private-notes-send"]',
  );
  await privateInput.waitFor({ timeout: 10000 });

  await privateInput.fill("/block Практика");
  await privateSend.click();
  await ownerPage1.getByText("Блок: Практика", { exact: false }).waitFor({
    timeout: 5000,
  });

  const privateMessage = `личная заметка ${Date.now()}`;
  await privateInput.fill(privateMessage);
  await privateSend.click();
  await ownerPage1.getByText(privateMessage, { exact: false }).waitFor({
    timeout: 8000,
  });

  await privateInput.fill("/");
  await ownerPage1
    .locator('[data-testid="room-private-notes-command-menu"]')
    .waitFor({ timeout: 5000 });
  const endBlockShortcutCount = await ownerPage1
    .getByRole("button", { name: "/endblock" })
    .count();
  if (endBlockShortcutCount > 0) {
    throw new Error("PRIVATE_NOTES_ENDBLOCK_SHORTCUT_SHOULD_NOT_EXIST");
  }
  await privateInput.fill("");

  await ownerPage1
    .locator('[data-testid="room-private-notes-active-block-close"]')
    .click();
  const activeBlockVisibleAfterEnd = await ownerPage1
    .getByText("Блок: Практика", { exact: false })
    .isVisible()
    .catch(() => false);
  if (activeBlockVisibleAfterEnd) {
    throw new Error("PRIVATE_NOTES_CLOSE_BADGE_DID_NOT_CLOSE_BLOCK");
  }

  await ownerPage1
    .locator('[data-testid="room-private-notes-export"]')
    .click();
  await ownerPage1
    .getByRole("heading", { name: "Экспорт личных заметок" })
    .waitFor({ timeout: 5000 });
  const mdDownloadPromise = ownerPage1.waitForEvent("download");
  await ownerPage1.getByRole("button", { name: "Скачать .md" }).click();
  const mdDownload = await mdDownloadPromise;
  const mdName = mdDownload.suggestedFilename();
  if (!mdName.endsWith(".md")) {
    throw new Error(`PRIVATE_NOTES_MD_EXPORT_FILENAME_INVALID:${mdName}`);
  }
  const pdfDownloadPromise = ownerPage1
    .waitForEvent("download", { timeout: 5000 })
    .catch(() => null);
  await ownerPage1.getByRole("button", { name: "Скачать .pdf" }).click();
  const pdfDownload = await pdfDownloadPromise;
  if (pdfDownload) {
    const pdfName = pdfDownload.suggestedFilename();
    if (!pdfName.endsWith(".pdf")) {
      throw new Error(`PRIVATE_NOTES_PDF_EXPORT_FILENAME_INVALID:${pdfName}`);
    }
  } else {
    await ownerPage1
      .waitForFunction(
        () => window.__roomLastDownload?.fileName?.endsWith(".pdf") === true,
        null,
        { timeout: 60000 },
      )
      .catch(() => {});
    const lastDownload = await ownerPage1.evaluate(
      () => window.__roomLastDownload ?? null,
    );
    if (!lastDownload || !lastDownload.fileName?.endsWith(".pdf")) {
      throw new Error("PRIVATE_NOTES_PDF_EXPORT_NOT_TRIGGERED");
    }
  }
  await ownerPage1.getByRole("button", { name: "Close" }).click().catch(() => {});

  await ownerPage2.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage2.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Owner QA 2");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner QA 2");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken,
  });
  await ownerPage2.goto(`${webBaseUrl}/room/${room.inviteCode}`, {
    waitUntil: "domcontentloaded",
  });
  await ownerPage2.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openTasksPanelIfNeeded(ownerPage2);
  await ownerPage2
    .locator('[data-testid="room-private-notes-input"]')
    .waitFor({ timeout: 8000 });

  const otherOwnerSeesPrivateText = await ownerPage2
    .getByText(privateMessage, { exact: false })
    .isVisible()
    .catch(() => false);
  if (otherOwnerSeesPrivateText) {
    throw new Error("PRIVATE_NOTES_SHOULD_BE_PRIVATE_PER_USER");
  }

  console.log("PRIVATE_NOTES_SLASH_EXPORT_OK");

  await ownerContext1.close();
  await ownerContext2.close();
} catch (error) {
  console.error("PRIVATE_NOTES_SLASH_EXPORT_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
