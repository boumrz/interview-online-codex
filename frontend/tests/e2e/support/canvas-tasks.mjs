import assert from 'node:assert/strict';

export async function selectCanvasTask(page, task) {
  const steps = page.getByRole('tab', { name: 'Шаги', exact: true });
  if (await steps.getAttribute('aria-selected') !== 'true') await steps.click();
  await page.getByTestId(`room-step-row-${task.stepIndex}`).click();
  await waitForCanvasTask(page, task.id);
}

export async function waitForCanvasTask(page, taskId) {
  assert.ok(taskId, 'the task has a stable room task ID');
  await page.locator(`section[data-canvas-task-id=${JSON.stringify(taskId)}]:visible`).waitFor();
}

// Older servers ignored the task selector and returned a room-wide document
// without identifying its task. Feed a real, populated earlier task as that response.
export async function expectLegacyCanvasBlocked(page, kind, first, second) {
  const pattern = `**/${kind}?*`;
  const writes = [];
  const countWrites = request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith(`/${kind}/changes`) && url.searchParams.get('taskId') === second.id) writes.push(request.url());
  };
  page.on('request', countWrites);
  await page.route(pattern, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('taskId') !== second.id) return route.continue();
    url.searchParams.set('taskId', first.id);
    url.searchParams.delete('afterSequence');
    const original = await route.fetch({ url: url.toString() });
    assert.equal(original.status(), 200);
    const document = await original.json();
    assert.ok(document.sequence > 0, 'the simulated legacy response contains the first task drawing');
    delete document.taskId;
    await route.fulfill({ response: original, json: document });
  });
  try {
    await selectCanvasTask(page, second);
    const panel = page.locator(`section[data-canvas-task-id=${JSON.stringify(second.id)}]:visible`);
    await panel.getByText(/Сервер не подтвердил, что рисунок/).first().waitFor();
    assert.ok(await panel.getByRole('button', { name: 'Скачать', exact: true }).isDisabled());
    assert.ok(await panel.getByTestId('room-drawing-color').isDisabled());
    const blockedCanvas = await panel.evaluate(region => {
      const surface = region.querySelector('iframe[title="Редактор схемы"], canvas.interactive');
      if (!surface) return true;
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return true;
      const x = Math.max(0, bounds.left) + (Math.min(innerWidth, bounds.right) - Math.max(0, bounds.left)) / 2;
      const y = Math.max(0, bounds.top) + (Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)) / 2;
      return document.elementFromPoint(x, y)?.textContent.includes('Сервер не подтвердил');
    });
    assert.ok(blockedCanvas, 'a task mismatch covers the editor before anything can be drawn');
    assert.equal(writes.length, 0);
  } finally {
    await page.unroute(pattern);
    page.off('request', countWrites);
  }
}
