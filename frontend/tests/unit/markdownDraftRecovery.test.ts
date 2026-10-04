import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMarkdownDraft, createMarkdownDraft, receiveMarkdownSnapshot } from "../../src/features/room/markdownDraftRecovery.ts";

test("concurrent Markdown insertions survive recovery without duplicates", () => {
  assert.equal(mergeMarkdownDraft("base", "base local", "remote base"), "remote base local");
  assert.equal(mergeMarkdownDraft("base", "base local", "base remote"), "base remote local");
  assert.equal(mergeMarkdownDraft("base", "base local", "base local"), "base local");
});

test("a delayed own acknowledgement retains the newer typed draft", () => {
  const draft = createMarkdownDraft("base", "base latest");
  draft.sentValues.add("base first");
  const next = receiveMarkdownSnapshot(draft, "base first");
  assert.equal(next?.value, "base latest");
  assert.equal(next?.base, "base first");
  assert.equal(receiveMarkdownSnapshot(next!, "base latest"), null);
});

test("repeated canonical snapshots do not repeatedly insert local text", () => {
  const draft = createMarkdownDraft("base", "base local");
  const rebased = receiveMarkdownSnapshot(draft, "remote base")!;
  assert.equal(rebased.value, "remote base local");
  assert.equal(receiveMarkdownSnapshot(rebased, "remote base")?.value, rebased.value);
});

test("concurrent replacement keeps both authors' replacement text", () => {
  assert.equal(mergeMarkdownDraft("base", "local", "remote"), "remotelocal");
});
