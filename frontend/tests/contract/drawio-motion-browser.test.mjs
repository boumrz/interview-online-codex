import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const assetRoot = fileURLToPath(new URL('../../public/drawio/', import.meta.url));
const panelSource = new URL('../../src/features/room/diagram/RoomDiagramPanel.tsx', import.meta.url);
const seed = '<mxfile><diagram id="room-diagram" name="Схема"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

test('the configured native editor resizes between room and expanded canvas without animated panels', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 30_000,
}, async () => {
  // Exercise the CSS actually sent by the room integration, rather than a
  // duplicate test-only configuration. Native scripts are served unmodified.
  const source = await readFile(panelSource, 'utf8');
  const customCssLiteral = source.match(/customCss:\s*("(?:[^"\\]|\\.)*")/);
  assert.ok(customCssLiteral, 'the room embed provides a literal customCss configuration');
  const customCss = JSON.parse(customCssLiteral[1]);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/host') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html><body style="margin:0"><iframe id="canvas" style="width:700px;height:450px;border:0" src="/drawio/index.html?embed=1&proto=json&configure=1&pages=0&offline=1&local=1&stealth=1&gapi=0&od=0&gh=0&gl=0&ui=kennedy"></iframe><script>
          window.loaded=false;
          addEventListener('message',event=>{
            if(event.origin!==location.origin||event.source!==document.getElementById('canvas').contentWindow)return;
            try {
              const message=JSON.parse(event.data);
              if(message.event==='configure')event.source.postMessage(JSON.stringify({action:'configure',config:{defaultPageVisible:false,defaultGridEnabled:false,customCss:${JSON.stringify(customCss)}}}),location.origin);
              if(message.event==='init')event.source.postMessage(JSON.stringify({action:'load',xml:${JSON.stringify(seed)},autosave:1,diffSync:true}),location.origin);
              if(message.event==='load')window.loaded=true;
            }catch{}
          });
        </script></body></html>`);
        return;
      }
      if (!pathname.startsWith('/drawio/')) throw new Error('outside editor assets');
      const filename = path.resolve(assetRoot, pathname.slice('/drawio/'.length));
      if (!filename.startsWith(assetRoot)) throw new Error('outside editor assets');
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript'
        : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      response.end(await readFile(filename));
    } catch {
      response.statusCode = 404;
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/host`);
    await page.waitForFunction(() => window.loaded);
    const samples = await page.evaluate(async () => {
      const frame = document.getElementById('canvas');
      const editorDocument = frame.contentDocument;
      const samples = [];
      const capture = width => {
        const shapes = editorDocument.querySelector('.geSidebarContainer:not(.geFormatContainer)');
        const format = editorDocument.querySelector('.geFormatContainer');
        return {
          targetWidth: width,
          shapesWidth: shapes.getBoundingClientRect().width,
          formatWidth: format.getBoundingClientRect().width,
          animations: editorDocument.getAnimations().filter(animation => animation.playState === 'running').map(animation => animation.constructor.name),
        };
      };
      // Allow initial responsive setup to complete; only participant-triggered
      // width changes are measured below, across both native panel breakpoints.
      await new Promise(resolve => setTimeout(resolve, 300));
      for (const width of [1440, 700, 1440, 700]) {
        frame.style.width = `${width}px`;
        frame.style.height = width === 700 ? '450px' : '900px';
        const started = performance.now();
        await new Promise(resolve => {
          const tick = () => {
            samples.push(capture(width));
            if (performance.now() - started < 400) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
      }
      return samples;
    });
    assert.ok(samples.length > 10, 'capture actual frames during expand and collapse');
    const animated = samples.filter(sample => sample.animations.length);
    assert.deepEqual(animated, [], 'native responsive panels must not animate during canvas expansion/collapse');
    for (const property of ['formatWidth', 'shapesWidth']) {
      const minimum = Math.min(...samples.map(sample => sample[property]));
      const maximum = Math.max(...samples.map(sample => sample[property]));
      assert.ok(maximum >= 200, `${property} is exercised while the native panel is open`);
      assert.ok(minimum <= 4, `${property} is exercised while the native panel is collapsed`);
      const intermediate = samples.filter(sample => Math.abs(sample[property] - minimum) > 0.75 && Math.abs(sample[property] - maximum) > 0.75);
      assert.deepEqual(intermediate, [], `${property} changes discretely without interpolated widths`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
