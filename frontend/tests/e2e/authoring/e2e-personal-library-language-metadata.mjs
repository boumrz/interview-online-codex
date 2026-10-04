import "../support/require-isolated-api.mjs";
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

  await page.getByRole("combobox", { name: "Язык задач", exact: true }).click();
  const filterDropdown = page.locator(".ant-select-dropdown:visible").last();
  await filterDropdown.waitFor({ state: "visible" });
  const filterLabels = await filterDropdown.locator(".ant-select-item-option").allTextContents();
  assert.deepEqual(filterLabels, expectedLanguages.map(([, label]) => label), "PERSONAL_LIBRARY_LANGUAGE_FILTER_REGRESSION");
  const languageFilter = page.getByRole("combobox", { name: "Язык задач", exact: true });
  for (const [index, [value]] of expectedLanguages.entries()) {
    if (index > 0) await languageFilter.click();
    const activeDropdown = page.locator(".ant-select-dropdown:visible").last();
    await activeDropdown.waitFor({ state: "visible" });
    await activeDropdown.locator(".ant-select-item-option").nth(index).click();
    await page.waitForFunction((expectedValue) => new URL(location.href).searchParams.get("language") === expectedValue, value);
  }

  await page.getByTestId("open-create-task-modal").click();
  const languageSelect = page.getByRole("combobox", { name: "Язык", exact: true });
  await languageSelect.click();
  const creationDropdown = page.locator(".ant-select-dropdown:visible").last();
  await creationDropdown.waitFor({ state: "visible" });
  const creationLabels = await creationDropdown.locator(".ant-select-item-option").allTextContents();
  assert.deepEqual(creationLabels, expectedLanguages.map(([, label]) => label), "PERSONAL_TASK_CREATE_LANGUAGE_REGRESSION");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".ant-select-dropdown")).every((dropdown) => {
    const style = getComputedStyle(dropdown);
    return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
  }), null, { timeout: 5_000 });
  await page.waitForFunction(() => document.querySelectorAll(".ant-select-open").length === 0);
  await page.keyboard.press("Escape");
  await page.locator(".ant-modal-wrap:visible").waitFor({ state: "hidden", timeout: 5_000 });
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  const presetCard = page.getByTestId(`preset-card-${preset.id}`);
  await presetCard.waitFor({ state: "visible" });
  await presetCard.getByText("3 задачи", { exact: true }).waitFor({ timeout: 5_000 });
  await presetCard.getByText("Node JS · 2, Python · 1", { exact: true }).waitFor({ timeout: 5_000 });

  const createPreset = page.getByRole("button", { name: "Создать набор", exact: true });
  await createPreset.click({ timeout: 5_000 });
  const taskPicker = page.getByRole("combobox", { name: "Задачи", exact: true });
  await taskPicker.click();
  const taskPickerDropdown = page.locator(".ant-select-dropdown:visible").last();
  await taskPickerDropdown.waitFor({ state: "visible" });
  const taskOptions = await taskPickerDropdown.locator(".ant-select-item-option").allTextContents();
  assert.deepEqual(
    taskOptions.toSorted(),
    ["Две суммы — Node JS", "Очередь событий — Node JS", "Группировка данных — Python"].toSorted(),
    "PRESET_CREATE_TASK_OPTION_LANGUAGE_MISSING",
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.ant-select-input[role="combobox"]')).every((input) => input.getAttribute("aria-expanded") !== "true"), null, { timeout: 5_000 });
  await page.waitForFunction(() => document.querySelectorAll(".ant-select-open").length === 0);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Создать набор", exact: true }).waitFor({ state: "hidden" });
  await presetCard.getByRole("button", { name: `Редактировать набор ${preset.name}`, exact: true }).click();
  const editPicker = page.getByRole("combobox", { name: "Задачи", exact: true });
  await editPicker.click();
  const editDropdown = page.locator(".ant-select-dropdown:visible").last();
  await editDropdown.waitFor({ state: "visible" });
  const editOptions = await editDropdown.locator(".ant-select-item-option").allTextContents();
  assert.deepEqual(editOptions, taskOptions, "PRESET_EDIT_TASK_OPTION_LANGUAGE_MISSING");

  console.log("PERSONAL_LIBRARY_LANGUAGE_METADATA_OK");
} finally {
  await browser.close();
}
