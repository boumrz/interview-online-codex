function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveApiBaseUrl(): string {
  const configured = process.env.VITE_API_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return trimTrailingSlashes(configured);
  }
  return "/api";
}

function resolveWsBaseUrl(): string {
  const configured = process.env.VITE_WS_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
      return trimTrailingSlashes(configured);
    }
    if (configured.startsWith("/")) {
      if (typeof window === "undefined") {
        return `ws://localhost:8080${trimTrailingSlashes(configured)}`;
      }
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${window.location.host}${trimTrailingSlashes(configured)}`;
    }
  }
  if (typeof window === "undefined") {
    return "ws://localhost:8080/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const WS_BASE_URL = resolveWsBaseUrl();
