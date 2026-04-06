import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError;
}

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const visible = await title.isVisible().catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

function parseInviteCode(url) {
  const match = url.match(/\/room\/([^/?#]+)/);
  return match ? match[1] : null;
}

const browser = await chromium.launch({ headless: true });

try {
  const interviewerContext = await browser.newContext();
  const interviewerPage = await interviewerContext.newPage();
  await gotoWithRetry(interviewerPage, webBaseUrl);
  await interviewerPage.getByRole("button", { name: "Создать комнату" }).click();
  await interviewerPage.waitForURL(/\/room\//, { timeout: 15000 });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const inviteCode = parseInviteCode(interviewerPage.url());
  if (!inviteCode) throw new Error(`INVITE_CODE_PARSE_FAILED url=${interviewerPage.url()}`);

  // Expectations for the new markdown explainer block:
  // - Interviewer: editor + preview
  // - Candidate: preview only
  const markdownEditor = interviewerPage.locator('[data-testid="room-markdown-editor"]');
  const markdownPreview = interviewerPage.locator('[data-testid="room-markdown-preview"]');
  if (!(await markdownEditor.isVisible().catch(() => false))) {
    throw new Error("MARKDOWN_EXPLAINER_EDITOR_NOT_FOUND (expected data-testid=room-markdown-editor)");
  }
  if (!(await markdownPreview.isVisible().catch(() => false))) {
    throw new Error("MARKDOWN_EXPLAINER_PREVIEW_NOT_FOUND (expected data-testid=room-markdown-preview)");
  }

  const content = `# Header

**bold** and list:
- a
- b

| Left columns  | Right columns |
| ------------- |:-------------:|
| left foo      | right foo     |
| left bar      | right bar     |
| left baz      | right baz     |

| Column | qweqweqwe |
| - | - |
| - | - |
| - | - |
`;
  await markdownEditor.fill(content);

  // Candidate should receive the rendered preview.
  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await gotoWithRetry(candidatePage, `${webBaseUrl}/room/${inviteCode}`);
  await enterNameIfPrompted(candidatePage, "Candidate Markdown");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const candidateEditor = candidatePage.locator('[data-testid="room-markdown-editor"]');
  const candidatePreview = candidatePage.locator('[data-testid="room-markdown-preview"]');
  const candidateHasEditor = await candidateEditor.isVisible().catch(() => false);
  if (candidateHasEditor) {
    throw new Error("CANDIDATE_SHOULD_NOT_SEE_MARKDOWN_EDITOR");
  }
  await candidatePreview.waitFor({ state: "visible", timeout: 8000 });

  await candidatePage.getByRole("heading", { name: "Header", exact: true }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("bold", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePreview.locator("table").first().waitFor({ state: "visible", timeout: 12000 });
  await candidatePage.getByText("left baz", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("right baz", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("qweqweqwe", { exact: false }).waitFor({ timeout: 12000 });

  console.log("MARKDOWN_EXPLAINER_SMOKE_OK", inviteCode);

  await interviewerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("MARKDOWN_EXPLAINER_SMOKE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
