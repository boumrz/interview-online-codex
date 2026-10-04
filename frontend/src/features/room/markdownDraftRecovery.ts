import { ChangeSet, Text } from "@codemirror/state";

export type MarkdownDraft = {
  base: string;
  value: string;
  /** Actual sent strings distinguish our delayed acknowledgements from peer edits. */
  sentValues: Set<string>;
};

export const createMarkdownDraft = (base: string, value: string): MarkdownDraft => ({
  base, value, sentValues: new Set(),
});

function markdownChange(base: string, value: string) {
  let from = 0;
  while (from < base.length && from < value.length && base[from] === value[from]) from += 1;
  let to = base.length;
  let end = value.length;
  while (to > from && end > from && base[to - 1] === value[end - 1]) { to -= 1; end -= 1; }
  return { from, to, insert: value.slice(from, end) };
}

/** Map local text changes across a canonical peer edit instead of replacing its full string. */
export function mergeMarkdownDraft(base: string, local: string, remote: string): string {
  if (local === remote || local === base) return remote;
  if (remote === base) return local;
  const localChange = markdownChange(base, local);
  const remoteChange = markdownChange(base, remote);
  if (localChange.insert && remoteChange.insert &&
      localChange.from < remoteChange.to && remoteChange.from < localChange.to) {
    // Concurrent replacements of the same original characters retain both
    // replacements. The manager can edit their combined text after recovery.
    const from = Math.min(localChange.from, remoteChange.from);
    const to = Math.max(localChange.to, remoteChange.to);
    return base.slice(0, from) + remote.slice(from, to + remote.length - base.length) +
      local.slice(from, to + local.length - base.length) + base.slice(to);
  }
  return ChangeSet.of(localChange, base.length)
    .map(ChangeSet.of(remoteChange, base.length))
    .apply(Text.of(remote.split("\n")))
    .toString();
}

export function receiveMarkdownSnapshot(draft: MarkdownDraft, remote: string): MarkdownDraft | null {
  if (remote === draft.value) return null;
  const ownAcknowledgement = draft.sentValues.has(remote);
  const sentValues = new Set(draft.sentValues);
  sentValues.delete(remote);
  return {
    base: remote,
    value: ownAcknowledgement ? draft.value : mergeMarkdownDraft(draft.base, draft.value, remote),
    sentValues,
  };
}
