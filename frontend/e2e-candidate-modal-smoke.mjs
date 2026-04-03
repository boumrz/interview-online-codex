import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });

try {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.getByRole("button", { name: "Создать комнату" }).click();
  await ownerPage.waitForURL(/\/room\//, { timeout: 15000 });
  const roomUrl = ownerPage.url();

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await candidatePage.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidatePage.getByLabel("Ваше имя").fill("Кандидат");
  await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await candidatePage.reload({ waitUntil: "domcontentloaded" });
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });
  const modalVisibleAfterRefresh = await candidatePage
    .getByText("Представьтесь перед входом в комнату", { exact: true })
    .isVisible()
    .catch(() => false);
  if (modalVisibleAfterRefresh) {
    throw new Error("CANDIDATE_MODAL_VISIBLE_AFTER_REFRESH");
  }
  const ownerControlsVisible = await candidatePage.getByRole("button", { name: "Следующий шаг" }).isVisible().catch(() => false);
  if (ownerControlsVisible) {
    throw new Error("OWNER_CONTROLS_VISIBLE_FOR_CANDIDATE");
  }
  console.log("CANDIDATE_MODAL_OK");
  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("CANDIDATE_MODAL_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
