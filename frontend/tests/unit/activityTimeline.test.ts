import assert from "node:assert/strict";
import test from "node:test";

type RawActivityEvent = {
  sourceEventId: string;
  acceptedSequence: number;
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

type ActivityTimelineGroup = {
  sessionId: string;
  sourceEventIds: string[];
  events: RawActivityEvent[];
};

type ActivityTimelineProjection = {
  reconcileActivityEvents(events: RawActivityEvent[]): RawActivityEvent[];
  projectActivityTimeline(events: RawActivityEvent[]): ActivityTimelineGroup[];
  formatActivityTimelineSummary(group: ActivityTimelineGroup): string;
  formatActivityTimelineParticipant(group: ActivityTimelineGroup, groups: ActivityTimelineGroup[]): string;
};

/**
 * The production helper is deliberately not present before section 4. These
 * dynamic imports keep this test a pure TypeScript/Node contract: no JSX,
 * browser, or React runtime is involved in the deterministic projection tests.
 */
async function loadProjection(): Promise<ActivityTimelineProjection> {
  return import("../../src/features/room/activityTimelineProjection.ts") as Promise<ActivityTimelineProjection>;
}

function event(
  sourceEventId: string,
  acceptedSequence: number,
  timestampEpochMs: number,
  overrides: Partial<RawActivityEvent> = {},
): RawActivityEvent {
  return {
    sourceEventId,
    acceptedSequence,
    timestampEpochMs,
    sessionId: "candidate-session-a",
    displayName: "Один и тот же кандидат",
    key: "",
    keyCode: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    eventKind: "keydown",
    ...overrides,
  };
}

function sourceIds(groups: ActivityTimelineGroup[]): string[][] {
  return groups.map((group) => group.sourceEventIds);
}

test("groups at the inclusive five-second boundary and starts at 5,001 ms", async () => {
  const { projectActivityTimeline } = await loadProjection();
  const groups = projectActivityTimeline([
    event("boundary-0", 1, 1_000, { key: "a", keyCode: "KeyA" }),
    event("boundary-4999", 2, 5_999, { key: "b", keyCode: "KeyB" }),
    event("boundary-5000", 3, 6_000, { key: "c", keyCode: "KeyC" }),
    event("boundary-5001", 4, 6_001, { key: "d", keyCode: "KeyD" }),
  ]);

  assert.deepEqual(sourceIds(groups), [
    ["boundary-5001"],
    ["boundary-0", "boundary-4999", "boundary-5000"],
  ]);
});

test("uses an anchored rather than sliding five-second grouping window", async () => {
  const { projectActivityTimeline } = await loadProjection();
  const groups = projectActivityTimeline([
    event("anchored-0", 1, 1_000, { key: "a", keyCode: "KeyA" }),
    event("anchored-4000", 2, 5_000, { key: "b", keyCode: "KeyB" }),
    event("anchored-8000", 3, 9_000, { key: "c", keyCode: "KeyC" }),
  ]);

  assert.deepEqual(sourceIds(groups), [
    ["anchored-8000"],
    ["anchored-0", "anchored-4000"],
  ]);
});

test("keeps same-name participants with different sessions in separate adjacent groups", async () => {
  const { projectActivityTimeline } = await loadProjection();
  const groups = projectActivityTimeline([
    event("session-a-first", 1, 1_000, { key: "a", keyCode: "KeyA" }),
    event("session-b", 2, 2_000, {
      sessionId: "candidate-session-b",
      displayName: "Один и тот же кандидат",
      key: "b",
      keyCode: "KeyB",
    }),
    event("session-a-last", 3, 3_000, { key: "c", keyCode: "KeyC" }),
  ]);

  assert.deepEqual(sourceIds(groups), [
    ["session-a-last"],
    ["session-b"],
    ["session-a-first"],
  ]);
});

test("adds a stable session qualifier only for duplicate candidate names", async () => {
  const { projectActivityTimeline, formatActivityTimelineParticipant } = await loadProjection();
  const groups = projectActivityTimeline([
    event("duplicate-a", 1, 1_000, { key: "a", keyCode: "KeyA", sessionId: "candidate-session-alpha" }),
    event("duplicate-b", 2, 2_000, { key: "b", keyCode: "KeyB", sessionId: "candidate-session-bravo" }),
    event("unique", 3, 3_000, {
      key: "c",
      keyCode: "KeyC",
      sessionId: "candidate-session-charlie",
      displayName: "Другой кандидат",
    }),
  ]);

  const duplicateLabels = groups
    .filter((group) => group.displayName === "Один и тот же кандидат")
    .map((group) => formatActivityTimelineParticipant(group, groups));
  assert.equal(new Set(duplicateLabels).size, 2, `duplicate labels must differ: ${duplicateLabels}`);
  assert.ok(duplicateLabels.every((label) => label.startsWith("Один и тот же кандидат · ")));
  assert.equal(
    formatActivityTimelineParticipant(groups.find((group) => group.displayName === "Другой кандидат")!, groups),
    "Другой кандидат",
  );
});

test("uses accepted sequence for equal timestamps and reconciles late and duplicate source IDs", async () => {
  const { reconcileActivityEvents, projectActivityTimeline } = await loadProjection();
  const reconciled = reconcileActivityEvents([
    event("late", 3, 3_000, { key: "c", keyCode: "KeyC" }),
    event("same-time-second", 2, 2_000, { key: "b", keyCode: "KeyB" }),
    event("same-time-first", 1, 2_000, { key: "a", keyCode: "KeyA" }),
    event("late", 3, 3_000, { key: "mutated", keyCode: "KeyM" }),
    event("early", 0, 1_000, { key: "z", keyCode: "KeyZ" }),
  ]);

  assert.deepEqual(
    reconciled.map((entry) => entry.sourceEventId),
    ["early", "same-time-first", "same-time-second", "late"],
  );
  assert.equal(reconciled.find((entry) => entry.sourceEventId === "late")?.key, "c");
  assert.deepEqual(sourceIds(projectActivityTimeline(reconciled)), [
    ["early", "same-time-first", "same-time-second", "late"],
  ]);
});

test("formats text, shortcuts, paste length, focus labels, and unknown input without a paste preview", async () => {
  const { projectActivityTimeline, formatActivityTimelineSummary } = await loadProjection();
  const group = projectActivityTimeline([
    event("text-h", 1, 1_000, { key: "h", keyCode: "KeyH" }),
    event("text-e", 2, 1_010, { key: "e", keyCode: "KeyE" }),
    event("text-l-1", 3, 1_020, { key: "l", keyCode: "KeyL" }),
    event("text-l-2", 4, 1_030, { key: "l", keyCode: "KeyL" }),
    event("text-o", 5, 1_040, { key: "o", keyCode: "KeyO" }),
    event("text-space", 6, 1_050, { key: " ", keyCode: "Space" }),
    event("text-w", 7, 1_060, { key: "w", keyCode: "KeyW" }),
    event("text-o-2", 8, 1_070, { key: "o", keyCode: "KeyO" }),
    event("text-r", 9, 1_080, { key: "r", keyCode: "KeyR" }),
    event("text-l-3", 10, 1_090, { key: "l", keyCode: "KeyL" }),
    event("text-d", 11, 1_100, { key: "d", keyCode: "KeyD" }),
    event("shortcut", 12, 1_110, {
      key: "z",
      keyCode: "KeyZ",
      ctrlKey: true,
    }),
    event("text-bang", 13, 1_120, { key: "!", keyCode: "Digit1", shiftKey: true }),
    event("paste", 14, 1_130, {
      eventKind: "paste",
      pasteLength: 42,
      pastePreview: "DO_NOT_EXPOSE_THIS_CLIPBOARD_CONTENT",
    }),
    event("focus", 15, 1_140, {
      eventKind: "window_blur",
      key: "Tab",
      keyCode: "Tab",
      altKey: true,
    }),
    event("tab-visible", 16, 1_150, { eventKind: "tab_visible" }),
    event("unknown", 17, 1_160, { key: "Unidentified", keyCode: "Unidentified" }),
  ])[0];
  const summary = formatActivityTimelineSummary(group);

  const requiredTokens = [
    "Набрано: «hello world»",
    "Ctrl+Z",
    "Набрано: «!»",
    "Вставка: 42 симв.",
    "Окно потеряло фокус",
    "Вкладка снова видима",
    "Неизвестный ввод",
  ];
  for (const token of requiredTokens) {
    assert.ok(summary.includes(token), `summary should include ${token}: ${summary}`);
  }
  assert.ok(
    summary.indexOf("Набрано: «hello world»") < summary.indexOf("Ctrl+Z") &&
      summary.indexOf("Ctrl+Z") < summary.indexOf("Набрано: «!»") &&
      summary.indexOf("Набрано: «!»") < summary.indexOf("Вставка: 42 симв."),
    `summary should preserve source action order: ${summary}`,
  );
  assert.ok(
    !summary.includes("DO_NOT_EXPOSE_THIS_CLIPBOARD_CONTENT"),
    `summary must not expose a paste preview: ${summary}`,
  );
});

test("collapses adjacent identical named actions with a count without losing their source order", async () => {
  const { projectActivityTimeline, formatActivityTimelineSummary } = await loadProjection();
  const group = projectActivityTimeline([
    event("backspace-first", 1, 1_000, { key: "Backspace", keyCode: "Backspace" }),
    event("backspace-second", 2, 1_010, { key: "Backspace", keyCode: "Backspace" }),
    event("enter", 3, 1_020, { key: "Enter", keyCode: "Enter" }),
    event("backspace-last", 4, 1_030, { key: "Backspace", keyCode: "Backspace" }),
  ])[0];
  const summary = formatActivityTimelineSummary(group);

  assert.ok(summary.includes("Backspace × 2"), `summary should count repeated actions: ${summary}`);
  assert.ok(
    summary.indexOf("Backspace × 2") < summary.indexOf("Enter") &&
      summary.indexOf("Enter") < summary.lastIndexOf("Backspace"),
    `summary should preserve actions after a collapsed run: ${summary}`,
  );
});
