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
  const visible = await title
    .waitFor({ state: "visible", timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function fillMarkdownEditor(page, content) {
  const editorRoot = page.locator('[data-testid="room-markdown-editor"]');
  await editorRoot.waitFor({ state: "visible", timeout: 8000 });
  const editable = editorRoot.locator(".cm-content");
  await editable.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(content);
}

async function assertMarkdownEditorHighlighting(page) {
  const editorRoot = page.locator('[data-testid="room-markdown-editor"]');
  await editorRoot.locator(".cm-gutters").waitFor({ state: "visible", timeout: 8000 });
  await editorRoot.locator(".cm-lineNumbers").waitFor({ state: "visible", timeout: 8000 });
  await editorRoot.locator(".cm-line").filter({ hasText: "| Left columns" }).first().waitFor({
    state: "visible",
    timeout: 8000,
  });

  const tokenizedSpanCount = await editorRoot.locator(".cm-content span[class]").count();
  if (tokenizedSpanCount < 8) {
    throw new Error(`MARKDOWN_EDITOR_TOKENS_MISSING count=${tokenizedSpanCount}`);
  }

  const codeLine = editorRoot.locator(".cm-line").filter({ hasText: "answer" }).first();
  await codeLine.waitFor({ state: "visible", timeout: 8000 });
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-testid="room-markdown-editor"]');
      const lines = Array.from(root?.querySelectorAll(".cm-line") ?? []);
      const line = lines.find((item) => item.textContent?.includes("answer"));
      return (line?.querySelectorAll("span[class]").length ?? 0) >= 2;
    },
    undefined,
    { timeout: 8000 },
  ).catch(() => {});
  const codeTokenSpanCount = await codeLine.locator("span[class]").count();
  if (codeTokenSpanCount < 2) {
    throw new Error(`MARKDOWN_EDITOR_CODE_TOKENS_MISSING count=${codeTokenSpanCount}`);
  }
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
  await interviewerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });

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
  const codeBlockButtonLabel = (await interviewerPage.getByRole("button", { name: "Code block" }).textContent())?.trim();
  if (codeBlockButtonLabel !== "Code" || codeBlockButtonLabel.includes("`")) {
    throw new Error(`MARKDOWN_CODEBLOCK_BUTTON_LABEL_BAD label=${codeBlockButtonLabel}`);
  }
  const placeholderNodeCount = await markdownEditor.locator(".cm-placeholder").count();
  if (placeholderNodeCount !== 0) {
    throw new Error(`MARKDOWN_EDITOR_PLACEHOLDER_NODE_PRESENT count=${placeholderNodeCount}`);
  }
  const oldPlaceholderCount = await markdownEditor.getByText("Например:", { exact: false }).count();
  if (oldPlaceholderCount !== 0) {
    throw new Error(`MARKDOWN_EDITOR_OLD_PLACEHOLDER_PRESENT count=${oldPlaceholderCount}`);
  }

  const content = `# Header

**bold** and list:
- a
- b

> Read carefully before coding.

1. First numbered item
2. Second numbered item

- [x] Checked task
- [ ] Open task

~~~ts
const answer: number = 42;
~~~

[safe link](https://example.com)
[unsafe link](javascript:alert("xss"))
<img src="x" onerror="window.__markdownXss = true">
<script>window.__markdownXss = true</script>

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
  await fillMarkdownEditor(interviewerPage, content);
  await assertMarkdownEditorHighlighting(interviewerPage);

  // Candidate should receive the rendered preview.
  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await gotoWithRetry(candidatePage, `${webBaseUrl}/room/${inviteCode}`);
  await enterNameIfPrompted(candidatePage, "Candidate Markdown");
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });

  const candidateEditor = candidatePage.locator('[data-testid="room-markdown-editor"]');
  const candidatePreview = candidatePage.locator('[data-testid="room-markdown-preview"]');
  const candidateHasEditor = await candidateEditor.isVisible().catch(() => false);
  if (candidateHasEditor) {
    throw new Error("CANDIDATE_SHOULD_NOT_SEE_MARKDOWN_EDITOR");
  }
  await candidatePreview.waitFor({ state: "visible", timeout: 8000 });

  await candidatePage.getByRole("heading", { name: "Header", exact: true }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("bold", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePreview.locator("blockquote").getByText("Read carefully", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePreview.locator("ol li").getByText("Second numbered item", { exact: true }).waitFor({ timeout: 12000 });
  await candidatePreview.locator('input[type="checkbox"]').first().waitFor({ state: "attached", timeout: 12000 });
  await candidatePreview.locator("pre code.hljs").getByText("answer", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePreview.locator("table").first().waitFor({ state: "visible", timeout: 12000 });
  await candidatePage.getByText("left baz", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("right baz", { exact: false }).waitFor({ timeout: 12000 });
  await candidatePage.getByText("qweqweqwe", { exact: false }).waitFor({ timeout: 12000 });
  const scriptCount = await candidatePreview.locator("script").count();
  if (scriptCount !== 0) {
    throw new Error(`MARKDOWN_SANITIZE_SCRIPT_FAILED count=${scriptCount}`);
  }
  const unsafeHref = await candidatePreview.locator("a", { hasText: "unsafe link" }).getAttribute("href");
  if (unsafeHref?.toLowerCase().startsWith("javascript:")) {
    throw new Error(`MARKDOWN_SANITIZE_HREF_FAILED href=${unsafeHref}`);
  }
  const xssExecuted = await candidatePage.evaluate(() => Boolean(window.__markdownXss));
  if (xssExecuted) {
    throw new Error("MARKDOWN_SANITIZE_EXECUTED_SCRIPT_OR_EVENT");
  }

  console.log("MARKDOWN_EXPLAINER_SMOKE_OK", inviteCode);

  await interviewerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("MARKDOWN_EXPLAINER_SMOKE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
