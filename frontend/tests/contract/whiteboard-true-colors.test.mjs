import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const localize = require('../../scripts/excalidraw-local-assets-loader.cjs');
const sdk = new URL('../../node_modules/@excalidraw/excalidraw/dist/', import.meta.url);
const themeFilter = 'invert(93%) hue-rotate(180deg)';
const imageFilter = 'invert(100%) hue-rotate(180deg) saturate(1.25)';

async function renderer(mode) {
  const directory = new URL(`${mode}/`, sdk);
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const original = await readFile(new URL(file, directory), 'utf8');
    if (!original.includes(themeFilter) || !original.includes(imageFilter)) continue;
    return { original, output: localize(original) };
  }
  assert.fail(`Pinned ${mode} renderer was not found`);
}

function constant(original, output, filter) {
  const name = new RegExp(`(?:var\\s+|,)\\s*([\\w$]+)\\s*=\\s*${JSON.stringify(filter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(original)?.[1];
  assert.ok(name, 'native filter declaration exists');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = new RegExp(`\\b${escaped}\\s*=\\s*("[^"]+")`).exec(output)?.[1];
  assert.ok(literal, 'adapted declaration remains executable');
  return JSON.parse(literal);
}

function nativeArrow(source, name, dependencies) {
  const start = source.indexOf(`var ${name} = `);
  assert.ok(start >= 0, `native ${name} exists`);
  const end = source.indexOf('\n};', start);
  assert.ok(end > start, `native ${name} body ends`);
  const expression = source.slice(start + `var ${name} = `.length, end + 2);
  return new Function(...Object.keys(dependencies), `return (${expression});`)(...Object.values(dependencies));
}

for (const mode of ['dev', 'prod']) {
  test(`${mode} native dark filter constants preserve the original RGB values`, async () => {
    const { original, output } = await renderer(mode);
    assert.equal(constant(original, output, themeFilter), 'none', 'direct native render/export/frame filters preserve RGB');
    assert.equal(constant(original, output, imageFilter), 'none', 'raster caches do not invert original image colors');
  });
}

test('native raster cache rendering uses original image colors in both themes', async () => {
  const { original, output } = await renderer('dev');
  const IMAGE_INVERT_FILTER = constant(original, output, imageFilter);
  const shouldResetImageFilter = nativeArrow(output, 'shouldResetImageFilter', {
    THEME: { DARK: 'dark' }, MIME_TYPES: { svg: 'image/svg+xml' },
    isInitializedImageElement: element => !!element.fileId, isPendingImageElement: () => false,
  });
  for (const theme of ['light', 'dark']) {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
      const rendered = [];
      const document = { createElement() { return { getContext() {
        return { filter: 'none', save() {}, restore() {}, translate() {}, scale() {} };
      } }; } };
      const generate = nativeArrow(output, 'generateElementCanvas', {
        document, getCanvasPadding: () => 0,
        cappedElementCanvasSize: () => ({ width: 2, height: 2, scale: 1 }),
        isLinearElement: () => false, isFreeDrawElement: () => false, window: { devicePixelRatio: 1 },
        rough: { canvas: () => ({}) }, shouldResetImageFilter, IMAGE_INVERT_FILTER,
        drawElementOnCanvas: (_element, _rough, context) => rendered.push(context.filter),
        getBoundTextElement: () => null, isArrowElement: () => false,
        getContainingFrame: () => null, isImageElement: () => true,
      });
      generate({ type: 'image', fileId: 'worksheet', crop: null, angle: 0 }, new Map(), { value: 1 },
        { imageCache: new Map([['worksheet', { mimeType }]]) }, { theme });
      assert.deepEqual(rendered, ['none'], `${theme} ${mimeType} keeps its native raster pixels`);
    }
  }
});

test('native dark export background does not remap an explicitly chosen color', async () => {
  const { original, output } = await renderer('dev');
  const bootstrap = nativeArrow(output, 'bootstrapCanvas', {
    THEME: { DARK: 'dark' }, THEME_FILTER: constant(original, output, themeFilter),
  });
  for (const color of ['#ff0000', '#800000', '#000000', '#ffffff']) {
    const painted = [];
    const context = { filter: 'none', setTransform() {}, scale() {}, save() {}, restore() {}, clearRect() {},
      fillRect() { painted.push({ color: this.fillStyle, filter: this.filter }); } };
    bootstrap({ canvas: { getContext: () => context }, scale: 1, normalizedWidth: 1, normalizedHeight: 1,
      theme: 'dark', isExporting: true, viewBackgroundColor: color });
    assert.deepEqual(painted, [{ color, filter: 'none' }]);
  }
});

test('the paired color adapter rejects partial or duplicated native filters', () => {
  const preserveColors = require('../../scripts/excalidraw-true-colors.cjs');
  const theme = `var theme = ${JSON.stringify(themeFilter)};`;
  const image = `var image = ${JSON.stringify(imageFilter)};`;
  assert.throws(() => preserveColors(theme), /Pinned Excalidraw color filters changed/);
  assert.throws(() => preserveColors(image), /Pinned Excalidraw color filters changed/);
  assert.throws(() => preserveColors(theme + image + image), /Pinned Excalidraw color filters changed/);
  const unrelated = 'export const unrelated = true;';
  assert.equal(preserveColors(unrelated), unrelated);
  const adapted = preserveColors(theme + image);
  assert.equal(preserveColors(adapted), adapted, 'reprocessing an adapted module is harmless');
});
