import {
  Awareness,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { EditorView } from "@codemirror/view";

/**
 * Helpers по идентичности участника комнаты + утилиты для борьбы с
 * дубликатами в Yjs Awareness.
 *
 * Идея identity-key такая же, как в `ParticipantIdentity` на бэке:
 * 1) если есть `userId` — это аутентифицированный участник,
 * 2) иначе guest идентифицируется по `participantId`,
 * 3) в самом крайнем случае — по сессии.
 *
 * `dedupeRemoteAwarenessEntries` нужен после рефреша вкладки: Yjs выдаёт
 * новый clientID, а sessionId тот же → у пиров появляются «зомби-каретки».
 * Здесь мы оставляем «свежего» владельца и убираем старые состояния
 * (см. подробный комментарий ниже).
 */

export type AwarenessUser = {
  sessionId?: string;
  participantId?: string;
  userId?: string;
  name?: string;
  color?: string;
};

export function normalizeIdentityValue(
  value?: string | null,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function participantIdentityKey(input: {
  sessionId?: string | null;
  participantId?: string | null;
  userId?: string | null;
}): string | null {
  const userId = normalizeIdentityValue(input.userId);
  if (userId) return `user:${userId}`;
  const participantId = normalizeIdentityValue(input.participantId);
  if (participantId) return `guest:${participantId}`;
  const sessionId = normalizeIdentityValue(input.sessionId);
  if (sessionId) return `session:${sessionId}`;
  return null;
}

function hashSessionId(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function awarenessUserColors(sessionId: string): {
  color: string;
  colorLight: string;
} {
  const hue = hashSessionId(sessionId) % 360;
  return {
    color: `hsl(${hue} 68% 58%)`,
    colorLight: `hsla(${hue} 68% 58% / 0.24)`,
  };
}

/**
 * После рефреша вкладки Yjs выдаёт клиенту новый `clientID`, тогда как
 * realtime sessionId остаётся прежним. У пиров на короткое время висят
 * сразу две awareness-записи на одного и того же участника — отсюда
 * двойные удалённые каретки в редакторе.
 *
 * Победителя нельзя выбирать по `clock`: у мёртвой вкладки clock
 * замораживается на большом значении, у новой — обнуляется. Поэтому
 * приоритет — `meta.lastUpdated`: его «прокачивает» каждый входящий
 * awareness-апдейт, а у обрубленного клиента он перестаёт расти.
 *
 * Дополнительно дропаются «pre-sessionId»-призраки (старые клиенты, у
 * которых в `user` ещё нет `sessionId`).
 */
export function dedupeRemoteAwarenessEntries(awareness: Awareness): void {
  const localId = awareness.clientID;
  const localUser = (awareness.states.get(localId)?.user ?? undefined) as
    | AwarenessUser
    | undefined;

  const clockOf = (clientId: number) =>
    awareness.meta.get(clientId)?.clock ?? 0;
  const lastUpdatedOf = (clientId: number) =>
    awareness.meta.get(clientId)?.lastUpdated ?? 0;

  const hasSessionIdInUser = (st: { user?: unknown } | undefined) => {
    const sid = (st?.user as { sessionId?: string } | undefined)?.sessionId;
    return typeof sid === "string" && sid.trim().length > 0;
  };

  const remoteWinsOver = (newId: number, oldId: number) => {
    const luN = lastUpdatedOf(newId);
    const luO = lastUpdatedOf(oldId);
    if (luN !== luO) {
      return luN > luO;
    }
    const stN = awareness.states.get(newId);
    const stO = awareness.states.get(oldId);
    const sidN = hasSessionIdInUser(stN);
    const sidO = hasSessionIdInUser(stO);
    if (sidN !== sidO) {
      return sidN;
    }
    const cN = clockOf(newId);
    const cO = clockOf(oldId);
    if (cN !== cO) {
      return cN > cO;
    }
    return newId > oldId;
  };

  const awarenessIdentityKey = (
    user: AwarenessUser | undefined,
  ): string | null => {
    if (!user) return null;
    return (
      participantIdentityKey({
        userId: user.userId,
        participantId: user.participantId,
        sessionId: user.sessionId,
      }) ?? `legacy:${String(user.name ?? "")}|${String(user.color ?? "")}`
    );
  };
  const localIdentityKey = awarenessIdentityKey(localUser);
  const forEachRemoteAwarenessUser = (
    visitor: (clientId: number, key: string) => void,
  ) => {
    awareness.states.forEach((_state, clientId) => {
      if (clientId === localId) return;
      const st = awareness.states.get(clientId);
      const user = st?.user as AwarenessUser | undefined;
      if (!user) return;
      const key = awarenessIdentityKey(user);
      if (!key) return;
      visitor(clientId, key);
    });
  };

  const winnerByKey = new Map<string, number>();
  forEachRemoteAwarenessUser((clientId, key) => {
    if (localIdentityKey && key === localIdentityKey) return;
    const prev = winnerByKey.get(key);
    if (prev === undefined || remoteWinsOver(clientId, prev)) {
      winnerByKey.set(key, clientId);
    }
  });

  const toRemove = new Set<number>();
  forEachRemoteAwarenessUser((clientId, key) => {
    if (localIdentityKey && key === localIdentityKey) {
      toRemove.add(clientId);
      return;
    }
    if (winnerByKey.get(key) !== clientId) {
      toRemove.add(clientId);
    }
  });

  // Drop pre-sessionId ghosts when the same participant already has sessionId in awareness.
  const hasSessionId = new Set<string>();
  awareness.states.forEach((st, id) => {
    if (id === localId) return;
    const sid = (st?.user as { sessionId?: string } | undefined)?.sessionId;
    if (typeof sid === "string" && sid.trim()) {
      hasSessionId.add(
        `${String((st?.user as { name?: string }).name ?? "")}|${String((st?.user as { color?: string }).color ?? "")}`,
      );
    }
  });
  awareness.states.forEach((_state, clientId) => {
    if (clientId === localId) return;
    const st = awareness.states.get(clientId);
    const u = st?.user as
      | { sessionId?: string; name?: string; color?: string }
      | undefined;
    if (!u || (typeof u.sessionId === "string" && u.sessionId.trim())) return;
    const legacyKey = `${String(u.name ?? "")}|${String(u.color ?? "")}`;
    if (hasSessionId.has(legacyKey) && !toRemove.has(clientId)) {
      toRemove.add(clientId);
    }
  });

  if (toRemove.size > 0) {
    removeAwarenessStates(awareness, Array.from(toRemove), "local");
  }
}

/**
 * Удалённые каретки на тёмной теме `oneDark`: дефолтные стили
 * `y-codemirror.next` рассчитаны на светлый фон и плохо читаются.
 */
export const remoteCursorDarkTheme = EditorView.baseTheme({
  ".cm-ySelectionCaret": {
    borderLeft: "2px solid rgba(255,255,255,0.88)",
    borderRight: "none",
  },
  ".cm-ySelectionCaret::after": {
    display: "none !important",
    content: "none",
  },
  ".cm-ySelectionCaret::before": {
    display: "none !important",
    content: "none",
  },
  ".cm-ySelectionInfo": {
    display: "none !important",
  },
  ".cm-ySelectionInfo::before": {
    display: "none !important",
  },
  ".cm-ySelectionCaretDot": {
    display: "none !important",
  },
});
