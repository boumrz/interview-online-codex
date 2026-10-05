import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { triggerBrowserDownload } from "../../src/features/room/personalNotesPdfExport.ts";

async function workbookModule() {
  const source = await readFile(new URL("../../src/services/hrExport.ts", import.meta.url), "utf8");
  const rewritten = source
    .replace('import { API_BASE_URL } from "../config/runtime";', 'const API_BASE_URL = "/api";')
    .replace('from "./apiErrors"', `from ${JSON.stringify(new URL("../../src/services/apiErrors.ts", import.meta.url).href)}`);
  const compiled = ts.transpileModule(rewritten, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function browserGlobals(t: { after: (callback: () => void) => void }, values: Record<string, unknown>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

test("room download keeps the Blob URL usable until the browser has begun consuming it", (t) => {
  const events: string[] = [];
  const scheduled: Array<() => void> = [];
  const blob = new Blob(["Заметки хоста"], { type: "text/markdown;charset=utf-8" });
  const anchor = { href: "", download: "", click: () => events.push("clicked"), remove: () => events.push("removed") };
  t.mock.method(URL, "createObjectURL", (download: Blob) => { assert.strictEqual(download, blob); return "blob:room-export"; });
  t.mock.method(URL, "revokeObjectURL", (url: string) => { assert.equal(url, "blob:room-export"); events.push("revoked"); });
  t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => { assert.ok(delay >= 1000); scheduled.push(callback); return 1 as any; });
  browserGlobals(t, { document: { createElement: () => anchor, body: { appendChild: () => events.push("appended") } }, window: {} });

  triggerBrowserDownload(blob, "Заметки.md");

  assert.equal(anchor.download, "Заметки.md");
  assert.equal(anchor.href, "blob:room-export");
  assert.deepEqual(events, ["appended", "clicked", "removed"]);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(events, ["appended", "clicked", "removed", "revoked"]);
});

test("candidate workbook request uses the same team, track, vacancy and date selection as its list", async (t) => {
  const { downloadHrWorkbook } = await workbookModule();
  const requested: string[] = [];
  const anchor = { href: "", download: "", click: () => {}, remove: () => {} };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requested.push(url);
    return new Response(new Uint8Array([0x50, 0x4b, 1, 2]), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Interview-Count": "7" } });
  });
  t.mock.method(URL, "createObjectURL", () => "blob:workbook");
  t.mock.method(URL, "revokeObjectURL", () => {});
  browserGlobals(t, { document: { createElement: () => anchor, body: { appendChild: () => {} } }, window: { setTimeout: () => 1 } });

  const count = await downloadHrWorkbook({ token: "test-token", teamId: "team", trackId: "track", vacancyId: "vacancy", from: "2026-09-20", to: "2026-09-28" });

  assert.equal(count, 7);
  assert.equal(requested.length, 1);
  const params = new URL(requested[0], "http://localhost").searchParams;
  assert.deepEqual(Object.fromEntries(params), { teamId: "team", trackId: "track", vacancyId: "vacancy", from: "2026-09-20", to: "2026-09-28" });
});

test("candidate workbook network failures have readable connection feedback", async (t) => {
  const { downloadHrWorkbook } = await workbookModule();
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(downloadHrWorkbook({ token: "test-token" }), { message: "Ошибка сети. Проверьте подключение и повторите попытку." });
});

test("an interrupted workbook response shows a readable connection error", async (t) => {
  const { downloadHrWorkbook } = await workbookModule();
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("Failed to fetch")); },
  }), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }));
  await assert.rejects(downloadHrWorkbook({ token: "test-token" }), { message: "Ошибка сети. Проверьте подключение и повторите попытку." });
});

test("candidate workbook cancellation remains an abort and server internals remain hidden", async (t) => {
  const { downloadHrWorkbook } = await workbookModule();
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("aborted", "AbortError"); });
  await assert.rejects(downloadHrWorkbook({ token: "test-token" }), { name: "AbortError" });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "SQL connection failed" }), { status: 503, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(downloadHrWorkbook({ token: "test-token" }), { message: "Ошибка сервера. Повторите попытку позже.", status: 503 });
});
