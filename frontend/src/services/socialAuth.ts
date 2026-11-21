import { API_BASE_URL } from "../config/runtime";

export type SocialConnection = {
  linked: boolean;
  available: boolean;
  canUnlink: boolean;
  requiresPassword: boolean;
};
export type SocialPending = {
  displayName: string;
  accountExists: boolean;
};

export const SOCIAL_INVITATION_RETURN_KEY = "interhub:social-invitation-return";

export async function socialRequest<T>(path: string, signal: AbortSignal, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(`${API_BASE_URL}/auth/social${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) throw { status: response.status, data };
    return data as T;
  } catch (error) {
    if (timedOut && !signal.aborted) throw { status: "TIMEOUT_ERROR" };
    if (error instanceof SyntaxError) throw { status: "PARSING_ERROR" };
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function readPending(data: unknown): SocialPending {
  if (!data || typeof data !== "object"
    || !("provider" in data) || data.provider !== "github"
    || !("displayName" in data) || typeof data.displayName !== "string"
    || !("accountExists" in data) || typeof data.accountExists !== "boolean") {
    throw { status: "PARSING_ERROR" };
  }
  return { displayName: data.displayName, accountExists: data.accountExists };
}

export function readGitHubConnection(value: unknown): SocialConnection {
  if (!value || typeof value !== "object" || !("connections" in value)
    || !Array.isArray(value.connections)) throw { status: "PARSING_ERROR" };
  const matches = value.connections.filter((item: unknown) => item && typeof item === "object"
    && "provider" in item && item.provider === "github");
  const item: unknown = matches[0];
  if (matches.length !== 1 || !item || typeof item !== "object"
    || !("linked" in item) || typeof item.linked !== "boolean"
    || !("available" in item) || typeof item.available !== "boolean"
    || !("canUnlink" in item) || typeof item.canUnlink !== "boolean"
    || (item.canUnlink && !item.linked)) throw { status: "PARSING_ERROR" };
  const requiresPassword = "requiresPassword" in item ? item.requiresPassword : false;
  if (typeof requiresPassword !== "boolean" || (requiresPassword && (!item.linked || item.canUnlink))) {
    throw { status: "PARSING_ERROR" };
  }
  return { linked: item.linked, available: item.available, canUnlink: item.canUnlink, requiresPassword };
}

export function assertGitHubLinked(value: unknown): void {
  if (!value || typeof value !== "object" || !("provider" in value) || value.provider !== "github"
    || !("linked" in value) || value.linked !== true) throw { status: "PARSING_ERROR" };
}

export function readAuthorizationUrl(data: unknown): string {
  if (!data || typeof data !== "object" || !("authorizationUrl" in data)
    || typeof data.authorizationUrl !== "string") throw { status: "PARSING_ERROR" };
  const url = new URL(data.authorizationUrl);
  if (`${url.origin}${url.pathname}` !== "https://github.com/login/oauth/authorize"
    || url.username || url.password || url.hash) {
    throw new Error("Invalid authorization URL");
  }
  return url.href;
}

export type SocialContinuation = { path: string; notice: string | null };

export function readRoomContextId(value: unknown): string {
  if (!value || typeof value !== "object" || !("contextId" in value)
    || typeof value.contextId !== "string" || !value.contextId) throw { status: "PARSING_ERROR" };
  return value.contextId;
}

export function readContinuation(value: unknown): SocialContinuation {
  if (!value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string"
    || (value.path !== "/workspace/personal/interviews" && !/^\/room\/[A-Za-z0-9_-]+$/.test(value.path))
    || !("notice" in value) || (value.notice !== null && typeof value.notice !== "string")) {
    throw { status: "PARSING_ERROR" };
  }
  return value as SocialContinuation;
}
