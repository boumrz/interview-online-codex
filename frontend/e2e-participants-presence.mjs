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
  const promptVisible = await page.getByText("Представьтесь перед входом в комнату").isVisible().catch(() => false);
  if (!promptVisible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
}

async function waitPresence(ownerPage, displayName, status) {
  await ownerPage.waitForFunction(
    ({ displayName, status }) => {
      const badges = Array.from(document.querySelectorAll('[data-testid^="participant-badge-"]'));
      const badge = badges.find((item) => item.textContent?.trim() === displayName);
      if (!badge) return false;
      const testId = badge.getAttribute("data-testid") ?? "";
      return testId === `participant-badge-${status}`;
    },
    { displayName, status },
    { timeout: 10000 }
  );
}

async function waitParticipantCount(ownerPage, displayName, expectedCount) {
  await ownerPage.waitForFunction(
    ({ displayName, expectedCount }) => {
      const badges = Array.from(document.querySelectorAll('[data-testid^="participant-badge-"]'));
      const count = badges.filter((item) => item.textContent?.trim() === displayName).length;
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

  const ownerPage = await ownerContext.newPage();
  const candidatePage = await candidateContext.newPage();
  const roomUrl = `${webBaseUrl}/room/${room.inviteCode}`;

  await ownerPage.goto(roomUrl, { waitUntil: "networkidle" });
  await ownerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await candidatePage.goto(roomUrl, { waitUntil: "networkidle" });
  await enterNameIfPrompted(candidatePage, "Candidate Presence");
  await candidatePage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  await candidatePage.bringToFront();
  await candidatePage.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitPresence(ownerPage, "Candidate Presence", "active");

  await ownerPage.bringToFront();
  await candidatePage.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
  });
  await waitPresence(ownerPage, "Candidate Presence", "away");

  await candidatePage.bringToFront();
  await candidatePage.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitPresence(ownerPage, "Candidate Presence", "active");

  await candidatePage.reload({ waitUntil: "networkidle" });
  await enterNameIfPrompted(candidatePage, "Candidate Presence");
  await candidatePage.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await waitParticipantCount(ownerPage, "Candidate Presence", 1);

  await candidatePage.close();
  await waitParticipantCount(ownerPage, "Candidate Presence", 0);

  console.log("PARTICIPANTS_PRESENCE_OK");

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("PARTICIPANTS_PRESENCE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
