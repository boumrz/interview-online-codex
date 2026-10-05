import { API_BASE_URL } from "../config/runtime";

export type SocialProvider = "google" | "vk";
export type SocialPending = {
  provider: SocialProvider;
  displayName: string;
  accountExists: boolean;
};

export const SOCIAL_INVITATION_RETURN_KEY = "interhub:social-invitation-return";

export async function socialRequest<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
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
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
    || !("provider" in data) || (data.provider !== "google" && data.provider !== "vk")
    || !("displayName" in data) || typeof data.displayName !== "string"
    || !("accountExists" in data) || typeof data.accountExists !== "boolean") {
    throw { status: "PARSING_ERROR" };
  }
  return data as SocialPending;
}

export function readAuthorizationUrl(data: unknown, provider: SocialProvider): string {
  if (!data || typeof data !== "object" || !("authorizationUrl" in data)
    || typeof data.authorizationUrl !== "string") throw { status: "PARSING_ERROR" };
  const url = new URL(data.authorizationUrl);
  const expected = provider === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : "https://id.vk.ru/authorize";
  if (`${url.origin}${url.pathname}` !== expected || url.username || url.password || url.hash) {
    throw new Error("Invalid authorization URL");
  }
  return url.href;
}
