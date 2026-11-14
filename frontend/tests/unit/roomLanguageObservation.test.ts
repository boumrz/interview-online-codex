import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent(`export function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes('/frontend/src/') && specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
}`)}`, import.meta.url);

const { observePublishedInterviewLanguage } = await import("../../src/features/room/roomLanguageObservation.ts");
const { initAnalytics } = await import("../../src/services/analytics.ts");
const goalCalls: unknown[][] = [];
Object.assign(globalThis, {
  window: {
    location: { hostname: "interview.vtools.tech", pathname: "/", origin: "https://interview.vtools.tech" },
    ym: (...args: unknown[]) => { if (args[1] === "reachGoal") goalCalls.push(args.slice(2)); },
  },
  document: { scripts: [], createElement: () => ({}), getElementsByTagName: () => [] },
});
const published = { role: "candidate", status: "active", inviteCode: "private-room", sessionId: "private-session",
  eventToken: "private-token", taskId: "private-task", language: "kotlin" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("only a counted host and a candidate with an active published task claim observations", async t => {
  const post = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ language: "kotlin", firstForRoom: true, firstForStep: true, firstMultilanguageRoom: false }));
  observePublishedInterviewLanguage(published); // counter has not been initialized
  await tick();
  initAnalytics();
  for (const change of [{ role: "owner" }, { role: "interviewer" }, { status: "finished" }, { status: "frozen" },
    { taskId: null }, { eventToken: null }]) observePublishedInterviewLanguage({ ...published, ...change });
  const cancelled = observePublishedInterviewLanguage(published);
  cancelled(); // an effect remounted before the task was shown
  await tick();
  assert.equal(post.mock.callCount(), 0);
  observePublishedInterviewLanguage(published);
  await tick();
  assert.equal(post.mock.callCount(), 1);
  const [url, init] = post.mock.calls[0].arguments;
  assert.equal(url, "/api/realtime/rooms/private-room/language-observations");
  assert.equal(init?.credentials, "include");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    sessionId: "private-session", eventToken: "private-token", taskId: "private-task", language: "kotlin",
  });
  assert.deepEqual(goalCalls, [["int_step_language_v1", { language: "kotlin" }], ["int_room_language_v1", { language: "kotlin" }]]);
});

test("late success counts the already-observed task, stale and unauthorized claims are ignored", async t => {
  goalCalls.length = 0;
  let finish!: (response: Response) => void;
  const post = t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
  const leave = observePublishedInterviewLanguage(published);
  await tick();
  leave();
  finish(Response.json({ language: "kotlin", firstForStep: true, firstForRoom: false }));
  await tick();
  for (const status of [204, 403]) {
    observePublishedInterviewLanguage(published);
    await tick();
    finish(new Response(null, { status }));
    await tick();
  }
  assert.equal(post.mock.callCount(), 3);
  assert.deepEqual(goalCalls, [["int_step_language_v1", { language: "kotlin" }]]);
});

test("a transient failure retries while the published step is current", async t => {
  goalCalls.length = 0;
  const post = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  post.mock.mockImplementationOnce(async () => Response.json({ language: "kotlin", firstForRoom: true }), 1);
  const leave = observePublishedInterviewLanguage(published);
  try {
    await new Promise(resolve => setTimeout(resolve, 1150));
    assert.equal(post.mock.callCount(), 2);
    assert.deepEqual(goalCalls, [["int_room_language_v1", { language: "kotlin" }]]);
  } finally { leave(); }
});
