import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { extractDrawioArchive, installDrawioArchive, isDrawioPrepared, prepareDrawio } from '../../scripts/prepare-drawio.mjs';

function archive(extra = {}) {
  return zipSync({
    'index.html': strToU8('<html>editor</html>'),
    'js/bootstrap.js': strToU8('bootstrap'),
    'js/app.min.js': strToU8('editor'),
    'resources/dia_ru.txt': strToU8('diagram'),
    'WEB-INF/lib/server.jar': strToU8('server'),
    'plugins/remote.js': strToU8('remote plugin'),
    ...extra,
  });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('verified archive provides the editor and its local resources without server integrations', () => {
  const bytes = archive();
  const files = extractDrawioArchive(bytes, digest(bytes));
  assert.equal(new TextDecoder().decode(files['index.html']), '<html>editor</html>');
  assert.equal(new TextDecoder().decode(files['resources/dia_ru.txt']), 'diagram');
  assert.equal(files['WEB-INF/lib/server.jar'], undefined);
  assert.equal(files['plugins/remote.js'], undefined);
});

test('archive integrity is checked before extraction', () => {
  assert.throws(() => extractDrawioArchive(archive(), '0'.repeat(64)), /DRAWIO_ARCHIVE_CHECKSUM/);
});

test('absolute and traversal entries are rejected even outside the static allowlist', () => {
  for (const name of ['../escape.js', '/escape.js', 'js/../../escape.js', 'C:/escape.js', 'WEB-INF/../escape.js']) {
    const bytes = archive({ [name]: strToU8('untrusted') });
    assert.throws(() => extractDrawioArchive(bytes, digest(bytes)), /DRAWIO_ARCHIVE_PATH/, name);
  }
});

test('partial archives cannot masquerade as a prepared editor', () => {
  const bytes = zipSync({ 'index.html': strToU8('incomplete') });
  assert.throws(() => extractDrawioArchive(bytes, digest(bytes)), /DRAWIO_ARCHIVE_INCOMPLETE/);
});

test('feature-off preparation does not access an archive or create editor files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'interhub-drawio-off-'));
  try {
    const target = path.join(directory, 'editor');
    assert.deepEqual(await prepareDrawio({ ifEnabled: true, enabled: false, target,
      archivePath: path.join(directory, 'absent-archive') }), { prepared: false, skipped: true });
    assert.equal(await isDrawioPrepared(target), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('installed editor serves only local code, fonts, images and connections by policy', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'interhub-drawio-install-'));
  try {
    const bytes = archive({ 'index.html': strToU8('<html><head><script src="js/bootstrap.js"></script></head><body>editor</body></html>') });
    await installDrawioArchive(bytes, directory, digest(bytes));
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /connect-src 'self'/);
    assert.match(html, /img-src 'self' data: blob:/);
    assert.match(html, /frame-src 'none'/);
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
    assert.match(await readFile(path.join(directory, 'LICENSE'), 'utf8'), /Apache License/);
    assert.equal(await readFile(path.join(directory, 'js/app.min.js'), 'utf8'), 'editor');
    // A rejected replacement leaves the existing working editor intact.
    await assert.rejects(installDrawioArchive(bytes, directory, '0'.repeat(64)), /DRAWIO_ARCHIVE_CHECKSUM/);
    assert.equal(await readFile(path.join(directory, 'index.html'), 'utf8'), html);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('incomplete or malformed prepared markers are not accepted as a usable editor', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'interhub-drawio-marker-'));
  try {
    await writeFile(path.join(directory, '.interhub-drawio.json'), '{bad');
    assert.equal(await isDrawioPrepared(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
