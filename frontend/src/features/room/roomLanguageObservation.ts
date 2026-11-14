import { API_BASE_URL } from "../../config/runtime";
import { isAnalyticsEnabled, trackInterviewLanguageObservation } from "../../services/analytics";
import { roomRealtimeFetch } from "./roomRealtimeTransport";

type PublishedLanguage = {
  inviteCode: string;
  sessionId: string;
  role?: string;
  status?: string;
  eventToken?: string | null;
  taskId?: string | null;
  language?: string;
};

export function observePublishedInterviewLanguage({
  inviteCode, sessionId, role, status, eventToken, taskId, language,
}: PublishedLanguage): () => void {
  if (!isAnalyticsEnabled() || role !== "candidate" || (status && status !== "active") ||
    !eventToken || !taskId || !language) return () => {};

  const url = `${API_BASE_URL}/realtime/rooms/${encodeURIComponent(inviteCode)}/language-observations`;
  const body = JSON.stringify({ sessionId, eventToken, taskId, language });
  let current = true;
  let retryDelay = 1000;
  let retry: ReturnType<typeof setTimeout>;
  async function observe() {
    if (!current) return;
    try {
      const response = await roomRealtimeFetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 200) {
        // The server has claimed these goals. Even if the user just moved to
        // another step, the reply belongs to the task they already saw.
        trackInterviewLanguageObservation(language!, await response.json());
        return;
      }
      if (response.status < 500 && response.status !== 408 && response.status !== 429) return;
    } catch {
      // On temporary transport failures the server can safely deduplicate a retry.
    }
    if (current) {
      retry = setTimeout(observe, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  }
  queueMicrotask(observe);
  return () => {
    current = false;
    clearTimeout(retry);
  };
}
