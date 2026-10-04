import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const marker = (branch, field) => `SYNTHETIC_PRIVACY_${branch}_${field}_ONLY`;

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: requestPath }, (res) => {
      // The stream is deliberately closed by the client, exercising upstream cleanup.
      if (res.headers['content-type']?.startsWith('text/event-stream')) {
        res.once('data', () => { const result = { status: res.statusCode, sse: true }; res.destroy(); resolve(result); });
      } else {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode }));
      }
    });
    req.setTimeout(15000, () => req.destroy(Error('synthetic HTTP probe timeout')));
    req.on('error', reject);
  });
}

async function portAvailable() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(100, () => { socket.destroy(); resolve(false); });
  });
}

export async function runPrivacyRegression({ frontendPath, outputDir, attempt, legacyLogging = false }) {
  const cwd = path.resolve(frontendPath);
  const output = path.resolve(outputDir, attempt);
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const checks = [];
  const logPath = path.join(output, 'synthetic-server.log');
  const errorLogPath = path.join(output, 'synthetic-compilation-error.log');
  const serveErrorLogPath = path.join(output, 'synthetic-serve-compilation-error.log');
  const fd = fs.openSync(logPath, 'wx', 0o600);
  let child;
  let errorChild;
  let serveErrorChild;
  let errorFd;
  let serveErrorFd;
  const sockets = new Set();
  let streamClosed = false;
  const api = http.createServer((req, res) => {
    if (req.url.startsWith('/api/fail-proxy')) { req.socket.destroy(); return; }
    if (req.url.startsWith('/api/realtime/rooms/logging-smoke/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"synthetic":true}\n\n');
      res.on('close', () => { streamClosed = true; });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"synthetic":true}');
  });
  api.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const check = async (name, fn) => {
    try { checks.push({ name, status: 'PASS', detail: await fn() }); }
    catch (error) { checks.push({ name, status: 'FAIL', error: error.message }); }
  };
  const started = Date.now();
  const configPath = path.join(cwd, 'rspack.config.mjs');
  const configUrl = pathToFileURL(configPath).href;
  const cli = path.join(cwd, 'node_modules/@rspack/cli/bin/rspack.js');
  const query = (branch) => `authToken=${marker(branch, 'TOKEN')}&displayName=${marker(branch, 'NAME')}`;
  const branchCounts = (branch) => {
    const text = fs.readFileSync(logPath, 'utf8');
    return Object.fromEntries(['TOKEN', 'NAME'].map((field) => [field.toLowerCase(), text.split(marker(branch, field)).length - 1]));
  };
  const requireAbsent = (counts) => { assert.deepEqual(counts, { token: 0, name: 0 }, 'synthetic private query values must be absent from infrastructure logs'); };
  try {
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const port = await portAvailable();
    const heldPath = path.join(output, 'first-compilation-held');
    const completedPath = path.join(output, 'first-compilation-complete');
    const wrapperPath = path.join(output, 'serve-fixture.config.mjs');
    // Only the evidence fixture holds the first compile. The delivered config is imported unchanged.
    fs.writeFileSync(wrapperPath, `import config from ${JSON.stringify(configUrl)};\nimport fs from 'node:fs';\nlet first = true;\nexport default { ...config, ${legacyLogging ? "infrastructureLogging: { level: 'info' }," : ''} plugins: [...config.plugins, { apply(compiler) { compiler.hooks.make.tapAsync('SyntheticColdCompilePrivacy', (compilation, done) => { if (!first) return done(); first = false; fs.writeFileSync(${JSON.stringify(heldPath)}, 'held'); setTimeout(() => { fs.writeFileSync(${JSON.stringify(completedPath)}, 'complete'); done(); }, 4000); }); } }] };\n`, { flag: 'wx' });
    child = spawn(process.execPath, [cli, 'serve', '--config', wrapperPath, '--host', '127.0.0.1', '--port', String(port)], {
      cwd, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, DEV_API_PROXY_TARGET: `http://127.0.0.1:${api.address().port}` }
    });
    await check('cold-compile SSE query is private and stream remains usable', async () => {
      const limit = Date.now() + 12000;
      while (Date.now() < limit && (!fs.existsSync(heldPath) || !await isListening(port))) {
        if (child.exitCode !== null) throw Error(`isolated dev server exited ${child.exitCode}`);
        await delay(20);
      }
      assert.ok(fs.existsSync(heldPath), 'first compilation fixture hook was entered');
      assert.equal(fs.existsSync(completedPath), false, 'HTTP sent while first compilation remained pending');
      const response = await request(port, `/api/realtime/rooms/logging-smoke/stream?${query('COLD')}`);
      assert.equal(response.status, 200); assert.equal(response.sse, true);
      const counts = branchCounts('COLD'); requireAbsent(counts);
      return { status: response.status, pendingCompilationWitness: true, markerOccurrences: counts };
    });
    await check('malicious-path error does not log private query values', async () => {
      const response = await request(port, `/..%2f..%2fsynthetic-malicious-path?${query('PATH')}`);
      assert.equal(response.status, 403);
      await delay(50);
      const counts = branchCounts('PATH'); requireAbsent(counts);
      return { status: response.status, markerOccurrences: counts };
    });
    await check('failed API proxy does not log private query values', async () => {
      const response = await request(port, `/api/fail-proxy?${query('PROXY')}`);
      assert.equal(response.status, 504);
      await delay(50);
      const counts = branchCounts('PROXY'); requireAbsent(counts);
      return { status: response.status, markerOccurrences: counts };
    });
    await check('SSE client close still releases upstream', async () => {
      const limit = Date.now() + 2000;
      while (!streamClosed && Date.now() < limit) await delay(20);
      assert.equal(streamClosed, true); return { upstreamClosed: true };
    });
    await stop(child);
    errorFd = fs.openSync(errorLogPath, 'wx', 0o600);
    const entryPath = path.join(output, 'synthetic-compilation-error-entry.js');
    const errorConfigPath = path.join(output, 'error-fixture.config.mjs');
    fs.writeFileSync(entryPath, "import './SYNTHETIC_MISSING_MODULE_PRIVACY_PROBE.js';\n", { flag: 'wx' });
    fs.writeFileSync(errorConfigPath, `import config from ${JSON.stringify(configUrl)};\nexport default { ...config, entry: ${JSON.stringify(entryPath)}, output: { ...config.output, path: ${JSON.stringify(path.join(output, 'error-build'))} } };\n`, { flag: 'wx' });
    await check('genuine compilation errors remain visible with production logging configuration', async () => {
      errorChild = spawn(process.execPath, [cli, 'build', '--config', errorConfigPath], { cwd, detached: true, stdio: ['ignore', errorFd, errorFd], env: { ...process.env } });
      const exit = await Promise.race([new Promise((resolve) => errorChild.once('exit', resolve)), delay(15000).then(() => { throw Error('compilation-error fixture timeout'); })]);
      fs.closeSync(errorFd); errorFd = undefined;
      const text = fs.readFileSync(errorLogPath, 'utf8');
      assert.equal(exit, 1); assert.match(text, /ERROR/); assert.match(text, /SYNTHETIC_MISSING_MODULE_PRIVACY_PROBE/); assert.match(text, /Module not found|Can't resolve/);
      return { exit, errorVisible: true, missingModuleDiagnosticVisible: true };
    });
    await check('genuine serve compilation errors remain visible with production logging configuration', async () => {
      serveErrorFd = fs.openSync(serveErrorLogPath, 'wx', 0o600);
      const errorPort = await portAvailable();
      serveErrorChild = spawn(process.execPath, [cli, 'serve', '--config', errorConfigPath, '--host', '127.0.0.1', '--port', String(errorPort)], {
        cwd, detached: true, stdio: ['ignore', serveErrorFd, serveErrorFd],
        env: { ...process.env, DEV_API_PROXY_TARGET: `http://127.0.0.1:${api.address().port}` }
      });
      const limit = Date.now() + 15000;
      let text = '';
      while (Date.now() < limit) {
        text = fs.readFileSync(serveErrorLogPath, 'utf8');
        if (/ERROR/.test(text) && /SYNTHETIC_MISSING_MODULE_PRIVACY_PROBE/.test(text) && /Module not found|Can't resolve/.test(text)) break;
        if (serveErrorChild.exitCode !== null) throw Error(`error-fixture dev server exited ${serveErrorChild.exitCode}`);
        await delay(20);
      }
      assert.match(text, /ERROR/); assert.match(text, /SYNTHETIC_MISSING_MODULE_PRIVACY_PROBE/); assert.match(text, /Module not found|Can't resolve/);
      return { errorVisible: true, missingModuleDiagnosticVisible: true, serverRemainedRunning: serveErrorChild.exitCode === null };
    });
  } catch (error) { checks.push({ name: 'harness setup', status: 'FAIL', error: error.message }); }
  finally {
    await stop(child); await stop(errorChild); await stop(serveErrorChild);
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => api.close(resolve));
    fs.closeSync(fd); if (errorFd !== undefined) fs.closeSync(errorFd); if (serveErrorFd !== undefined) fs.closeSync(serveErrorFd);
  }
  const result = {
    frontendPath: cwd, legacyLogging, productionConfigSha256: digest(configPath),
    fixtureOnlyChanges: ['first compilation held in imported config wrapper', ...(legacyLogging ? ['legacy info level restored only in serve wrapper'] : [])],
    checks, counts: { pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length },
    syntheticMarkerOccurrences: Object.fromEntries(['COLD', 'PATH', 'PROXY'].map((branch) => [branch.toLowerCase(), branchCounts(branch)])),
    logs: [logPath, ...[errorLogPath, serveErrorLogPath].filter((file) => fs.existsSync(file))].map((file) => ({ path: file, sha256: digest(file), mode: (fs.statSync(file).mode & 0o777).toString(8) })),
    seconds: (Date.now() - started) / 1000, recordedAt: new Date().toISOString(),
    limitations: ['Synthetic credentials only; no browser, external editor, main app or diagnostic app operations', 'Mock API on ephemeral loopback port; first compile delay is test-only instrumentation']
  };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

import os from 'node:os';
import test from 'node:test';

// Each invocation owns only temporary fixtures, mock API and ephemeral loopback servers.
const frontendPath = path.resolve(here, '../..');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interhub-dev-log-privacy-'));
const result = await runPrivacyRegression({ frontendPath, outputDir, attempt: 'fixed' });
for (const check of result.checks) {
  test(check.name, () => assert.equal(check.status, 'PASS', check.error));
}
