import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createOwnedRuntime } from "../e2e/support/owned-runtime.mjs";

// All API requests are intercepted. This suite owns its frontend runtime and
// never connects to the user's application, backend or database.
const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));
const runtime = createOwnedRuntime();
let browser;
let web;
let configDirectory;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  void Promise.allSettled([browser?.close(), runtime.stop()]).finally(() => process.exit(130));
});
const user = { id: "ui-owner", nickname: "uiowner", displayName: "Проверка интерфейса", role: "user", isHr: false };
const team = { id: "ui-team", name: "Команда UI", role: "OWNER", epoch: 1, revision: 1, capabilities: [] };
const tasks = [{ id: "ui-task", title: "Проверка задач", description: "Условие", starterCode: "", language: "nodejs", revision: 1, status: "ACTIVE" }];
const room = {
  id: "ui-room", title: "Комната UI", inviteCode: "ui-room", language: "nodejs", currentStep: 0,
  status: "active", code: "", notes: "", notesMessages: [], briefingMarkdown: "",
  ownerToken: null, interviewerToken: null, role: "owner", isOwner: true, canManageRoom: true, canGrantAccess: true,
  accessMembers: [], tasks: [{ ...tasks[0], stepIndex: 0, categoryName: null, score: null }], roomEditorMode: "code",
};

before(async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  web = `http://127.0.0.1:${port}`;
  configDirectory = await mkdtemp(join(tmpdir(), "interhub-ui-browser-"));
  const configPath = join(configDirectory, "rspack.config.mjs");
  const dashboardEntry = join(configDirectory, "dashboard.tsx");
  await writeFile(dashboardEntry, `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { store } from ${JSON.stringify(join(frontendRoot, "src/app/store.ts"))};
import { setCurrentUser } from ${JSON.stringify(join(frontendRoot, "src/features/auth/authSlice.ts"))};
import { ThemeProvider } from ${JSON.stringify(join(frontendRoot, "src/features/theme/ThemeProvider.tsx"))};
import { DashboardPage } from ${JSON.stringify(join(frontendRoot, "src/pages/DashboardPage.tsx"))};
import "antd/dist/reset.css";
import ${JSON.stringify(join(frontendRoot, "src/styles/global.css"))};
store.dispatch(setCurrentUser(JSON.parse(localStorage.getItem("auth_user"))));
function Fixture() {
  const [section, setSection] = useState("tasks");
  window.dashboardHarness = { setSection };
  return <DashboardPage forcedSection={section} />;
}
createRoot(document.getElementById("root")).render(<Provider store={store}><ThemeProvider><BrowserRouter useTransitions={false}><Fixture /></BrowserRouter></ThemeProvider></Provider>);
`);
  await writeFile(configPath, `import config from ${JSON.stringify(pathToFileURL(join(frontendRoot, "rspack.config.mjs")).href)};
import rspack from ${JSON.stringify(pathToFileURL(join(frontendRoot, "node_modules/@rspack/core/dist/index.js")).href)};
export default { ...config, entry: { main: config.entry, dashboardHarness: ${JSON.stringify(dashboardEntry)} },
  resolve: { ...config.resolve, modules: [${JSON.stringify(join(frontendRoot, "node_modules"))}, "node_modules"] },
  plugins: [...config.plugins.filter(plugin => plugin.constructor.name !== "HtmlRspackPlugin"),
    new rspack.HtmlRspackPlugin({ template: ${JSON.stringify(join(frontendRoot, "public/index.html"))}, filename: "index.html", chunks: ["main"] }),
    new rspack.HtmlRspackPlugin({ template: ${JSON.stringify(join(frontendRoot, "public/index.html"))}, filename: "dashboard-harness.html", chunks: ["dashboardHarness"] })],
  devServer: { ...config.devServer, host: "127.0.0.1", port: ${port}, hot: false, liveReload: false, client: false } };\n`);
  const server = runtime.start(process.execPath, ["node_modules/@rspack/cli/bin/rspack.js", "serve", "--config", configPath], {
    cwd: frontendRoot, env: { ...process.env, DEV_API_PROXY_TARGET: "http://127.0.0.1:1" },
  });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (server.finished) throw new Error(`Owned frontend runtime exited: ${server.code}`);
      if (await fetch(web).then(response => response.ok).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(await fetch(web).then(response => response.ok), "owned frontend is ready");
    browser = await chromium.launch();
  } catch (error) { await runtime.stop(); throw error; }
}, { timeout: 70_000 });
after(async () => { await browser?.close(); await runtime.stop(); if (configDirectory) await rm(configDirectory, { recursive: true, force: true }); });

function gate() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), release: () => resolve() };
}

async function fixture({ theme = "light", width = 1366, taskGate, hiringGate, creationGate, creationFailure = true, metadataGate, metadataFailure = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 820 } });
  const requests = [];
  await context.addInitScript(({ user, theme, room }) => {
    localStorage.setItem("auth_token", "ui-fixture");
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
    localStorage.setItem("interview-online:ui-theme", theme);
    const state = { ...room, eventToken: "ui-event", participants: [], taskScores: { "0": 3 }, personalNotes: [],
      lastCodeUpdatedBySessionId: null, notesLockedBySessionId: null, notesLockedByDisplayName: null,
      notesLockedUntilEpochMs: null, cursors: [], lastCandidateKey: null, candidateKeyHistory: [] };
    window.EventSource = class extends EventTarget {
      readyState = 0;
      constructor() {
        super();
        setTimeout(() => {
          if (this.readyState === 2) return;
          this.readyState = 1;
          this.onopen?.(new Event("open"));
          this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "state_sync", payload: state }) }));
        }, 30);
      }
      close() { this.readyState = 2; }
    };
  }, { user, theme, room });
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ path, method: request.method(), body: request.postDataJSON() });
    let body;
    let status = 200;
    if (path === "/api/me/profile") body = user;
    else if (path === "/api/me/workspaces") body = [{ id: "personal", name: "Личное", role: "OWNER", epoch: 1, capabilities: [] }, team];
    else if (path === "/api/me/rooms") body = [];
    else if (path === "/api/me/tasks") { await taskGate?.promise; body = [{ language: "nodejs", tasks }]; }
    else if (path === "/api/me/hiring-manager-preview") { await hiringGate?.promise; body = { normalizedId: "ui-hiring", displayName: "Нанимающий UI" }; }
    else if (path === "/api/rooms" && request.method() === "POST") { await creationGate?.promise; status = creationFailure ? 503 : 200; body = creationFailure ? { error: "Тестовая ошибка создания" } : room; }
    else if (path === `/api/teams/${team.id}`) body = team;
    else if (path.endsWith("/members")) body = { items: [{ userId: user.id, displayName: user.displayName, role: "OWNER", state: "ACTIVE", revision: 1 }], page: 0, size: 100, totalElements: 1, totalPages: 1 };
    else if (path.endsWith("/tracks")) body = { items: [], counts: { activeTracks: 0, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
    else if (path.endsWith("/tasks")) body = { items: tasks };
    else if (path.endsWith("/interviews") || path.endsWith("/interview-owner-offers") || path.endsWith("/task-sets")) body = { items: [] };
    else if (path === `/api/rooms/${room.inviteCode}`) body = room;
    else if (path.endsWith("/interview-metadata")) { await metadataGate?.promise; status = metadataFailure ? 503 : 200; body = { candidateName: null, position: null, scheduledAt: null, revision: 0 }; }
    else if (path.endsWith("/hr-managers")) body = [];
    else if (path.endsWith("/events") || path.endsWith("/activity")) body = { accepted: true };
    else { status = 404; body = { error: "Unknown isolated fixture route" }; }
    await route.fulfill({ status, json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text().slice(0, 600)); });
  return { context, page, requests, errors };
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".ant-modal")].every(element =>
    !element.getClientRects().length || getComputedStyle(element).transform === "none"));
}

async function geometry(dialog) {
  return dialog.evaluate(element => {
    const create = [...element.querySelectorAll("button")].find(button => button.textContent.trim() === "Создать интервью");
    const cancel = [...element.querySelectorAll("button")].find(button => button.textContent.trim() === "Отмена");
    const footer = create.parentElement;
    const title = element.querySelector(".ant-modal-title");
    const box = element.getBoundingClientRect();
    const fields = element.querySelector(".app-authoring-fields").getBoundingClientRect();
    const createBox = create.getBoundingClientRect();
    const cancelBox = cancel.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    return { width: box.width, createHeight: createBox.height, cancelHeight: cancelBox.height,
      buttonTopDifference: Math.abs(createBox.y - cancelBox.y),
      footerBottomInset: box.bottom - footerBox.bottom, footerGap: createBox.x - cancelBox.right,
      footerAfterFields: footerBox.y >= fields.bottom,
      titleSize: getComputedStyle(title.firstElementChild ?? title).fontSize,
      footerBorder: getComputedStyle(footer).borderTopWidth,
      footerMargin: getComputedStyle(footer).marginTop,
    };
  });
}

for (const theme of ["light", "dark"]) for (const width of [390, 1366]) {
  test(`personal creation matches team modal and footer at ${width}px ${theme}`, async () => {
    const { context, page } = await fixture({ theme, width });
    try {
      await page.goto(`${web}/workspace/teams/${team.id}/interviews/new`);
      let dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
      await dialog.getByLabel("Название интервью", { exact: true }).waitFor();
      await settle(page);
      const reference = await geometry(dialog);
      await page.goto(`${web}/workspace/personal/interviews/new`);
      dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
      await dialog.getByLabel("Название интервью", { exact: true }).waitFor();
      await settle(page);
      const actual = await geometry(dialog);
      assert.equal(actual.footerAfterFields, true, "actions stay outside scrolling fields");
      assert.ok(actual.buttonTopDifference <= 1, "footer buttons share a row");
      for (const property of ["width", "createHeight", "cancelHeight", "footerBottomInset", "footerGap", "titleSize", "footerBorder", "footerMargin"]) {
        if (typeof actual[property] === "number") assert.ok(Math.abs(actual[property] - reference[property]) <= 1, `${property}: personal footer/modal matches team (${actual[property]} / ${reference[property]})`);
        else assert.equal(actual[property], reference[property], `${property}: personal footer/modal matches team`);
      }
    } finally { await context.close(); }
  });
}

test("personal creation blocks empty, loading, picker and duplicate submits while preserving an error draft", async () => {
  const taskGate = gate();
  const hiringGate = gate();
  const creationGate = gate();
  const { context, page, requests } = await fixture({ taskGate, hiringGate, creationGate });
  try {
    await page.goto(`${web}/workspace/personal/interviews/new`);
    const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    const create = dialog.getByRole("button", { name: "Создать интервью", exact: true });
    const title = dialog.getByLabel("Название интервью", { exact: true });
    await title.waitFor();
    assert.equal(await create.isDisabled(), true, "empty title blocks create");
    await title.fill("   ");
    assert.equal(await create.isDisabled(), true, "whitespace title blocks create");
    await title.fill("Новое личное интервью");
    assert.equal(await create.isDisabled(), true, "unfinished task loading blocks create");
    taskGate.release();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Создать интервью" && !button.disabled));
    assert.equal(await dialog.getByLabel("Имя кандидата", { exact: true }).inputValue(), "", "candidate remains optional");
    const picker = dialog.getByRole("combobox", { name: "Нанимающий", exact: true });
    await picker.fill("hiring");
    assert.equal(await create.isDisabled(), true, "hiring search blocks create");
    hiringGate.release();
    await page.locator(".ant-select-item-option").filter({ hasText: "Нанимающий UI" }).click();
    await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname === "/api/rooms" && request.method() === "POST"),
      create.click(),
    ]);
    assert.equal(await create.isDisabled(), true, "pending create blocks repeats");
    assert.equal(await dialog.getByRole("button", { name: "Отмена", exact: true }).isDisabled(), true, "pending creation disables cancellation");
    await page.keyboard.press("Enter");
    assert.equal(requests.filter(request => request.path === "/api/rooms").length, 1, "one room request while pending");
    creationGate.release();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await title.inputValue(), "Новое личное интервью", "error keeps the draft");
    assert.equal(await create.isDisabled(), false, "error allows another attempt");
  } finally { taskGate.release(); hiringGate.release(); creationGate.release(); await context.close(); }
});

test("personal creation stays locked during candidate saving and offers recovery without creating another room", async () => {
  const metadataGate = gate();
  const { context, page, requests } = await fixture({ creationFailure: false, metadataGate, metadataFailure: true });
  try {
    await page.goto(`${web}/workspace/personal/interviews/new`);
    const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    const title = dialog.getByLabel("Название интервью", { exact: true });
    const create = dialog.getByRole("button", { name: "Создать интервью", exact: true });
    await title.fill("Интервью с кандидатом");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Имя кандидата");
    await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname.endsWith("/interview-metadata")),
      create.click(),
    ]);
    assert.equal(await create.isDisabled(), true, "candidate saving still belongs to the pending creation");
    assert.equal(await title.isDisabled(), true, "pending creation keeps its submitted draft stable");
    assert.equal(await dialog.getByRole("button", { name: "Отмена", exact: true }).isDisabled(), true);
    metadataGate.release();
    await dialog.getByRole("button", { name: "Повторить сохранение", exact: true }).waitFor();
    assert.equal(await create.isDisabled(), true, "partial success never permits another room creation");
    assert.equal(await title.inputValue(), "Интервью с кандидатом");
    assert.equal(requests.filter(request => request.path === "/api/rooms").length, 1);
  } finally { metadataGate.release(); await context.close(); }
});

async function leftAligned(options, label) {
  const measurements = await options.evaluateAll(elements => elements.map(element => {
    const content = element.querySelector(".ant-select-item-option-content") ?? element;
    const range = document.createRange();
    range.selectNodeContents(content.querySelector("span") ?? content);
    const rect = content.getBoundingClientRect();
    const text = range.getBoundingClientRect();
    const style = getComputedStyle(content);
    return { text: element.textContent, inset: text.x - rect.x, padding: Number.parseFloat(style.paddingLeft) || 0 };
  }));
  assert.ok(measurements.length > 0, `${label}: visible options exist`);
  for (const measure of measurements) assert.ok(Math.abs(measure.inset - measure.padding) <= 2, `${label}: text sits at left padding ${JSON.stringify(measure)}`);
}

for (const theme of ["light", "dark"]) {
  test(`Select, MultiSelect and room ratings keep a left text edge in ${theme}`, async () => {
    const { context, page, errors } = await fixture({ theme });
    try {
      await page.goto(web);
      await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
      const rawSelect = page.getByRole("combobox", { name: "Язык", exact: true });
      await rawSelect.click();
      const rawPopup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([class*='-leave'])");
      await rawPopup.waitFor();
      await settle(page);
      const rawOption = rawPopup.locator(".ant-select-item-option").filter({ hasText: "Python" });
      await leftAligned(rawOption, "raw Ant Design Select");
      await rawOption.hover();
      await leftAligned(rawOption, "hovered raw Select");
      await rawOption.click();
      await rawSelect.click();
      await leftAligned(rawPopup.locator(".ant-select-item-option-selected"), "selected raw Select");
      await rawSelect.press("Escape");
      await page.goto(`${web}/workspace/teams/${team.id}/interviews/new`);
      const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
      for (const [name, optionTitle] of [["Трек интервью", "Без трека"], ["Задачи интервью", tasks[0].title]]) {
        const select = dialog.getByRole("combobox", { name, exact: true });
        await select.click();
        const popup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([class*='-leave'])");
        await popup.waitFor();
        await settle(page);
        const option = popup.locator(".ant-select-item-option").filter({ hasText: optionTitle });
        // Composite task labels have a left title as well as a right language.
        if (name === "Задачи интервью") {
          const inset = await option.evaluate(element => element.querySelector(".ant-select-item-option-content span").getBoundingClientRect().x - element.querySelector(".ant-select-item-option-content").getBoundingClientRect().x);
          assert.ok(inset <= 2, "MultiSelect task title starts on the left");
        } else await leftAligned(option, "single Select");
        await option.hover();
        if (name !== "Задачи интервью") await leftAligned(option, "hovered Select");
        await option.click();
        // Single Select already closes on choice. Escape afterward would also
        // close the authoring modal once the popup's leave animation finishes.
        if (name === "Задачи интервью") await select.press("Escape");
      }
      await page.goto(`${web}/room/${room.inviteCode}`);
      await page.getByTestId("room-code-editor-host").locator(".cm-editor").waitFor().catch(async error => {
        throw new Error(`Room editor did not appear: ${JSON.stringify({ errors, body: await page.locator("body").innerText() })}`, { cause: error });
      });
      const score = page.getByLabel("Оценка активного для всех шага", { exact: true });
      await score.click();
      const list = page.getByRole("listbox", { name: "Доступные оценки шага", exact: true });
      await list.waitFor();
      await leftAligned(list.getByRole("option"), "room rating dropdown");
      assert.equal(await list.getByRole("option", { name: "3", exact: true }).getAttribute("aria-selected"), "true", "selected rating keeps the same left edge");
      await list.getByRole("option", { name: "3", exact: true }).hover();
      await leftAligned(list.getByRole("option", { name: "3", exact: true }), "hovered rating");
      await list.getByRole("option", { name: "3", exact: true }).click();
      assert.equal(await list.count(), 0, "choosing a rating closes its list");
    } finally { await context.close(); }
  });
}

test("Dashboard task editing releases its preview worker after closing and ignores a held reply after reopening", async () => {
  const { context, page } = await fixture();
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    const probe = window.dashboardWorkerProbe = {
      instances: [], replies: [], hold: false,
      flush() { for (const deliver of this.replies.splice(0)) deliver(); },
    };
    window.Worker = class {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      terminated = false;
      constructor(...args) {
        this.native = new NativeWorker(...args);
        probe.instances.push(this);
        this.native.onmessage = event => {
          const deliver = () => this.onmessage?.(event);
          if (probe.hold) probe.replies.push(deliver);
          else deliver();
        };
        this.native.onerror = event => this.onerror?.(event);
        this.native.onmessageerror = event => this.onmessageerror?.(event);
      }
      postMessage(request) { this.native.postMessage(request); }
      terminate() { this.terminated = true; this.native.terminate(); }
    };
  });
  try {
    await page.goto(`${web}/dashboard-harness.html`);
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Редактирование задачи", exact: true });
    await dialog.getByRole("paragraph").filter({ hasText: /^Условие$/ }).waitFor();
    await page.evaluate(() => { window.dashboardWorkerProbe.hold = true; });
    await dialog.getByPlaceholder("Опишите условие, примеры и ожидаемый результат", { exact: true }).fill("# Поздний результат закрытого редактора");
    await page.waitForFunction(() => window.dashboardWorkerProbe.replies.length > 0);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    // Cards are other legitimate consumers. Remove them as well to expose the
    // modal's leaked subscription without changing any production routes.
    await page.evaluate(() => window.dashboardHarness.setSection("rooms"));
    const released = await page.waitForFunction(() => window.dashboardWorkerProbe.instances.length > 0 &&
      window.dashboardWorkerProbe.instances.every(worker => worker.terminated), null, { timeout: 1_000 }).then(() => true, () => false);
    assert.equal(released, true, "the last actual preview disappears: its worker must terminate");
    await page.evaluate(() => window.dashboardHarness.setSection("tasks"));
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Редактирование задачи", exact: true });
    await dialog.getByPlaceholder("Опишите условие, примеры и ожидаемый результат", { exact: true }).fill("# Актуальный предпросмотр");
    await page.evaluate(() => { window.dashboardWorkerProbe.hold = false; window.dashboardWorkerProbe.flush(); });
    await dialog.getByRole("heading", { name: "Актуальный предпросмотр", exact: true }).waitFor();
    assert.equal(await dialog.getByText("Поздний результат закрытого редактора", { exact: true }).count(), 0, "a late closed-modal reply cannot reappear");
  } finally { await context.close(); }
});
