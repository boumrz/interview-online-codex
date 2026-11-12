import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const assetRoot = path.resolve(fileURLToPath(new URL('../../public/drawio/', import.meta.url)));
const publicRoot = path.dirname(assetRoot);
const seed = '<mxfile><diagram id="interhub-room-board" name="Схема"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const editorQuery = '?embed=1&proto=json&spin=1&offline=1&local=1&stealth=1&gapi=0&od=0&gh=0&gl=0&saveAndExit=0&noSaveBtn=1&noExitBtn=1&ui=kennedy';

async function fixture(run) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/host') {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<html><body>${['a', 'b', 'canonical'].map(id => `<iframe id="${id}" width="700" height="600" src="/drawio/index.html${editorQuery}"></iframe>`).join('')}<script>window.events=[];addEventListener('message',event=>{if(event.origin!==location.origin)return;const from=['a','b','canonical'].find(id=>document.getElementById(id).contentWindow===event.source);if(!from)return;try{const message=JSON.parse(event.data);events.push({from,...message});if(message.event==='init')event.source.postMessage(JSON.stringify({action:'load',xml:${JSON.stringify(seed)},autosave:1,diffSync:true}),location.origin);}catch{}});</script></body></html>`);
        return;
      }
      const filename = path.resolve(publicRoot, '.' + pathname);
      if (!filename.startsWith(assetRoot + path.sep)) throw new Error('outside fixture');
      res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript'
        : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      let bytes = await readFile(filename);
      // Observe the real editor model only in this isolated fixture. Production uses postMessage only.
      if (filename.endsWith('/js/app.min.js')) bytes = Buffer.concat([bytes, Buffer.from(';var __interhubCapture=EditorUi.prototype.initializeEmbedMode;EditorUi.prototype.initializeEmbedMode=function(){window.__testUi=this;return __interhubCapture.apply(this,arguments);};')]);
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(origin + '/host');
    await page.waitForFunction(() => events.filter(event => event.event === 'load').length === 3);
    const evaluate = (id, fn, argument) => page.locator(`#${id}`).contentFrame().locator('body').evaluate(fn, argument);
    let request = 0;
    const command = async (id, message) => {
      const requestId = `request-${++request}`;
      const start = await page.evaluate(() => events.length);
      await page.evaluate(({ id, message, requestId }) => document.getElementById(id).contentWindow.postMessage(JSON.stringify({ ...message, requestId }), location.origin), { id, message, requestId });
      const correlation = { id, requestId, start, load: message.action === 'load' };
      await page.waitForFunction(({ id, requestId, start, load }) => events.some((event, index) => index >= start && event.from === id && (load ? event.event === 'load' : event.message?.requestId === requestId)), correlation);
      const response = await page.evaluate(({ id, requestId, start, load }) => events.find((event, index) => index >= start && event.from === id && (load ? event.event === 'load' : event.message?.requestId === requestId)), correlation);
      assert.equal(response.error, undefined);
      return response;
    };
    const values = id => evaluate(id, () => window.__testUi.editor.graph.getDefaultParent().children?.map(cell => ({ id: cell.id, value: cell.value })) ?? []);
    const autosaves = () => page.evaluate(() => events.filter(event => event.event === 'autosave'));
    const insert = (id, value) => evaluate(id, (body, value) => {
      const graph = window.__testUi.editor.graph;
      graph.getModel().beginUpdate();
      try { graph.insertVertex(graph.getDefaultParent(), null, value, 60, 60, 120, 60); }
      finally { graph.getModel().endUpdate(); }
    }, value);
    const edit = async (id, fn, argument) => {
      const before = (await autosaves()).filter(event => event.from === id).length;
      await evaluate(id, fn, argument);
      await page.waitForFunction(({ id, before }) => events.filter(event => event.event === 'autosave' && event.from === id).length > before, { id, before });
      return (await autosaves()).filter(event => event.from === id).at(-1);
    };
    const scene = id => evaluate(id, () => {
      const graph = window.__testUi.editor.graph;
      return Object.values(graph.model.cells).filter(cell => cell.vertex || cell.edge).map(cell => ({
        id: cell.id, label: graph.convertValueToString(cell), parent: cell.parent?.id,
        vertex: Boolean(cell.vertex), edge: Boolean(cell.edge), x: cell.geometry?.x,
        source: cell.source?.id, target: cell.target?.id, style: cell.style,
      })).sort((a, b) => a.id.localeCompare(b.id));
    });
    const orderFromXml = xml => page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      const updates = {};
      for (const diagram of document.querySelectorAll('diagram')) {
        const cells = {};
        const previous = {};
        for (const root of diagram.querySelectorAll('mxGraphModel > root')) {
          for (const entry of root.children) {
            const cell = entry.tagName === 'mxCell' ? entry : entry.querySelector('mxCell');
            const id = entry.getAttribute('id') ?? cell?.getAttribute('id');
            const parent = cell?.getAttribute('parent');
            if (id && parent) {
              cells[id] = { parent, previous: previous[parent] ?? '' };
              previous[parent] = id;
            }
          }
        }
        updates[diagram.id] = { cells: { u: cells } };
      }
      return { u: updates };
    }, xml);
    await run({ page, evaluate, command, values, autosaves, insert, edit, scene, orderFromXml });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('pinned draw.io supports canonical replay, order reconciliation and personal Undo without patch echoes', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ page, evaluate, command, values, autosaves, insert }) => {
    const violation = await evaluate('a', () => new Promise(resolve => {
      document.addEventListener('securitypolicyviolation', event => resolve({ blockedURI: event.blockedURI, directive: event.effectiveDirective }), { once: true });
      const image = new Image();
      image.src = 'https://interhub-drawio-test.invalid/blocked-image';
    }));
    assert.equal(violation.blockedURI, 'https://interhub-drawio-test.invalid/blocked-image');
    assert.equal(violation.directive, 'img-src');
    await Promise.all([insert('a', 'Alice'), insert('b', 'Bob')]);
    await page.waitForFunction(() => events.filter(event => event.event === 'autosave').length === 2);
    const initial = await autosaves();
    const alice = initial.find(event => event.from === 'a');
    const bob = initial.find(event => event.from === 'b');
    assert.ok(alice.patch && bob.patch);
    assert.ok(alice.xml && bob.xml);
    assert.notEqual((await values('a'))[0].id, (await values('b'))[0].id);

    // Server acceptance A then B is rebuilt in an unedited canonical editor, not from a scene with future local edits.
    await command('canonical', { action: 'patch', patch: alice.patch });
    await command('canonical', { action: 'patch', patch: bob.patch });
    const canonical = await command('canonical', { action: 'export', format: 'xml' });
    assert.match(canonical.xml, /Alice/);
    assert.match(canonical.xml, /Bob/);
    const canonicalChecksum = (await command('canonical', { action: 'getDiff' })).checksum;

    await command('a', { action: 'patch', patch: bob.patch });
    await command('b', { action: 'patch', patch: alice.patch });
    await command('b', { action: 'patch', patch: bob.patch });
    // Reapplying insert patches alone preserves different sibling order; explicit accepted order resolves it.
    const order = await page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      const updates = {};
      for (const diagram of document.querySelectorAll('diagram')) {
        const cells = {};
        const previous = {};
        for (const cell of diagram.querySelectorAll('mxGraphModel > root > mxCell')) {
          const parent = cell.getAttribute('parent');
          if (parent) {
            cells[cell.id] = { parent, previous: previous[parent] ?? '' };
            previous[parent] = cell.id;
          }
        }
        updates[diagram.id] = { cells: { u: cells } };
      }
      return { u: updates };
    }, canonical.xml);
    for (const id of ['a', 'b']) {
      const applied = await command(id, { action: 'patch', patch: order });
      assert.equal(applied.checksum, canonicalChecksum);
      assert.deepEqual(await values(id), await values('canonical'));
    }
    assert.equal((await autosaves()).length, 2, 'Remote patches must not echo as local saves');

    await evaluate('a', () => window.__testUi.actions.get('undo').funct());
    assert.deepEqual((await values('a')).map(cell => cell.value), ['Bob']);
    await page.waitForFunction(() => events.filter(event => event.event === 'autosave').length === 3);
    const undo = (await autosaves()).at(-1);
    await command('canonical', { action: 'patch', patch: undo.patch });
    await command('b', { action: 'patch', patch: undo.patch });
    assert.deepEqual((await values('b')).map(cell => cell.value), ['Bob']);
    const saved = await command('canonical', { action: 'export', format: 'xml' });
    await command('canonical', { action: 'load', xml: saved.xml, autosave: 1, diffSync: true });
    assert.deepEqual((await values('canonical')).map(cell => cell.value), ['Bob']);
    assert.equal((await autosaves()).length, 3, 'Reloaded accepted snapshot must not create a write');
  });
});

test('parallel label and geometry edits on one native block survive canonical replay', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ page, evaluate, command, edit, scene }) => {
    const created = await edit('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.insertVertex(graph.getDefaultParent(), null, 'Service', 60, 60, 120, 60);
    });
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: created.patch });
    const nodeId = (await scene('a'))[0].id;
    const [moved, renamed] = await Promise.all([
      edit('a', (body, id) => {
        const graph = window.__testUi.editor.graph;
        const geometry = graph.model.getCell(id).geometry.clone();
        geometry.x = 280;
        graph.model.setGeometry(graph.model.getCell(id), geometry);
      }, nodeId),
      edit('b', (body, id) => {
        const graph = window.__testUi.editor.graph;
        graph.model.setValue(graph.model.getCell(id), 'Renamed service');
      }, nodeId),
    ]);
    await command('canonical', { action: 'patch', patch: moved.patch });
    await command('canonical', { action: 'patch', patch: renamed.patch });
    await command('a', { action: 'patch', patch: renamed.patch });
    await command('b', { action: 'patch', patch: moved.patch });
    for (const id of ['a', 'b', 'canonical']) {
      const [node] = await scene(id);
      assert.equal(node.label, 'Renamed service');
      assert.equal(node.x, 280);
    }
    const hashes = await Promise.all(['a', 'b', 'canonical'].map(async id => (await command(id, { action: 'getDiff' })).checksum));
    assert.equal(new Set(hashes).size, 1);
  });
});

test('delete wins against a late native geometry update without resurrecting the node', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ command, edit, scene }) => {
    const created = await edit('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.insertVertex(graph.getDefaultParent(), null, 'Removed service', 60, 60, 120, 60);
    });
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: created.patch });
    const nodeId = (await scene('a'))[0].id;
    const [removed, moved] = await Promise.all([
      edit('a', (body, id) => {
        const graph = window.__testUi.editor.graph;
        graph.removeCells([graph.model.getCell(id)]);
      }, nodeId),
      edit('b', (body, id) => {
        const graph = window.__testUi.editor.graph;
        const geometry = graph.model.getCell(id).geometry.clone();
        geometry.x = 300;
        graph.model.setGeometry(graph.model.getCell(id), geometry);
      }, nodeId),
    ]);
    await command('canonical', { action: 'patch', patch: removed.patch });
    await command('canonical', { action: 'patch', patch: moved.patch });
    await command('a', { action: 'patch', patch: moved.patch });
    await command('b', { action: 'patch', patch: removed.patch });
    for (const id of ['a', 'b', 'canonical']) assert.deepEqual(await scene(id), []);
    const xml = (await command('canonical', { action: 'export', format: 'xml' })).xml;
    assert.doesNotMatch(xml, /Removed service/);
  });
});

test('connected architecture blocks retain edges after a move and remove incident edges on source deletion', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ command, edit, scene }) => {
    const created = await edit('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.model.beginUpdate();
      try {
        const service = graph.insertVertex(graph.getDefaultParent(), null, 'API', 60, 60, 120, 60);
        const database = graph.insertVertex(graph.getDefaultParent(), null, 'Database', 320, 60, 100, 80, 'shape=cylinder3;');
        graph.insertEdge(graph.getDefaultParent(), null, 'SQL', service, database);
      } finally { graph.model.endUpdate(); }
    });
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: created.patch });
    const before = await scene('a');
    const source = before.find(cell => cell.label === 'API');
    const database = before.find(cell => cell.label === 'Database');
    const connection = before.find(cell => cell.edge);
    assert.equal(connection.source, source.id);
    assert.equal(connection.target, database.id);
    const moved = await edit('a', (body, id) => {
      const graph = window.__testUi.editor.graph;
      const geometry = graph.model.getCell(id).geometry.clone();
      geometry.x = 190;
      graph.model.setGeometry(graph.model.getCell(id), geometry);
    }, source.id);
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: moved.patch });
    for (const id of ['a', 'b', 'canonical']) {
      const cells = await scene(id);
      assert.equal(cells.find(cell => cell.id === source.id).x, 190);
      assert.equal(cells.find(cell => cell.id === connection.id).source, source.id);
      assert.equal(cells.find(cell => cell.id === connection.id).target, database.id);
    }
    const removed = await edit('a', (body, id) => {
      const graph = window.__testUi.editor.graph;
      graph.removeCells([graph.model.getCell(id)]);
    }, source.id);
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: removed.patch });
    for (const id of ['a', 'b', 'canonical']) {
      const cells = await scene(id);
      assert.equal(cells.length, 1);
      assert.equal(cells[0].id, database.id);
      assert.equal(cells.some(cell => cell.id === connection.id), false);
    }
  });
});

test('wrapped UserObject inserts inside a group converge in canonical sibling order', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ command, edit, scene, evaluate, orderFromXml }) => {
    const initial = await edit('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.model.beginUpdate();
      try {
        const group = graph.insertVertex(graph.getDefaultParent(), null, 'Subsystem', 60, 60, 320, 220, 'group;');
        const object = mxUtils.createXmlDocument().createElement('UserObject');
        object.setAttribute('label', 'Existing worker');
        object.setAttribute('component', 'service');
        graph.insertVertex(group, null, object, 20, 30, 100, 50);
      } finally { graph.model.endUpdate(); }
    });
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: initial.patch });
    const group = (await scene('a')).find(cell => cell.label === 'Subsystem');
    const insertWrapped = (id, label) => edit(id, (body, { groupId, label }) => {
      const graph = window.__testUi.editor.graph;
      const object = mxUtils.createXmlDocument().createElement('UserObject');
      object.setAttribute('label', label);
      object.setAttribute('component', 'service');
      graph.insertVertex(graph.model.getCell(groupId), null, object, 150, 30, 100, 50);
    }, { groupId: group.id, label });
    const [alice, bob] = await Promise.all([insertWrapped('a', 'Alice worker'), insertWrapped('b', 'Bob worker')]);
    await command('canonical', { action: 'patch', patch: alice.patch });
    await command('canonical', { action: 'patch', patch: bob.patch });
    const canonical = await command('canonical', { action: 'export', format: 'xml' });
    assert.match(canonical.xml, /<UserObject[^>]*component="service"/);
    const order = await orderFromXml(canonical.xml);
    await command('a', { action: 'patch', patch: bob.patch });
    await command('b', { action: 'patch', patch: alice.patch });
    const canonicalChecksum = (await command('canonical', { action: 'getDiff' })).checksum;
    const childLabels = id => evaluate(id, (body, groupId) => {
      const graph = window.__testUi.editor.graph;
      return graph.model.getCell(groupId).children.map(cell => graph.convertValueToString(cell));
    }, group.id);
    for (const id of ['a', 'b']) {
      assert.equal((await command(id, { action: 'patch', patch: order })).checksum, canonicalChecksum);
      assert.deepEqual(await childLabels(id), await childLabels('canonical'));
    }
    assert.deepEqual(new Set(await childLabels('a')), new Set(['Existing worker', 'Alice worker', 'Bob worker']));
    await evaluate('a', () => window.__testUi.actions.get('undo').funct());
    assert.deepEqual(new Set(await childLabels('a')), new Set(['Existing worker', 'Bob worker']));
  });
});

test('native freehand gesture is stored with architecture in the same replayable document', {
  skip: !existsSync(path.join(assetRoot, 'index.html')) ? 'Run npm run prepare:drawio first' : false,
  timeout: 45_000,
}, async () => {
  await fixture(async ({ page, command, edit, evaluate, scene, autosaves }) => {
    const architecture = await edit('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.model.beginUpdate();
      try {
        const service = graph.insertVertex(graph.getDefaultParent(), null, 'Service', 60, 60, 100, 60);
        const database = graph.insertVertex(graph.getDefaultParent(), null, 'Database', 260, 60, 100, 70, 'shape=cylinder3;');
        graph.insertEdge(graph.getDefaultParent(), null, 'query', service, database);
      } finally { graph.model.endUpdate(); }
    });
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: architecture.patch });
    const before = (await autosaves()).filter(event => event.from === 'a').length;
    const point = await evaluate('a', () => {
      const graph = window.__testUi.editor.graph;
      graph.freehand.setPerfectFreehandMode(false);
      graph.freehand.startDrawing();
      const bounds = graph.container.getBoundingClientRect();
      return { x: bounds.left + 90, y: bounds.top + 220 };
    });
    await page.locator('#a').scrollIntoViewIfNeeded();
    const frame = await page.locator('#a').boundingBox();
    await page.mouse.move(frame.x + point.x, frame.y + point.y);
    await page.mouse.down();
    await page.mouse.move(frame.x + point.x + 25, frame.y + point.y + 20, { steps: 5 });
    await page.mouse.move(frame.x + point.x + 70, frame.y + point.y - 15, { steps: 7 });
    await page.mouse.up();
    await evaluate('a', () => window.__testUi.editor.graph.freehand.stopDrawing());
    const drawing = (await scene('a')).find(cell => cell.style?.includes('shape=stencil('));
    assert.ok(drawing, 'The native tool creates a compressed stencil vertex in this pinned version');
    await page.waitForFunction(before => events.filter(event => event.event === 'autosave' && event.from === 'a').length > before, before);
    const stroke = (await autosaves()).filter(event => event.from === 'a').at(-1);
    assert.ok(stroke.patch);
    for (const id of ['b', 'canonical']) await command(id, { action: 'patch', patch: stroke.patch });
    const canonical = await command('canonical', { action: 'export', format: 'xml' });
    assert.match(canonical.xml, /value="Service"/);
    assert.match(canonical.xml, /value="Database"/);
    assert.match(canonical.xml, /shape=stencil\(/);
    await command('canonical', { action: 'load', xml: canonical.xml, autosave: 1, diffSync: true });
    const restored = await scene('canonical');
    assert.equal(restored.filter(cell => cell.edge).length, 1);
    assert.equal(restored.filter(cell => cell.vertex).length, 3);
    assert.equal(restored.find(cell => cell.id === drawing.id).style, drawing.style);
  });
});
