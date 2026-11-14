import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { nativeStrokeWidth } from '../../src/features/room/whiteboard/whiteboardStrokeWidth.ts';
const require = createRequire(import.meta.url);
const { getStroke } = require('perfect-freehand');
const load = require('../../scripts/excalidraw-local-assets-loader.cjs');
const sdk = new URL('../../node_modules/@excalidraw/excalidraw/dist/', import.meta.url);

for (const mode of ['dev', 'prod']) {
  test(`${mode} freehand capture uses a fixed nib at down, move and up without simulated pressure`, async () => {
    const source = load(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const fromDown = source.indexOf('"handleFreeDrawElementOnPointerDown"');
    const untilInsert = source.indexOf('this.scene.insertElement', fromDown);
    const capture = source.slice(fromDown, untilInsert);
    const flag = capture.match(/simulatePressure:\s*(\w+),/)?.[1] ?? "simulatePressure";
    assert.match(capture, new RegExp(`\\b${flag}\\s*=\\s*false\\b`));
    assert.match(capture, /pressures:\s*\[0\.5\]/);
    const appended = [...source.matchAll(/\[\.\.\.(\w+)\.pressures,\s*([^\]]+)\]/g)];
    assert.equal(appended.length, 2, 'pointermove and pointerup');
    for (const match of appended) assert.equal(match[2], '0.5');
  });
}

test('the live and finished native outlines are uniform at each width while older pressure strokes retain their shape', async () => {
  // Execute the SDK renderer through its native outline step, before it
  // encodes the outline as a compact SVG path string.
  const directory = new URL('dev/', sdk);
  let render;
  for (const file of await readdir(directory)) {
    if (!/^chunk-.+\.js$/.test(file)) continue;
    const source = load(await readFile(new URL(file, directory), 'utf8'));
    const renderer = source.match(/function getFreeDrawSvgPath\(element\) \{[\s\S]+?\n\}/)?.[0];
    if (renderer) {
      render = new Function('getStroke', 'getSvgPathFromStroke2', `return (${renderer})`)(getStroke, outline => outline);
      break;
    }
  }
  assert.equal(typeof render, 'function');
  const points = Array.from({ length: 101 }, (_, i) => [i * 2, 0]);
  const element = { points, pressures: points.map(() => .5), simulatePressure: false };
  function interior(element) {
    const outline = render(element);
    const middle = outline.filter(([x]) => x > 40 && x < 160).map(([, y]) => Math.abs(y));
    assert.ok(middle.length >= 8);
    return middle;
  }
  for (const lastCommittedPoint of [null, points.at(-1)]) {
    for (const pixels of [1, 4, 8, 13, 32, 50]) {
      const middle = interior({ ...element, strokeWidth: nativeStrokeWidth('freedraw', pixels), lastCommittedPoint });
      assert.ok(Math.abs(middle[0] * 2 - pixels) < 1e-8, `${pixels} px is the actual freehand body diameter`);
      assert.ok(Math.max(...middle) - Math.min(...middle) < 1e-9, 'live and finished strokes stay uniform');
      for (const tool of ['line', 'rectangle', 'ellipse']) assert.equal(nativeStrokeWidth(tool, pixels), pixels);
    }
    const radii = [1, 2, 4].map(strokeWidth => {
      const middle = interior({ ...element, strokeWidth, lastCommittedPoint });
      assert.ok(Math.max(...middle) - Math.min(...middle) < 1e-9);
      return middle[0];
    });
    assert.equal(radii[1], radii[0] * 2);
    assert.equal(radii[2], radii[0] * 4);
    assert.ok(Math.abs(radii[0] * 2 - 6.010407640085654) < 1e-8, 'previous native strokes retain their exact appearance');
    const legacy = interior({ ...element, pressures: points.map((_, i) => i < 50 ? .15 : .85), strokeWidth: 2, lastCommittedPoint });
    assert.ok(Math.max(...legacy) - Math.min(...legacy) > 1);
  }
});
