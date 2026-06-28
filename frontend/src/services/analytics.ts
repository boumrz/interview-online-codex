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

const allowedHosts = new Set(
  normalizeAllowedHosts(process.env.VITE_METRIKA_ALLOWED_HOSTS),
);

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (LOCAL_DEV_HOSTS.has(normalized)) return true;
  return normalized.endsWith(".local");
}

function shouldEnableCounter(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (isLocalDevelopmentHost(normalized)) return false;
  return allowedHosts.has(normalized);
}

function sanitizePayload(
  payload?: MetricPayload,
): Record<string, PrimitiveMetricValue> | undefined {
  if (!payload) return undefined;
  const entries = Object.entries(payload).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, PrimitiveMetricValue>;
}

function warnBlockedEvent(
  method: string,
  eventName: string,
  payload?: MetricPayload,
) {
  if (typeof window === "undefined") return;
  const isLocalHost = isLocalDevelopmentHost(activeHost);
  if (!isLocalHost) return;
  const cleanedPayload = sanitizePayload(payload);
  if (cleanedPayload) {
    console.warn(`[analytics:${method}] blocked on local host`, {
      host: activeHost,
      path: activePath,
      event: eventName,
      payload: cleanedPayload,
    });
    return;
  }
  console.warn(`[analytics:${method}] blocked on local host`, {
    host: activeHost,
    path: activePath,
    event: eventName,
  });
}

function invokeYm(
  method: string,
  args: unknown[],
  options: { debugEvent: string; debugPayload?: MetricPayload },
) {
  if (typeof window === "undefined") return;
  if (!enabled || typeof window.ym !== "function") {
    warnBlockedEvent(method, options.debugEvent, options.debugPayload);
    return;
  }
  window.ym(METRIKA_COUNTER_ID, method, ...args);
}

export function initAnalytics() {
  if (
    initialized ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  )
    return;
  initialized = true;
  activeHost = window.location.hostname.trim().toLowerCase();
  activePath = `${window.location.pathname}${window.location.search}`;
  enabled = shouldEnableCounter(activeHost);
  if (!enabled) return;

  if (Array.isArray(window.dataLayer) === false) {
    window.dataLayer = [];
  }

  (function (
    m: Window,
    e: Document,
    t: string,
    r: string,
    i: string,
    k?: HTMLScriptElement,
    a?: Element | null,
  ) {
    const anyWindow = m as unknown as Record<string, unknown>;
    if (typeof anyWindow[i] !== "function") {
      const ymApi: YmApi = ((...args: unknown[]) => {
        (ymApi.a = ymApi.a || []).push(args);
      }) as YmApi;
      ymApi.l = Date.now();
      anyWindow[i] = ymApi;
    }
    for (let j = 0; j < document.scripts.length; j += 1) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t) as HTMLScriptElement;
    a = e.getElementsByTagName(t)[0];
    if (!a?.parentNode) return;
    k.async = true;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, "script", METRIKA_SCRIPT_URL, "ym");

  window.ym?.(METRIKA_COUNTER_ID, "init", {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: window.location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });
}

export function trackPageView(path: string, payload?: MetricPayload) {
  const sanitizedPath = path.trim();
  if (!sanitizedPath) return;
  activePath = sanitizedPath;
  const options = sanitizePayload(payload);
  if (options) {
    invokeYm("hit", [sanitizedPath, options], {
      debugEvent: sanitizedPath,
      debugPayload: options,
    });
    return;
  }
  invokeYm("hit", [sanitizedPath], {
    debugEvent: sanitizedPath,
  });
}

export function trackEvent(goalId: string, payload?: MetricPayload) {
  const goal = goalId.trim();
  if (!goal) return;
  const params = sanitizePayload(payload);
  if (params) {
    invokeYm("reachGoal", [goal, params], {
      debugEvent: goal,
      debugPayload: params,
    });
    return;
  }
  invokeYm("reachGoal", [goal], {
    debugEvent: goal,
  });
}

export function setUserParams(payload: MetricPayload) {
  const params = sanitizePayload(payload);
  if (!params) return;
  invokeYm("userParams", [params], {
    debugEvent: "user_params",
    debugPayload: params,
  });
}

export function setVisitParams(payload: MetricPayload) {
  const params = sanitizePayload(payload);
  if (!params) return;
  invokeYm("params", [params], {
    debugEvent: "visit_params",
    debugPayload: params,
  });
}

export function isAnalyticsEnabled() {
  return enabled;
}
