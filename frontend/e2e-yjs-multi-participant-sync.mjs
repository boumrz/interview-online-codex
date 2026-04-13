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

async function waitForEditableCodeEditor(page) {
  await page.waitForFunction(
    () => {
      const editor = document.querySelector(
        "[data-testid='room-code-editor-host'] .cm-editor"
      );
      return Boolean(editor) && !editor.classList.contains("cm-readOnly");
    },
    null,
    { timeout: 15000 }
  );
}

async function appendToCodeEditorModel(page, text) {
  await page.evaluate((insertText) => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    const view = host?.__roomEditorView;
    if (!view?.state?.doc) {
      throw new Error("CODE_EDITOR_VIEW_NOT_FOUND");
    }
    const len = view.state.doc.length;
    view.dispatch({
      changes: { from: len, to: len, insert: insertText },
      selection: { anchor: len + insertText.length, head: len + insertText.length }
    });
  }, text);
}

async function modelValue(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    if (host?.__roomEditorView?.state?.doc?.toString) {
      return host.__roomEditorView.state.doc.toString();
    }
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    if (view?.state?.doc?.toString) {
      return view.state.doc.toString();
    }
    return document.querySelector(".cm-content")?.textContent ?? "";
  });
}

function countOccurrences(text, marker) {
  if (!marker) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const next = text.indexOf(marker, offset);
    if (next < 0) return count;
    count += 1;
    offset = next + marker.length;
  }
}

function assertSingleOccurrence(values, markers, label) {
  values.forEach((value, idx) => {
    markers.forEach((marker) => {
      const count = countOccurrences(value, marker);
      if (count !== 1) {
        throw new Error(
          `${label}_DUPLICATE_MARKER marker=${marker} count=${count} page=${idx}\n${value}`
        );
      }
    });
  });
}

async function typeByEdits(page, text, delayMs = 18, fallbackName = "Candidate") {
  await enterNameIfPrompted(page, fallbackName);
  const content = page.locator("[data-testid='room-code-editor-host'] .cm-content");
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
  await waitForEditableCodeEditor(ownerPage);

  await candidateAPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateAPage, "Candidate A");
  await candidateAPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidateBPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateBPage, "Candidate B");
  await candidateBPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidateCPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidateCPage, "Candidate C");
  await candidateCPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await appendToCodeEditorModel(ownerPage, " alpha_yjs_A  beta_yjs_B  gamma_yjs_C ");

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
  assertSingleOccurrence(values, markers, "MULTI_PARTICIPANT_SYNC_INITIAL");

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
  assertSingleOccurrence(afterReload, markers, "MULTI_PARTICIPANT_SYNC_AFTER_RELOAD");

  console.log("YJS_MULTI_PARTICIPANT_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateAContext.close();
  await candidateBContext.close();
  await candidateCContext.close();
} finally {
  await browser.close();
}
