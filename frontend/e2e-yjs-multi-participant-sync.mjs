import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Yjs multi sync ${Date.now()}`,
      ownerDisplayName: "Owner Multi",
      language: "nodejs"
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const visible = await title.isVisible().catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function modelValue(page) {
  return page.evaluate(() => window.monaco?.editor?.getModels?.()[0]?.getValue() ?? "");
}

async function typeByEdits(page, text, delayMs = 18) {
  for (const ch of text) {
    await page.evaluate((char) => {
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      const editor = editors[0];
      const model = editor?.getModel?.();
      if (!editor || !model) return;
      const line = model.getLineCount();
      const column = model.getLineMaxColumn(line);
      editor.executeEdits("e2e-multi-sync", [
        {
          range: new window.monaco.Range(line, column, line, column),
          text: char,
          forceMoveMarkers: true
        }
      ]);
    }, ch);
    await page.waitForTimeout(delayMs);
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();
  if (!room.ownerToken) throw new Error("OWNER_TOKEN_MISSING");
  const roomUrl = `${webBaseUrl}/room/${room.inviteCode}`;

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Owner Multi");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner Multi");
  }, { inviteCode: room.inviteCode, ownerToken: room.ownerToken });

  const candidateAContext = await browser.newContext();
  const candidateBContext = await browser.newContext();
  const candidateCContext = await browser.newContext();

  const ownerPage = await ownerContext.newPage();
  const candidateAPage = await candidateAContext.newPage();
  const candidateBPage = await candidateBContext.newPage();
  const candidateCPage = await candidateCContext.newPage();

  await ownerPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await candidateAPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateAPage, "Candidate A");
  await candidateAPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await candidateBPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateBPage, "Candidate B");
  await candidateBPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await candidateCPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateCPage, "Candidate C");
  await candidateCPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await Promise.all([
    typeByEdits(candidateAPage, " alpha_yjs_A "),
    typeByEdits(candidateBPage, " beta_yjs_B "),
    typeByEdits(candidateCPage, " gamma_yjs_C ")
  ]);

  await ownerPage.waitForTimeout(3500);

  const values = await Promise.all([
    modelValue(ownerPage),
    modelValue(candidateAPage),
    modelValue(candidateBPage),
    modelValue(candidateCPage)
  ]);
  const [ownerValue, candidateAValue, candidateBValue, candidateCValue] = values;
  const allEqual =
    ownerValue === candidateAValue &&
    ownerValue === candidateBValue &&
    ownerValue === candidateCValue;
  if (!allEqual) {
    throw new Error(
      `MULTI_PARTICIPANT_SYNC_FAILED\nowner=${ownerValue.length}\na=${candidateAValue.length}\nb=${candidateBValue.length}\nc=${candidateCValue.length}`
    );
  }

  console.log("YJS_MULTI_PARTICIPANT_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateAContext.close();
  await candidateBContext.close();
  await candidateCContext.close();
} finally {
  await browser.close();
}
