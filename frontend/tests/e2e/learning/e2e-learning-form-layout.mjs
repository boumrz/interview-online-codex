import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const browser = await chromium.launch();
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

after(() => browser.close());

async function openPersonalLibrary(t, viewport, colorScheme) {
  const registration = await fetch(`${api}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: `guide${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      displayName: "Проверка формы обучения",
      password: "onboarding-test-password",
    }),
  });
  assert.equal(registration.status, 200);
  const { token } = await registration.json();
  const context = await browser.newContext({ viewport, colorScheme });
  t.after(() => context.close());
  await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const tour = page.locator("[data-learning-tour]");
  await page.goto(`${web}/workspace/personal/interviews`);
  const start = page.getByRole("button", { name: /^Начать( обучение)?$/ });
  const firstStep = tour.locator('[data-learning-step="1"]');
  await start.or(firstStep).first().waitFor();
  if (await start.isVisible()) await start.click();
  await firstStep.waitFor();
  const libraryLink = page.locator('[data-learning-anchor="personal-library-link"]').filter({ visible: true });
  if (!(await libraryLink.count())) await page.locator('[data-learning-anchor="personal-sections-menu"]').click();
  await libraryLink.first().click();
  await tour.locator('[data-learning-step="2"]').waitFor();
  return { page, tour };
}

for (const [colorScheme, viewport] of [
  ["dark", { width: 1440, height: 1000 }],
  ["light", { width: 640, height: 800 }],
]) {
  test(`task guidance leaves creation fields usable at ${viewport.width}px in ${colorScheme} mode`, async (t) => {
    const { page, tour } = await openPersonalLibrary(t, viewport, colorScheme);
    await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Создать задачу", exact: true });
    const title = form.getByRole("textbox", { name: "Название", exact: true });
    const description = form.getByRole("textbox", { name: /описание/i });
    const code = form.getByRole("textbox", { name: /стартовый код/i });
    const save = form.getByRole("button", { name: "Сохранить задачу", exact: true });
    await form.waitFor();
    const inlineGuide = form.locator("[data-learning-tour]");
    await inlineGuide.waitFor();

    // Read every box in one browser frame as the dialog animates into place.
    const overlaps = await form.evaluate((dialog) => {
      const guidance = dialog.querySelector("[data-learning-tour]").getBoundingClientRect();
      const controls = dialog.querySelectorAll("input, textarea, .app-form-actions button");
      return Array.from(controls).filter((control) => {
        const bounds = control.getBoundingClientRect();
        return guidance.left < bounds.right && bounds.left < guidance.right &&
          guidance.top < bounds.bottom && bounds.top < guidance.bottom;
      }).map((control) => control.id || control.textContent);
    });
    assert.deepEqual(overlaps, [], "guidance does not overlap a form control");
    assert.equal(await tour.count(), 1, "there is a single instruction and no floating duplicate");

    await title.fill(`Задача для проверки ${viewport.width}`);
    await description.click();
    await page.keyboard.type("Опишите решение");
    assert.equal(await description.inputValue(), "Опишите решение");
    await code.click();
    await page.keyboard.type("return 1;");
    assert.equal(await code.inputValue(), "return 1;");
    await save.click();
    await form.waitFor({ state: "hidden" });
    await page.getByText(`Задача для проверки ${viewport.width}`, { exact: true }).waitFor();
  });
}
