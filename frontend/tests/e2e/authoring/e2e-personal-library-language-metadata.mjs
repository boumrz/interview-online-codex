import assert from "node:assert/strict";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const expectedLanguages = [
  ["nodejs", "Node JS"],
  ["python", "Python"],
  ["kotlin", "Kotlin"],
  ["java", "Java"],
  ["sql", "SQL"],
  ["plaintext", "Plain text"],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const nickname = `ql${Date.now()}`;

async function request(path, { token, method = "GET", body, status = 200 } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

try {
  const auth = await request("/auth/register", {
    method: "POST",
    body: { nickname, displayName: nickname, password: "secret123", isHr: false },
  });
  const createTask = (title, language) => request("/me/tasks", {
    token: auth.token,
    method: "POST",
    body: { title, language, description: "Проверка языка набора", starterCode: "" },
  });
  const nodeFirst = await createTask("Две суммы", "nodejs");
  const nodeSecond = await createTask("Очередь событий", "nodejs");
  const pythonTask = await createTask("Группировка данных", "python");
  const preset = await request("/me/presets", {
    token: auth.token,
    method: "POST",
    status: 201,
    body: { name: "Backend screening", taskTemplateIds: [nodeFirst.id, nodeSecond.id, pythonTask.id] },
  });

  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
  }, auth);

  await page.goto(`${webBaseUrl}/workspace/personal/library`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-create-task-modal").waitFor({ state: "visible", timeout: 15_000 });

  const filterValues = await page.getByLabel("Язык задач", { exact: true }).locator("option").evaluateAll(
    (options) => options.map((option) => [option.value, option.textContent?.trim() ?? ""]),
  );
  assert.deepEqual(filterValues, [["", "Все языки"], ...expectedLanguages], "PERSONAL_LIBRARY_LANGUAGE_FILTER_REGRESSION");

  await page.getByTestId("open-create-task-modal").click();
  const languageSelect = page.getByRole("textbox", { name: "Язык", exact: true });
  await languageSelect.click();
  const creationLabels = await page.locator(".mantine-Select-options [role=option]").allTextContents();
  assert.deepEqual(creationLabels, expectedLanguages.map(([, label]) => label), "PERSONAL_TASK_CREATE_LANGUAGE_REGRESSION");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  const presetCard = page.getByTestId(`preset-card-${preset.id}`);
  await presetCard.waitFor({ state: "visible" });
  await presetCard.getByText("3 задачи", { exact: true }).waitFor({ timeout: 5_000 });
  await presetCard.getByText("Node JS · 2, Python · 1", { exact: true }).waitFor({ timeout: 5_000 });

  const createPreset = page.getByRole("button", { name: "Создать набор", exact: true });
  await createPreset.click();
  const taskPicker = page.getByRole("textbox", { name: "Задачи", exact: true });
  await taskPicker.click();
  const taskOptions = await page.locator(".mantine-MultiSelect-options [role=option]").allTextContents();
  assert.deepEqual(
    taskOptions.toSorted(),
    ["Две суммы — Node JS", "Очередь событий — Node JS", "Группировка данных — Python"].toSorted(),
    "PRESET_CREATE_TASK_OPTION_LANGUAGE_MISSING",
  );

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await presetCard.getByRole("button", { name: "Изменить", exact: true }).click();
  const editPicker = page.getByRole("textbox", { name: "Задачи", exact: true });
  await editPicker.click();
  const editOptions = await page.locator(".mantine-MultiSelect-options [role=option]").allTextContents();
  assert.deepEqual(editOptions, taskOptions, "PRESET_EDIT_TASK_OPTION_LANGUAGE_MISSING");

  console.log("PERSONAL_LIBRARY_LANGUAGE_METADATA_OK");
} finally {
  await browser.close();
}
