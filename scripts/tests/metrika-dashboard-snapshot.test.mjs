import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardConfig } from "../metrika-dashboard-core.mjs";
import * as dashboard from "../serve-metrika-dashboard.mjs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";

const config = { counterId: 109032539, timezone: "Europe/Moscow", port: 4175 };
const snapshot = {
  counterId: config.counterId, timezone: config.timezone, capturedAt: "2026-11-14T10:00:00+03:00",
  periodStart: "2026-10-15", periodEnd: "2026-11-13", dau: 0, mau: 35,
  retention: { d7: { users: 1, cohortSize: 10, cohortStart: "2026-10-01", cohortEnd: "2026-10-01" } },
};

// Exercise the HTTP handler without requiring permission to bind a test port.
function request(server, url = "/", host = "127.0.0.1:4175") {
  return new Promise((resolve) => {
    let status, headers;
    server.emit("request", { method: "GET", url, headers: { host } }, {
      writeHead(code, values) { status = code; headers = values; },
      end(body) { resolve({ status, headers, body }); },
    });
  });
}

test("opens and rereads dated aggregates on the regular dashboard URL without OAuth", async () => {
  const current = { ...snapshot };
  const server = dashboard.createConfiguredDashboardServer(parseDashboardConfig({}), { readSnapshot: async () => JSON.stringify(current) });
  const first = await request(server);
  assert.equal(first.status, 200);
  assert.match(first.headers["Cache-Control"], /no-store/);
  assert.match(first.body, /Сохранённый срез/);
  assert.match(first.body, /13\.11\.2026/);
  assert.match(first.body, /15\.10\.2026/);
  assert.match(first.body, /1 из 10/);
  assert.match(first.body, /01\.10\.2026/);
  assert.match(first.body, /Нет данных/);
  assert.match(first.body, /<strong>0<\/strong>/);
  current.dau = 23;
  assert.match((await request(server)).body, /<strong>23<\/strong>/);
  assert.equal((await request(server, "/snapshot.json")).status, 404);
  assert.equal((await request(server, "/.local-metrics/snapshot.json")).status, 404);
  assert.equal((await request(server, "/", "external.example")).status, 421);
});

test("shows safe recoverable errors for missing or invalid snapshots", async () => {
  const bad = [
    { ...snapshot, token: "sensitive-value" }, { ...snapshot, counterId: 888888 },
    { ...snapshot, dau: -3 }, { ...snapshot, capturedAt: "untrusted" }, { ...snapshot, periodEnd: "2026-11-14" },
    { ...snapshot, retention: { d7: { users: 2, cohortSize: 1 } } },
    { ...snapshot, retention: { d7: { users: 1, cohortSize: 2, cohortStart: "2026-11-13", cohortEnd: "2026-11-13" } } },
    { ...snapshot, retention: { d7: { users: 1, cohortSize: 2, cohortStart: "2026-10-01" } } },
    { ...snapshot, retention: { d7: { users: 0, cohortSize: 2, email: "sensitive-value" } } },
  ];
  for (const value of [null, ...bad]) {
    const server = dashboard.createConfiguredDashboardServer(config, { readSnapshot: async () => {
      if (!value) throw new Error("sensitive-value");
      return JSON.stringify(value);
    } });
    const result = await request(server);
    assert.equal(result.status, 503);
    assert.match(result.body, /Перечитать срез/);
    assert.doesNotMatch(result.body, /sensitive-value/);
  }
});

test("keeps the live dashboard when OAuth is available", async () => {
  const server = dashboard.createConfiguredDashboardServer({ ...config, token: "fixture-value" }, {
    readSnapshot: async () => { throw new Error("snapshot should not be read"); },
  });
  const page = await request(server);
  assert.equal(page.status, 200);
  assert.match(page.body, /id="period-selector"/);
  assert.doesNotMatch(page.body, /fixture-value|Перечитать срез/);
});

test("exports a standalone private HTML without starting the local server", async () => {
  const { mkdtemp, readFile, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = await mkdtemp(join(tmpdir(), "metrika-snapshot-"));
  const outputPath = join(folder, "dashboard.html");
  try {
    await dashboard.exportDashboardSnapshot(config, { readSnapshot: async () => JSON.stringify(snapshot), outputPath });
    const html = await readFile(outputPath, "utf8");
    assert.match(html, /Сохранённый срез/);
    assert.match(html, /https:\/\/metrika\.yandex\.ru\/overview\?id=109032539/);
    assert.match(html, /<style>[\s\S]+<\/style>/);
    assert.match(html, /Версия для просмотра/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const hash = createHash("sha256").update(script).digest("base64");
    assert.ok(html.includes(`script-src 'sha256-${hash}'`));
    assert.doesNotMatch(html, /(?:href|src)="\/|Перечитать срез/);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    await assert.rejects(dashboard.exportDashboardSnapshot(config, { readSnapshot: async () => "{}", outputPath }));
    assert.equal(await readFile(outputPath, "utf8"), html);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("links to live DAU and MAU independently of the date of the saved numbers", async () => {
  const server = dashboard.createConfiguredDashboardServer(config, { readSnapshot: async () => JSON.stringify(snapshot) });
  const { body, headers } = await request(server);
  const links = [...body.matchAll(/data-audience-window="(day|month)" href="([^"]+)"/g)].map(([, period, href]) => ({
    href: href.replaceAll("&amp;", "&"), dataset: { audienceWindow: period },
  }));
  const retentionHref = body.match(/data-audience-window="retention" href="([^"]+)"/)?.[1];
  assert.ok(retentionHref);
  const retention = { href: retentionHref.replaceAll("&amp;", "&"), dataset: { audienceWindow: "retention" } };
  const productHref = body.match(/data-audience-window="product" href="([^"]+)"/)?.[1];
  assert.ok(productHref);
  const product = { href: productHref.replaceAll("&amp;", "&"), dataset: { audienceWindow: "product" } };
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((link) => new URL(link.href).searchParams.get("period")), ["2026-11-13:2026-11-13", "2026-10-15:2026-11-13"]);
  const script = body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const hash = createHash("sha256").update(script).digest("base64");
  assert.ok(headers["Content-Security-Policy"].includes(`'sha256-${hash}'`));
  const fakeNow = "2027-01-01T21:02:00Z"; // 2 January in Moscow.
  const today = class extends Date { constructor(...args) { super(...(args.length ? args : [fakeNow])); } };
  runInNewContext(script, { Date: today, URL, document: { querySelectorAll: () => [...links, retention, product] } });
  const productUrl = new URL(product.href);
  assert.equal(productUrl.pathname, "/dashboard");
  assert.equal(productUrl.searchParams.get("dashboardId"), "345734c0-b899-45b6-8114-99e04982577f");
  assert.equal(productUrl.searchParams.get("period"), "2026-12-03:2027-01-01");
  const retentionUrl = new URL(retention.href);
  assert.equal(retentionUrl.pathname, "/stat/retention");
  assert.equal(retentionUrl.searchParams.get("period"), "2026-10-04:2027-01-01");
  assert.equal(retentionUrl.searchParams.get("groupMethod"), "calendar");
  assert.equal(retentionUrl.searchParams.get("onlyNewUsers"), "true");
  assert.equal(retentionUrl.searchParams.get("tableGroupByInterval"), "day");
  assert.equal(retentionUrl.searchParams.get("minCohortSize"), "1");
  const dates = links.map((link) => new URL(link.href).searchParams.get("period"));
  assert.deepEqual(dates, ["yesterday", "2026-12-03:2027-01-01"]);
  for (const link of links) {
    const url = new URL(link.href);
    assert.equal(url.origin, "https://metrika.yandex.ru");
    assert.equal(url.searchParams.get("group"), link.dataset.audienceWindow === "day" ? "dekaminute" : "day");
    assert.equal(url.searchParams.get("id"), "109032539");
    assert.equal(url.searchParams.get("dashboardId"), "a0cb3fe0-7819-4547-a915-93ad9f3f0b00");
  }
});

test("shows only confirmed history and product goals for their exact windows", async () => {
  const previous = { periodStart: "2026-09-15", periodEnd: "2026-10-14", visits: 150 };
  const product = { candidateJoined: 3, verdictSaved: 0 };
  const open = async (extra) => request(dashboard.createConfiguredDashboardServer(config, {
    readSnapshot: async () => JSON.stringify({ ...snapshot, ...extra }),
  }));
  const page = await open({ previous, product });
  assert.equal(page.status, 200);
  assert.match(page.body, /15\.09\.2026 — 14\.10\.2026/);
  assert.match(page.body, /Предыдущий период/);
  assert.match(page.body, /<strong>150<\/strong>/);
  assert.match(page.body, /Подключение кандидата/);
  assert.match(page.body, /Сохранение вердикта/);
  assert.doesNotMatch(page.body, /Первая правка кода/);
  assert.match(page.body, /срабатывание цели/i);
  const ordinary = await open({});
  assert.doesNotMatch(ordinary.body, /Предыдущий период|Подключение кандидата/);
  for (const invalid of [
    { previous: { ...previous, periodStart: "2026-09-16" } },
    { previous: { ...previous, periodEnd: "2026-10-13" } },
    { previous: { ...previous, pageviews: -1 } },
    { product: { ...product, email: "secret-value" } },
    { product: { firstCodeEdit: 1.1 } },
  ]) {
    const error = await open(invalid);
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.body, /secret-value/);
  }
});
