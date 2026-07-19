const METRIKA_COUNTER_ID = 109032539;
const METRIKA_SCRIPT_URL = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_COUNTER_ID}`;
const DEFAULT_ALLOWED_HOSTS = ["interview.vtools.tech", "interview.domiknote.ru"];
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type PrimitiveMetricValue = string | number | boolean | null;
type MetricPayload = Record<string, PrimitiveMetricValue | undefined>;

type YmApi = {
  (counterId: number, method: string, ...args: unknown[]): void;
  a?: unknown[];
  l?: number;
};

declare global {
  interface Window {
    ym?: YmApi;
    dataLayer?: unknown[];
  }
}

/**
 * Product-conversion targets are deliberately separate from legacy diagnostic goals.
 * Their numeric Metrika IDs are resolved by the loopback dashboard server only.
 */
export const PRODUCT_METRIKA_EVENT = {
  candidateJoined: "int_candidate_joined_v1",
  meaningfulCandidateActivity: "int_meaningful_candidate_activity_v1",
  verdictSaved: "int_verdict_saved_v1",
} as const;

const LEGACY_EVENT_NAMES = new Set([
  "mkt_landing_view", "mkt_login_view", "mkt_register_submit", "mkt_login_submit",
  "mkt_register_validation_failed", "mkt_register_success", "mkt_register_failed",
  "mkt_login_success", "mkt_login_failed", "mkt_auth_mode_changed",
  "prod_guest_room_create_submit", "prod_guest_room_create_success", "prod_guest_room_create_failed",
  "prod_room_join_submit", "prod_dashboard_view", "prod_task_create_submit",
  "prod_task_create_success", "prod_task_create_failed", "prod_room_create_submit",
  "prod_room_create_success", "prod_room_create_failed", "prod_room_page_view",
  "prod_room_error", "prod_recovery_sync_completed", "prod_first_code_edit",
  "prod_room_opened", "prod_participants_count_changed", "prod_second_participant_joined",
  "prod_note_sent", "prod_room_tasks_add_submit", "prod_room_tasks_add_success",
  "prod_room_tasks_add_failed", "prod_room_custom_task_add_submit",
  "prod_room_custom_task_add_success", "prod_room_custom_task_add_failed",
  "prod_room_task_rename_submit", "prod_room_task_rename_success",
  "prod_room_task_rename_failed", "prod_room_task_delete_submit",
  "prod_room_task_delete_success", "prod_room_task_delete_failed",
  "prod_participant_role_grant_interviewer", "prod_participant_role_revoke_interviewer",
  "prod_candidate_name_submit_success", "prod_candidate_name_submit_failed",
  "prod_room_go_to_login", "prod_realtime_reconnect_scheduled", "prod_realtime_post_failed",
  "prod_realtime_post_rejected", "prod_state_sync_requested", "prod_realtime_connected",
  "prod_realtime_connection_lost", "prod_state_sync_received",
  "prod_recovery_state_sync_applied", "prod_realtime_server_error_message",
  "prod_realtime_message_parse_failed", "prod_editor_bootstrap_server_snapshot",
  "prod_editor_bootstrap_code_fallback", "prod_editor_bootstrap_code_rebuild",
  "prod_editor_bootstrap_missing_snapshot",
]);

const APPROVED_EVENT_NAMES = new Set<string>([
  ...LEGACY_EVENT_NAMES,
  ...Object.values(PRODUCT_METRIKA_EVENT),
]);

const APPROVED_PAYLOAD_FIELDS = new Set([
  "authenticated", "auth_status", "actor_role", "entry_point", "schema_version",
  "mode", "nickname_len", "reason", "has_api_message", "language",
  "task_language", "has_title", "has_display_name", "selected_tasks", "first_task_language",
  "tasks_count", "task_count_bucket", "title_len", "description_len", "step_index",
  "target_role", "has_target_user_id", "name_len", "section", "is_admin",
  "agent_ops_enabled", "dashboard_section", "can_manage_room", "has_realtime_state",
  "has_yjs_snapshot", "step", "participants", "delta", "yjs_sequence",
  "pending_messages", "status_code", "payload_type", "ready_state", "expect_hydration",
  "error_stage", "error_code", "verdict_code", "has_comment",
]);

const STRING_VALUE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  auth_status: new Set(["anonymous", "authenticated"]),
  actor_role: new Set(["owner", "interviewer", "candidate"]),
  entry_point: new Set(["landing", "login", "room", "dashboard", "guest", "direct_invite"]),
  schema_version: new Set(["v1"]),
  mode: new Set(["login", "register"]),
  reason: new Set(["password_too_short", "display_name_required", "nickname_required", "nickname_too_short", "nickname_has_space"]),
  language: new Set(["nodejs", "javascript", "typescript", "python", "java", "sql", "csharp", "cpp", "go", "php", "plaintext"]),
  first_task_language: new Set(["nodejs", "javascript", "typescript", "python", "java", "sql", "csharp", "cpp", "go", "php", "plaintext"]),
  task_language: new Set(["nodejs", "javascript", "typescript", "python", "java", "sql", "csharp", "cpp", "go", "php", "plaintext"]),
  task_count_bucket: new Set(["1", "2_3", "4_plus"]),
  target_role: new Set(["interviewer", "candidate"]),
  error_stage: new Set(["join", "editor", "realtime", "verdict"]),
  error_code: new Set(["room_state_error", "network_error", "server_error", "invalid_payload", "message_parse_failed"]),
  verdict_code: new Set(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]),
};

const NUMBER_LIMITS: Record<string, number> = {
  nickname_len: 32,
  selected_tasks: 50,
  tasks_count: 50,
  title_len: 200,
  description_len: 10_000,
  step_index: 100,
  name_len: 100,
  participants: 100,
  delta: 100,
  yjs_sequence: 1_000_000,
  pending_messages: 1_000,
  status_code: 599,
  ready_state: 3,
};

let initialized = false;
let enabled = false;
let activeHost = "";
let activePath = "";

function normalizeAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_HOSTS;
}

const allowedHosts = new Set(normalizeAllowedHosts(process.env.VITE_METRIKA_ALLOWED_HOSTS));

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOCAL_DEV_HOSTS.has(normalized) || normalized.endsWith(".local");
}

function shouldEnableCounter(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return Boolean(normalized) && !isLocalDevelopmentHost(normalized) && allowedHosts.has(normalized);
}

export function analyticsRouteTemplate(path: string): string {
  const pathname = path.trim().split(/[?#]/, 1)[0] || "/";
  if (/^\/room\/[^/]+\/?$/i.test(pathname)) return "/room/:invite";
  if (/^\/dashboard\/[^/]+\/?$/i.test(pathname)) return "/dashboard/:section";
  if (pathname === "/" || pathname === "/login" || pathname === "/dashboard") return pathname;
  return "/other";
}

function sanitizePayload(payload?: MetricPayload): Record<string, PrimitiveMetricValue> | undefined {
  if (!payload) return undefined;
  const cleaned: Record<string, PrimitiveMetricValue> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!APPROVED_PAYLOAD_FIELDS.has(key) || value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (STRING_VALUE_ALLOWLIST[key]?.has(value)) cleaned[key] = value;
      continue;
    }
    if (typeof value === "number") {
      const limit = NUMBER_LIMITS[key];
      if (Number.isFinite(value) && Number.isInteger(value) && value >= 0 && limit !== undefined && value <= limit) {
        cleaned[key] = value;
      }
      continue;
    }
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function warnBlockedEvent(method: string, eventName: string, payload?: MetricPayload) {
  if (typeof window === "undefined" || !isLocalDevelopmentHost(activeHost)) return;
  const cleanedPayload = sanitizePayload(payload);
  console.warn(`[analytics:${method}] blocked on local host`, {
    host: activeHost,
    path: activePath,
    event: eventName,
    ...(cleanedPayload ? { payload: cleanedPayload } : {}),
  });
}

function invokeYm(method: string, args: unknown[], options: { debugEvent: string; debugPayload?: MetricPayload }) {
  if (typeof window === "undefined") return;
  if (!enabled || typeof window.ym !== "function") {
    warnBlockedEvent(method, options.debugEvent, options.debugPayload);
    return;
  }
  window.ym(METRIKA_COUNTER_ID, method, ...args);
}

export function initAnalytics() {
  if (initialized || typeof window === "undefined" || typeof document === "undefined") return;
  initialized = true;
  activeHost = window.location.hostname.trim().toLowerCase();
  activePath = analyticsRouteTemplate(window.location.pathname);
  enabled = shouldEnableCounter(activeHost);
  if (!enabled) return;

  if (Array.isArray(window.dataLayer) === false) window.dataLayer = [];

  (function (m: Window, e: Document, t: string, r: string, i: string, k?: HTMLScriptElement, a?: Element | null) {
    const anyWindow = m as unknown as Record<string, unknown>;
    if (typeof anyWindow[i] !== "function") {
      const ymApi: YmApi = ((...args: unknown[]) => {
        (ymApi.a = ymApi.a || []).push(args);
      }) as YmApi;
      ymApi.l = Date.now();
      anyWindow[i] = ymApi;
    }
    for (let j = 0; j < document.scripts.length; j += 1) if (document.scripts[j].src === r) return;
    k = e.createElement(t) as HTMLScriptElement;
    a = e.getElementsByTagName(t)[0];
    if (!a?.parentNode) return;
    k.async = true;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, "script", METRIKA_SCRIPT_URL, "ym");

  window.ym?.(METRIKA_COUNTER_ID, "init", {
    ssr: true,
    webvisor: false,
    // Link and referrer telemetry can contain invite-bearing or third-party URLs.
    // Re-enable either only after a dedicated analytics privacy review.
    clickmap: false,
    ecommerce: "dataLayer",
    referrer: "",
    url: new URL(activePath, window.location.origin).toString(),
    accurateTrackBounce: true,
    trackLinks: false,
  });
}

export function trackPageView(path: string, payload?: MetricPayload) {
  const safePath = analyticsRouteTemplate(path);
  activePath = safePath;
  const options = sanitizePayload(payload);
  invokeYm("hit", options ? [safePath, options] : [safePath], { debugEvent: safePath, debugPayload: options });
}

export function trackEvent(goalId: string, payload?: MetricPayload) {
  const goal = goalId.trim();
  if (!APPROVED_EVENT_NAMES.has(goal)) return;
  const params = sanitizePayload(payload);
  invokeYm("reachGoal", params ? [goal, params] : [goal], { debugEvent: goal, debugPayload: params });
}

export function setVisitParams(payload: MetricPayload) {
  const params = sanitizePayload(payload);
  if (!params) return;
  invokeYm("params", [params], { debugEvent: "visit_params", debugPayload: params });
}

export function isAnalyticsEnabled() {
  return enabled;
}
