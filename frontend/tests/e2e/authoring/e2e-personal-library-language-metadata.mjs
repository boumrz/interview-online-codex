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

async function openPicker(picker) {
  const inputId = await picker.getAttribute("id");
  assert.ok(inputId, "PICKER_INPUT_ID_MISSING");
  await picker.click();
  // The popup shell can appear before its virtual options, and another modal's
  // closing popup can still match :visible. Read this input's own rendered list.
  const rendered = await page.waitForFunction((id) => {
    const input = document.getElementById(id);
    const listboxId = input?.getAttribute("aria-controls");
    const dropdown = listboxId && document.getElementById(listboxId)?.closest(".ant-select-dropdown");
    if (input?.getAttribute("aria-expanded") !== "true" || !dropdown) return null;
    const style = getComputedStyle(dropdown);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    const labels = Array.from(dropdown.querySelectorAll(".ant-select-item-option"), (option) => option.textContent);
    return labels.length ? { listboxId, labels } : null;
  }, inputId, { timeout: 5_000 });
  const { listboxId, labels } = await rendered.jsonValue();
  await rendered.dispose();
  return {
    labels,
    dropdown: page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id=${JSON.stringify(listboxId)}]`) }),
  };
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

  const languageFilter = page.getByRole("combobox", { name: "Язык задач", exact: true });
  const { dropdown: filterDropdown, labels: filterLabels } = await openPicker(languageFilter);
  assert.deepEqual(filterLabels, expectedLanguages.map(([, label]) => label), "PERSONAL_LIBRARY_LANGUAGE_FILTER_REGRESSION");
  let activeDropdown = filterDropdown;
  for (const [index, [value]] of expectedLanguages.entries()) {
    if (index > 0) ({ dropdown: activeDropdown } = await openPicker(languageFilter));
    await activeDropdown.locator(".ant-select-item-option").nth(index).click();
    await page.waitForFunction((expectedValue) => new URL(location.href).searchParams.get("language") === expectedValue, value);
  }

  await page.getByTestId("open-create-task-modal").click();
  const languageSelect = page.getByRole("combobox", { name: "Язык", exact: true });
  const { labels: creationLabels } = await openPicker(languageSelect);
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
  const { labels: taskOptions } = await openPicker(taskPicker);
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
  const { labels: editOptions } = await openPicker(editPicker);
  assert.deepEqual(editOptions, taskOptions, "PRESET_EDIT_TASK_OPTION_LANGUAGE_MISSING");
  const selectedLabels = await editPicker.evaluate((input) => Array.from(
    input.closest(".ant-select").querySelectorAll(".ant-select-selection-item-content"),
    (chip) => chip.textContent,
  ));
  assert.deepEqual(selectedLabels, [
    "Две суммы — Node JS", "Очередь событий — Node JS", "Группировка данных — Python",
  ], "PRESET_EDIT_SELECTED_TASK_LANGUAGE_MISSING");

  console.log("PERSONAL_LIBRARY_LANGUAGE_METADATA_OK");
} finally {
  await browser.close();
}
