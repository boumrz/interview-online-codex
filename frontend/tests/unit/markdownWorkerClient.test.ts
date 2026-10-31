import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarkdownWorkerClient } from "../../src/components/markdownWorkerClient.ts";
import type { MarkdownWorkerPort, MarkdownWorkerRequest } from "../../src/components/markdownWorkerProtocol.ts";

function createHarness(timeoutMs = 1_000) {
  const workers: MarkdownWorkerPort[] = [];
  const requests: MarkdownWorkerRequest[][] = [];
  const sanitized: string[] = [];
  const terminated: MarkdownWorkerPort[] = [];
  const client = createMarkdownWorkerClient(() => {
    const messages: MarkdownWorkerRequest[] = [];
    const worker: MarkdownWorkerPort = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(request) { messages.push(request); },
      terminate() { terminated.push(worker); },
    };
    requests.push(messages);
    workers.push(worker);
    return worker;
  }, (html) => {
    sanitized.push(html);
    return `safe:${html}`;
  }, timeoutMs);
  function reply(html: string, workerIndex = 0, requestIndex = 0) {
    const request = requests[workerIndex]?.[requestIndex];
    assert.ok(request);
    workers[workerIndex]?.onmessage?.({ data: { id: request.id, html } });
  }
  return { client, workers, requests, sanitized, terminated, reply };
}

function expectAbort(promise: Promise<string>) {
  return assert.rejects(promise, { name: "AbortError" });
}

test("HTML returned by the worker is sanitized before callers receive it", async () => {
  const h = createHarness();
  try {
    assert.equal(h.workers.length, 0);
    const result = h.client.render("# private title");
    assert.equal(h.workers.length, 1);
    assert.equal(h.requests[0]?.[0]?.markdown, "# private title");
    h.reply('<h1 style="color:red">private title</h1>');
    assert.equal(await result, 'safe:<h1 style="color:red">private title</h1>');
    assert.deepEqual(h.sanitized, ['<h1 style="color:red">private title</h1>']);
  } finally { h.client.dispose(); }
});

test("simultaneous identical documents share one render without a permanent cache", async () => {
  const h = createHarness();
  try {
    const a = h.client.render("same");
    const b = h.client.render("same");
    assert.equal(h.requests[0]?.length, 1);
    h.reply("<p>same</p>");
    assert.deepEqual(await Promise.all([a, b]), ["safe:<p>same</p>", "safe:<p>same</p>"]);
    assert.equal(h.sanitized.length, 1);
    const c = h.client.render("same");
    assert.equal(h.requests[0]?.length, 2);
    h.reply("<p>same</p>", 0, 1);
    await c;
  } finally { h.client.dispose(); }
});

test("cancelled intermediate drafts are dropped and stale output is never sanitized", async () => {
  const h = createHarness();
  try {
    const first = new AbortController();
    const second = new AbortController();
    const a = h.client.render("first", first.signal);
    const aRejected = expectAbort(a);
    first.abort();
    const b = h.client.render("intermediate", second.signal);
    const bRejected = expectAbort(b);
    const c = h.client.render("latest");
    second.abort();
    assert.equal(h.requests[0]?.length, 1);
    h.reply("<p>first</p>");
    assert.deepEqual(h.sanitized, []);
    assert.equal(h.requests[0]?.length, 2);
    assert.equal(h.requests[0]?.[1]?.markdown, "latest");
    h.reply("<p>latest</p>", 0, 1);
    assert.equal(await c, "safe:<p>latest</p>");
    await Promise.all([aRejected, bRejected]);
  } finally { h.client.dispose(); }
});

test("one cancelled consumer does not cancel another consumer of the same document", async () => {
  const h = createHarness();
  try {
    const controller = new AbortController();
    const cancelled = h.client.render("shared", controller.signal);
    const cancelledResult = expectAbort(cancelled);
    const remaining = h.client.render("shared");
    controller.abort();
    h.reply("shared");
    assert.equal(await remaining, "safe:shared");
    await cancelledResult;
    assert.equal(h.requests[0]?.length, 1);
  } finally { h.client.dispose(); }
});

test("different active documents run one at a time, newest active work first", async () => {
  const h = createHarness();
  try {
    const a = h.client.render("a");
    const b = h.client.render("b");
    const c = h.client.render("c");
    assert.equal(h.requests[0]?.length, 1);
    h.reply("a");
    assert.equal(h.requests[0]?.[1]?.markdown, "c");
    h.reply("c", 0, 1);
    assert.equal(h.requests[0]?.[2]?.markdown, "b");
    h.reply("b", 0, 2);
    assert.deepEqual(await Promise.all([a, b, c]), ["safe:a", "safe:b", "safe:c"]);
  } finally { h.client.dispose(); }
});

test("queued identical documents share a job and pre-aborted work is never posted", async () => {
  const h = createHarness();
  try {
    const controller = new AbortController();
    controller.abort();
    await expectAbort(h.client.render("cancelled", controller.signal));
    assert.equal(h.workers.length, 0);
    const active = h.client.render("active");
    const a = h.client.render("queued");
    const b = h.client.render("queued");
    h.reply("active");
    assert.equal(h.requests[0]?.length, 2);
    h.reply("queued", 0, 1);
    assert.deepEqual(await Promise.all([active, a, b]), ["safe:active", "safe:queued", "safe:queued"]);
  } finally { h.client.dispose(); }
});

test("worker crash rejects pending consumers and a future render creates a fresh worker", async () => {
  const h = createHarness();
  try {
    const a = h.client.render("private a");
    const b = h.client.render("private b");
    const failed = Promise.all([assert.rejects(a, /failed/i), assert.rejects(b, /failed/i)]);
    h.workers[0]?.onerror?.(new Error("crash private a"));
    await failed;
    assert.equal(h.terminated.length, 1);
    assert.deepEqual(h.sanitized, []);
    const retry = h.client.render("retry");
    assert.equal(h.workers.length, 2);
    h.reply("retry", 1);
    assert.equal(await retry, "safe:retry");
  } finally { h.client.dispose(); }
});

test("dispose rejects all work, ignores late replies, and prevents future rendering", async () => {
  const h = createHarness();
  const a = h.client.render("private");
  const b = h.client.render("queued");
  const lateReply = h.workers[0]?.onmessage;
  const rejected = Promise.all([assert.rejects(a, /disposed/i), assert.rejects(b, /disposed/i)]);
  h.client.dispose();
  h.client.dispose();
  await rejected;
  lateReply?.({ data: { id: h.requests[0]?.[0]?.id, html: "private" } });
  assert.deepEqual(h.sanitized, []);
  assert.equal(h.terminated.length, 1);
  await assert.rejects(h.client.render("future"), /disposed/i);
});

test("a stuck worker times out, clears pending work, and can be retried", async () => {
  const h = createHarness(10);
  try {
    const a = h.client.render("stuck");
    const b = h.client.render("queued");
    await Promise.all([assert.rejects(a, /timed out/i), assert.rejects(b, /timed out/i)]);
    assert.equal(h.terminated.length, 1);
    const retry = h.client.render("retry");
    h.reply("retry", 1);
    assert.equal(await retry, "safe:retry");
  } finally { h.client.dispose(); }
});

test("empty Markdown resolves without creating a worker or sanitizing", async () => {
  const h = createHarness();
  try {
    assert.equal(await h.client.render(" \r\n\t"), "");
    assert.equal(h.workers.length, 0);
    assert.deepEqual(h.sanitized, []);
  } finally { h.client.dispose(); }
});

test("malformed worker HTML is rejected rather than exposed to the sanitizer", async () => {
  const h = createHarness();
  try {
    const result = h.client.render("document");
    const rejected = assert.rejects(result, /failed/i);
    h.workers[0]?.onmessage?.({ data: { id: h.requests[0]?.[0]?.id, html: { unsafe: "HTML" } } });
    await rejected;
    assert.deepEqual(h.sanitized, []);
    assert.equal(h.terminated.length, 1);
  } finally { h.client.dispose(); }
});

test("worker-reported errors and message decode failures clear work without leaking private text", async () => {
  for (const failure of ["reported", "decode"]) {
    const h = createHarness();
    try {
      const result = h.client.render("private source");
      const rejected = assert.rejects(result, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /failed/i);
        assert.doesNotMatch(error.message, /private source/);
        return true;
      });
      if (failure === "reported") {
        h.workers[0]?.onmessage?.({ data: { id: h.requests[0]?.[0]?.id, error: "private source" } });
      } else {
        h.workers[0]?.onmessageerror?.("private source");
      }
      await rejected;
      assert.deepEqual(h.sanitized, []);
      assert.equal(h.terminated.length, 1);
    } finally { h.client.dispose(); }
  }
});

test("creation, posting, and sanitization failures reject safely and permit retry", async () => {
  for (const failure of ["create", "post", "sanitize"]) {
    const state = { fail: true };
    const posted: MarkdownWorkerRequest[] = [];
    const worker: MarkdownWorkerPort = {
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage(request) {
        if (state.fail && failure === "post") throw new Error("private source");
        posted.push(request);
      },
      terminate() {},
    };
    const client = createMarkdownWorkerClient(() => {
      if (state.fail && failure === "create") throw new Error("private source");
      return worker;
    }, (html) => {
      if (state.fail && failure === "sanitize") throw new Error("private source");
      return `safe:${html}`;
    });
    try {
      const result = client.render("private source");
      const rejected = assert.rejects(result, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /failed/i);
        assert.doesNotMatch(error.message, /private source/);
        return true;
      });
      if (failure === "sanitize") worker.onmessage?.({ data: { id: posted[0]?.id, html: "private source" } });
      await rejected;
      state.fail = false;
      const retry = client.render("retry");
      worker.onmessage?.({ data: { id: posted.at(-1)?.id, html: "retry" } });
      assert.equal(await retry, "safe:retry");
    } finally { client.dispose(); }
  }
});

test("late results from a failed worker and old job IDs cannot resolve current work", async () => {
  const h = createHarness();
  try {
    const a = h.client.render("first");
    const rejected = assert.rejects(a, /failed/i);
    const lateReply = h.workers[0]?.onmessage;
    h.workers[0]?.onerror?.(null);
    await rejected;
    const current = h.client.render("current");
    lateReply?.({ data: { id: h.requests[0]?.[0]?.id, html: "first" } });
    h.workers[1]?.onmessage?.({ data: { id: h.requests[0]?.[0]?.id, html: "old" } });
    assert.deepEqual(h.sanitized, []);
    h.reply("current", 1);
    assert.equal(await current, "safe:current");
  } finally { h.client.dispose(); }
});

test("malformed reply shapes fail closed and ignore private exception contents", async () => {
  for (const data of [null, "private", { id: -1, html: "private" }, { id: 1, html: "private", error: "private" }]) {
    const h = createHarness();
    try {
      const result = h.client.render("private");
      const rejected = assert.rejects(result, /failed/i);
      h.workers[0]?.onmessage?.({ data });
      await rejected;
      assert.deepEqual(h.sanitized, []);
    } finally { h.client.dispose(); }
  }
});
