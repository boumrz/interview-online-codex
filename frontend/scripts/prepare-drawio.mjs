import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const release = JSON.parse(await readFile(new URL('./drawio-release.json', import.meta.url), 'utf8'));
export const DRAWIO_VERSION = release.version;
export const DRAWIO_ARCHIVE_SHA256 = release.archiveSha256;
export const DRAWIO_ARCHIVE_URL = release.archiveUrl;
const maxArchiveBytes = release.maxArchiveBytes;
const maxExpandedBytes = 200 * 1024 * 1024;
const maxEntryBytes = 40 * 1024 * 1024;
const requiredFiles = ['index.html', 'js/bootstrap.js', 'js/app.min.js'];
const packagingRevision = 1;
const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
const staticDirectories = new Set(['images', 'img', 'js', 'math4', 'mxgraph', 'resources', 'shapes', 'stencils', 'styles', 'templates']);
const frontendDirectory = fileURLToPath(new URL('../', import.meta.url));
const defaultTarget = path.join(frontendDirectory, 'public/drawio');
export const DRAWIO_DEFAULT_ARCHIVE_PATH = path.join(frontendDirectory, '.cache/drawio', DRAWIO_VERSION, 'draw.war');
const legacyCache = fileURLToPath(new URL(`../../.tools/drawio/${DRAWIO_VERSION}/draw.war`, import.meta.url));

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
      source: DRAWIO_ARCHIVE_URL,
    }) + '\n');
    // Verification and materialization complete before an old working editor is replaced.
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function cachedArchive(archivePath, expectedDigest) {
  try {
    const cached = await stat(archivePath);
    if (!cached.isFile() || cached.size > maxArchiveBytes) {
      throw new Error('DRAWIO_ARCHIVE_SIZE: cached archive is not a regular file within the release size limit');
    }
    const bytes = await readFile(archivePath);
    if (bytes.byteLength > maxArchiveBytes || digest(bytes) !== expectedDigest) {
      throw new Error('DRAWIO_ARCHIVE_CHECKSUM: cached archive does not match the pinned release');
    }
    return bytes;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return null;
}

async function cacheArchive(archivePath, bytes) {
  let directory;
  try {
    await mkdir(path.dirname(archivePath), { recursive: true });
    directory = await mkdtemp(path.join(path.dirname(archivePath), '.drawio-download-'));
    const temporary = path.join(directory, 'draw.war');
    await writeFile(temporary, bytes);
    await rename(temporary, archivePath);
  } catch {
    throw new Error(`DRAWIO_ARCHIVE_CACHE: cannot persist the verified archive at ${archivePath}; check available disk space and permissions`);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

function downloadFailure(error, archivePath, attempt, attempts) {
  const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  const code = timeout ? 'DRAWIO_DOWNLOAD_TIMEOUT' : 'DRAWIO_DOWNLOAD_FAILED';
  return new Error(`${code}: pinned draw.io ${DRAWIO_VERSION} could not be downloaded after ${attempt}/${attempts} attempt(s). `
    + `Source: ${DRAWIO_ARCHIVE_URL}. Download the verified draw.war on a machine with access and copy it to ${archivePath}, `
    + `or set DRAWIO_ARCHIVE_PATH. Expected SHA-256: ${DRAWIO_ARCHIVE_SHA256}.`);
}

/** Download-only preparation also supports a verified offline Docker context. */
export async function ensureDrawioArchive({ archivePath = process.env.DRAWIO_ARCHIVE_PATH || DRAWIO_DEFAULT_ARCHIVE_PATH,
  legacyArchivePath = archivePath === DRAWIO_DEFAULT_ARCHIVE_PATH ? legacyCache : null,
  fetchImpl = globalThis.fetch, expectedDigest = DRAWIO_ARCHIVE_SHA256,
  timeoutMs = Number(process.env.DRAWIO_DOWNLOAD_TIMEOUT_MS ?? 180_000),
  attempts = Number(process.env.DRAWIO_DOWNLOAD_ATTEMPTS ?? 2), retryDelayMs = 1_000, onAttempt = () => {} } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000
      || !Number.isInteger(attempts) || attempts < 1 || attempts > 3
      || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10_000) {
    throw new Error('DRAWIO_DOWNLOAD_CONFIG: timeout must be 1000..900000 ms and attempts must be 1..3');
  }
  const cached = await cachedArchive(archivePath, expectedDigest);
  if (cached) return cached;
  if (legacyArchivePath) {
    const previous = await cachedArchive(legacyArchivePath, expectedDigest);
    if (previous) { await cacheArchive(archivePath, previous); return previous; }
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      onAttempt({ attempt, attempts, timeoutMs });
      const response = await fetchImpl(DRAWIO_ARCHIVE_URL, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (!response.ok) {
        await response.body?.cancel();
        const failure = new Error('HTTP download failed');
        failure.transient = response.status === 408 || response.status === 429 || response.status >= 500;
        throw failure;
      }
      if (Number(response.headers.get('content-length') ?? 0) > maxArchiveBytes) {
        await response.body?.cancel();
        throw new Error('DRAWIO_ARCHIVE_SIZE: download exceeds limit');
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxArchiveBytes) throw new Error('DRAWIO_ARCHIVE_SIZE: download exceeds limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (digest(bytes) !== expectedDigest) throw new Error('DRAWIO_ARCHIVE_CHECKSUM: downloaded archive mismatch');
      await cacheArchive(archivePath, bytes);
      return bytes;
    } catch (error) {
      if (error instanceof Error && /^DRAWIO_ARCHIVE_(?:CHECKSUM|SIZE|CACHE)/.test(error.message)) throw error;
      const transient = error?.transient === true || ['TimeoutError', 'AbortError'].includes(error?.name)
        || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error?.cause?.code);
      if (!transient || attempt === attempts) throw downloadFailure(error, archivePath, attempt, attempts);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error('DRAWIO_DOWNLOAD_FAILED: no verified archive available');
}

export async function prepareDrawio({ target = defaultTarget, archivePath = process.env.DRAWIO_ARCHIVE_PATH || DRAWIO_DEFAULT_ARCHIVE_PATH,
  archiveOnly = false, ...downloadOptions } = {}) {
  if (!archiveOnly && await isDrawioPrepared(target)) return { prepared: true };
  const bytes = await ensureDrawioArchive({ archivePath, ...downloadOptions });
  if (archiveOnly) return { prepared: false, archivePath };
  await installDrawioArchive(bytes, target, downloadOptions.expectedDigest ?? DRAWIO_ARCHIVE_SHA256);
  return { prepared: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archiveArgument = process.argv.slice(2).find((argument) => argument.startsWith('--archive='));
  try {
    const result = await prepareDrawio({ archiveOnly: process.argv.includes('--archive-only'),
      onAttempt: ({ attempt, attempts, timeoutMs }) => process.stderr.write(`Downloading pinned draw.io ${DRAWIO_VERSION} (${attempt}/${attempts}, timeout ${timeoutMs / 1000}s): ${DRAWIO_ARCHIVE_URL}\n`),
      ...(archiveArgument ? { archivePath: path.resolve(archiveArgument.slice('--archive='.length)) } : {}) });
    if (result.prepared) process.stdout.write(`draw.io ${DRAWIO_VERSION} prepared locally\n`);
    else if (result.archivePath) process.stdout.write(`draw.io ${DRAWIO_VERSION} archive verified: ${result.archivePath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'DRAWIO_PREPARATION_FAILED'}\n`);
    process.exitCode = 1;
  }
}
