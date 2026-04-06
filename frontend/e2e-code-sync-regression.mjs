import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const nickname = `sync_${Date.now()}`;
const password = "secret123";

async function registerAndCreateRoom() {
  const registerResponse = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password })
  });
  const auth = await registerResponse.json();
  if (!registerResponse.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(auth)}`);
  }

  const createRoomResponse = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({ title: "Sync Regression Room", language: "nodejs", taskIds: [] })
  });
  const room = await createRoomResponse.json();
  if (!createRoomResponse.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }

  return { auth, room };
}

async function modelValue(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".cm-host");
    const view = host?.__roomEditorView ?? null;
    if (view?.state?.doc?.toString) {
      return view.state.doc.toString();
    }
    const content = document.querySelector(".cm-content");
    if (!content) return null;
    const raw = content.innerText ?? "";
    return raw
      .replace(/[\u200b\u200c\u200d\u200e\u200f\u2060-\u206f\ufeff]/g, "")
      .replace(/\n+$/g, "");
  });
}

function normalizeSnapshot(value) {
  return value
    .replace(/\u200b/g, "")
    .replaceAll("Owner QA", "")
    .replaceAll("Candidate QA", "")
    .replaceAll(nickname, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function waitForFragments(page, fragments, timeout = 12000) {
  await page.waitForFunction(
    ({ fragments }) => {
      const host = document.querySelector(".cm-host");
      const view = host?.__roomEditorView ?? null;
      const raw =
        (view?.state?.doc?.toString ? view.state.doc.toString() : null) ??
        (document.querySelector(".cm-content")?.innerText ?? "");
      const normalized = raw
        .replace(/[\u200b\u200c\u200d\u200e\u200f\u2060-\u206f\ufeff]/g, "")
        .replaceAll("Owner QA", "")
        .replaceAll("Candidate QA", "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return fragments.every((fragment) => normalized.includes(fragment));
    },
    { fragments },
    { timeout }
  );
}

const appendedText = "function solve(a, b) {\n  return a + b;\n}\nalpha\nbeta\ngamma\ndelta\nepsilon";
const splitAt = 18;

const browser = await chromium.launch({ headless: true });

try {
  const { auth, room } = await registerAndCreateRoom();

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, token, user }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.removeItem(`owner_token_${inviteCode}`);
      localStorage.setItem("display_name", "Owner QA");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner QA");
    },
    { inviteCode: room.inviteCode, token: auth.token, user: auth.user }
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await candidatePage.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidatePage.getByLabel("Ваше имя").fill("Candidate QA");
  await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const initialValue = await modelValue(ownerPage);
  if (initialValue == null) {
    throw new Error("OWNER_EDITOR_VIEW_NOT_FOUND");
  }
  const expectedValue = `${initialValue}${appendedText}`;
  const firstHalf = appendedText.slice(0, splitAt);
  const secondHalf = appendedText.slice(splitAt);

  await ownerPage.bringToFront();
  await ownerPage.locator(".cm-content").click({ force: true });
  await ownerPage.keyboard.press("End");
  await ownerPage.keyboard.type(firstHalf, { delay: 8 });
  await ownerPage.waitForTimeout(300);
  await ownerPage.keyboard.type(secondHalf, { delay: 8 });

  const requiredFragments = [
    "function solve(a, b) {",
    "return a + b;",
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon"
  ];
  await waitForFragments(ownerPage, requiredFragments, 12000);
  await waitForFragments(candidatePage, requiredFragments, 12000);

  const ownerValue = await modelValue(ownerPage);
  const candidateValue = await modelValue(candidatePage);
  if (ownerValue == null || candidateValue == null) {
    throw new Error("EDITOR_VIEW_NOT_FOUND_AFTER_TYPING");
  }

  const ownerNormalized = normalizeSnapshot(ownerValue);
  const candidateNormalized = normalizeSnapshot(candidateValue);
  const expectedNormalized = normalizeSnapshot(expectedValue);

  const ownerMissing = requiredFragments.filter((fragment) => !ownerNormalized.includes(fragment));
  const candidateMissing = requiredFragments.filter((fragment) => !candidateNormalized.includes(fragment));
  const baselineMissing = !ownerNormalized.includes(expectedNormalized.slice(0, Math.min(24, expectedNormalized.length))) ||
    !candidateNormalized.includes(expectedNormalized.slice(0, Math.min(24, expectedNormalized.length)));

  if (ownerMissing.length > 0 || candidateMissing.length > 0 || baselineMissing) {
    throw new Error(
      `CODE_SYNC_REGRESSION_FAILED\nEXPECTED:\n${expectedValue}\n\nOWNER:\n${ownerValue}\n\nCANDIDATE:\n${candidateValue}\n\nOWNER_MISSING:${ownerMissing.join(",")}\nCANDIDATE_MISSING:${candidateMissing.join(",")}`
    );
  }

  console.log("CODE_SYNC_REGRESSION_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} finally {
  await browser.close();
}
