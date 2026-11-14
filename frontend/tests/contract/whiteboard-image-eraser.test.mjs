import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const adapt = require('../../scripts/excalidraw-image-eraser.cjs');
const sdk = new URL('../../node_modules/@excalidraw/excalidraw/dist/', import.meta.url);

function method(source, mode, name, next, app) {
  const registration = mode === 'dev' ? '__publicField' : 'C';
  const marker = source.indexOf(`"${name}"`);
  const start = source.lastIndexOf(`${registration}(this,`, marker);
  const nextMarker = source.indexOf(`"${next}"`, marker);
  const end = source.lastIndexOf(`${registration}(this,`, nextMarker);
  assert.ok(marker >= 0 && start >= 0 && end > start, `native ${name} registration exists`);
  const register = (target, property, value) => { target[property] = value; };
  const update = (element, changes) => ({ ...element, ...changes, version: element.version + 1 });
  const bound = element => element.type === 'text' && Boolean(element.containerId);
  const groups = (elements, id) => elements.filter(element => element.groupIds?.includes(id));
  const distance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]);
  const point = (x, y) => [x, y];
  const names = mode === 'dev'
    ? ['__publicField', 'newElementWith', 'isBoundToContainer', 'getElementsInGroup', 'pointDistance', 'pointFrom']
    : ['C', 'q', 'qe', 'Le', 'dr', 'z'];
  new Function(...names, source.slice(start, end)).call(app, register, update, bound, groups, distance, point);
  return app[name];
}

const element = (id, type, overrides = {}) => ({ id, type, version: 1, isDeleted: false, groupIds: [], ...overrides });
function harness(elements, hits = elements, pending = []) {
  let scene = elements;
  const app = {
    elementsPendingErasure: new Set(pending),
    captures: 0, replacements: 0, renders: 0,
    store: { shouldCaptureIncrement() { app.captures++; } },
    scene: {
      getElementsIncludingDeleted: () => scene,
      getNonDeletedElements: () => scene.filter(element => !element.isDeleted),
      replaceAllElements(next) { scene = next; app.replacements++; },
    },
    eraserTrail: { addPointToPath() {} },
    getElementsAtPosition: () => hits,
    getElementHitThreshold: () => 1,
    triggerRender() { app.renders++; },
  };
  return { app, get scene() { return scene; } };
}

for (const mode of ['dev', 'prod']) {
  test(`${mode} eraser adaptation fails visibly when the pinned hit or commit contract changes`, async () => {
    const source = await readFile(new URL(`${mode}/index.js`, sdk), 'utf8');
    assert.throws(() => adapt(source.replaceAll('"eraseElements"', '"changedEraseElements"')), /Pinned Excalidraw eraser changed/);
    assert.throws(() => adapt(source.replaceAll('this.elementsPendingErasure.add', 'this.changedPendingErasure.add')), /Pinned Excalidraw eraser changed/);
  });

  test(`${mode} eraser preserves raster objects and commits one native deletion for overlaid annotations`, async () => {
    const source = adapt(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const picture = element('picture', 'image');
    const stroke = element('stroke', 'freedraw');
    const label = element('label', 'text');
    const untouched = element('untouched', 'rectangle');
    const h = harness([picture, stroke, label, untouched], undefined, ['picture', 'stroke', 'label']);
    method(source, mode, 'eraseElements', 'initializeImage', h.app)();
    assert.equal(h.scene.find(element => element.id === 'picture'), picture, 'image is never replaced, versioned or deleted');
    assert.equal(h.scene.find(element => element.id === 'stroke').isDeleted, true);
    assert.equal(h.scene.find(element => element.id === 'label').isDeleted, true);
    assert.equal(h.scene.find(element => element.id === 'untouched'), untouched);
    assert.equal(h.app.captures, 1, 'native history captures the annotation deletion once');
    assert.equal(h.app.replacements, 1);
    assert.equal(h.app.elementsPendingErasure.size, 0);
  });

  test(`${mode} image-only eraser hits create no history or scene write, including deleted frame cascades`, async () => {
    const source = adapt(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const picture = element('picture', 'image', { frameId: 'frame' });
    const h = harness([picture], undefined, ['picture', 'frame']);
    method(source, mode, 'eraseElements', 'initializeImage', h.app)();
    assert.equal(h.scene[0], picture);
    assert.equal(h.app.captures, 0);
    assert.equal(h.app.replacements, 0);
    assert.equal(h.app.elementsPendingErasure.size, 0);

    const frame = element('frame', 'frame');
    const stroke = element('stroke', 'freedraw', { frameId: 'frame' });
    const nested = harness([frame, picture, stroke], undefined, ['frame']);
    method(source, mode, 'eraseElements', 'initializeImage', nested.app)();
    assert.equal(nested.scene.find(element => element.id === 'picture'), picture);
    assert.ok(nested.scene.filter(element => element.type !== 'image').every(element => element.isDeleted));
    assert.equal(nested.app.captures, 1);
  });

  test(`${mode} grouped or locked images do not block annotation erasure or enter its pending preview`, async () => {
    const source = adapt(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    for (const locked of [false, true]) {
      const picture = element('picture', 'image', { locked, groupIds: ['group'] });
      const stroke = element('stroke', 'freedraw', { groupIds: ['group'] });
      const sibling = element('sibling', 'line', { groupIds: ['group'] });
      const h = harness([picture, stroke, sibling], [picture, stroke]);
      method(source, mode, 'handleEraser', 'handleTouchMove', h.app)({ altKey: false }, { lastCoords: { x: 0, y: 0 } }, { x: 0, y: 0 });
      assert.deepEqual([...h.app.elementsPendingErasure].sort(), ['sibling', 'stroke']);
      assert.equal(h.app.renders, 1);
      method(source, mode, 'eraseElements', 'initializeImage', h.app)();
      assert.equal(h.scene.find(element => element.id === 'picture'), picture);
      assert.ok(h.scene.filter(element => element.type !== 'image').every(element => element.isDeleted));
    }
  });

  test(`${mode} Alt still restores pending annotation erasures without modifying an image`, async () => {
    const source = adapt(await readFile(new URL(`${mode}/index.js`, sdk), 'utf8'));
    const picture = element('picture', 'image', { groupIds: ['group'] });
    const stroke = element('stroke', 'freedraw', { groupIds: ['group'] });
    const h = harness([picture, stroke], [picture, stroke], ['stroke']);
    method(source, mode, 'handleEraser', 'handleTouchMove', h.app)({ altKey: true }, { lastCoords: { x: 0, y: 0 } }, { x: 0, y: 0 });
    assert.equal(h.app.elementsPendingErasure.size, 0);
    method(source, mode, 'eraseElements', 'initializeImage', h.app)();
    assert.deepEqual(h.scene, [picture, stroke]);
    assert.equal(h.app.captures, 0);
  });
}

test('unrelated SDK modules pass through unchanged', () => {
  const unrelated = 'export const circle = "ellipse";';
  assert.equal(adapt(unrelated), unrelated);
});
