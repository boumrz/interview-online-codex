import type { CandidateKeyInfo } from "./candidateKeys";

export type HistoryReadKind = "latest" | "older" | "catchup";

export type ActivityHistoryPage = {
  readonly events: CandidateKeyInfo[];
  readonly hasMore: boolean;
  readonly nextBeforeSequence: number | null;
  readonly nextAfterSequence: number | null;
  readonly throughSequence: number;
};

/** Older traversal and completed catch-up have independent, frozen boundaries. */
export type HistoryCursor = {
  readonly confirmedThrough: number | null;
  readonly olderBefore: number | null;
  readonly olderThrough: number | null;
  readonly catchupAfter: number | null;
  readonly catchupThrough: number | null;
};

export function createHistoryCursor(): HistoryCursor {
  return { confirmedThrough: null, olderBefore: null, olderThrough: null, catchupAfter: null, catchupThrough: null };
}

export function historyPageQuery(cursor: HistoryCursor, kind: HistoryReadKind): Record<string, string> {
  const query: Record<string, string> = { limit: "200" };
  if (kind === "older") {
    if (cursor.olderBefore == null || cursor.olderThrough == null) throw new Error("No older history page");
    query.beforeSequence = String(cursor.olderBefore);
    query.throughSequence = String(cursor.olderThrough);
  } else if (kind === "catchup") {
    if (cursor.confirmedThrough == null) throw new Error("History not initialized");
    query.afterSequence = String(cursor.catchupAfter ?? cursor.confirmedThrough);
    if (cursor.catchupThrough != null) query.throughSequence = String(cursor.catchupThrough);
  }
  return query;
}

export function advanceHistoryCursor(cursor: HistoryCursor, kind: HistoryReadKind, page: ActivityHistoryPage): HistoryCursor {
  if (kind === "catchup") {
    const after = cursor.catchupAfter ?? cursor.confirmedThrough;
    if (after == null || page.throughSequence < after ||
      (cursor.catchupThrough != null && page.throughSequence !== cursor.catchupThrough) ||
      (page.hasMore && (page.nextAfterSequence == null || page.nextAfterSequence <= after || page.nextAfterSequence >= page.throughSequence))) {
      throw new Error("Invalid history continuation");
    }
    return page.hasMore
      ? { ...cursor, catchupAfter: page.nextAfterSequence, catchupThrough: page.throughSequence }
      : { ...cursor, confirmedThrough: page.throughSequence, catchupAfter: null, catchupThrough: null };
  }
  if ((kind === "older" && page.throughSequence !== cursor.olderThrough) ||
    (page.hasMore && (page.nextBeforeSequence == null || page.nextBeforeSequence <= 0 ||
      (kind === "older" && page.nextBeforeSequence >= (cursor.olderBefore ?? 0))))) {
    throw new Error("Invalid older history continuation");
  }
  return {
    ...cursor,
    ...(kind === "latest" ? { confirmedThrough: page.throughSequence, olderThrough: page.throughSequence } : {}),
    olderBefore: page.hasMore ? page.nextBeforeSequence : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHistoryEvent(value: unknown): value is CandidateKeyInfo {
  return isRecord(value) &&
    typeof value.sourceEventId === "string" && value.sourceEventId.length > 0 &&
    isSequence(value.acceptedSequence) &&
    typeof value.sessionId === "string" && typeof value.displayName === "string" &&
    typeof value.key === "string" && typeof value.keyCode === "string" &&
    typeof value.ctrlKey === "boolean" && typeof value.altKey === "boolean" &&
    typeof value.shiftKey === "boolean" && typeof value.metaKey === "boolean" &&
    typeof value.timestampEpochMs === "number" && Number.isFinite(value.timestampEpochMs) &&
    (value.eventKind == null || typeof value.eventKind === "string") &&
    (value.pasteLength == null || typeof value.pasteLength === "number") &&
    (value.pastePreview == null || typeof value.pastePreview === "string");
}

/** Reject malformed data as a recoverable read error, never as empty history. */
export function parseActivityHistoryPage(value: unknown): ActivityHistoryPage {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 200 ||
    !value.events.every(isHistoryEvent) || typeof value.hasMore !== "boolean" ||
    !isSequence(value.throughSequence) ||
    !(value.nextBeforeSequence === null || isSequence(value.nextBeforeSequence)) ||
    !(value.nextAfterSequence === null || isSequence(value.nextAfterSequence))) {
    throw new Error("Invalid history response");
  }
  return {
    events: value.events, hasMore: value.hasMore, throughSequence: value.throughSequence,
    nextBeforeSequence: value.nextBeforeSequence, nextAfterSequence: value.nextAfterSequence,
  };
}
