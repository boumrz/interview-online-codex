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
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    if (view?.state?.doc?.toString) {
      return view.state.doc.toString();
    }
    return document.querySelector(".cm-content")?.textContent ?? "";
  });
}

async function typeByEdits(page, text, delayMs = 18, fallbackName = "Candidate") {
  await enterNameIfPrompted(page, fallbackName);
  const content = page.locator(".cm-content");
  await content.click({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: delayMs });
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
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidateAPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateAPage, "Candidate A");
  await candidateAPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidateBPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateBPage, "Candidate B");
  await candidateBPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidateCPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateCPage, "Candidate C");
  await candidateCPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await Promise.all([
    typeByEdits(candidateAPage, " alpha_yjs_A ", 18, "Candidate A"),
    typeByEdits(candidateBPage, " beta_yjs_B ", 18, "Candidate B"),
    typeByEdits(candidateCPage, " gamma_yjs_C ", 18, "Candidate C")
  ]);

  await ownerPage.waitForTimeout(12000);

  const values = await Promise.all([
    modelValue(ownerPage),
    modelValue(candidateAPage),
    modelValue(candidateBPage),
    modelValue(candidateCPage)
  ]);
  const [ownerValue, candidateAValue, candidateBValue, candidateCValue] = values;
  const markers = ["alpha_yjs_A", "beta_yjs_B", "gamma_yjs_C"];
  const hasAllMarkers = (text) => markers.every((m) => text.includes(m));
  const allHaveContent = values.every(hasAllMarkers);
  if (!allHaveContent) {
    throw new Error(
      `MULTI_PARTICIPANT_SYNC_FAILED (missing markers)\nowner(${ownerValue.length})=${ownerValue}\na(${candidateAValue.length})=${candidateAValue}\nb(${candidateBValue.length})=${candidateBValue}\nc(${candidateCValue.length})=${candidateCValue}`
    );
  }

  // Hard reload one participant: must converge again from server snapshot + SSE (regression: stale yjs on server).
  await candidateBPage.reload({ waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateBPage, "Candidate B");
  await candidateBPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await candidateBPage.waitForTimeout(14000);

  const afterReload = await Promise.all([
    modelValue(ownerPage),
    modelValue(candidateAPage),
    modelValue(candidateBPage),
    modelValue(candidateCPage)
  ]);
  if (!afterReload.every(hasAllMarkers)) {
    throw new Error(
      `MULTI_PARTICIPANT_SYNC_FAILED_AFTER_RELOAD\n${afterReload.map((v, i) => `${i}:(${v.length})=${v}`).join("\n")}`
    );
  }

  // Remote awareness carets (y-protocols) must appear — catches frozen/missing cursors after reload.
  await ownerPage.waitForFunction(
    () => document.querySelectorAll(".cm-ySelectionCaret").length >= 2,
    null,
    { timeout: 25_000 }
  );
  await candidateBPage.waitForFunction(
    () => document.querySelectorAll(".cm-ySelectionCaret").length >= 2,
    null,
    { timeout: 25_000 }
  );

  console.log("YJS_MULTI_PARTICIPANT_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateAContext.close();
  await candidateBContext.close();
  await candidateCContext.close();
} finally {
  await browser.close();
}
