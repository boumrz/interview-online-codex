/**
 * Sync-логирование комнаты.
 *
 * Изначально жило inline в `RoomPage.tsx`. Вынесено отдельно, чтобы
 * `RoomPage`/`RoomCodeEditor` не тащили за собой логику чтения query/localStorage,
 * и чтобы один и тот же канал логов был доступен извлечённым модулям
 * (`RoomCodeEditor`, helpers awareness/yjs).
 *
 * Поведение управляется query-параметром `?syncLog=0|1` или ключом
 * `room_sync_log` в `localStorage` (любое значение, кроме `"0"`, считается
 * включённым). По умолчанию логирование включено в dev-сборках и не должно
 * ломать прод (выбрасываются в `console.info`).
 */

const ROOM_SYNC_LOG_QUERY_PARAM = "syncLog";
const ROOM_SYNC_LOG_STORAGE_KEY = "room_sync_log";

export function isRoomSyncLogEnabled(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get(ROOM_SYNC_LOG_QUERY_PARAM) === "0") return false;
    if (params.get(ROOM_SYNC_LOG_QUERY_PARAM) === "1") return true;
    return window.localStorage.getItem(ROOM_SYNC_LOG_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function roomSyncLog(
  event: string,
  payload?: Record<string, unknown>,
): void {
  if (!isRoomSyncLogEnabled()) return;
  const ts = new Date().toISOString();
  if (payload && Object.keys(payload).length > 0) {
    console.info(`[room-sync][${ts}] ${event}`, payload);
  } else {
    console.info(`[room-sync][${ts}] ${event}`);
  }
}
