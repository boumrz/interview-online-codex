#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DashboardError,
  createDashboardWindow,
  createDashboardService,
  createProductGoalCatalogueResolver,
  loadDashboardData,
  parseDashboardConfig,
  parseDashboardPeriod,
} from "./metrika-dashboard-core.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const assetDirectory = join(scriptDirectory, "metrika-dashboard-ui");
const ASSETS = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/favicon.svg", { file: "favicon.svg", type: "image/svg+xml" }],
  ["/dashboard.css", { file: "dashboard.css", type: "text/css; charset=utf-8" }],
  ["/dashboard.js", { file: "dashboard.js", type: "application/javascript; charset=utf-8" }],
]);

function isAllowedHost(host) {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function send(response, statusCode, contentType, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  });
  response.end(body);
}

function safeError(error) {
  if (error instanceof DashboardError) return error.message;
  return "Не удалось обновить дэшборд. Попробуйте позже.";
}

function parseDashboardRequest(searchParams) {
  const entries = [...searchParams.entries()];
  const keys = entries.map(([key]) => key);
  const allowedKeys = new Set(["period", "start", "end", "refresh"]);
  if (keys.some((key) => !allowedKeys.has(key)) || new Set(keys).size !== keys.length) {
    throw new DashboardError("Недопустимый параметр запроса.", "configuration");
  }
  const refresh = searchParams.get("refresh");
  if (refresh !== null && refresh !== "1") {
    throw new DashboardError("Недопустимый параметр запроса.", "configuration");
  }
  const period = searchParams.get("period");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (period !== null && (start !== null || end !== null)) {
    throw new DashboardError("Укажите либо готовый период, либо обе даты произвольного периода.", "configuration");
  }
  if ((start === null) !== (end === null)) {
    throw new DashboardError("Для произвольного периода нужны дата начала и дата окончания.", "configuration");
  }
  const range = period !== null
    ? { periodDays: parseDashboardPeriod(period) }
    : start !== null
      ? { start, end }
      : { periodDays: parseDashboardPeriod() };
  return { force: refresh === "1", range };
}

export function createDashboardServer({ service, normalizeRange = (range) => range, readAsset = (file) => readFile(join(assetDirectory, file), "utf8") }) {
  return createServer(async (request, response) => {
    if (!isAllowedHost(request.headers.host)) {
      send(response, 421, "application/json; charset=utf-8", JSON.stringify({ error: "Локальный дэшборд доступен только на этом компьютере." }));
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") {
      send(response, 405, "application/json; charset=utf-8", JSON.stringify({ error: "Метод не поддерживается." }), { Allow: "GET" });
      return;
    }
    if (url.pathname === "/api/dashboard-data") {
      let dashboardRequest;
      try {
        dashboardRequest = parseDashboardRequest(url.searchParams);
        dashboardRequest.range = normalizeRange(dashboardRequest.range);
      } catch (error) {
        send(response, 400, "application/json; charset=utf-8", JSON.stringify({ error: safeError(error) }));
        return;
      }
      try {
        const data = await service.get(dashboardRequest);
        send(response, 200, "application/json; charset=utf-8", JSON.stringify(data));
      } catch (error) {
        send(response, 503, "application/json; charset=utf-8", JSON.stringify({ error: safeError(error) }));
      }
      return;
    }
    const asset = ASSETS.get(url.pathname);
    if (!asset) {
      send(response, 404, "text/plain; charset=utf-8", "Не найдено.");
      return;
    }
    try {
      send(response, 200, asset.type, await readAsset(asset.file));
    } catch {
      send(response, 500, "text/plain; charset=utf-8", "Не удалось загрузить локальный ресурс.");
    }
  });
}

export async function startDashboard(config) {
  const resolveProductGoalCatalogue = createProductGoalCatalogueResolver({ config });
  const service = createDashboardService({
    load: (window) => loadDashboardData(config, { window, resolveProductGoalCatalogue }),
    cacheKey: (window) => window.cacheKey,
  });
  const server = createDashboardServer({
    service,
    normalizeRange: (range) => createDashboardWindow(config.timezone, range),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  return server;
}

async function main() {
  const config = parseDashboardConfig();
  const server = await startDashboard(config);
  const url = `http://127.0.0.1:${config.port}`;
  console.log(`Локальный дэшборд доступен: ${url}`);
  console.log("Оставьте это окно открытым; Ctrl+C остановит локальный дэшборд.");
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`Ошибка: ${safeError(error)}`);
    process.exitCode = 1;
  });
}
