import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as preparation from '../../scripts/prepare-drawio.mjs';

const bytes = Buffer.from('verified pinned archive fixture');
const hash = createHash('sha256').update(bytes).digest('hex');
async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'interhub-drawio-download-'));
  try { await run({ directory, archivePath: path.join(directory, 'cache', 'draw.war') }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function ensure(options) {
  assert.equal(typeof preparation.ensureDrawioArchive, 'function', 'download-only preparation must seed a verified Docker-context archive without extracting the editor');
  return preparation.ensureDrawioArchive({ expectedDigest: hash, legacyArchivePath: null, retryDelayMs: 0, ...options });
}

test('a verified offline archive needs no network and is returned unchanged', () => fixture(async ({ directory }) => {
  const archivePath = path.join(directory, 'draw.war'); await writeFile(archivePath, bytes);
  let requests = 0;
  const result = await ensure({ archivePath, fetchImpl: async () => { requests++; throw new Error('offline'); } });
  assert.deepEqual(result, bytes); assert.equal(requests, 0);
}));

test('a fetched archive is verified and cached for the next Docker build', () => fixture(async ({ archivePath }) => {
  let requests = 0;
  const options = { archivePath, fetchImpl: async (url, init) => {
    requests++; assert.equal(url, preparation.DRAWIO_ARCHIVE_URL); assert.ok(init.signal);
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
  } };
  assert.deepEqual(await ensure(options), bytes); assert.deepEqual(await readFile(archivePath), bytes);
  await ensure(options); assert.equal(requests, 1);
}));

test('a verified legacy cache migrates into the Docker context without fetching', () => fixture(async ({ directory, archivePath }) => {
  const legacyArchivePath = path.join(directory, 'legacy.war'); await writeFile(legacyArchivePath, bytes);
  assert.deepEqual(await ensure({ archivePath, legacyArchivePath, fetchImpl: async () => { throw new Error('network forbidden'); } }), bytes);
  assert.deepEqual(await readFile(archivePath), bytes);
}));

test('corrupt cache or downloaded bytes fail closed without accepting another release', () => fixture(async ({ directory, archivePath }) => {
  const corrupt = path.join(directory, 'corrupt.war'); await writeFile(corrupt, 'corrupt');
  let requests = 0;
  await assert.rejects(ensure({ archivePath: corrupt, fetchImpl: async () => { requests++; } }), /DRAWIO_ARCHIVE_CHECKSUM/);
  await assert.rejects(ensure({ archivePath, fetchImpl: async () => new Response('wrong release') }), /DRAWIO_ARCHIVE_CHECKSUM/);
  assert.equal(requests, 0); await assert.rejects(stat(archivePath), { code: 'ENOENT' });
}));

test('transient timeout retries are bounded and explain how to provide the offline archive', () => fixture(async ({ archivePath }) => {
  let requests = 0;
  await assert.rejects(ensure({ archivePath, attempts: 2, fetchImpl: async () => {
    requests++; throw new DOMException('timeout', 'TimeoutError');
  } }), error => /DRAWIO_DOWNLOAD_TIMEOUT/.test(error.message) && error.message.includes(preparation.DRAWIO_ARCHIVE_URL) && error.message.includes(archivePath));
  assert.equal(requests, 2); await assert.rejects(stat(archivePath), { code: 'ENOENT' });
}));

test('temporary HTTP failure retries, while permanent HTTP and oversized downloads do not', () => fixture(async ({ archivePath }) => {
  let requests = 0;
  assert.deepEqual(await ensure({ archivePath, fetchImpl: async () => ++requests === 1 ? new Response('busy', { status: 503 }) : new Response(bytes) }), bytes);
  assert.equal(requests, 2);
  await rm(archivePath);
  requests = 0;
  await assert.rejects(ensure({ archivePath, fetchImpl: async () => { requests++; return new Response('missing', { status: 404 }); } }), /DRAWIO_DOWNLOAD_FAILED/);
  assert.equal(requests, 1);
  await assert.rejects(ensure({ archivePath, fetchImpl: async () => new Response('large', { headers: { 'Content-Length': String(100 * 1024 * 1024) } }) }), /DRAWIO_ARCHIVE_SIZE/);
}));

test('download settings reject invalid or unbounded retry/timeout values before network access', () => fixture(async ({ archivePath }) => {
  for (const options of [{ attempts: 0 }, { attempts: 4 }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 900001 }]) {
    await assert.rejects(ensure({ archivePath, ...options, fetchImpl: async () => { assert.fail('no network for invalid settings'); } }), /DRAWIO_DOWNLOAD_CONFIG/);
  }
}));

test('archive-only mode verifies the supplied cache without expanding editor files', () => fixture(async ({ directory, archivePath }) => {
  let requests = 0;
  const target = path.join(directory, 'editor');
  const result = await preparation.prepareDrawio({ archiveOnly: true, enabled: true,
    archivePath, target, expectedDigest: hash, fetchImpl: async () => { requests++; return new Response(bytes); } });
  assert.deepEqual(result, { prepared: false, skipped: false, archivePath });
  assert.deepEqual(await readFile(archivePath), bytes); assert.equal(requests, 1);
  await assert.rejects(stat(target), { code: 'ENOENT' });
}));

test('oversized cache is rejected before loading it into memory or fetching a replacement', () => fixture(async ({ directory }) => {
  const archivePath = path.join(directory, 'oversized.war');
  const file = await open(archivePath, 'w');
  await file.truncate(80 * 1024 * 1024 + 1); await file.close();
  await assert.rejects(ensure({ archivePath, fetchImpl: async () => { assert.fail('no network for oversized cache'); } }), /DRAWIO_ARCHIVE_SIZE/);
}));
