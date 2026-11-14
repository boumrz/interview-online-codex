import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { SUBSET_WORKER_FILES } from '../../scripts/whiteboard-assets.mjs';

const require = createRequire(import.meta.url);
const localize = require('../../scripts/excalidraw-local-assets-loader.cjs');
const sdk = new URL('../../node_modules/@excalidraw/excalidraw/', import.meta.url);

test('pinned SDK fonts remain local even when the primary font is unavailable', async () => {
  const metadata = JSON.parse(await readFile(new URL('package.json', sdk), 'utf8'));
  assert.equal(metadata.version, '0.18.1');
  for (const mode of ['prod', 'dev']) {
    let adapted = 0;
    for (const file of await readdir(new URL(`dist/${mode}/`, sdk))) {
      if (!file.endsWith('.js')) continue;
      const source = await readFile(new URL(`dist/${mode}/${file}`, sdk), 'utf8');
      if (!source.includes('ASSETS_FALLBACK_URL')) continue;
      const output = localize(source);
      assert.ok(output !== source, `${mode}: remove the SDK default CDN fallback`);
      assert.match(output, /ASSETS_FALLBACK_URL[\s\S]{0,150}whiteboard-assets/);
      assert.doesNotMatch(output, /ASSETS_FALLBACK_URL[^;]*https:\/\/esm\.sh/);
      adapted++;
    }
    assert.equal(adapted, 1, `${mode}: exactly one pinned font provider is adapted`);
  }
});

test('a native ellipse drag uses equal diameters in the development and production editors', async () => {
  for (const mode of ['dev', 'prod']) {
    const directory = new URL(`dist/${mode}/`, sdk);
    let checked = 0;
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.js')) continue;
      const source = await readFile(new URL(file, directory), 'utf8');
      // Exercise the actual SDK drag routine apart from scene mutation, text,
      // image and Shift helpers. Unmodified drags of the other shapes still
      // use their original dimensions.
      const output = localize(source);
      const start = /(?:var dragNewElement = |,_9=)\(\{\s*newElement:/.exec(output);
      if (!start) continue;
      const body = output.slice(start.index);
      const arrowStart = body.indexOf('({');
      const arrowEnd = mode === 'dev' ? body.indexOf('\n};') : body.indexOf('};var');
      assert.ok(arrowEnd > arrowStart);
      const expression = body.slice(arrowStart, arrowEnd + (mode === 'dev' ? 2 : 1));
      const makeDrag = new Function('mutateElement', 'Y', 'isTextElement', 'k', 'isImageElement', 'Ye', `return (${expression})`);
      const drag = makeDrag(Object.assign, Object.assign, () => false, () => false, () => false, () => false);
      for (const [dx, dy] of [[50, 12], [0, -30], [-18, 0], [-12, -42]]) {
        for (const type of ['ellipse', 'rectangle']) {
          if (type === 'rectangle' && (!dx || !dy)) continue;
          const element = { type };
          drag({ newElement: element, elementType: type, originX: 10, originY: 20, x: 10 + dx, y: 20 + dy,
            width: Math.abs(dx), height: Math.abs(dy), shouldMaintainAspectRatio: false, shouldResizeFromCenter: false, zoom: 1 });
          const diameter = Math.max(Math.abs(dx), Math.abs(dy));
          assert.deepEqual([element.width, element.height], type === 'ellipse' ? [diameter, diameter] : [Math.abs(dx), Math.abs(dy)], mode);
          assert.equal(element.x, dx < 0 ? 10 - element.width : 10);
          assert.equal(element.y, dy < 0 ? 20 - element.height : 20);
        }
      }
      checked++;
    }
    assert.equal(checked, 1, `${mode}: native new-element drag routine`);
  }
});

test('local subset worker manifest contains its full static module graph', async () => {
  const visited = new Set();
  const queue = ['subset-worker.chunk.js'];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(new URL(`dist/prod/${file}`, sdk), 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.\/[^"']+\.js)["']/g)) queue.push(match[1].slice(2));
  }
  assert.deepEqual([...visited].sort(), [...SUBSET_WORKER_FILES].sort());
});

test('shipped font attribution manifest matches every pinned font and notice', async () => {
  const base = new URL('../../scripts/whiteboard-font-licenses/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.ok(manifest);
  const fonts = await readdir(new URL('dist/prod/fonts/', sdk));
  assert.ok(fonts.includes('Liberation'), 'unused server font remains untouched in the npm package');
  for (const font of fonts.filter(font => font !== 'Liberation')) {
    const notice = await readFile(new URL(`${font}.LICENSE.txt`, base), 'utf8');
    assert.match(notice, /Copyright/i, font);
    assert.match(notice, /SIL OPEN FONT LICENSE|MIT License|Permission is hereby granted/i, font);
    const metadata = manifest.families[font];
    const files = (await readdir(new URL(`dist/prod/fonts/${font}/`, sdk))).filter(file => file.endsWith('.woff2')).map(file => `${font}/${file}`).sort();
    assert.deepEqual(Object.keys(metadata.fontFiles).sort(), files, `${font}: every shipped face has attribution`);
    assert.equal(createHash('sha256').update(notice).digest('hex'), metadata.noticeSha256, font);
    for (const [file, expected] of Object.entries(metadata.fontFiles)) {
      const bytes = await readFile(new URL(`dist/prod/fonts/${file}`, sdk));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file);
    }
  }
});
