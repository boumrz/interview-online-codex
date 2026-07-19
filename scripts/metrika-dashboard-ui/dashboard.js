const elements = {
  period: document.querySelector("#period"), periodSelector: document.querySelector("#period-selector"), customRange: document.querySelector("#custom-range"), rangeStart: document.querySelector("#range-start"), rangeEnd: document.querySelector("#range-end"), status: document.querySelector("#status"), refresh: document.querySelector("#refresh"),
  dau: document.querySelector("#dau"), wau: document.querySelector("#wau"), mau: document.querySelector("#mau"), newUsers: document.querySelector("#new-users"),
  dauNote: document.querySelector("#dau-note"), wauNote: document.querySelector("#wau-note"), mauNote: document.querySelector("#mau-note"), newUsersNote: document.querySelector("#new-users-note"),
  summaryLine: document.querySelector("#summary-line"), periodUsers: document.querySelector("#period-users"), periodNewUsers: document.querySelector("#period-new-users"), averageDau: document.querySelector("#average-dau"), activityComparison: document.querySelector("#activity-comparison"), activityComparisonNote: document.querySelector("#activity-comparison-note"),
  checkpoints: document.querySelector("#checkpoints"), retentionScope: document.querySelector("#retention-scope"), retentionChart: document.querySelector("#retention-chart"), dauChart: document.querySelector("#dau-chart"), cohorts: document.querySelector("#cohorts"),
  productSourceBadge: document.querySelector("#product-source-badge"), productSignalNote: document.querySelector("#product-signal-note"), productSignalFunnel: document.querySelector("#product-signal-funnel"), reliabilityCards: document.querySelector("#reliability-cards"),
  legacyGoalSourceBadge: document.querySelector("#legacy-goal-source-badge"), legacyGoalGroups: document.querySelector("#legacy-goal-groups"), legacyGoalCatalogue: document.querySelector("#legacy-goal-catalogue"),
  qualityBadge: document.querySelector("#quality-badge"), freshness: document.querySelector("#freshness"),
};
const number = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]);
const displayDate = (value, formatter = dateFormat) => formatter.format(new Date(`${value}T12:00:00`));

function setText(element, value) { element.textContent = value; }
function rateText(cell) { return cell?.state === "value" ? `${percent.format(cell.rate)}%` : cell?.state === "early" ? "ещё рано" : "—"; }
function tooltip(cell) { return cell?.state === "value" ? `${number.format(cell.users)} / ${number.format(cell.cohortSize ?? 0)}` : ""; }
function periodLabel(meta) {
  if (meta.rangeMode === "custom") return `${number.format(meta.periodDays)} ${meta.periodDays === 1 ? "день" : meta.periodDays < 5 ? "дня" : "дней"}`;
  return meta.periodDays === 90 ? "3 месяца" : "30 дней";
}

function configureCustomRange(meta) {
  const isCustom = meta.rangeMode === "custom";
  elements.periodSelector.value = isCustom ? "custom" : String(meta.periodDays);
  elements.customRange.hidden = !isCustom;
  elements.rangeStart.value = meta.periodStart;
  elements.rangeEnd.value = meta.asOf;
  elements.rangeStart.max = meta.latestCompletedDay ?? meta.asOf;
  elements.rangeEnd.max = meta.latestCompletedDay ?? meta.asOf;
  elements.rangeStart.max = elements.rangeEnd.value || elements.rangeStart.max;
  elements.rangeEnd.min = elements.rangeStart.value;
}

function renderPeriodSummary(meta, summary) {
  const comparison = summary.activityComparison;
  const percentChange = comparison.percentChange == null ? null : percent.format(Math.abs(comparison.percentChange));
  const direction = comparison.deltaUsers > 0 ? "выше" : comparison.deltaUsers < 0 ? "ниже" : "на том же уровне";
  setText(elements.periodUsers, number.format(summary.periodUsers));
  setText(elements.periodNewUsers, number.format(summary.periodNewUsers));
  setText(elements.averageDau, number.format(summary.averageDau));
  setText(elements.activityComparison, comparison.percentChange == null ? "нет базы" : `${comparison.deltaUsers >= 0 ? "+" : "−"}${percentChange}%`);
  setText(elements.activityComparisonNote, comparison.percentChange == null
    ? "В первой половине не было достаточной дневной активности для сравнения."
    : `Во второй половине средний DAU ${direction}: ${number.format(comparison.recentAverageDau)} против ${number.format(comparison.earlyAverageDau)} в первой.`);
  setText(elements.summaryLine, `За ${periodLabel(meta).toLowerCase()} продуктом воспользовались ${number.format(summary.periodUsers)} уникальных посетителей. В среднем за день — ${number.format(summary.averageDau)}; пик — ${number.format(summary.highestDau)} (${displayDate(summary.highestDauDate)}). Это факты Метрики, а не объяснение причин.`);
}

function drawLineChart(svg, data, { key, color, areaColor, suffix = "", labels }) {
  const width = svg.viewBox.baseVal.width || 640; const height = svg.viewBox.baseVal.height || 270;
  const padding = { top: 18, right: 14, bottom: 34, left: 43 }; const graphWidth = width - padding.left - padding.right; const graphHeight = height - padding.top - padding.bottom;
  const values = data.map((item) => typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] : null);
  if (values.every((value) => value === null)) { svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#8190a8" font-size="14">Нет доступных данных для графика</text>`; return; }
  const numericValues = values.map((value) => value ?? 0); const max = Math.max(1, ...numericValues); const ticks = [0, .25, .5, .75, 1];
  const point = (value, index) => { const x = padding.left + (data.length <= 1 ? graphWidth / 2 : index / (data.length - 1) * graphWidth); const y = padding.top + graphHeight - value / max * graphHeight; return [x, y]; };
  const points = numericValues.map(point); const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${padding.left},${padding.top + graphHeight} ${line} ${padding.left + graphWidth},${padding.top + graphHeight}`;
  const xIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  svg.innerHTML = `<defs><linearGradient id="${svg.id}-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${areaColor}" stop-opacity=".4"/><stop offset="1" stop-color="${areaColor}" stop-opacity="0"/></linearGradient></defs>${ticks.map((tick) => { const y = padding.top + graphHeight - tick * graphHeight; const label = key === "users" ? Math.round(max * tick) : max * tick; return `<g><line x1="${padding.left}" x2="${padding.left + graphWidth}" y1="${y}" y2="${y}" stroke="#263650" stroke-dasharray="3 5"/><text x="2" y="${y + 4}" fill="#9aaac0" font-size="12">${number.format(label)}${suffix}</text></g>`; }).join("")}<polygon points="${area}" fill="url(#${svg.id}-fill)"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${xIndexes.map((index) => { const [x] = points[index]; return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#9aaac0" font-size="12">${escapeHtml(labels(data[index], index))}</text>`; }).join("")}`;
}

function renderCheckpoints(checkpoints) {
  const days = [0, 1, 7, 14, 30];
  elements.checkpoints.innerHTML = days.map((day) => { const value = checkpoints[`d${day}`]; const note = value?.rate == null ? "Нет зрелой когорты" : `${number.format(value.users)} / ${number.format(value.cohortSize)}`; return `<article class="checkpoint"><span class="checkpoint-label">D${day}</span><strong class="checkpoint-rate">${value?.rate == null ? "—" : `${percent.format(value.rate)}%`}</strong><p class="checkpoint-note">${note}</p></article>`; }).join("");
}

function renderCohorts(cohorts) {
  elements.cohorts.innerHTML = cohorts.length ? cohorts.map((cohort) => `<tr><td>${escapeHtml(displayDate(cohort.date))}<br><small>${number.format(cohort.size)} новых</small></td>${[0, 1, 7, 14, 30].map((day) => { const cell = cohort.checkpoints[`d${day}`]; return `<td class="${cell?.state === "value" ? "strong" : "muted"}" title="${escapeHtml(tooltip({ ...cell, cohortSize: cohort.size }))}">${rateText(cell)}</td>`; }).join("")}</tr>`).join("") : "<tr><td colspan=6 class=muted>Для выбранного периода нет зрелых когорт.</td></tr>";
}

const productSignalOrder = [
  ["roomCreated", "Комната создана", "Срабатывания цели создания комнаты"],
  ["candidateJoined", "Кандидат подключился", "Срабатывания цели подключения кандидата"],
  ["candidateActivity", "Кандидат начал работу", "Срабатывания первой значимой работы с кодом"],
  ["verdictSaved", "Вердикт сохранён", "Срабатывания успешного сохранения вердикта"],
];

function unavailableMetric(label, reason) {
  return `<article class="product-signal-card unavailable"><p class="metric-name">${escapeHtml(label)}</p><strong>Недоступно</strong><p>Метрика · ${escapeHtml(reason || "Цель ещё не настроена, не подтверждена или данные не обработаны.")}</p></article>`;
}

function legacyGoalMetric(signal) {
  const label = signal?.label || "Цель Метрики";
  if (signal?.state !== "available") return unavailableMetric(label, signal?.reason);
  return `<article class="product-signal-card"><p class="metric-name">${escapeHtml(label)}</p><strong>${number.format(signal.reaches)}</strong><p>Метрика · срабатывания целей · ${escapeHtml(signal.description || "Сигнал выбранного этапа пути.")}</p></article>`;
}

function renderLegacyGoalGroups(productSignals) {
  const source = productSignals?.source;
  const groups = Array.isArray(productSignals?.legacyGoalGroups) ? productSignals.legacyGoalGroups : [];
  setText(elements.legacyGoalSourceBadge, source?.label || "Метрика · браузерное событие");
  elements.legacyGoalGroups.innerHTML = groups.length
    ? groups.map((group) => `<section class="legacy-goal-group" aria-labelledby="legacy-goal-${escapeHtml(group.key)}"><h3 id="legacy-goal-${escapeHtml(group.key)}">${escapeHtml(group.label)}</h3>${group.overview?.length ? `<div class="legacy-goal-cards">${group.overview.map(legacyGoalMetric).join("")}</div>` : "<p class=\"legacy-goal-empty\">Подробные realtime-сигналы — в следующем блоке и в диагностике ниже.</p>"}</section>`).join("")
    : "<p class=\"legacy-goal-empty\">Цели Метрики пока недоступны. Это не означает, что действий не было.</p>";
  const diagnostics = groups.flatMap((group) => (group.diagnostics || []).map((signal) => ({ group, signal })));
  elements.legacyGoalCatalogue.innerHTML = diagnostics.length
    ? diagnostics.map(({ group, signal }) => `<tr><th scope="row">${escapeHtml(group.label)}</th><td><strong>${escapeHtml(signal?.label || "Цель Метрики")}</strong><br><small>${escapeHtml(signal?.description || "Диагностический сигнал выбранного этапа.")}</small></td><td class="${signal?.state === "available" ? "strong" : "muted"}">${signal?.state === "available" ? number.format(signal.reaches) : "Недоступно"}</td><td>${signal?.state === "available" ? "Срабатывания цели" : escapeHtml(signal?.reason || "Данные цели временно недоступны.")}</td></tr>`).join("")
    : "<tr><td colspan=4 class=\"muted\">Диагностические цели пока недоступны.</td></tr>";
}

function renderProductSignals(productSignals) {
  const source = productSignals?.source;
  setText(elements.productSourceBadge, source?.label || "Метрика · браузерное событие");
  setText(elements.productSignalNote, source?.disclaimer || "Сигналы Метрики пока недоступны. Это не означает ноль комнат или ноль интервью.");
  elements.productSignalFunnel.innerHTML = productSignalOrder.map(([key, fallbackLabel, note]) => {
    const signal = productSignals?.signals?.[key];
    const label = signal?.label || fallbackLabel;
    if (signal?.state !== "available") return unavailableMetric(label, signal?.reason);
    return `<article class="product-signal-card"><p class="metric-name">${escapeHtml(label)}</p><strong>${number.format(signal.reaches)}</strong><p>Метрика · ${escapeHtml(note)} · единица: срабатывания целей</p></article>`;
  }).join("");
  const reliability = productSignals?.reliability;
  if (reliability?.state !== "available") {
    elements.reliabilityCards.innerHTML = unavailableMetric("Realtime-сигналы", reliability?.reason);
    return;
  }
  elements.reliabilityCards.innerHTML = [
    ["Потеря соединения", number.format(reliability.connectionLossReaches), "срабатывания цели"],
    ["Восстановление realtime", number.format(reliability.recoveryReaches), "срабатывания цели"],
    ["Потери на подключение кандидата", `${percent.format(reliability.lossPerCandidateJoinRate)}%`, `${number.format(reliability.connectionLossReaches)} / ${number.format(reliability.candidateJoinReaches)}`],
    ["Восстановления на подключение кандидата", `${percent.format(reliability.recoveryPerCandidateJoinRate)}%`, `${number.format(reliability.recoveryReaches)} / ${number.format(reliability.candidateJoinReaches)}`],
  ].map(([label, value, note]) => `<article class="reliability-card"><p class="metric-name">${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><p>Метрика · ${escapeHtml(note)}</p></article>`).join("");
}

function renderQuality(data) {
  const { quality, meta } = data; const messages = [];
  if (quality.sampled) messages.push(`Выборка Метрики${quality.sampleShare == null ? "" : `: ${percent.format(quality.sampleShare * 100)}%`}`);
  if (quality.dataLagSeconds > 0) messages.push(`Задержка обновления около ${Math.ceil(quality.dataLagSeconds / 60)} мин.`);
  if (meta.stale) messages.push(meta.refreshError);
  elements.qualityBadge.className = `quality-badge${messages.length ? " warning" : ""}`;
  elements.qualityBadge.textContent = messages.length ? messages.join(" · ") : "Данные без отмеченных ограничений";
  elements.freshness.textContent = `Последнее успешное обновление: ${new Date(meta.refreshedAt).toLocaleString("ru-RU")}${meta.cached ? " · из локального кэша" : ""}`;
}

function render(data) {
  const { meta, summary, daily, retention, productSignals } = data;
  configureCustomRange(meta);
  setText(elements.period, `${periodLabel(meta)} · ${displayDate(meta.periodStart)} — ${displayDate(meta.asOf)} · ${meta.timezone}`);
  setText(elements.status, `Данные на ${fullDate.format(new Date(`${meta.asOf}T12:00:00`))}`);
  setText(elements.dau, number.format(summary.dau)); setText(elements.wau, number.format(summary.wau)); setText(elements.mau, number.format(summary.mau)); setText(elements.newUsers, number.format(summary.newUsers));
  setText(elements.dauNote, `Активны за ${displayDate(summary.dauDate)} — конец выбранного периода`); setText(elements.wauNote, `Уникальные за ${displayDate(summary.wauStart)} — ${displayDate(meta.asOf)}`); setText(elements.mauNote, `Уникальные за ${displayDate(summary.mauStart)} — ${displayDate(meta.asOf)}; всегда 30 дней`); setText(elements.newUsersNote, `Первый визит Метрики за ${displayDate(summary.dauDate)}`);
  setText(elements.retentionScope, meta.retentionDays < meta.periodDays
    ? `Retention: когорты за ${displayDate(meta.retentionStart)} — ${displayDate(meta.asOf)} (последние ${meta.retentionDays} дней выбранного периода)`
    : `Когорты первого визита: ${displayDate(meta.retentionStart)} — ${displayDate(meta.asOf)} · D0 — контроль, важнее D1/D7/D30`);
  renderPeriodSummary(meta, summary);
  renderProductSignals(productSignals);
  renderLegacyGoalGroups(productSignals);
  renderCheckpoints(retention.checkpoints); renderCohorts(retention.cohorts);
  drawLineChart(elements.retentionChart, retention.curve, { key: "rate", color: "#ef7181", areaColor: "#c74462", suffix: "%", labels: (item) => `D${item.day}` });
  drawLineChart(elements.dauChart, daily, { key: "users", color: "#35d3a1", areaColor: "#139976", labels: (item) => displayDate(item.date) });
  renderQuality(data);
}

async function load(force = false) {
  elements.refresh.disabled = true; setText(elements.status, "Обновляем данные Метрики…");
  try {
    const query = new URLSearchParams();
    if (elements.periodSelector.value === "custom") {
      const start = elements.rangeStart.value;
      const end = elements.rangeEnd.value;
      if (!start || !end) throw new Error("Укажите дату начала и дату окончания периода.");
      query.set("start", start); query.set("end", end);
    } else query.set("period", elements.periodSelector.value);
    if (force) query.set("refresh", "1");
    const response = await fetch(`/api/dashboard-data?${query.toString()}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "Не удалось получить данные.");
    render(payload);
  } catch (error) {
    setText(elements.status, error instanceof Error ? error.message : "Не удалось получить данные.");
    elements.qualityBadge.className = "quality-badge error"; setText(elements.qualityBadge, "Данные не загружены");
  } finally { elements.refresh.disabled = false; }
}

elements.refresh.addEventListener("click", () => load(true));
elements.periodSelector.addEventListener("change", () => {
  const custom = elements.periodSelector.value === "custom";
  elements.customRange.hidden = !custom;
  if (!custom) load();
});
elements.rangeStart.addEventListener("change", () => { elements.rangeEnd.min = elements.rangeStart.value; });
elements.rangeEnd.addEventListener("change", () => {
  if (elements.periodSelector.value === "custom" && elements.rangeStart.value && elements.rangeEnd.value) load();
});
load();
setInterval(() => load(), 300_000);
