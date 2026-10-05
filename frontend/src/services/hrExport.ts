import { API_BASE_URL } from "../config/runtime";
import { getApiErrorMessage } from "./apiErrors";

export class HrExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function fileNameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded).replaceAll(/[\\/]/g, "-");
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value)?.[1]?.trim();
  return plain ? plain.replaceAll(/[\\/]/g, "-") : null;
}

async function safeErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return getApiErrorMessage({ status: response.status, data: body }, "Не удалось подготовить Excel");
  } catch {
    return null;
  }
}

export async function downloadHrWorkbook({
  token,
  from,
  to,
  teamId,
  trackId,
  vacancyId,
  signal,
  isSessionCurrent,
}: {
  token: string;
  from?: string;
  to?: string;
  teamId?: string;
  trackId?: string;
  vacancyId?: string;
  signal?: AbortSignal;
  isSessionCurrent?: () => boolean;
}): Promise<number> {
  const assertCurrentSession = () => {
    if (signal?.aborted || (isSessionCurrent && !isSessionCurrent())) {
      throw new DOMException("Export aborted", "AbortError");
    }
  };
  const networkFailure = (error: unknown): never => {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new HrExportError(getApiErrorMessage(error, "Не удалось скачать Excel"), 0);
  };
  const params = new URLSearchParams();
  if (teamId) params.set("teamId", teamId);
  if (trackId) params.set("trackId", trackId);
  if (vacancyId) params.set("vacancyId", vacancyId);
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/me/hr/rooms/export${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  }).catch(networkFailure);
  if (!response.ok) {
    throw new HrExportError(
      (await safeErrorMessage(response)) ?? "Не удалось подготовить Excel",
      response.status,
    );
  }
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
    throw new HrExportError("Сервер вернул неверный формат файла", response.status);
  }
  const bytes = await response.arrayBuffer().catch(networkFailure);
  assertCurrentSession();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (bytes.byteLength < 2 || signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new HrExportError("Сервер вернул повреждённый файл", response.status);
  }
  const blob = new Blob([bytes], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const filename =
    fileNameFromDisposition(response.headers.get("Content-Disposition")) ??
    `hr-interviews-${fallbackDate}.xlsx`;
  try {
    assertCurrentSession();
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  const parsedCount = Number(response.headers.get("Interview-Count") ?? "0");
  return Number.isFinite(parsedCount) && parsedCount >= 0 ? Math.floor(parsedCount) : 0;
}
