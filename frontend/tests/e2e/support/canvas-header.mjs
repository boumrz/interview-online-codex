import assert from 'node:assert/strict';

export async function assertCompactCanvasHeader(panel, { narrow = false } = {}) {
  const toolbar = panel.getByRole('group', { name: 'Действия с холстом' });
  const color = toolbar.getByRole('button', { name: /Закреплённый цвет/ });
  const download = toolbar.getByRole('button', { name: 'Скачать', exact: true });
  const expand = toolbar.getByRole('button', { name: /^(На весь экран|Вернуться в комнату)$/ });
  const [colorBox, downloadBox, expandBox, bounds] = await Promise.all(
    [color, download, expand, toolbar].map(control => control.boundingBox()),
  );
  const status = toolbar.getByRole('status').filter({ hasText: /^(Сохранено$|Только просмотр)/ });
  const statusBox = await status.boundingBox();
  assert.ok(statusBox && statusBox.width > 1 && statusBox.height > 1, 'save and read-only statuses are visible');
  const boxes = [colorBox, downloadBox, expandBox, statusBox];
  assert.ok(bounds && boxes.every(box => box && box.width && box.height), 'all toolbar controls are visible');
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1, 'item fits the toolbar');
    for (const other of boxes.slice(index + 1)) {
      const overlapsX = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
      const overlapsY = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
      assert.ok(overlapsX <= 1 || overlapsY <= 1, 'header items do not overlap');
    }
  }
  if (narrow) return;
  const [first, second] = [colorBox, downloadBox].sort((a, b) => a.x - b.x);
  assert.ok(first.x - bounds.x <= 20, 'the color and download controls start on the left');
  assert.ok(second.x - first.x - first.width <= 24, 'color and download are grouped');
  if ((await status.textContent()).trim() === 'Сохранено') {
    const gap = statusBox.x - downloadBox.x - downloadBox.width;
    assert.ok(gap >= -1 && gap <= 24, 'saved status follows Download in the action group');
    assert.ok(statusBox.y < downloadBox.y + downloadBox.height && statusBox.y + statusBox.height > downloadBox.y,
      'saved status is on the same row as Download');
  }
  assert.ok(bounds.x + bounds.width - expandBox.x - expandBox.width <= 20, 'fullscreen is aligned right');
  assert.ok([second, expandBox].every(box => box.y < first.y + first.height && box.y + box.height > first.y),
    'wide toolbar actions fit one row');
}

export async function assertStableAutosave(panel, canvas, changesRoute, edit) {
  const page = panel.page();
  const toolbar = panel.getByRole('group', { name: 'Действия с холстом' });
  const status = toolbar.getByRole('status');
  const layout = {
    canvas, toolbar, status,
    color: toolbar.getByRole('button', { name: /Закреплённый цвет/ }),
    download: toolbar.getByRole('button', { name: 'Скачать', exact: true }),
    fullscreen: toolbar.getByRole('button', { name: /^(На весь экран|Вернуться в комнату)$/ }),
  };
  async function measure() {
    const rects = {};
    for (const [name, locator] of Object.entries(layout)) {
      const rect = await locator.boundingBox();
      assert.ok(rect && rect.width > 1 && rect.height > 1, `${name} stays visible`);
      rects[name] = rect;
    }
    return rects;
  }

  await status.filter({ hasText: /^Сохранено$/ }).waitFor();
  const idle = await measure();
  let releaseWrite;
  const pending = new Promise(resolve => { releaseWrite = resolve; });
  await page.route(changesRoute, async route => {
    await pending;
    await route.continue();
  }, { times: 1 });

  try {
    await Promise.all([page.waitForRequest(changesRoute), edit()]);
    await status.filter({ hasText: /^Сохранение…$/ }).waitFor();
    // Keep the real write pending through the delayed success feedback.
    // A timer alone may not clear a write that is still outstanding.
    await status.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)));
    assert.equal((await status.textContent()).trim(), 'Сохранение…');
    assert.deepEqual(await measure(), idle, 'an in-flight save must not resize or move the canvas, status or actions');
  } finally {
    releaseWrite();
  }
  await status.filter({ hasText: /^Сохранено$/ }).waitFor();
  assert.deepEqual(await measure(), idle, 'acknowledgment must preserve canvas, status and actions geometry');
}
