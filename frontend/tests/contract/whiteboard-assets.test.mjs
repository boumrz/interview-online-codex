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
