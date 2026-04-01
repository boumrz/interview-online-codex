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

export const API_BASE_URL = resolveApiBaseUrl();
