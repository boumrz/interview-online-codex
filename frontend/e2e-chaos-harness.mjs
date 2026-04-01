import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const browser = await chromium.launch({ headless: true });

const metrics = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  propagationMs: null,
  reconnectMs: null,
  permissionCheck: null
};

function now() {
  return Date.now();
}

async function roomCodeValue(page) {
  return page.evaluate(() => {
    const editors = window.monaco?.editor?.getEditors?.() ?? [];
    const model = editors[0]?.getModel?.() ?? window.monaco?.editor?.getModels?.()[0];
    if (model) return model.getValue();
    const viewLines = document.querySelector(".view-lines");
    return viewLines?.textContent || "";
  });
}

async function appendCode(page, snippet) {
  await page.evaluate((chunk) => {
    const monacoApi = window.monaco;
    const editor = monacoApi?.editor?.getEditors?.()?.[0];
    const model = editor?.getModel?.() ?? monacoApi?.editor?.getModels?.()[0];
    if (!model) throw new Error("MONACO_MODEL_NOT_FOUND");
    if (editor && monacoApi?.Range) {
      const end = model.getFullModelRange().getEndPosition();
      editor.executeEdits("chaos-append", [
        {
          range: new monacoApi.Range(end.lineNumber, end.column, end.lineNumber, end.column),
          text: chunk,
          forceMoveMarkers: true
        }
      ]);
      return;
    }
    const next = `${model.getValue()}${chunk}`;
    model.setValue(next);
  }, snippet);
}

async function waitForEditorContains(page, marker, timeoutMs = 8000) {
  const start = now();
  while (now() - start < timeoutMs) {
    const text = await roomCodeValue(page);
    if (text.includes(marker)) {
      return now() - start;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`MARKER_NOT_PROPAGATED: ${marker}`);
}

try {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();

  await owner.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: "Создать комнату" }).click();
  await owner.waitForURL(/\/room\//, { timeout: 15000 });
  await owner.locator(".monaco-editor").waitFor({ timeout: 15000 });
  const roomUrl = owner.url();

  const candidateAContext = await browser.newContext();
  const candidateA = await candidateAContext.newPage();
  await candidateA.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await candidateA.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidateA.getByLabel("Ваше имя").fill("Candidate A");
  await candidateA.getByRole("button", { name: "Войти в комнату" }).click();
  await candidateA.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const candidateBContext = await browser.newContext();
  const candidateB = await candidateBContext.newPage();
  await candidateB.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await candidateB.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidateB.getByLabel("Ваше имя").fill("Candidate B");
  await candidateB.getByRole("button", { name: "Войти в комнату" }).click();
  await candidateB.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const marker = `\n// chaos-${Date.now()}`;
  const t0 = now();
  await appendCode(owner, marker);
  await waitForEditorContains(candidateA, marker, 12000);
  metrics.propagationMs = now() - t0;

  const candidateOwnerControlVisible = await candidateA
    .getByRole("button", { name: /Запустить код|Запуск.../ })
    .isVisible()
    .catch(() => false);
  metrics.permissionCheck = candidateOwnerControlVisible ? "FAILED" : "PASSED";
  if (candidateOwnerControlVisible) {
    throw new Error("OWNER_CONTROL_VISIBLE_FOR_CANDIDATE");
  }

  const reconnectMarker = `\n# reconnect-${Date.now()}`;
  await candidateBContext.setOffline(true);
  await owner.waitForTimeout(1200);
  await appendCode(owner, reconnectMarker);

  const reconnectStart = now();
  await candidateBContext.setOffline(false);
  await candidateB.reload({ waitUntil: "domcontentloaded" });
  await candidateB.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await waitForEditorContains(candidateB, reconnectMarker, 12000);
  metrics.reconnectMs = now() - reconnectStart;

  metrics.finishedAt = new Date().toISOString();
  console.log("CHAOS_HARNESS_OK", JSON.stringify(metrics));

  await ownerContext.close();
  await candidateAContext.close();
  await candidateBContext.close();
} catch (error) {
  console.error("CHAOS_HARNESS_FAIL", error, JSON.stringify(metrics));
  process.exitCode = 1;
} finally {
  await browser.close();
}
