const GROUP_WINDOW_MS = 5_000;

/**
 * Kept local so the deterministic projection can run in Node's dependency-free
 * test harness. Room payloads are structurally compatible with this shape.
 */
export type ActivityTimelineEvent = {
  sourceEventId?: string;
  acceptedSequence?: number;
  sessionId: string;
  displayName: string;
  key: string;
  keyCode: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  timestampEpochMs: number;
  eventKind?: string;
  pasteLength?: number;
  pastePreview?: string;
};

export type ActivityTimelineGroup = {
  sessionId: string;
  displayName: string;
  sourceEventIds: string[];
  events: ActivityTimelineEvent[];
  startTimestampEpochMs: number;
  endTimestampEpochMs: number;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Old retained records can lack the additive source ID during a rolling
 * deployment. New records always use sourceEventId; this fallback is only to
 * keep an old state-sync readable until it is replaced by an authoritative one.
 */
function activityIdentity(event: ActivityTimelineEvent): string {
  if (event.sourceEventId?.trim()) return `source:${event.sourceEventId}`;
  return [
    "legacy",
    event.sessionId,
    finiteNumber(event.timestampEpochMs),
    finiteNumber(event.acceptedSequence),
    event.eventKind ?? "keydown",
    event.key,
    event.keyCode,
    event.ctrlKey ? "1" : "0",
    event.altKey ? "1" : "0",
    event.shiftKey ? "1" : "0",
    event.metaKey ? "1" : "0",
  ].join(":");
}

function canonicalCompare(left: ActivityTimelineEvent, right: ActivityTimelineEvent): number {
  return (
    finiteNumber(left.timestampEpochMs) - finiteNumber(right.timestampEpochMs) ||
    finiteNumber(left.acceptedSequence) - finiteNumber(right.acceptedSequence) ||
    activityIdentity(left).localeCompare(activityIdentity(right))
  );
}

/**
 * Deduplicates transports by their immutable source identity and returns the
 * order assigned by the server. The first copy wins intentionally: duplicate
 * delivery must never overwrite the accepted raw record with later client data.
 */
export function reconcileActivityEvents(events: ActivityTimelineEvent[]): ActivityTimelineEvent[] {
  const seen = new Set<string>();
  const unique: ActivityTimelineEvent[] = [];

  for (const event of events) {
    if (!event?.sessionId) continue;
    const identity = activityIdentity(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(event);
  }

  return unique.sort(canonicalCompare);
}

/**
 * Creates a display-only projection. The source event array is never mutated
 * and no grouping state is retained between calls, so late state-sync events
 * naturally recompute their correct canonical position.
 */
export function projectActivityTimeline(events: ActivityTimelineEvent[]): ActivityTimelineGroup[] {
  const groups: ActivityTimelineGroup[] = [];
  let openGroup: ActivityTimelineGroup | null = null;

  for (const event of reconcileActivityEvents(events)) {
    const timestampEpochMs = finiteNumber(event.timestampEpochMs);
    const isEligibleForOpenGroup =
      openGroup != null &&
      openGroup.sessionId === event.sessionId &&
      timestampEpochMs <= openGroup.startTimestampEpochMs + GROUP_WINDOW_MS;

    if (!isEligibleForOpenGroup) {
      openGroup = {
        sessionId: event.sessionId,
        displayName: event.displayName,
        sourceEventIds: event.sourceEventId ? [event.sourceEventId] : [],
        events: [event],
        startTimestampEpochMs: timestampEpochMs,
        endTimestampEpochMs: timestampEpochMs,
      };
      groups.push(openGroup);
      continue;
    }

    const currentGroup = openGroup;
    if (!currentGroup) continue;
    currentGroup.events.push(event);
    if (event.sourceEventId) currentGroup.sourceEventIds.push(event.sourceEventId);
    currentGroup.endTimestampEpochMs = timestampEpochMs;
  }

  return groups.reverse();
}

/**
 * Keeps normally unique candidate names compact, but distinguishes separate
 * sessions when a room contains identically named candidates. The suffix is a
 * stable short identifier rather than user-entered activity content.
 */
export function formatActivityTimelineParticipant(
  group: ActivityTimelineGroup,
  groups: ActivityTimelineGroup[],
): string {
  const displayName = group.displayName.trim() || "Кандидат";
  const hasSameNameDifferentSession = groups.some(
    (other) =>
      other.sessionId !== group.sessionId &&
      (other.displayName.trim() || "Кандидат") === displayName,
  );
  if (!hasSameNameDifferentSession) return displayName;

  const suffix = group.sessionId.trim().slice(-6) || "сессия";
  return `${displayName} · ${suffix}`;
}

function isPrintableKeydown(event: ActivityTimelineEvent): boolean {
  if ((event.eventKind ?? "keydown") !== "keydown") return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;

  const key = event.key ?? "";
  const normalized = key.trim();
  if (["", "Unidentified", "Dead", "Process", "Compose"].includes(normalized) && key !== " ") {
    return false;
  }
  if (/^[\u0000-\u001f\u007f]$/.test(key)) return false;
  return Array.from(key).length === 1;
}

function formatEventKey(event: ActivityTimelineEvent): string {
  const modifiers: string[] = [];
  const normalized = event.key === " " ? "Space" : event.key.trim() || event.keyCode.trim() || "Unknown";
  const isCtrl = normalized === "Control" || normalized === "Ctrl";
  const isAlt = normalized === "Alt";
  const isShift = normalized === "Shift";
  const isMeta = normalized === "Meta" || normalized === "Cmd" || normalized === "Command" || normalized === "OS";
  if (event.ctrlKey && !isCtrl) modifiers.push("Ctrl");
  if (event.altKey && !isAlt) modifiers.push("Alt");
  if (event.shiftKey && !isShift) modifiers.push("Shift");
  if (event.metaKey && !isMeta) modifiers.push("Cmd");

  const aliases: Record<string, string> = {
    Control: "Ctrl",
    Meta: "Cmd",
    Command: "Cmd",
    OS: "Cmd",
    Escape: "Esc",
    Spacebar: "Space",
  };
  const baseKey = (aliases[normalized] ?? normalized.replace(/^Arrow/, "")) || "Unknown";
  const key =
    (event.ctrlKey || event.altKey || event.metaKey) && Array.from(baseKey).length === 1
      ? baseKey.toUpperCase()
      : baseKey;
  return [...modifiers, key].join("+");
}

function isStandaloneModifier(event: ActivityTimelineEvent): boolean {
  if ((event.eventKind ?? "keydown") !== "keydown") return false;
  const label = formatEventKey(event);
  return label === "Ctrl" || label === "Alt" || label === "Shift" || label === "Cmd";
}

function stateLabel(eventKind: string): string | null {
  switch (eventKind) {
    case "window_blur":
      return "Окно потеряло фокус";
    case "window_focus":
      return "Окно снова в фокусе";
    case "tab_hidden":
      return "Вкладка стала скрытой";
    case "tab_visible":
      return "Вкладка снова видима";
    default:
      return null;
  }
}

function actionToken(event: ActivityTimelineEvent): string | null {
  const eventKind = event.eventKind ?? "keydown";
  if (eventKind === "paste") {
    const length = Math.max(0, Math.floor(finiteNumber(event.pasteLength)));
    return `Вставка: ${length} симв.`;
  }

  const focusLabel = stateLabel(eventKind);
  if (focusLabel) return focusLabel;

  if (eventKind !== "keydown") return `Неизвестное действие: ${eventKind}`;
  if (isStandaloneModifier(event)) return null;

  const keyLabel = formatEventKey(event);
  if (!keyLabel || keyLabel === "Unknown" || keyLabel === "Unidentified") {
    return "Неизвестный ввод";
  }
  return keyLabel;
}

/**
 * Produces plain text for a group without exposing paste previews. Text buffers
 * flush before every non-text token, preserving the exact source action order.
 */
export function formatActivityTimelineSummary(group: ActivityTimelineGroup): string {
  const tokens: Array<{ type: "text" | "action"; value: string; count?: number }> = [];
  let typedText = "";

  const flushTypedText = () => {
    if (!typedText) return;
    tokens.push({ type: "text", value: `Набрано: «${typedText}»` });
    typedText = "";
  };

  for (const event of group.events) {
    if (isPrintableKeydown(event)) {
      typedText += event.key;
      continue;
    }

    flushTypedText();
    const token = actionToken(event);
    if (!token) continue;
    const previous = tokens.at(-1);
    if (previous?.type === "action" && previous.value === token) {
      previous.count = (previous.count ?? 1) + 1;
      continue;
    }
    tokens.push({ type: "action", value: token });
  }
  flushTypedText();

  return tokens.length > 0
    ? tokens
        .map((token) =>
          token.type === "action" && (token.count ?? 1) > 1
            ? `${token.value} × ${token.count}`
            : token.value,
        )
        .join(" · ")
    : "Нет распознаваемых действий";
}
