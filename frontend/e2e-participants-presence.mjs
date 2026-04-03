import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Presence room ${Date.now()}`,
      ownerDisplayName: "Host Presence",
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

async function waitParticipantCount(ownerPage, displayName, expectedCount) {
  await ownerPage.waitForFunction(
    ({ displayName, expectedCount }) => {
      const badges = Array.from(document.querySelectorAll('[data-testid^="participant-badge-"]'));
      const count = badges.filter((item) => item.textContent?.includes(displayName)).length;
      return count === expectedCount;
    },
    { displayName, expectedCount },
    { timeout: 12000 }
  );
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
    localStorage.setItem("display_name", "Host Presence");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host Presence");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });

  const candidateContext = await browser.newContext();
  await candidateContext.addInitScript(({ inviteCode }) => {
    localStorage.setItem("display_name", "Candidate Presence");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Candidate Presence");
  }, {
    inviteCode: room.inviteCode
  });

  const ownerPage = await ownerContext.newPage();
  const candidatePage = await candidateContext.newPage();
  const roomUrl = `${webBaseUrl}/room/${room.inviteCode}`;

  await ownerPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await candidatePage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate Presence");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  await waitParticipantCount(ownerPage, "Candidate Presence", 1);

  await candidatePage.reload({ waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate Presence");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await waitParticipantCount(ownerPage, "Candidate Presence", 1);

  await candidatePage.close();

  console.log("PARTICIPANTS_PRESENCE_OK");

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("PARTICIPANTS_PRESENCE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
