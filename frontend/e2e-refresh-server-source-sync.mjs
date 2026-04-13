import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const nickname = `rs_${Date.now().toString(36).slice(-8)}`;
const password = "secret123";

function normalizeEditorSnapshot(value) {
  return value
    .replace(/[\u200b\u200c\u200d\u200e\u200f\u2060-\u206f\ufeff]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+$/g, "")
    .trim();
}

function countOccurrences(text, marker) {
  if (!marker) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = text.indexOf(marker, from);
    if (index < 0) return count;
    count += 1;
    from = index + marker.length;
  }
}

async function editorValue(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    if (host?.__roomEditorView?.state?.doc?.toString) {
      return host.__roomEditorView.state.doc.toString();
    }
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view =
      anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    if (view?.state?.doc?.toString) {
      return view.state.doc.toString();
    }
    const content = document.querySelector(".cm-content");
    return content?.textContent ?? "";
  });
}

async function waitForMarkers(page, markers) {
  await page.waitForFunction(
    ({ markers }) => {
      let rawText = "";
      const host = document.querySelector("[data-testid='room-code-editor-host']");
      if (host?.__roomEditorView?.state?.doc?.toString) {
        rawText = host.__roomEditorView.state.doc.toString();
      } else {
        const editor = document.querySelector(".cm-editor");
        const anyEditor = editor;
        const view =
          anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
        if (view?.state?.doc?.toString) {
          rawText = view.state.doc.toString();
        } else {
          rawText = document.querySelector(".cm-content")?.textContent ?? "";
        }
      }
      const normalized = rawText
        .replace(/[\u200b\u200c\u200d\u200e\u200f\u2060-\u206f\ufeff]/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n+$/g, "")
        .trim();
      return markers.every((marker) => normalized.includes(marker));
    },
    { markers },
    { timeout: 15000 }
  );
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

async function registerAndCreateRoom() {
  const registerResponse = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password })
  });
  const auth = await registerResponse.json();
  if (!registerResponse.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(auth)}`);
  }

  const seedTaskResponse = await fetch(`${apiBaseUrl}/me/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({
      title: `Seed ${nickname}`,
      description: "Refresh sync seed task",
      starterCode: "function solve() {\n  return null;\n}\n",
      language: "nodejs"
    })
  });
  const seedTask = await seedTaskResponse.json();
  if (!seedTaskResponse.ok) {
    throw new Error(`SEED_TASK_FAILED ${JSON.stringify(seedTask)}`);
  }

  const createRoomResponse = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({ title: "Refresh Server Source Sync", language: "nodejs", taskIds: [seedTask.id] })
  });
  const room = await createRoomResponse.json();
  if (!createRoomResponse.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }

  return { auth, room };
}

async function joinAsCandidate(page) {
  const modal = page.locator("[role='dialog']");
  const hasVisibleModal = await modal.first().isVisible().catch(() => false);
  if (!hasVisibleModal) return;
  await modal.locator("input").first().fill("Candidate Refresh");
  await modal.locator("button").first().click();
  await modal.first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

const browser = await chromium.launch({ headless: true });

try {
  const { auth, room } = await registerAndCreateRoom();
  const markerA = `server_marker_a_${Date.now()}`;
  const markerB = `server_marker_b_${Date.now()}`;

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, token, user }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.removeItem(`owner_token_${inviteCode}`);
      localStorage.setItem("display_name", "Owner Refresh");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner Refresh");
    },
    { inviteCode: room.inviteCode, token: auth.token, user: auth.user }
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await waitForEditableCodeEditor(ownerPage);

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await joinAsCandidate(candidatePage);
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await appendToCodeEditorModel(ownerPage, `\n${markerA}\n${markerB}`);

  // Refresh quickly, before delayed DB save, to assert server realtime state remains the source of truth.
  await ownerPage.waitForTimeout(160);
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await waitForEditableCodeEditor(ownerPage);

  await waitForMarkers(ownerPage, [markerA, markerB]);
  await waitForMarkers(candidatePage, [markerA, markerB]);

  const ownerSnapshot = await editorValue(ownerPage);
  const candidateSnapshot = await editorValue(candidatePage);
  if (ownerSnapshot == null || candidateSnapshot == null) {
    throw new Error("REFRESH_SYNC_EDITOR_NOT_FOUND");
  }

  const ownerNormalized = normalizeEditorSnapshot(ownerSnapshot);
  const candidateNormalized = normalizeEditorSnapshot(candidateSnapshot);
  const missingInOwner = [markerA, markerB].filter((marker) => !ownerNormalized.includes(marker));
  const missingInCandidate = [markerA, markerB].filter((marker) => !candidateNormalized.includes(marker));

  if (missingInOwner.length > 0 || missingInCandidate.length > 0) {
    throw new Error(
      `REFRESH_SERVER_SOURCE_SYNC_FAILED\nOWNER_MISSING:${missingInOwner.join(",")}\nCANDIDATE_MISSING:${missingInCandidate.join(",")}\nOWNER:\n${ownerNormalized}\nCANDIDATE:\n${candidateNormalized}`
    );
  }
  for (const marker of [markerA, markerB]) {
    const ownerCount = countOccurrences(ownerNormalized, marker);
    const candidateCount = countOccurrences(candidateNormalized, marker);
    if (ownerCount !== 1 || candidateCount !== 1) {
      throw new Error(
        `REFRESH_SERVER_SOURCE_SYNC_DUPLICATE marker=${marker} ownerCount=${ownerCount} candidateCount=${candidateCount}\nOWNER:\n${ownerNormalized}\nCANDIDATE:\n${candidateNormalized}`
      );
    }
  }

  console.log("REFRESH_SERVER_SOURCE_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("REFRESH_SERVER_SOURCE_SYNC_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
