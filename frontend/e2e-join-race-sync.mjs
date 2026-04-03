import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Join Race ${Date.now()}`,
      ownerDisplayName: "Owner Join Race",
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

async function waitModelContains(page, marker) {
  await page.waitForFunction(
    (token) => {
      const editor = document.querySelector(".cm-editor");
      const anyEditor = editor;
      const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
      const value = view?.state?.doc?.toString ? view.state.doc.toString() : (document.querySelector(".cm-content")?.textContent ?? "");
      return typeof value === "string" && value.includes(token);
    },
    marker,
    { timeout: 20000 }
  );
}

async function appendText(page, text) {
  await page.locator(".cm-content").click({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 8 });
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();
  if (!room.ownerToken) {
    throw new Error("OWNER_TOKEN_MISSING");
  }

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Owner Join Race");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner Join Race");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });

  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const candidatePages = [];
  const candidateContexts = [];

  for (let i = 0; i < 3; i += 1) {
    await appendText(ownerPage, `\nowner-typing-before-join-${i}`);

    const context = await browser.newContext();
    candidateContexts.push(context);
    const page = await context.newPage();
    candidatePages.push(page);
    await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await enterNameIfPrompted(page, `Candidate ${i + 1}`);
    await page.locator(".cm-editor").waitFor({ timeout: 15000 });
    await page.waitForTimeout(220);
  }

  const finalMarker = `__join_race_done_${Date.now()}__`;
  await appendText(ownerPage, `\n${finalMarker}`);
  await waitModelContains(ownerPage, finalMarker);
  await ownerPage.waitForTimeout(1500);

  for (const page of candidatePages) {
    await page.waitForFunction(
      (marker) => {
        const editor = document.querySelector(".cm-editor");
        const anyEditor = editor;
        const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
        const value = view?.state?.doc?.toString ? view.state.doc.toString() : (document.querySelector(".cm-content")?.textContent ?? "");
        return typeof value === "string" && value.includes(marker);
      },
      finalMarker,
      { timeout: 45000 }
    );
  }

  console.log("JOIN_RACE_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  for (const context of candidateContexts) {
    await context.close();
  }
} finally {
  await browser.close();
}
