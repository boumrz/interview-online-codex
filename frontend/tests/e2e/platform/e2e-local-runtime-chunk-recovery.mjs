import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const roomUrl = `${baseUrl}/room/runtime-chunk-recovery`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertDirectRoomNavigation(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const response = await page.goto(roomUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const documentText = await page.locator("body").innerText();

    assert(response?.status() === 200, `ROOM_DEEP_LINK_STATUS=${response?.status()}`);
    assert(!documentText.includes("Cannot GET"), "ROOM_DEEP_LINK_RETURNED_SERVER_404");
    await page.waitForSelector("#root", { state: "attached", timeout: 10_000 });
  } finally {
    await context.close();
  }
}

async function assertStaleRoomChunkRecovers(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let roomChunkWasAborted = false;
  let roomDocumentRequests = 0;
  const pageErrors = [];

  page.on("request", (request) => {
    if (request.resourceType() === "document" && request.url() === roomUrl) {
      roomDocumentRequests += 1;
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!roomChunkWasAborted && request.resourceType() === "script" && request.url().includes("RoomPage")) {
      roomChunkWasAborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  try {
    await page.goto(roomUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const reloadDeadline = Date.now() + 15_000;
    while (roomDocumentRequests < 2 && Date.now() < reloadDeadline) {
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(
      () => !document.body.innerText.includes("ChunkLoadError") && document.getElementById("root")?.childElementCount,
      undefined,
      { timeout: 15_000 },
    );

    assert(roomChunkWasAborted, "ROOM_CHUNK_WAS_NOT_REQUESTED");
    assert(roomDocumentRequests === 2, `CHUNK_RECOVERY_RELOAD_COUNT=${roomDocumentRequests}`);
    assert(!pageErrors.some((message) => message.includes("ChunkLoadError")), `CHUNK_ERROR_REMAINS=${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  await assertDirectRoomNavigation(browser);
  await assertStaleRoomChunkRecovers(browser);
  console.log("LOCAL_RUNTIME_CHUNK_RECOVERY_OK");
} catch (error) {
  console.error("LOCAL_RUNTIME_CHUNK_RECOVERY_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
