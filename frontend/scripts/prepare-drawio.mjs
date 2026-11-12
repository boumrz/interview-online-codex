import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export const DRAWIO_VERSION = '32.6.10';
export const DRAWIO_ARCHIVE_SHA256 = 'a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f';
const archiveUrl = `https://github.com/jgraph/drawio/releases/download/v${DRAWIO_VERSION}/draw.war`;
const maxArchiveBytes = 80 * 1024 * 1024;
const maxExpandedBytes = 200 * 1024 * 1024;
const maxEntryBytes = 40 * 1024 * 1024;
const requiredFiles = ['index.html', 'js/bootstrap.js', 'js/app.min.js'];
const packagingRevision = 1;
const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
const staticDirectories = new Set(['images', 'img', 'js', 'math4', 'mxgraph', 'resources', 'shapes', 'stencils', 'styles', 'templates']);
const frontendDirectory = fileURLToPath(new URL('../', import.meta.url));
const defaultTarget = path.join(frontendDirectory, 'public/drawio');
const defaultCache = fileURLToPath(new URL(`../../.tools/drawio/${DRAWIO_VERSION}/draw.war`, import.meta.url));

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function extractDrawioArchive(bytes, expectedDigest = DRAWIO_ARCHIVE_SHA256) {
  if (bytes.byteLength > maxArchiveBytes || digest(bytes) !== expectedDigest) {
    throw new Error('DRAWIO_ARCHIVE_CHECKSUM: expected the pinned draw.io release');
  }
  let entries = 0;
  let expandedBytes = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      entries += 1;
      if (file.name.includes('\\') || file.name.includes('\0') || file.name.startsWith('/')
          || /^[A-Za-z]:/.test(file.name) || file.name.split('/').includes('..')) {
        throw new Error('DRAWIO_ARCHIVE_PATH: unsafe archive entry');
      }
      expandedBytes += file.originalSize;
      if (entries > 10_000 || file.originalSize > maxEntryBytes || expandedBytes > maxExpandedBytes) {
        throw new Error('DRAWIO_ARCHIVE_SIZE: archive exceeds static editor limits');
      }
      return !file.name.endsWith('/') && (file.name === 'index.html'
        || staticDirectories.has(file.name.split('/')[0]));
    },
  });
  if (requiredFiles.some((name) => !files[name]?.byteLength)) {
    throw new Error('DRAWIO_ARCHIVE_INCOMPLETE: editor entry points missing');
  }
  return files;
}

export async function isDrawioPrepared(target = defaultTarget) {
  try {
    const marker = JSON.parse(await readFile(path.join(target, '.interhub-drawio.json'), 'utf8'));
    if (marker.version !== DRAWIO_VERSION || marker.archiveSha256 !== DRAWIO_ARCHIVE_SHA256
        || marker.packagingRevision !== packagingRevision) return false;
    for (const name of [...requiredFiles, 'LICENSE']) {
      if (!(await stat(path.join(target, name))).isFile()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function installDrawioArchive(bytes, target = defaultTarget, expectedDigest = DRAWIO_ARCHIVE_SHA256) {
  const files = extractDrawioArchive(bytes, expectedDigest);
  await mkdir(path.dirname(target), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(target), '.drawio-prepare-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const destination = path.join(staging, name);
      await mkdir(path.dirname(destination), { recursive: true });
      if (name === 'index.html') {
        const html = new TextDecoder().decode(content);
        const meta = `<!-- Modified by InterHub: local-only editor content policy. -->\n<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`;
        await writeFile(destination, /<head(?:\s[^>]*)?>/i.test(html)
          ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${meta}`)
          : `${meta}\n${html}`);
      } else {
        await writeFile(destination, content);
      }
    }
    await writeFile(path.join(staging, 'LICENSE'), await readFile(new URL('./drawio.LICENSE', import.meta.url)));
    await writeFile(path.join(staging, '.interhub-drawio.json'), JSON.stringify({
      version: DRAWIO_VERSION,
      archiveSha256: expectedDigest,
      packagingRevision,
      source: archiveUrl,
    }) + '\n');
    // Verification and materialization complete before an old working editor is replaced.
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function archiveBytes(archivePath) {
  try {
    const bytes = await readFile(archivePath);
    if (bytes.byteLength > maxArchiveBytes || digest(bytes) !== DRAWIO_ARCHIVE_SHA256) {
      throw new Error('DRAWIO_ARCHIVE_CHECKSUM: cached archive does not match the pinned release');
    }
    return bytes;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(180_000), redirect: 'follow' });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > maxArchiveBytes) {
    throw new Error('DRAWIO_DOWNLOAD_FAILED: could not download the pinned editor');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxArchiveBytes) throw new Error('DRAWIO_ARCHIVE_SIZE: download exceeds limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== DRAWIO_ARCHIVE_SHA256) throw new Error('DRAWIO_ARCHIVE_CHECKSUM: downloaded archive mismatch');
  await mkdir(path.dirname(archivePath), { recursive: true });
  const temporary = `${archivePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, archivePath);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes;
}

export async function prepareDrawio({ ifEnabled = false, enabled = process.env.FEATURE_ROOM_DIAGRAMS_ENABLED === 'true',
  target = defaultTarget, archivePath = defaultCache } = {}) {
  if (ifEnabled && !enabled) return { prepared: false, skipped: true };
  if (await isDrawioPrepared(target)) return { prepared: true, skipped: false };
  await installDrawioArchive(await archiveBytes(archivePath), target);
  return { prepared: true, skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archiveArgument = process.argv.slice(2).find((argument) => argument.startsWith('--archive='));
  try {
    const result = await prepareDrawio({ ifEnabled: process.argv.includes('--if-enabled'),
      ...(archiveArgument ? { archivePath: path.resolve(archiveArgument.slice('--archive='.length)) } : {}) });
    if (result.prepared) process.stdout.write(`draw.io ${DRAWIO_VERSION} prepared locally\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'DRAWIO_PREPARATION_FAILED'}\n`);
    process.exitCode = 1;
  }
}
