import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const load = require('../../scripts/excalidraw-local-assets-loader.cjs');
const sdk = new URL('../../node_modules/@excalidraw/excalidraw/dist/', import.meta.url);
const image = { type: 'image', width: 200, height: 100, angle: 0, scale: [1, 1] };

function angleAndFallback(cursor) {
  const encoded = cursor.match(/data:image\/svg\+xml,([^"]+)"\) 12 12, (\w+-resize)$/);
  assert.ok(encoded, `expected an oriented image cursor, got ${cursor}`);
  const svg = decodeURIComponent(encoded[1]);
  const rotation = svg.match(/transform="rotate\((\d+) 12 12\)/);
  assert.ok(rotation, 'the cursor is rotated around its hotspot');
  return [Number(rotation[1]), encoded[2]];
}

for (const mode of ['dev', 'prod']) {
  test(`${mode} proportional mouse resizing projects movement onto the image diagonal`, async () => {
    const source = load(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const helper = source.match(/^function projectImageResizePointer[\s\S]*?\n}/m)?.[0] ?? '';
    const sdkResize = source.slice(source.indexOf('"maybeHandleResize",'), source.indexOf('"getContextMenuItems",'));
    const branch = mode === 'dev'
      ? /snapLines\s*}\);\s*}([\s\S]*?)if \(transformElements\(/
      : /this\.setState\(\{snapLines:b\}\)\}([\s\S]*?)if\(DE\(/;
    const update = branch.exec(sdkResize)?.[1];
    assert.notEqual(update, undefined, 'native transform inputs exist');
    const names = mode === 'dev'
      ? ['event', 'pointerDownState', 'selectedElements', 'transformHandleType', 'resizeX', 'resizeY', 'shouldMaintainAspectRatio']
      : ['r', 't', 'n', 'a', 's', 'c', 'ii'];
    const getPointer = new Function(...names, 'imageResizeSnapped', `${helper}\n${update}\nreturn [${names[4]}, ${names[5]}];`);
    const original = { ...image, id: 'image', x: 50, y: 20, width: 400 };
    const adjust = (x, y, options = {}) => {
      const { shape = original, handle = 'se', selected = [shape], event = { pointerType: 'mouse' }, snapped = false } = options;
      const down = { originalElements: new Map([[shape.id, shape]]) };
      return getPointer.call({ state: { lastPointerDownWith: 'mouse' } }, event, down, selected, handle, x, y, event => !!event.shiftKey, snapped);
    };
    const close = (actual, expected, description) => {
      assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-8, `${description}: got ${actual}, expected ${expected}`);
    };

    close(adjust(450, 120), [450, 120], 'the initial grab and returning to it keep the size');
    close(adjust(450, 140), [450 + 80 / 17, 120 + 20 / 17], 'a vertical drag cannot make a wide corner outrun the pointer');
    for (const zoom of [0.5, 2]) {
      const [x, y] = adjust(450, 120 + 20 / zoom);
      close([(x - 450) * zoom, (y - 120) * zoom], [80 / 17, 20 / 17], `the same mouse movement at ${zoom * 100}% zoom`);
    }
    close(adjust(490, 130), [490, 130], 'motion along the diagonal transfers one to one');
    close(adjust(444, 144), [450, 120], 'perpendicular movement leaves the size unchanged');
    close(adjust(10, 10), [10, 10], 'continuing past the opposite corner follows the same line');
    close(adjust(180, 270, { shape: { ...original, angle: Math.PI / 2 } }), [200 - 20 / 17, 270 + 80 / 17], 'rotation changes the diagonal in scene coordinates');
    close(adjust(450, 140, { event: { altKey: true } }), [450 + 80 / 17, 120 + 20 / 17], 'Alt during a mouse drag still uses the projected pointer');
    close(adjust(450, 140, { event: { pointerType: 'mouse', shiftKey: true } }), [450, 140], 'Shift retains native free resize');
    close(adjust(450, 140, { event: { pointerType: 'pen' } }), [450, 140], 'pen retains native resizing');
    close(adjust(450, 140, { shape: { ...original, type: 'rectangle' } }), [450, 140], 'other elements retain native resizing');
    close(adjust(450, 140, { handle: 'e' }), [450, 140], 'side handles remain native');
    close(adjust(450, 140, { selected: [original, original] }), [450, 140], 'multi-selection remains native');
    close(adjust(450, 140, { snapped: true }), [450, 140], 'intentional snapping remains native');
  });

  test(`${mode} hover cursor follows each image corner and preserves native cursors for other tools`, async () => {
    const source = load(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const helper = source.match(/^function imageResizeCornerCursor[\s\S]*?\n}/m)?.[0] ?? '';
    const branch = mode === 'dev'
      ? /if \(elementWithTransformHandleType && elementWithTransformHandleType\.transformHandleType\) \{([\s\S]+?)\n\s*return;/
      : /if\(u&&u\.transformHandleType\)\{([^\n]+?);return\}/;
    const update = branch.exec(source)?.[1];
    assert.ok(update, 'native hover branch exists');
    const names = mode === 'dev'
      ? ['event', 'elementWithTransformHandleType', 'setCursor', 'getCursorForResizingElement']
      : ['t', 'u', 'Te', 'np'];
    const hover = new Function(...names, `${helper}\n${update}`);
    function getCursor(element, transformHandleType, { croppingElementId, pointerType = 'mouse' } = {}) {
      const canvas = { style: {} };
      hover.call({ interactiveCanvas: canvas, state: { croppingElementId } },
        { pointerType }, { element, transformHandleType }, (canvas, cursor) => { canvas.style.cursor = cursor; }, () => 'native');
      return canvas.style.cursor;
    }
    for (const handle of ['nw', 'se']) assert.deepEqual(angleAndFallback(getCursor(image, handle)), [27, 'nwse-resize']);
    for (const handle of ['ne', 'sw']) assert.deepEqual(angleAndFallback(getCursor(image, handle)), [153, 'nesw-resize']);
    assert.deepEqual(angleAndFallback(getCursor({ ...image, angle: Math.PI / 6 }, 'se')), [57, 'nwse-resize']);
    assert.deepEqual(angleAndFallback(getCursor({ ...image, width: 400 }, 'se')), [14, 'ew-resize']);
    assert.deepEqual(angleAndFallback(getCursor({ ...image, height: 400, angle: -Math.PI / 6 }, 'ne')), [87, 'ns-resize']);
    assert.deepEqual(angleAndFallback(getCursor({ ...image, scale: [-1, 1] }, 'se')), [27, 'nwse-resize']);
    assert.equal(getCursor(image, 'rotation'), 'native');
    assert.equal(getCursor(image, 's'), 'native');
    assert.equal(getCursor(image, 'se', { croppingElementId: 'image' }), 'native');
    assert.equal(getCursor(image, 'se', { pointerType: 'pen' }), 'native');
    assert.equal(getCursor({ ...image, type: 'rectangle' }, 'se'), 'native');
  });

  test(`${mode} active image resize updates the cursor when proportions or the dragged corner change`, async () => {
    const source = load(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const helper = source.match(/^function imageResizeCornerCursor[\s\S]*?\n}/m)?.[0] ?? '';
    const sdkResize = source.slice(source.indexOf('"maybeHandleResize",'), source.indexOf('"getContextMenuItems",'));
    const branch = mode === 'dev'
      ? /pointerDownState\.resize\.center\.y\s*\)\) \{\s*([\s\S]*?)const suggestedBindings/
      : /\.resize\.center\.y\)\)\{([\s\S]*?)let d=gs\(/;
    const update = branch.exec(sdkResize)?.[1];
    assert.notEqual(update, undefined, 'native transform success branch exists');
    const names = mode === 'dev'
      ? ['event', 'pointerDownState', 'selectedElements', 'transformHandleType']
      : ['r', 't', 'n', 'a'];
    const drag = new Function(...names, `${helper}\n${update}`);
    function getCursor(elements, original, resizeHandle, pointerType = 'mouse') {
      const canvas = { style: { cursor: 'native' } };
      drag.call({ interactiveCanvas: canvas }, { pointerType }, { originalElements: new Map([['image', original]]) }, elements, resizeHandle);
      return canvas.style.cursor;
    }
    const original = { ...image, id: 'image' };
    assert.deepEqual(angleAndFallback(getCursor([{ ...original, width: 400, height: 300 }], original, 'se')), [37, 'nwse-resize']);
    assert.deepEqual(angleAndFallback(getCursor([{ ...original, width: 400, height: 300, scale: [-1, 1] }], original, 'se')), [143, 'nesw-resize']);
    assert.deepEqual(angleAndFallback(getCursor([{ ...original, width: 400, height: 300, scale: [-1, -1] }], original, 'se')), [37, 'nwse-resize']);
    assert.equal(getCursor([original, original], original, 'se'), 'native');
    assert.equal(getCursor([original], original, 'rotation'), 'native');
    assert.equal(getCursor([original], original, 'se', 'touch'), 'native');
  });
}
