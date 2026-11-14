import { createHash } from "node:crypto";
import { createCustomReportWindow, parseDashboardDate } from "./metrika-dashboard-core.mjs";

const countFields = ["dau", "wau", "mau", "periodUsers", "visits", "pageviews", "newUsers"];
const retentionDays = [1, 7, 30];
const trafficLabels = { periodUsers: "Посетители", visits: "Визиты", pageviews: "Просмотры", newUsers: "Новые посетители" };
const productLabels = { candidateJoined: "Подключение кандидата", firstCodeEdit: "Первая правка кода", verdictSaved: "Сохранение вердикта" };
const countFormat = new Intl.NumberFormat("ru-RU");
const percentFormat = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });

function requireValid(condition) {
  if (!condition) throw new Error("Некорректный агрегированный срез");
}

function onlyFields(value, allowed) {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  requireValid(Object.keys(value).every((key) => allowed.includes(key)));
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function dateLabel(date) {
  return date.split("-").reverse().join(".");
}

function shiftDay(date, days) {
  const shifted = parseDashboardDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  return start === end ? dateLabel(start) : `${dateLabel(start)} — ${dateLabel(end)}`;
}

function retentionCard(value, day, period) {
  const title = `D${day}`;
  if (value == null) return card(title, "Нет данных", "Когорта и число возвратов не указаны.");
  onlyFields(value, ["users", "cohortSize", "cohortStart", "cohortEnd"]);
  requireValid(isCount(value.users) && isCount(value.cohortSize) && value.users <= value.cohortSize);
  requireValid((value.cohortStart === undefined) === (value.cohortEnd === undefined));
  const start = value.cohortStart ?? period.periodStart;
  const matureThrough = shiftDay(period.periodEnd, -day);
  const end = value.cohortEnd ?? matureThrough;
  parseDashboardDate(start);
  parseDashboardDate(end);
  requireValid(start <= end && end <= matureThrough);
  const fraction = value.cohortSize ? percentFormat.format(value.users / value.cohortSize) : "Нет зрелой когорты";
  return card(title, fraction, `${countFormat.format(value.users)} из ${countFormat.format(value.cohortSize)}. Первый визит: ${dateRange(start, end)}.`);
}

function card(title, value, note) {
  return `<article class="kpi"><p class="metric-name">${title}</p><strong>${value}</strong><p class="metric-note">${note}</p></article>`;
}

function countCard(title, value, note) {
  return card(title, value == null ? "Нет данных" : countFormat.format(value), note);
}

function section(title, content, description = "") {
  return `<section><h2>${title}</h2>${description ? `<p>${description}</p>` : ""}<div class="kpis">${content}</div></section>`;
}

function confirmedCards(data, labels, period) {
  return Object.entries(labels).filter(([key]) => data[key] != null).map(([key, label]) => {
    requireValid(isCount(data[key]));
    return countCard(label, data[key], period);
  }).join("");
}

function comparisonSection(previous, window) {
  if (previous == null) return "";
  onlyFields(previous, ["periodStart", "periodEnd", ...Object.keys(trafficLabels)]);
  requireValid(previous.periodEnd === shiftDay(window.dailyStart, -1));
  requireValid(previous.periodStart === shiftDay(window.dailyStart, -window.periodDays));
  const cards = confirmedCards(previous, trafficLabels, dateRange(previous.periodStart, previous.periodEnd));
  return cards ? section("Предыдущий период", cards) : "";
}

function goalsSection(product, period) {
  if (product == null) return "";
  onlyFields(product, Object.keys(productLabels));
  const cards = confirmedCards(product, productLabels, period);
  return cards ? section("Достижения целей интервью", cards, "Каждое срабатывание цели в браузере учитывается отдельно. Один участник может совершить действие несколько раз.") : "";
}

// This function is embedded verbatim in the exported report. It only updates local link targets.
function updateAudienceLinks() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const parts = Object.fromEntries(today.map((part) => [part.type, part.value]));
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1));
  const end = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() - 29);
  const monthStart = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() - 60);
  const retentionStart = day.toISOString().slice(0, 10);
  for (const link of document.querySelectorAll("[data-audience-window]")) {
    const url = new URL(link.href);
    const daily = link.dataset.audienceWindow === "day";
    const start = link.dataset.audienceWindow === "retention" ? retentionStart : monthStart;
    url.searchParams.set("period", daily ? "yesterday" : `${start}:${end}`);
    url.searchParams.set("group", daily ? "dekaminute" : "day");
    link.href = url.href;
  }
}

const linkScript = `(${updateAudienceLinks.toString()})();`;
export const snapshotScriptSource = `'sha256-${createHash("sha256").update(linkScript).digest("base64")}'`;
const audienceDashboard = "a0cb3fe0-7819-4547-a915-93ad9f3f0b00";
const interviewDashboard = "345734c0-b899-45b6-8114-99e04982577f";

function reportLink(path, options, label, attributes = "") {
  const url = new URL(path, "https://metrika.yandex.ru");
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value);
  return `<a ${attributes}href="${url.href.replaceAll("&", "&amp;")}">${label}</a>`;
}

function liveReports(counterId, window) {
  if (counterId !== 109032539) return "";
  const options = { id: counterId, dashboardId: audienceDashboard, group: "day" };
  const dau = reportLink("/dashboard", { ...options, period: `${window.asOf}:${window.asOf}` }, "DAU за вчера", 'data-audience-window="day" ');
  const mau = reportLink("/dashboard", { ...options, period: `${window.mauStart}:${window.asOf}` }, "MAU за 30 завершённых дней", 'data-audience-window="month" ');
  const retention = reportLink("/stat/retention", {
    id: counterId, group: "day", groupMethod: "calendar", onlyNewUsers: true, tableGroupByInterval: "day", minCohortSize: 1,
    period: `${shiftDay(window.asOf, -89)}:${window.asOf}`,
  }, "Удержание за 90 завершённых дней", 'data-audience-window="retention" ');
  const product = reportLink("/dashboard", {
    ...options, dashboardId: interviewDashboard, period: `${window.mauStart}:${window.asOf}`,
  }, "Использование интервью", 'data-audience-window="product" ');
  return `<section class="snapshot-live"><h2>Открыть текущие данные в Яндекс Метрике</h2><p>Для просмотра войдите в аккаунт с доступом к счётчику. Периоды отчётов отсчитываются от даты открытия по Москве.</p>
    <nav>${dau}${mau}${retention}${product}</nav><noscript><p>JavaScript отключён. Ссылки на отчёты открывают окна, заканчивающиеся ${dateLabel(window.asOf)}.</p></noscript></section>`;
}

function page(content, counterId, stylesheet) {
  const assets = stylesheet
    ? `<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${snapshotScriptSource}; base-uri 'none'; form-action 'none'"><style>${stylesheet}</style>`
    : '<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/dashboard.css">';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>InterHub · Срез Метрики</title>${assets}</head><body><main class="shell snapshot">
    <header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">↗</span>InterHub · Метрики продукта</div>
    <nav>${stylesheet ? "" : '<a href="/">Перечитать срез</a>'}${counterId ? `<a href="https://metrika.yandex.ru/overview?id=${counterId}">Открыть Метрику</a>` : ""}</nav></header>
    ${content}</main>${counterId === 109032539 ? `<script>${linkScript}</script>` : ""}</body></html>`;
}

export function unavailableSnapshotPage() {
  return page('<h1>Срез недоступен</h1><p>Проверьте файл <code>.local-metrics/snapshot.json</code> в папке проекта и нажмите «Перечитать срез». Для загрузки из Метрики запустите дашборд с настроенным METRIKA_OAUTH_TOKEN.</p>');
}

export function snapshotPage(snapshot, config, { stylesheet } = {}) {
  onlyFields(snapshot, ["counterId", "timezone", "capturedAt", "periodStart", "periodEnd", ...countFields, "retention", "previous", "product"]);
  requireValid(Number.isSafeInteger(snapshot.counterId) && snapshot.counterId === config.counterId && snapshot.timezone === config.timezone);
  requireValid(typeof snapshot.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.capturedAt));
  parseDashboardDate(snapshot.capturedAt.slice(0, 10));
  const captured = new Date(snapshot.capturedAt);
  requireValid(Number.isFinite(captured.valueOf()));
  const window = createCustomReportWindow(config.timezone, snapshot.periodStart, snapshot.periodEnd, captured);
  const period = dateRange(snapshot.periodStart, snapshot.periodEnd);
  for (const field of countFields) requireValid(snapshot[field] == null || isCount(snapshot[field]));
  const retention = snapshot.retention ?? {};
  onlyFields(retention, retentionDays.map((day) => `d${day}`));
  const capturedLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: config.timezone }).format(captured);
  const audience = [
    countCard("DAU", snapshot.dau, dateLabel(window.asOf)),
    countCard("WAU", snapshot.wau, dateRange(window.wauStart, window.asOf)),
    countCard("MAU", snapshot.mau, dateRange(window.mauStart, window.asOf)),
  ].join("");
  const totals = Object.entries(trafficLabels)
    .map(([key, label]) => countCard(label, snapshot[key], period)).join("");
  const refreshNote = stylesheet
    ? "Версия для просмотра. При обновлении среза выполните <code>node scripts/serve-metrika-dashboard.mjs --export</code> в папке проекта и откройте файл снова."
    : "«Перечитать срез» открывает последнюю сохранённую версию файла. Для загрузки данных из Метрики запустите дашборд с настроенным METRIKA_OAUTH_TOKEN.";
  return page(`<div class="headline"><div><p class="eyebrow">Сохранённый срез</p><h1>Аудитория InterHub</h1></div></div>
    <p>Яндекс Метрика · счётчик ${snapshot.counterId} · получено ${capturedLabel} (${config.timezone}).</p>
    <p>${refreshNote}</p>
    ${liveReports(snapshot.counterId, window)}
    ${section("Уникальные посетители сайта в срезе", audience)}
    ${section("Общая статистика", totals)}
    ${comparisonSection(snapshot.previous, window)}
    ${goalsSection(snapshot.product, period)}
    ${section("Возврат в точный день после первого визита", retentionDays.map((day) => retentionCard(retention[`d${day}`], day, snapshot)).join(""))}
    <p>Метрика различает посетителей по браузерам. У одного человека может быть несколько таких идентификаторов.</p>`, snapshot.counterId, stylesheet);
}
