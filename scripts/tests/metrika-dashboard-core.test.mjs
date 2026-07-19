import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DashboardError,
  MAX_CUSTOM_DASHBOARD_RANGE_DAYS,
  buildRetention,
  createInjectedProductGoalCatalogue,
  createCustomReportWindow,
  createDashboardWindow,
  createProductGoalCatalogueResolver,
  createDashboardService,
  createReportWindow,
  loadDashboardData,
  parseDashboardPeriod,
  resolveProductGoalCataloguePayload,
  summarizeSelectedPeriod,
} from "../metrika-dashboard-core.mjs";
import { createDashboardServer } from "../serve-metrika-dashboard.mjs";

const config = { token: "private-token", counterId: 109032539, timezone: "Europe/Moscow", port: 4175 };
const reportWindow = { asOf: "2026-07-15", dailyStart: "2026-06-16", retentionStart: "2026-06-01", wauStart: "2026-07-09", mauStart: "2026-06-16", timezoneOffset: "+03:00" };
const fixtureData = {
  meta: { asOf: "2026-07-15", periodDays: 90, periodStart: "2026-04-17", timezone: "Europe/Moscow", refreshedAt: "2026-07-16T08:00:00.000Z" },
  summary: { dau: 10, newUsers: 2, wau: 30, mau: 50, dauDate: "2026-07-15", wauStart: "2026-07-09", mauStart: "2026-06-16", periodUsers: 100, periodNewUsers: 30, averageDau: 8, activityComparison: { earlyAverageDau: 7, recentAverageDau: 9, deltaUsers: 2, percentChange: 2 / 7 * 100 } },
  daily: [{ date: "2026-07-15", users: 10, newUsers: 2 }],
  retention: { curve: [], checkpoints: {}, cohorts: [] },
  quality: { sampled: false, sampleShare: null, dataLagSeconds: 0 },
};

function retentionRow(activityDate, cohortDate, users) {
  return { dimensions: [{ id: activityDate }, { id: cohortDate }], metrics: [users] };
}

test("anchors KPI windows on the latest completed Moscow day", () => {
  const window = createReportWindow("Europe/Moscow", 30, new Date("2026-07-16T12:00:00.000Z"));
  assert.equal(window.asOf, "2026-07-15");
  assert.equal(window.wauStart, "2026-07-09");
  assert.equal(window.mauStart, "2026-06-16");
  assert.equal(window.dailyStart, "2026-06-16");
});

test("accepts only fixed 30 or 90 day dashboard periods", () => {
  assert.equal(parseDashboardPeriod(), 90);
  assert.equal(parseDashboardPeriod("30"), 30);
  assert.equal(createReportWindow("Europe/Moscow", 90, new Date("2026-07-16T12:00:00.000Z")).dailyStart, "2026-04-17");
  assert.throws(() => parseDashboardPeriod(31), DashboardError);
});

test("builds a bounded custom report window and retains only its final 90 cohort days", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const window = createCustomReportWindow("Europe/Moscow", "2026-04-01", "2026-07-15", now);
  assert.equal(window.rangeMode, "custom");
  assert.equal(window.periodDays, 106);
  assert.equal(window.retentionDays, 90);
  assert.equal(window.retentionStart, "2026-04-17");
  assert.equal(window.wauStart, "2026-07-09");
  assert.equal(window.mauStart, "2026-06-16");
  assert.equal(window.cacheKey, "2026-04-01:2026-07-15");
  assert.throws(() => createCustomReportWindow("Europe/Moscow", "2026-07-16", "2026-07-16", now), DashboardError);
  assert.throws(() => createCustomReportWindow("Europe/Moscow", "2026-07-15", "2026-07-14", now), DashboardError);
  assert.throws(() => createCustomReportWindow("Europe/Moscow", "2025-07-15", "2026-07-15", now), DashboardError);
  assert.equal(MAX_CUSTOM_DASHBOARD_RANGE_DAYS, 365);
});

test("builds weighted daily cohort retention without turning future days into zero", () => {
  const retention = buildRetention({
    data: [
      retentionRow("2026-06-15", "2026-06-15", 20), retentionRow("2026-06-16", "2026-06-15", 10), retentionRow("2026-06-22", "2026-06-15", 4), retentionRow("2026-06-29", "2026-06-15", 2), retentionRow("2026-07-15", "2026-06-15", 1),
      retentionRow("2026-07-01", "2026-07-01", 10), retentionRow("2026-07-02", "2026-07-01", 4), retentionRow("2026-07-08", "2026-07-01", 2), retentionRow("2026-07-15", "2026-07-01", 1),
      retentionRow("2026-07-15", "2026-07-15", 3),
    ], sampled: false, data_lag: 0,
  }, reportWindow);
  assert.equal(retention.checkpoints.d0.rate, 100);
  assert.equal(retention.checkpoints.d1.rate, 14 / 30 * 100);
  assert.equal(retention.checkpoints.d30.rate, 1 / 20 * 100);
  const newest = retention.cohorts.find((cohort) => cohort.date === "2026-07-15");
  assert.equal(newest.checkpoints.d1.state, "early");
  assert.equal(newest.checkpoints.d1.rate, undefined);
});

test("uses one in-flight load and reuses a fresh cached aggregate", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const service = createDashboardService({ load: async () => { calls += 1; await pending; return fixtureData; }, now: () => 1_000, ttlMs: 10_000 });
  const first = service.get();
  const second = service.get();
  release();
  const [firstValue, secondValue] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(firstValue.summary.dau, 10);
  assert.equal(secondValue.summary.dau, 10);
  const cached = await service.get();
  assert.equal(calls, 1);
  assert.equal(cached.meta.cached, true);
});

test("keeps cache and in-flight work isolated by canonical selected range", async () => {
  const calls = [];
  const service = createDashboardService({
    load: async (range) => {
      calls.push(range);
      return { ...fixtureData, meta: { ...fixtureData.meta, periodDays: range.periodDays ?? 14, periodStart: range.start ?? fixtureData.meta.periodStart, asOf: range.end ?? fixtureData.meta.asOf } };
    },
    now: () => 1_000,
    ttlMs: 10_000,
  });
  const customRange = { start: "2026-07-01", end: "2026-07-14" };
  const [thirty, custom] = await Promise.all([service.get({ periodDays: 30 }), service.get({ range: customRange })]);
  assert.equal(calls.length, 2);
  assert.ok(calls.some((range) => range.periodDays === 30));
  assert.ok(calls.some((range) => range.start === "2026-07-01" && range.end === "2026-07-14"));
  assert.equal(thirty.meta.periodDays, 30);
  assert.equal(custom.meta.periodDays, 14);
  await service.get({ periodDays: 30 });
  assert.equal(calls.length, 2);
});

test("summarises the selected period without treating DAU as distinct period users", () => {
  const summary = summarizeSelectedPeriod([
    { date: "2026-07-01", users: 2, newUsers: 2 },
    { date: "2026-07-02", users: 4, newUsers: 1 },
    { date: "2026-07-03", users: 6, newUsers: 3 },
    { date: "2026-07-04", users: 8, newUsers: 0 },
  ], 12);
  assert.equal(summary.periodUsers, 12);
  assert.equal(summary.periodNewUsers, 6);
  assert.equal(summary.averageDau, 5);
  assert.equal(summary.activityComparison.earlyAverageDau, 3);
  assert.equal(summary.activityComparison.recentAverageDau, 7);
  assert.equal(summary.activityComparison.percentChange, 4 / 3 * 100);
});

test("normalises only fixed Reporting API aggregates and keeps the token out of the result", async () => {
  const dailyValues = Array.from({ length: 30 }, (_, index) => index + 1);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/bytime")) return Response.json({ data: [{ metrics: [dailyValues, dailyValues.map(() => 1)] }], sampled: false, data_lag: 0 });
    if (parsed.searchParams.get("dimensions")) return Response.json({ data: [retentionRow("2026-06-16", "2026-06-16", 1)], sampled: false, data_lag: 0 });
    const date1 = parsed.searchParams.get("date1");
    return Response.json({ data: [{ metrics: [date1 === "2026-07-09" ? 70 : 300] }], sampled: false, data_lag: 0 });
  };
  const result = await loadDashboardData(config, { fetchImpl, productGoalIds: {}, periodDays: 30, now: new Date("2026-07-16T12:00:00.000Z") });
  assert.equal(result.summary.dau, 30);
  assert.equal(result.summary.wau, 70);
  assert.equal(result.summary.mau, 300);
  assert.equal(result.summary.periodUsers, 300);
  assert.equal(result.summary.periodNewUsers, 30);
  assert.equal(result.summary.averageDau, 15.5);
  assert.equal(result.meta.periodDays, 30);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.url.startsWith("https://api-metrika.yandex.net/stat/v1/")));
  assert.ok(calls.every((call) => call.authorization === "OAuth private-token"));
  assert.doesNotMatch(JSON.stringify(result), /private-token|Authorization|api-metrika/);
});

test("resolves only exact, active action goals and caches the fixed server-side catalogue", async () => {
  const goals = [
    { id: 90_001, type: "action", status: "Active", conditions: [{ type: "exact", url: "prod_room_create_success" }] },
    { id: 90_002, type: "action", status: "Active", conditions: [{ type: "exact", url: "prod_guest_room_create_success" }] },
    { id: 90_003, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_candidate_joined_v1" }] },
    { id: 90_004, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_meaningful_candidate_activity_v1" }] },
    { id: 90_005, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_verdict_saved_v1" }] },
    { id: 90_006, type: "action", status: "Active", conditions: [{ type: "exact", url: "prod_realtime_connection_lost" }] },
    { id: 90_007, type: "action", status: "Active", conditions: [{ type: "exact", url: "prod_recovery_state_sync_applied" }] },
    { id: 90_008, type: "action", status: "Active", conditions: [{ type: "exact", url: "prod_recovery_sync_completed" }] },
  ];
  const direct = resolveProductGoalCataloguePayload({ goals }, undefined, null);
  assert.deepEqual(direct.signals.roomCreated.goalIds, [90_001, 90_002]);
  assert.equal(direct.signals.candidateJoined.state, "available");
  assert.equal(direct.signals.verdictSaved.goalIds[0], 90_005);
  const duplicated = resolveProductGoalCataloguePayload({ goals: [...goals, { ...goals[2], id: 90_009 }] }, undefined, null);
  assert.equal(duplicated.signals.candidateJoined.state, "unavailable");
  const inactive = resolveProductGoalCataloguePayload({ goals: goals.map((goal) => goal.id === 90_004 ? { ...goal, status: "Inactive" } : goal) }, undefined, null);
  assert.equal(inactive.signals.candidateActivity.state, "unavailable");

  let managementCalls = 0;
  const resolver = createProductGoalCatalogueResolver({
    config,
    now: () => 1_000,
    manifest: null,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/management\/v1\/counter\/109032539\/goals/);
      managementCalls += 1;
      return Response.json({ goals });
    },
  });
  const [first, second] = await Promise.all([resolver(), resolver()]);
  assert.equal(managementCalls, 1);
  assert.equal(first.signals.candidateJoined.goalIds[0], 90_003);
  assert.deepEqual(second.signals.realtimeRecovery.goalIds, [90_007, 90_008]);
  await resolver();
  assert.equal(managementCalls, 1);
});

test("requires the verified manifest ID for each versioned product goal", () => {
  const goals = [
    { id: 585806372, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_candidate_joined_v1" }] },
    { id: 585806373, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_meaningful_candidate_activity_v1" }] },
    { id: 585806374, type: "action", status: "Active", conditions: [{ type: "exact", url: "int_verdict_saved_v1" }] },
  ];
  const verified = resolveProductGoalCataloguePayload({ goals });
  assert.equal(verified.signals.candidateJoined.state, "available");
  assert.equal(verified.signals.candidateActivity.state, "available");
  assert.equal(verified.signals.verdictSaved.state, "available");
  const mismatch = resolveProductGoalCataloguePayload({ goals: [{ ...goals[0], id: 585806399 }, ...goals.slice(1)] });
  assert.equal(mismatch.signals.candidateJoined.state, "unavailable");
});

test("normalises bounded product goal reaches without exposing goal IDs or treating unavailable goals as zero", async () => {
  const dailyValues = Array.from({ length: 30 }, (_, index) => index + 1);
  const goalIds = {
    roomCreated: [90_001, 90_002],
    candidateJoined: [90_003],
    candidateActivity: [90_004],
    verdictSaved: [90_005],
    realtimeConnectionLoss: [90_006],
    realtimeRecovery: [90_007, 90_008],
  };
  let activeGoalRequests = 0;
  let maximumActiveGoalRequests = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const metrics = parsed.searchParams.get("metrics") ?? "";
    if (metrics.startsWith("ym:s:goal")) {
      activeGoalRequests += 1;
      maximumActiveGoalRequests = Math.max(maximumActiveGoalRequests, activeGoalRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeGoalRequests -= 1;
      const values = metrics.split(",").map((metric) => Number(/goal(\d+)reaches/.exec(metric)?.[1]) - 90_000);
      return Response.json({ data: [{ metrics: values }], sampled: false, data_lag: 0 });
    }
    if (parsed.pathname.endsWith("/bytime")) return Response.json({ data: [{ metrics: [dailyValues, dailyValues.map(() => 1)] }], sampled: false, data_lag: 0 });
    if (parsed.searchParams.get("dimensions")) return Response.json({ data: [retentionRow("2026-06-16", "2026-06-16", 1)], sampled: false, data_lag: 0 });
    const date1 = parsed.searchParams.get("date1");
    return Response.json({ data: [{ metrics: [date1 === "2026-07-09" ? 70 : 300] }], sampled: false, data_lag: 0 });
  };
  const result = await loadDashboardData(config, {
    fetchImpl,
    productGoalCatalogue: createInjectedProductGoalCatalogue(goalIds),
    periodDays: 30,
    now: new Date("2026-07-16T12:00:00.000Z"),
  });
  assert.equal(result.productSignals.signals.roomCreated.reaches, 3);
  assert.equal(result.productSignals.signals.candidateJoined.reaches, 3);
  assert.equal(result.productSignals.signals.verdictSaved.reaches, 5);
  assert.equal(result.productSignals.reliability.lossPerCandidateJoinRate, 200);
  assert.equal(result.productSignals.reliability.recoveryPerCandidateJoinRate, 15 / 3 * 100);
  assert.ok(maximumActiveGoalRequests <= 2);
  const publicPayload = JSON.stringify(result);
  assert.doesNotMatch(publicPayload, /90001|goalIds|int_candidate_joined_v1/);

  const unavailable = await loadDashboardData(config, {
    fetchImpl,
    productGoalIds: { roomCreated: [90_001, 90_002] },
    periodDays: 30,
    now: new Date("2026-07-16T12:00:00.000Z"),
  });
  assert.equal(unavailable.productSignals.signals.candidateJoined.state, "unavailable");
  assert.equal(unavailable.productSignals.reliability.state, "unavailable");
  assert.equal(unavailable.productSignals.signals.candidateJoined.reaches, undefined);
});

test("groups curated legacy action goals without exposing targets and preserves partial availability", async () => {
  const dailyValues = Array.from({ length: 30 }, (_, index) => index + 1);
  const goalIds = {
    landingViewed: [91_001],
    loginSuccess: [91_002],
    registerSuccess: [91_003],
    accountRoomCreated: [91_004],
    guestRoomCreated: [91_005],
    tasksAdded: [91_006, 91_007],
    roomOpened: [91_008],
    secondParticipantJoined: [91_009],
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const metrics = parsed.searchParams.get("metrics") ?? "";
    if (metrics.startsWith("ym:s:goal")) {
      const values = metrics.split(",").map((metric) => {
        const goalId = Number(/goal(\d+)reaches/.exec(metric)?.[1]);
        return goalId === 91_008 ? 0 : goalId - 91_000;
      });
      return Response.json({ data: [{ metrics: values }], sampled: false, data_lag: 0 });
    }
    if (parsed.pathname.endsWith("/bytime")) return Response.json({ data: [{ metrics: [dailyValues, dailyValues.map(() => 1)] }], sampled: false, data_lag: 0 });
    if (parsed.searchParams.get("dimensions")) return Response.json({ data: [retentionRow("2026-06-16", "2026-06-16", 1)], sampled: false, data_lag: 0 });
    const date1 = parsed.searchParams.get("date1");
    return Response.json({ data: [{ metrics: [date1 === "2026-07-09" ? 70 : 300] }], sampled: false, data_lag: 0 });
  };
  const result = await loadDashboardData(config, {
    fetchImpl,
    productGoalCatalogue: createInjectedProductGoalCatalogue(goalIds),
    periodDays: 30,
    now: new Date("2026-07-16T12:00:00.000Z"),
  });
  const access = result.productSignals.legacyGoalGroups.find((group) => group.key === "access");
  const launch = result.productSignals.legacyGoalGroups.find((group) => group.key === "launch");
  const roomActivity = result.productSignals.legacyGoalGroups.find((group) => group.key === "roomActivity");
  assert.deepEqual(access.overview.map((signal) => signal.key), ["landingViewed", "loginSuccess", "registerSuccess"]);
  assert.equal(access.overview[0].reaches, 1);
  assert.equal(access.diagnostics.find((signal) => signal.key === "loginFailed").state, "unavailable");
  assert.equal(launch.overview.find((signal) => signal.key === "tasksAdded").reaches, 13);
  assert.equal(roomActivity.overview.find((signal) => signal.key === "roomOpened").reaches, 0);
  const publicPayload = JSON.stringify(result.productSignals.legacyGoalGroups);
  assert.doesNotMatch(publicPayload, /9100[1-9]|goalIds|mkt_|prod_/);
});

test("maps Metrika access errors to a safe message", async () => {
  await assert.rejects(
    loadDashboardData(config, { fetchImpl: async () => new Response("ignored", { status: 403 }), now: new Date("2026-07-16T12:00:00.000Z") }),
    (error) => error instanceof DashboardError && /отклонила доступ/.test(error.message),
  );
});

test("maps quota and malformed Metrika responses to safe states", async () => {
  await assert.rejects(
    loadDashboardData(config, { fetchImpl: async () => new Response("ignored", { status: 420 }), now: new Date("2026-07-16T12:00:00.000Z") }),
    (error) => error instanceof DashboardError && /ограничила запросы/.test(error.message),
  );
  await assert.rejects(
    loadDashboardData(config, { fetchImpl: async () => Response.json({ data: [{ metrics: [[1]] }] }), now: new Date("2026-07-16T12:00:00.000Z") }),
    (error) => error instanceof DashboardError && /неполные данные/.test(error.message),
  );
  await assert.rejects(
    loadDashboardData(config, { fetchImpl: async () => new Response("ignored", { status: 429 }), now: new Date("2026-07-16T12:00:00.000Z") }),
    (error) => error instanceof DashboardError && /ограничила запросы/.test(error.message),
  );
});

test("rejects an incomplete retention matrix instead of rendering partial cohorts", () => {
  assert.throws(() => buildRetention({ data: [], total_rows: 5_001 }, reportWindow), DashboardError);
});

test("serves allowed preset and custom aggregates only on a loopback server", async () => {
  const requested = [];
  const now = new Date("2026-07-16T12:00:00.000Z");
  const server = createDashboardServer({
    service: { get: async (options) => { requested.push(options); return fixtureData; } },
    normalizeRange: (range) => createDashboardWindow("Europe/Moscow", range, now),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const root = await fetch(`http://127.0.0.1:${address.port}/`);
    const favicon = await fetch(`http://127.0.0.1:${address.port}/favicon.svg`);
    const api = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data`);
    const thirtyDays = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?period=30`);
    const custom = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?start=2026-07-01&end=2026-07-14`);
    assert.equal(root.status, 200);
    assert.equal(favicon.status, 200);
    assert.match(root.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(api.status, 200);
    assert.equal(thirtyDays.status, 200);
    assert.equal(custom.status, 200);
    assert.deepEqual(requested.map((request) => request.range.cacheKey), ["2026-04-17:2026-07-15", "2026-06-16:2026-07-15", "2026-07-01:2026-07-14"]);
    const apiBody = await api.text();
    assert.doesNotMatch(apiBody, /private-token|Authorization|api-metrika/);
    const invalid = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?metric=anything`);
    const duplicate = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?period=30&period=90`);
    const partialRange = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?start=2026-07-01`);
    const mixedRange = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?period=30&start=2026-07-01&end=2026-07-14`);
    const futureRange = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-data?start=2026-07-01&end=2026-07-16`);
    assert.equal(invalid.status, 400);
    assert.equal(duplicate.status, 400);
    assert.equal(partialRange.status, 400);
    assert.equal(mixedRange.status, 400);
    assert.equal(futureRange.status, 400);
    assert.equal(requested.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dashboard assets have no direct Metrika request or credential placeholder", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../metrika-dashboard-ui/index.html", import.meta.url), "utf8"),
    readFile(new URL("../metrika-dashboard-ui/dashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Памятка: что означает каждый параметр/);
  assert.match(html, /Продуктовые показатели/);
  assert.match(html, /Метрика · браузерное событие/);
  assert.match(html, /Активность аудитории по дням/);
  assert.match(html, /period-selector/);
  assert.match(html, /range-start/);
  assert.match(html, /legacy-goal-groups/);
  assert.match(html, /legacy-goal-catalogue/);
  assert.match(script, /start/);
  assert.match(script, /renderLegacyGoalGroups/);
  assert.match(script, /Недоступно/);
  assert.doesNotMatch(`${html}${script}`, /api-metrika\.yandex\.net|METRIKA_OAUTH_TOKEN|Authorization: OAuth|585806372|goalIds/);
});

test("Windows launcher reads the local credential without embedding it in source", async () => {
  const launcher = await readFile(new URL("../open-metrika-dashboard.ps1", import.meta.url), "utf8");
  const wrapper = await readFile(new URL("../../Открыть-дашборд-Метрики.cmd", import.meta.url), "utf8");

  assert.match(launcher, /CredRead/);
  assert.match(launcher, /Start-Process/);
  assert.match(wrapper, /open-metrika-dashboard\.ps1/);
  const tokenPrefixPattern = new RegExp(["y0", "__"].join(""), "i");
  assert.doesNotMatch(launcher, tokenPrefixPattern);
  assert.doesNotMatch(launcher, /Authorization:\s*OAuth/i);
  assert.doesNotMatch(wrapper, tokenPrefixPattern);
});
