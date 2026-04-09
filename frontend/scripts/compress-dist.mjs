import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { promises as fs } from "node:fs";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".svg",
  ".json",
  ".map",
  ".txt",
  ".xml",
  ".wasm"
]);

const MIN_BYTES = 1024;
const DIST_DIR = path.resolve(process.cwd(), process.argv[2] ?? "dist");

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return [fullPath];
  }));
  return files.flat();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

async function writeCompressedVariant(targetPath, bytes) {
  await fs.writeFile(targetPath, bytes);
  return bytes.length;
}

async function run() {
  const stat = await fs.stat(DIST_DIR).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`[compress-dist] dist directory not found: ${DIST_DIR}`);
    process.exitCode = 1;
    return;
  }

  const files = await collectFiles(DIST_DIR);
  const candidates = files.filter((file) => {
    if (file.endsWith(".br") || file.endsWith(".gz")) return false;
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  let processed = 0;
  let originalBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  let gzipSaved = 0;
  let brotliSaved = 0;

  for (const file of candidates) {
    const source = await fs.readFile(file);
    if (source.length < MIN_BYTES) continue;

    processed += 1;
    originalBytes += source.length;

    const gzipBuffer = gzipSync(source, { level: 9 });
    if (gzipBuffer.length < source.length) {
      const written = await writeCompressedVariant(`${file}.gz`, gzipBuffer);
      gzipBytes += written;
      gzipSaved += source.length - written;
    } else {
      await fs.rm(`${file}.gz`, { force: true });
    }

    const brotliBuffer = brotliCompressSync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.length
      }
    });
    if (brotliBuffer.length < source.length) {
      const written = await writeCompressedVariant(`${file}.br`, brotliBuffer);
      brotliBytes += written;
      brotliSaved += source.length - written;
    } else {
      await fs.rm(`${file}.br`, { force: true });
    }
  }

  const gzipRatio = originalBytes > 0 ? ((1 - gzipBytes / originalBytes) * 100) : 0;
  const brotliRatio = originalBytes > 0 ? ((1 - brotliBytes / originalBytes) * 100) : 0;

  console.info("[compress-dist] completed");
  console.info(`[compress-dist] files processed: ${processed}`);
  console.info(`[compress-dist] original size: ${formatBytes(originalBytes)}`);
  console.info(`[compress-dist] gzip size: ${formatBytes(gzipBytes)} (saved ${formatBytes(gzipSaved)}, ${gzipRatio.toFixed(1)}%)`);
  console.info(`[compress-dist] brotli size: ${formatBytes(brotliBytes)} (saved ${formatBytes(brotliSaved)}, ${brotliRatio.toFixed(1)}%)`);
}

await run();
