import { PRODUCT_METRIKA_GOAL_MANIFEST } from "./metrika-product-goal-manifest.mjs";

const API_BASE_URL = "https://api-metrika.yandex.net";
const DEFAULT_COUNTER_ID = 109032539;
const DEFAULT_TIMEZONE = "Europe/Moscow";
const RETENTION_CHECKPOINTS = [0, 1, 7, 14, 30];
const REQUEST_TIMEOUT_MS = 15_000;
const RETENTION_MAX_ROWS = 5_000;
const RETENTION_SCOPE_MAX_DAYS = 90;
const PRODUCT_GOAL_CATALOGUE_TTL_MS = 15 * 60_000;
const PRODUCT_GOAL_REPORT_CONCURRENCY = 2;
export const DASHBOARD_PERIOD_DAYS = Object.freeze([30, 90]);
export const DEFAULT_DASHBOARD_PERIOD_DAYS = 90;
export const MAX_CUSTOM_DASHBOARD_RANGE_DAYS = 365;

// Target names are public, versioned analytics configuration. Numeric goal IDs are
// resolved only in this local Node process and never leave its API response.
export const PRODUCT_GOAL_TARGET_CATALOGUE = Object.freeze([
  Object.freeze({
    key: "roomCreated",
    label: "Комната создана",
    targets: Object.freeze(["prod_room_create_success", "prod_guest_room_create_success"]),
  }),
  Object.freeze({
    key: "candidateJoined",
    label: "Кандидат подключился",
    targets: Object.freeze(["int_candidate_joined_v1"]),
  }),
  Object.freeze({
    key: "candidateActivity",
    label: "Кандидат начал работу",
    targets: Object.freeze(["int_meaningful_candidate_activity_v1"]),
  }),
  Object.freeze({
    key: "verdictSaved",
    label: "Вердикт сохранён",
    targets: Object.freeze(["int_verdict_saved_v1"]),
  }),
  Object.freeze({
    key: "realtimeConnectionLoss",
    label: "Потеря realtime-соединения",
    targets: Object.freeze(["prod_realtime_connection_lost"]),
  }),
  Object.freeze({
    key: "realtimeRecovery",
    label: "Восстановление realtime",
    targets: Object.freeze(["prod_recovery_state_sync_applied", "prod_recovery_sync_completed"]),
  }),
  Object.freeze({
    key: "landingViewed",
    label: "Открыли лендинг",
    description: "Первый шаг: человек увидел страницу продукта.",
    targets: Object.freeze(["mkt_landing_view"]),
  }),
  Object.freeze({
    key: "loginViewed",
    label: "Открыли форму входа",
    description: "Показывает интерес к входу в сервис.",
    targets: Object.freeze(["mkt_login_view"]),
  }),
  Object.freeze({
    key: "loginSubmitted",
    label: "Отправили форму входа",
    description: "Переход от просмотра формы к попытке войти.",
    targets: Object.freeze(["mkt_login_submit"]),
  }),
  Object.freeze({
    key: "loginSuccess",
    label: "Успешно вошли",
    description: "Пользователь успешно авторизовался.",
    targets: Object.freeze(["mkt_login_success"]),
  }),
  Object.freeze({
    key: "loginFailed",
    label: "Не удалось войти",
    description: "Сигнал проблемы на пути авторизации.",
    targets: Object.freeze(["mkt_login_failed"]),
  }),
  Object.freeze({
    key: "registerSubmitted",
    label: "Отправили форму регистрации",
    description: "Пользователь начал регистрацию.",
    targets: Object.freeze(["mkt_register_submit"]),
  }),
  Object.freeze({
    key: "registerSuccess",
    label: "Успешно зарегистрировались",
    description: "Новый пользователь завершил регистрацию.",
    targets: Object.freeze(["mkt_register_success"]),
  }),
  Object.freeze({
    key: "registerFailed",
    label: "Не удалось зарегистрироваться",
    description: "Сигнал ошибки на пути регистрации.",
    targets: Object.freeze(["mkt_register_failed", "mkt_register_validation_failed"]),
  }),
  Object.freeze({
    key: "accountRoomCreated",
    label: "Создали комнату в кабинете",
    description: "Интервьюер создал комнату после входа.",
    targets: Object.freeze(["prod_room_create_success"]),
  }),
  Object.freeze({
    key: "guestRoomCreated",
    label: "Создали гостевую комнату",
    description: "Интервьюер быстро создал комнату без входа.",
    targets: Object.freeze(["prod_guest_room_create_success"]),
  }),
  Object.freeze({
    key: "roomCreateFailed",
    label: "Не удалось создать комнату",
    description: "Сигнал сбоя при запуске интервью.",
    targets: Object.freeze(["prod_room_create_failed", "prod_guest_room_create_failed"]),
  }),
  Object.freeze({
    key: "tasksAdded",
    label: "Добавили задания в комнату",
    description: "Интервьюер подготовил содержание интервью.",
    targets: Object.freeze(["prod_room_tasks_add_success", "prod_room_custom_task_add_success"]),
  }),
  Object.freeze({
    key: "taskAddFailed",
    label: "Не удалось добавить задание",
    description: "Сигнал проблемы при подготовке комнаты.",
    targets: Object.freeze(["prod_room_tasks_add_failed", "prod_room_custom_task_add_failed"]),
  }),
  Object.freeze({
    key: "roomOpened",
    label: "Открыли комнату",
    description: "Участник перешёл в пространство интервью.",
    targets: Object.freeze(["prod_room_opened"]),
  }),
  Object.freeze({
    key: "roomJoinSubmitted",
    label: "Попытались войти в комнату",
    description: "Участник отправил форму присоединения.",
    targets: Object.freeze(["prod_room_join_submit"]),
  }),
  Object.freeze({
    key: "secondParticipantJoined",
    label: "Присоединился второй участник",
    description: "Ключевой признак фактического старта интервью.",
    targets: Object.freeze(["prod_second_participant_joined"]),
  }),
  Object.freeze({
    key: "firstCodeEdit",
    label: "Первое изменение кода",
    description: "Кандидат или интервьюер начал работу с задачей.",
    targets: Object.freeze(["prod_first_code_edit"]),
  }),
  Object.freeze({
    key: "noteSent",
    label: "Добавили заметку",
    description: "Интервьюер зафиксировал наблюдение по ходу интервью.",
    targets: Object.freeze(["prod_note_sent"]),
  }),
  Object.freeze({
    key: "realtimePostFailed",
    label: "Не отправилось realtime-событие",
    description: "Помогает заметить проблемы с доставкой событий в комнате.",
    targets: Object.freeze(["prod_realtime_post_failed"]),
  }),
  Object.freeze({
    key: "realtimePostRejected",
    label: "Realtime-событие отклонено",
    description: "Помогает заметить отклонённые сервером действия.",
    targets: Object.freeze(["prod_realtime_post_rejected"]),
  }),
]);

export const LEGACY_GOAL_GROUPS = Object.freeze([
  Object.freeze({
    key: "access",
    label: "Привлечение и доступ",
    overviewKeys: Object.freeze(["landingViewed", "loginSuccess", "registerSuccess"]),
    diagnosticKeys: Object.freeze(["loginViewed", "loginSubmitted", "loginFailed", "registerSubmitted", "registerFailed"]),
  }),
  Object.freeze({
    key: "launch",
    label: "Запуск и подготовка интервью",
    overviewKeys: Object.freeze(["accountRoomCreated", "guestRoomCreated", "tasksAdded"]),
    diagnosticKeys: Object.freeze(["roomCreateFailed", "taskAddFailed", "roomJoinSubmitted"]),
  }),
  Object.freeze({
    key: "roomActivity",
    label: "Работа в комнате",
    overviewKeys: Object.freeze(["roomOpened", "secondParticipantJoined", "firstCodeEdit"]),
    diagnosticKeys: Object.freeze(["noteSent"]),
  }),
  Object.freeze({
    key: "realtime",
    label: "Realtime и восстановление",
    overviewKeys: Object.freeze([]),
    diagnosticKeys: Object.freeze(["realtimeConnectionLoss", "realtimeRecovery", "realtimePostFailed", "realtimePostRejected"]),
  }),
]);

export class DashboardError extends Error {
  constructor(message, kind = "unavailable") {
    super(message);
    this.name = "DashboardError";
    this.kind = kind;
  }
}

export function parseDashboardPeriod(value = DEFAULT_DASHBOARD_PERIOD_DAYS) {
  const periodDays = Number(value);
  if (!Number.isInteger(periodDays) || !DASHBOARD_PERIOD_DAYS.includes(periodDays)) {
    throw new DashboardError("Период дашборда должен быть 30 или 90 полных дней.", "configuration");
  }
  return periodDays;
}

export function parseDashboardDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DashboardError("Дата дашборда должна быть в формате ГГГГ-ММ-ДД.", "configuration");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new DashboardError("Дата дашборда некорректна.", "configuration");
  }
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function datePartsInTimezone(timezone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  } catch {
    throw new DashboardError("METRIKA_TIMEZONE должна быть корректной IANA временной зоной.", "configuration");
  }
}

function timezoneOffset(timezone, date) {
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
    if (value === "GMT") return "+00:00";
    const match = /^GMT([+-]\d{2}:\d{2})$/.exec(value ?? "");
    if (match) return match[1];
  } catch {
    // The configuration error below intentionally does not expose implementation details.
  }
  throw new DashboardError("METRIKA_TIMEZONE должна быть корректной IANA временной зоной.", "configuration");
}

export function parseDashboardConfig(environment = process.env) {
  const token = environment.METRIKA_OAUTH_TOKEN?.trim();
  if (!token) {
    throw new DashboardError("Не задан METRIKA_OAUTH_TOKEN. Локальный дэшборд не запущен.", "configuration");
  }
  const counterId = Number.parseInt(environment.METRIKA_COUNTER_ID ?? String(DEFAULT_COUNTER_ID), 10);
  if (!Number.isInteger(counterId) || counterId <= 0) {
    throw new DashboardError("METRIKA_COUNTER_ID должен быть положительным числом.", "configuration");
  }
  const timezone = environment.METRIKA_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  datePartsInTimezone(timezone);
  const port = Number.parseInt(environment.METRIKA_DASHBOARD_PORT ?? "4175", 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new DashboardError("METRIKA_DASHBOARD_PORT должен быть числом от 1024 до 65535.", "configuration");
  }
  return { token, counterId, timezone, port };
}

function createWindowFromBounds(timezone, dailyStart, asOf, rangeMode) {
  const selectedPeriodDays = Math.floor((asOf.valueOf() - dailyStart.valueOf()) / 86_400_000) + 1;
  const retentionDays = Math.min(selectedPeriodDays, RETENTION_SCOPE_MAX_DAYS);
  const retentionStart = addDays(asOf, -(retentionDays - 1));
  return {
    asOf: isoDate(asOf),
    dailyStart: isoDate(dailyStart),
    retentionStart: isoDate(retentionStart),
    periodDays: selectedPeriodDays,
    retentionDays,
    rangeMode,
    cacheKey: `${isoDate(dailyStart)}:${isoDate(asOf)}`,
    wauStart: isoDate(addDays(asOf, -6)),
    mauStart: isoDate(addDays(asOf, -29)),
    timezoneOffset: timezoneOffset(timezone, asOf),
  };
}

export function createReportWindow(timezone, periodDays = DEFAULT_DASHBOARD_PERIOD_DAYS, now = new Date()) {
  const selectedPeriodDays = parseDashboardPeriod(periodDays);
  const asOf = addDays(datePartsInTimezone(timezone, now), -1);
  return { ...createWindowFromBounds(timezone, addDays(asOf, -(selectedPeriodDays - 1)), asOf, "preset"), latestCompletedDay: isoDate(asOf) };
}

export function createCustomReportWindow(timezone, start, end, now = new Date()) {
  const dailyStart = parseDashboardDate(start);
  const asOf = parseDashboardDate(end);
  const latestCompletedDay = addDays(datePartsInTimezone(timezone, now), -1);
  if (dailyStart > asOf) {
    throw new DashboardError("Дата начала не может быть позже даты окончания.", "configuration");
  }
  if (asOf > latestCompletedDay) {
    throw new DashboardError("Можно выбрать только завершённые дни по времени Метрики.", "configuration");
  }
  const selectedPeriodDays = Math.floor((asOf.valueOf() - dailyStart.valueOf()) / 86_400_000) + 1;
  if (selectedPeriodDays > MAX_CUSTOM_DASHBOARD_RANGE_DAYS) {
    throw new DashboardError(`Произвольный период может содержать не более ${MAX_CUSTOM_DASHBOARD_RANGE_DAYS} дней.`, "configuration");
  }
  return { ...createWindowFromBounds(timezone, dailyStart, asOf, "custom"), latestCompletedDay: isoDate(latestCompletedDay) };
}

export function createDashboardWindow(timezone, range = {}, now = new Date()) {
  const hasStart = range?.start !== undefined;
  const hasEnd = range?.end !== undefined;
  if (hasStart || hasEnd) {
    if (hasStart !== hasEnd || range?.periodDays !== undefined) {
      throw new DashboardError("Укажите либо готовый период, либо обе даты произвольного периода.", "configuration");
    }
    return createCustomReportWindow(timezone, range.start, range.end, now);
  }
  return createReportWindow(timezone, range?.periodDays ?? DEFAULT_DASHBOARD_PERIOD_DAYS, now);
}

function allDates(startDate, endDate) {
  const dates = [];
  for (let date = new Date(`${startDate}T00:00:00Z`); isoDate(date) <= endDate; date = addDays(date, 1)) {
    dates.push(isoDate(date));
  }
  return dates;
}

function numberValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DashboardError("Метрика вернула неполные данные. Обновите страницу позже.", "malformed");
  }
  return Math.max(0, value);
}

function qualityFrom(payload) {
  return {
    sampled: payload?.sampled === true,
    sampleShare: typeof payload?.sample_share === "number" && Number.isFinite(payload.sample_share) ? payload.sample_share : null,
    dataLagSeconds: typeof payload?.data_lag === "number" && Number.isFinite(payload.data_lag) ? Math.max(0, Math.round(payload.data_lag)) : 0,
  };
}

export function mergeQuality(...qualities) {
  const sampleShares = qualities.map((quality) => quality.sampleShare).filter((value) => value !== null);
  return {
    sampled: qualities.some((quality) => quality.sampled),
    sampleShare: sampleShares.length ? Math.min(...sampleShares) : null,
    dataLagSeconds: Math.max(0, ...qualities.map((quality) => quality.dataLagSeconds)),
  };
}

function safeDimensionDate(dimension) {
  const candidates = [dimension?.id, dimension?.name].filter((value) => typeof value === "string");
  const date = candidates.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!date) {
    throw new DashboardError("Метрика вернула неполные данные retention. Обновите страницу позже.", "malformed");
  }
  return date;
}

export function parseDailyActivity(payload, window) {
  const metrics = payload?.data?.[0]?.metrics;
  const dates = allDates(window.dailyStart, window.asOf);
  if (!Array.isArray(metrics) || metrics.length !== 2 || !metrics.every((values) => Array.isArray(values) && values.length === dates.length)) {
    throw new DashboardError("Метрика вернула неполные данные активности. Обновите страницу позже.", "malformed");
  }
  return {
    rows: dates.map((date, index) => ({
      date,
      users: Math.round(numberValue(metrics[0][index])),
      newUsers: Math.round(numberValue(metrics[1][index])),
    })),
    quality: qualityFrom(payload),
  };
}

export function parseAggregateUsers(payload) {
  const value = payload?.data?.[0]?.metrics?.[0];
  return { users: Math.round(numberValue(value)), quality: qualityFrom(payload) };
}

function cellFor(cohortSize, activeUsers, returnDate, asOf) {
  if (returnDate > asOf) return { state: "early" };
  if (cohortSize === 0) return { state: "unavailable" };
  return {
    state: "value",
    users: activeUsers,
    rate: (activeUsers / cohortSize) * 100,
  };
}

export function buildRetention(payload, window) {
  if (!Array.isArray(payload?.data)) {
    throw new DashboardError("Метрика вернула неполные данные retention. Обновите страницу позже.", "malformed");
  }
  if ((typeof payload.total_rows === "number" && payload.total_rows > RETENTION_MAX_ROWS) || payload.data.length > RETENTION_MAX_ROWS) {
    throw new DashboardError("Метка retention неполная. Обновите страницу позже.", "malformed");
  }
  const matrix = new Map();
  for (const row of payload.data) {
    if (!Array.isArray(row?.dimensions) || row.dimensions.length < 2 || !Array.isArray(row?.metrics) || row.metrics.length < 1) {
      throw new DashboardError("Метрика вернула неполные данные retention. Обновите страницу позже.", "malformed");
    }
    const activityDate = safeDimensionDate(row.dimensions[0]);
    const cohortDate = safeDimensionDate(row.dimensions[1]);
    if (activityDate < window.retentionStart || activityDate > window.asOf || cohortDate < window.retentionStart || cohortDate > window.asOf || activityDate < cohortDate) {
      continue;
    }
    const cohort = matrix.get(cohortDate) ?? new Map();
    cohort.set(activityDate, Math.round(numberValue(row.metrics[0])));
    matrix.set(cohortDate, cohort);
  }

  const cohortDates = [...matrix.keys()].sort();
  const curve = Array.from({ length: RETENTION_CHECKPOINTS.at(-1) + 1 }, (_, day) => {
    let denominator = 0;
    let numerator = 0;
    for (const cohortDate of cohortDates) {
      const returnDate = isoDate(addDays(new Date(`${cohortDate}T00:00:00Z`), day));
      if (returnDate > window.asOf) continue;
      const cohort = matrix.get(cohortDate);
      const cohortSize = cohort.get(cohortDate) ?? 0;
      denominator += cohortSize;
      numerator += cohort.get(returnDate) ?? 0;
    }
    return {
      day,
      cohortSize: denominator,
      users: numerator,
      rate: denominator === 0 ? null : (numerator / denominator) * 100,
    };
  });

  const checkpoints = Object.fromEntries(RETENTION_CHECKPOINTS.map((day) => [`d${day}`, curve[day]]));
  const cohorts = cohortDates.slice(-14).reverse().map((date) => {
    const cohort = matrix.get(date);
    const size = cohort.get(date) ?? 0;
    return {
      date,
      size,
      checkpoints: Object.fromEntries(RETENTION_CHECKPOINTS.map((day) => {
        const returnDate = isoDate(addDays(new Date(`${date}T00:00:00Z`), day));
        return [`d${day}`, cellFor(size, cohort.get(returnDate) ?? 0, returnDate, window.asOf)];
      })),
    };
  });

  return { curve, checkpoints, cohorts, quality: qualityFrom(payload) };
}

async function requestMetrika(path, parameters, config, fetchImpl) {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `OAuth ${config.token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new DashboardError("Метрика отклонила доступ. Проверьте токен и права на счётчик.", "access");
      }
      if (response.status === 420 || response.status === 429) {
        throw new DashboardError("Метрика временно ограничила запросы. Попробуйте обновить позже.", "quota");
      }
      throw new DashboardError("Метрика временно недоступна. Попробуйте обновить позже.", "unavailable");
    }
    try {
      return await response.json();
    } catch {
      throw new DashboardError("Метрика вернула некорректный ответ. Попробуйте обновить позже.", "malformed");
    }
  } catch (error) {
    if (error instanceof DashboardError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DashboardError("Метрика не ответила вовремя. Попробуйте обновить позже.", "timeout");
    }
    throw new DashboardError("Не удалось получить данные Метрики. Попробуйте обновить позже.", "unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

const GOAL_CONFIGURATION_UNAVAILABLE = "Цель ещё не создана или не подтверждена в счётчике.";
const GOAL_REPORT_UNAVAILABLE = "Данные цели временно недоступны или ещё обрабатываются Метрикой.";
const MANIFEST_ENTRY_BY_SIGNAL = Object.freeze({
  candidateJoined: "candidateJoined",
  candidateActivity: "meaningfulCandidateActivity",
  verdictSaved: "verdictSaved",
});

function safeGoalId(value) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function activeGoal(goal) {
  return typeof goal?.status === "string" && goal.status.toLowerCase() === "active";
}

function actionTargets(goal) {
  if (goal?.type !== "action") return [];
  const conditions = Array.isArray(goal.conditions) ? goal.conditions : [];
  return [...new Set([
    goal.goal_id,
    goal.goalId,
    ...conditions.flatMap((condition) => [
      condition?.goal_id,
      condition?.goalId,
      condition?.type === "exact" ? condition?.url : undefined,
    ]),
  ].filter((value) => typeof value === "string" && value.length > 0))];
}

function unavailableGoalSignal({ key, label, description }, reason = GOAL_CONFIGURATION_UNAVAILABLE) {
  return { key, label, description, state: "unavailable", reason };
}

function manifestGoalForSignal(signalKey, manifest) {
  const manifestKey = MANIFEST_ENTRY_BY_SIGNAL[signalKey];
  if (!manifestKey || manifest === null) return null;
  const entry = manifest?.[manifestKey];
  const goalId = safeGoalId(entry?.id);
  return goalId !== null && typeof entry?.target === "string" ? { goalId, target: entry.target } : false;
}

function normaliseGoalIds(goalIds) {
  if (!Array.isArray(goalIds) || !goalIds.length) return null;
  const normalised = goalIds.map(safeGoalId);
  return normalised.every((goalId) => goalId !== null) && new Set(normalised).size === normalised.length ? normalised : null;
}

/**
 * Creates the internal resolved catalogue shape. It is exported only to make the
 * fixed report contract testable; callers must never send its goalIds to a browser.
 */
export function createInjectedProductGoalCatalogue(goalIdsByKey, catalogue = PRODUCT_GOAL_TARGET_CATALOGUE) {
  const signals = Object.fromEntries(catalogue.map((definition) => {
    const goalIds = normaliseGoalIds(goalIdsByKey?.[definition.key]);
    return [definition.key, goalIds
      ? { key: definition.key, label: definition.label, description: definition.description, state: "available", goalIds }
      : unavailableGoalSignal(definition)];
  }));
  return { signals };
}

export function resolveProductGoalCataloguePayload(payload, catalogue = PRODUCT_GOAL_TARGET_CATALOGUE, manifest = PRODUCT_METRIKA_GOAL_MANIFEST) {
  if (!Array.isArray(payload?.goals)) {
    return { signals: Object.fromEntries(catalogue.map((definition) => [definition.key, unavailableGoalSignal(definition)])) };
  }
  const goalsByTarget = new Map();
  for (const goal of payload.goals) {
    const goalId = safeGoalId(goal?.id);
    if (goalId === null) continue;
    for (const target of actionTargets(goal)) {
      const targets = goalsByTarget.get(target) ?? [];
      targets.push({ goalId, active: activeGoal(goal) });
      goalsByTarget.set(target, targets);
    }
  }
  const signals = Object.fromEntries(catalogue.map((definition) => {
    const goalIds = [];
    const manifestGoal = manifestGoalForSignal(definition.key, manifest);
    if (manifestGoal === false || (manifestGoal && (definition.targets.length !== 1 || definition.targets[0] !== manifestGoal.target))) {
      return [definition.key, unavailableGoalSignal(definition)];
    }
    for (const target of definition.targets) {
      const matches = goalsByTarget.get(target) ?? [];
      if (matches.length !== 1 || !matches[0].active || (manifestGoal && matches[0].goalId !== manifestGoal.goalId)) {
        return [definition.key, unavailableGoalSignal(definition)];
      }
      goalIds.push(matches[0].goalId);
    }
    return [definition.key, { key: definition.key, label: definition.label, description: definition.description, state: "available", goalIds }];
  }));
  return { signals };
}

export function createProductGoalCatalogueResolver({
  config,
  fetchImpl = fetch,
  now = () => Date.now(),
  ttlMs = PRODUCT_GOAL_CATALOGUE_TTL_MS,
  catalogue = PRODUCT_GOAL_TARGET_CATALOGUE,
  manifest = PRODUCT_METRIKA_GOAL_MANIFEST,
} = {}) {
  let cached = null;
  let inFlight = null;
  const unavailable = () => ({ signals: Object.fromEntries(catalogue.map((definition) => [definition.key, unavailableGoalSignal(definition)])) });
  return async function resolve() {
    const currentTime = now();
    if (cached && currentTime - cached.savedAt < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = requestMetrika(`/management/v1/counter/${config.counterId}/goals`, {}, config, fetchImpl)
      .then((payload) => resolveProductGoalCataloguePayload(payload, catalogue, manifest))
      .catch(() => unavailable())
      .then((value) => {
        cached = { value, savedAt: now() };
        return value;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function parseProductGoalReaches(payload, goalIds) {
  const metrics = payload?.data?.[0]?.metrics;
  if (!Array.isArray(metrics) || metrics.length !== goalIds.length) {
    throw new DashboardError("Метрика вернула неполные данные цели. Попробуйте обновить страницу позже.", "malformed");
  }
  return {
    reaches: Math.round(metrics.reduce((total, value) => total + numberValue(value), 0)),
    quality: qualityFrom(payload),
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadProductGoalSignals({ catalogue, common, reportWindow, config, fetchImpl }) {
  const definitions = PRODUCT_GOAL_TARGET_CATALOGUE;
  const resolvedSignals = definitions.map((definition) => catalogue.signals?.[definition.key] ?? unavailableGoalSignal(definition));
  const loadedSignals = await mapWithConcurrency(resolvedSignals, PRODUCT_GOAL_REPORT_CONCURRENCY, async (signal) => {
    if (signal.state !== "available") return signal;
    try {
      const payload = await requestMetrika("/stat/v1/data", {
        ...common,
        date1: reportWindow.dailyStart,
        date2: reportWindow.asOf,
        metrics: signal.goalIds.map((goalId) => `ym:s:goal${goalId}reaches`).join(","),
      }, config, fetchImpl);
      const parsed = parseProductGoalReaches(payload, signal.goalIds);
      return {
        key: signal.key,
        label: signal.label,
        description: signal.description,
        state: "available",
        reaches: parsed.reaches,
        quality: parsed.quality,
      };
    } catch {
      return unavailableGoalSignal(signal, GOAL_REPORT_UNAVAILABLE);
    }
  });
  const signals = Object.fromEntries(loadedSignals.map((signal) => [signal.key, signal]));
  const candidateJoined = signals.candidateJoined;
  const connectionLoss = signals.realtimeConnectionLoss;
  const recovery = signals.realtimeRecovery;
  const denominator = candidateJoined?.state === "available" ? candidateJoined.reaches : null;
  const hasReliabilitySignals = connectionLoss?.state === "available" && recovery?.state === "available" && denominator !== null && denominator > 0;
  const unavailableReliabilitySignal = [candidateJoined, connectionLoss, recovery].find((signal) => signal?.state !== "available");
  const publicSignal = ({ key, label, description, state, reaches, quality, reason }) => ({
    key,
    label,
    description,
    state,
    ...(state === "available" ? { reaches, quality } : { reason }),
  });
  const legacyGoalGroups = LEGACY_GOAL_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    overview: group.overviewKeys.map((key) => publicSignal(signals[key])),
    diagnostics: group.diagnosticKeys.map((key) => publicSignal(signals[key])),
  }));
  const productQuality = mergeQuality(...loadedSignals.filter((signal) => signal.state === "available").map((signal) => signal.quality));
  return {
    source: {
      kind: "metrika_browser_signal",
      label: "Метрика · браузерное событие",
      disclaimer: "Срабатывания целей относятся к браузерным визитам. Это не уникальные комнаты, не люди и не последовательная двухсторонняя воронка.",
    },
    signals,
    legacyGoalGroups,
    reliability: hasReliabilitySignals
      ? {
        state: "available",
        connectionLossReaches: connectionLoss.reaches,
        recoveryReaches: recovery.reaches,
        candidateJoinReaches: denominator,
        lossPerCandidateJoinRate: connectionLoss.reaches / denominator * 100,
        recoveryPerCandidateJoinRate: recovery.reaches / denominator * 100,
      }
      : {
        state: "unavailable",
        reason: denominator === 0
          ? "Нет срабатываний подключения кандидата для расчёта отношения."
          : unavailableReliabilitySignal?.reason ?? GOAL_REPORT_UNAVAILABLE,
      },
    quality: productQuality,
  };
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function summarizeSelectedPeriod(rows, periodUsers) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new DashboardError("Метрика вернула неполные данные активности. Обновите страницу позже.", "malformed");
  }
  const splitIndex = Math.ceil(rows.length / 2);
  const early = rows.slice(0, splitIndex);
  const recent = rows.slice(splitIndex);
  const earlyAverageDau = average(early.map((row) => row.users));
  const recentAverageDau = average(recent.map((row) => row.users));
  const deltaUsers = recentAverageDau - earlyAverageDau;
  const percentChange = earlyAverageDau === 0 ? null : deltaUsers / earlyAverageDau * 100;
  const highest = rows.reduce((current, row) => row.users > current.users ? row : current, rows[0]);
  const lowest = rows.reduce((current, row) => row.users < current.users ? row : current, rows[0]);
  return {
    periodUsers,
    periodNewUsers: rows.reduce((total, row) => total + row.newUsers, 0),
    averageDau: average(rows.map((row) => row.users)),
    highestDau: highest.users,
    highestDauDate: highest.date,
    lowestDau: lowest.users,
    lowestDauDate: lowest.date,
    activityComparison: {
      earlyStart: early[0].date,
      earlyEnd: early.at(-1).date,
      earlyAverageDau,
      recentStart: recent[0].date,
      recentEnd: recent.at(-1).date,
      recentAverageDau,
      deltaUsers,
      percentChange,
    },
  };
}

function commonParameters(config, window) {
  return {
    ids: config.counterId,
    accuracy: "full",
    timezone: window.timezoneOffset,
    lang: "en",
  };
}

export async function loadDashboardData(config, {
  fetchImpl = fetch,
  now = new Date(),
  periodDays,
  range,
  window,
  productGoalCatalogue,
  productGoalIds,
  resolveProductGoalCatalogue,
} = {}) {
  const reportWindow = window ?? createDashboardWindow(config.timezone, range ?? { periodDays: periodDays ?? DEFAULT_DASHBOARD_PERIOD_DAYS }, now);
  const common = commonParameters(config, reportWindow);
  const goalCatalogue = productGoalCatalogue
    ?? (productGoalIds ? createInjectedProductGoalCatalogue(productGoalIds) : await (resolveProductGoalCatalogue ?? createProductGoalCatalogueResolver({ config, fetchImpl }))());
  const [dailyPayload, periodUsersPayload] = await Promise.all([
    requestMetrika("/stat/v1/data/bytime", {
      ...common,
      date1: reportWindow.dailyStart,
      date2: reportWindow.asOf,
      group: "day",
      metrics: "ym:s:users,ym:s:newUsers",
    }, config, fetchImpl),
    requestMetrika("/stat/v1/data", {
      ...common,
      date1: reportWindow.dailyStart,
      date2: reportWindow.asOf,
      metrics: "ym:s:users",
    }, config, fetchImpl),
  ]);
  const [wauPayload, mauPayload] = await Promise.all([
    requestMetrika("/stat/v1/data", {
      ...common,
      date1: reportWindow.wauStart,
      date2: reportWindow.asOf,
      metrics: "ym:s:users",
    }, config, fetchImpl),
    requestMetrika("/stat/v1/data", {
      ...common,
      date1: reportWindow.mauStart,
      date2: reportWindow.asOf,
      metrics: "ym:s:users",
    }, config, fetchImpl),
  ]);
  const retentionPayload = await requestMetrika("/stat/v1/data", {
    ...common,
    date1: reportWindow.retentionStart,
    date2: reportWindow.asOf,
    dimensions: "ym:s:date,ym:s:firstVisitDate",
    metrics: "ym:s:users",
    filters: `ym:s:firstVisitDate >= '${reportWindow.retentionStart}'`,
    limit: RETENTION_MAX_ROWS,
    sort: "ym:s:date,ym:s:firstVisitDate",
  }, config, fetchImpl);

  const daily = parseDailyActivity(dailyPayload, reportWindow);
  const periodUsers = parseAggregateUsers(periodUsersPayload);
  const wau = parseAggregateUsers(wauPayload);
  const mau = parseAggregateUsers(mauPayload);
  const retention = buildRetention(retentionPayload, reportWindow);
  const productSignals = await loadProductGoalSignals({ catalogue: goalCatalogue, common, reportWindow, config, fetchImpl });
  const latest = daily.rows.at(-1);
  const selectedPeriod = summarizeSelectedPeriod(daily.rows, periodUsers.users);
  return {
    meta: {
      asOf: reportWindow.asOf,
      timezone: config.timezone,
      periodDays: reportWindow.periodDays,
      periodStart: reportWindow.dailyStart,
      retentionStart: reportWindow.retentionStart,
      retentionDays: reportWindow.retentionDays,
      rangeMode: reportWindow.rangeMode,
      latestCompletedDay: reportWindow.latestCompletedDay,
      refreshedAt: new Date(now).toISOString(),
    },
    summary: {
      dau: latest.users,
      newUsers: latest.newUsers,
      wau: wau.users,
      mau: mau.users,
      dauDate: latest.date,
      wauStart: reportWindow.wauStart,
      mauStart: reportWindow.mauStart,
      ...selectedPeriod,
    },
    daily: daily.rows,
    retention: {
      curve: retention.curve,
      checkpoints: retention.checkpoints,
      cohorts: retention.cohorts,
    },
    productSignals,
    quality: mergeQuality(daily.quality, periodUsers.quality, wau.quality, mau.quality, retention.quality, productSignals.quality),
  };
}

export function createDashboardService({ load, cacheKey = (range) => range?.cacheKey ?? JSON.stringify(range ?? { periodDays: DEFAULT_DASHBOARD_PERIOD_DAYS }), now = () => Date.now(), ttlMs = 300_000, minForcedRefreshMs = 60_000 }) {
  const cachedByPeriod = new Map();
  const inFlightByPeriod = new Map();
  const lastForcedRefreshAtByPeriod = new Map();
  async function get({ force = false, range, periodDays } = {}) {
    const selectedRange = range ?? { periodDays: periodDays ?? DEFAULT_DASHBOARD_PERIOD_DAYS };
    const selectedRangeKey = cacheKey(selectedRange);
    const currentTime = now();
    const cached = cachedByPeriod.get(selectedRangeKey);
    const lastForcedRefreshAt = lastForcedRefreshAtByPeriod.get(selectedRangeKey) ?? 0;
    const cacheIsFresh = cached && currentTime - cached.savedAt < ttlMs;
    if (cacheIsFresh && (!force || currentTime - lastForcedRefreshAt < minForcedRefreshMs)) {
      return { ...cached.data, meta: { ...cached.data.meta, cached: true } };
    }
    const inFlight = inFlightByPeriod.get(selectedRangeKey);
    if (inFlight) return inFlight;
    if (force) lastForcedRefreshAtByPeriod.set(selectedRangeKey, currentTime);
    const loading = Promise.resolve(load(selectedRange)).then((data) => {
      cachedByPeriod.set(selectedRangeKey, { data, savedAt: now() });
      return { ...data, meta: { ...data.meta, cached: false } };
    }).catch((error) => {
      if (cached) {
        return {
          ...cached.data,
          meta: { ...cached.data.meta, cached: true, stale: true, refreshError: "Не удалось обновить данные; показан последний успешный срез." },
        };
      }
      throw error;
    }).finally(() => {
      inFlightByPeriod.delete(selectedRangeKey);
    });
    inFlightByPeriod.set(selectedRangeKey, loading);
    return loading;
  }
  return { get };
}
