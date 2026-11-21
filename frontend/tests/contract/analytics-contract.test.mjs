import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourcePath = new URL("../../src/services/analytics.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

async function loadAnalyticsModule() {
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${Math.random()}`);
}

function installBrowserStub(hostname = "interview.vtools.tech", listeners = new Map()) {
  const calls = [];
  globalThis.window = {
    location: {
      hostname,
      origin: `https://${hostname}`,
      pathname: "/",
    },
    dataLayer: [],
    ym: (...args) => calls.push(args),
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  globalThis.document = {
    scripts: [],
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };
  return calls;
}

test("confirmed completion reports only a finite nonnegative duration, including fractional and zero minutes", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  for (const minutes of [undefined, null, -3, Infinity, NaN, "12.5", 12.5, 0]) {
    analytics.trackCompletedInterviewDuration(minutes);
  }
  assert.deepEqual(calls.filter(call => call[1] === "reachGoal").map(call => call.slice(2)), [
    ["int_interview_duration_v1", { duration_minutes: 12.5 }],
    ["int_interview_duration_v1", { duration_minutes: 0 }],
  ]);
});

test("analytics keeps only approved event names and finite enum or bounded payload values", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();

  analytics.trackEvent(analytics.PRODUCT_METRIKA_EVENT.candidateJoined, {
    actor_role: "candidate",
    schema_version: "v1",
    participants: 2,
    next_path: "/room/sensitive-invite",
    free_text: "access-token-like-value",
    error_code: "https://example.test/room/sensitive-invite",
    nickname_len: -1,
  });
  analytics.trackEvent("unapproved_goal", { actor_role: "candidate" });

  const goalCalls = calls.filter((call) => call[1] === "reachGoal");
  assert.equal(goalCalls.length, 1);
  assert.deepEqual(goalCalls[0].slice(1), [
    "reachGoal",
    analytics.PRODUCT_METRIKA_EVENT.candidateJoined,
    { actor_role: "candidate", schema_version: "v1", participants: 2 },
  ]);
});

test("client error goals expose bounded diagnostic categories and deduplicate repeated failures", async () => {
  const calls = installBrowserStub();
  window.location.pathname = "/room/private-invite";
  document.referrer = "https://interview.vtools.tech/room/private-referrer?token=private-token";
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  analytics.trackClientError("whiteboard_load", "http_failure", 503);
  analytics.trackClientError("whiteboard_load", "http_failure", 503);
  analytics.trackClientError("whiteboard_load", "invalid_json", 200);
  analytics.trackClientError("whiteboard_load", "https://example.test/room/private-invite", 503);
  analytics.trackClientError("private-operation", "http_failure", 503);
  analytics.trackClientError("whiteboard_load", "toString", 503);
  analytics.trackClientError("whiteboard_load", "network_failure", "private-auth-token");
  analytics.trackEvent("client_error", { error_code: "network_error" });
  const goals = calls.filter(call => call[1] === "reachGoal");
  const options = calls.find(call => call[1] === "init")[2];
  assert.equal(options.defer, true);
  assert.equal(options.referrer, "https://interview.vtools.tech/room/:invite");
  const firstHit = calls.findIndex(call => call[1] === "hit");
  assert.ok(firstHit > 0 && firstHit < calls.indexOf(goals[0]));
  assert.deepEqual(calls[firstHit].slice(1), ["hit", "https://interview.vtools.tech/room/:invite", { referer: "https://interview.vtools.tech/room/:invite" }]);
  analytics.trackPageView(window.location.pathname);
  assert.equal(calls.filter(call => call[1] === "hit").length, 1);
  assert.equal(goals.length, 3);
  assert.deepEqual(goals.map(call => call[2]), Array(3).fill("client_error"));
  assert.deepEqual(goals[0][3], { client_error: { whiteboard_load: { response: { http_failure: { http_503: "Сервер вернул ошибку HTTP" } } } } });
  assert.deepEqual(goals[1][3], { client_error: { whiteboard_load: { decode: { invalid_json: { http_200: "Ответ не удалось прочитать как JSON" } } } } });
  assert.deepEqual(goals[2][3], { client_error: { whiteboard_load: { request: { network_failure: { none: "Не удалось получить ответ от сервера" } } } } });
  assert.doesNotMatch(JSON.stringify(calls), /private/);
});

test("unhandled errors report only a known JavaScript category and tolerate a failed analytics tag", async () => {
  const listeners = new Map();
  const calls = installBrowserStub("interview.vtools.tech", listeners);
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  const reason = new TypeError("private error with /room/private-invite and auth token");
  listeners.get("unhandledrejection")({ reason });
  const goal = calls.find(call => call[1] === "reachGoal");
  assert.deepEqual(goal?.slice(2), ["client_error", { client_error: { browser_rejection: { javascript: { type_error: { none: "JavaScript TypeError" } } } } }]);
  window.ym = () => { throw new Error("tag failure"); };
  assert.doesNotThrow(() => listeners.get("unhandledrejection")({ reason: new ReferenceError("private reference") }));
});

test("error goals wait for a safe page hit if the analytics tag throws on startup", async () => {
  const calls = installBrowserStub();
  const originalYm = window.ym;
  window.ym = (...args) => {
    if (args[1] === "hit") throw new Error("tag failure");
    originalYm(...args);
  };
  const analytics = await loadAnalyticsModule();
  assert.doesNotThrow(() => analytics.initAnalytics());
  analytics.trackClientError("whiteboard_load", "network_failure");
  assert.equal(calls.some(call => call[1] === "reachGoal"), false);
  window.ym = originalYm;
  analytics.trackPageView(window.location.pathname);
  analytics.trackClientError("whiteboard_load", "network_failure");
  assert.deepEqual(calls.map(call => call[1]), ["init", "hit", "reachGoal"]);
});

test("analytics redacts invite routes and rejects token-like values even in approved fields", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();

  analytics.trackPageView("/room/very-secret-invite?next=/dashboard");
  analytics.trackEvent(analytics.PRODUCT_METRIKA_EVENT.verdictSaved, {
    actor_role: "y0__token-shaped-value",
    verdict_code: "HIRE",
    has_comment: true,
    status_code: 600,
  });
  analytics.setVisitParams({ auth_status: "authenticated", entry_point: "https://example.test" });

  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes("very-secret-invite"), false);
  assert.equal(serialized.includes("next=/dashboard"), false);
  assert.equal(serialized.includes("y0__token-shaped-value"), false);

  const hit = calls.filter((call) => call[1] === "hit").at(-1);
  const verdict = calls.find((call) => call[1] === "reachGoal");
  const visitParams = calls.find((call) => call[1] === "params");
  assert.deepEqual(hit.slice(1), ["hit", "https://interview.vtools.tech/room/:invite", { referer: "https://interview.vtools.tech/" }]);
  assert.deepEqual(verdict.slice(1), ["reachGoal", analytics.PRODUCT_METRIKA_EVENT.verdictSaved, {
    verdict_code: "HIRE",
    has_comment: true,
  }]);
  assert.deepEqual(visitParams.slice(1), ["params", { auth_status: "authenticated" }]);
});

test("published task responses send exactly the server-awarded language goals", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  const observation = (language, firstForStep, firstForRoom, firstMultilanguageRoom = false) =>
    analytics.trackInterviewLanguageObservation(language, {
      language, firstForStep, firstForRoom, firstMultilanguageRoom,
      taskId: "private-task", sessionId: "private-session",
    });
  observation("python", true, true);
  observation("python", false, false);
  observation("python", true, false);
  observation("kotlin", true, true, true);
  observation("plaintext", true, true);
  observation("private-string", true, true, true);
  analytics.trackInterviewLanguageObservation("python", {
    language: "java", firstForStep: true, firstForRoom: true, firstMultilanguageRoom: true,
  });
  analytics.trackEvent("int_step_language_v1", { actor_role: "owner", language: "java" });
  analytics.trackEvent("int_multilanguage_room_v1", { step_index: 5 });
  assert.deepEqual(calls.filter(call => call[1] === "reachGoal").map(call => call.slice(2)), [
    ["int_step_language_v1", { language: "python" }],
    ["int_room_language_v1", { language: "python" }],
    ["int_step_language_v1", { language: "python" }],
    ["int_step_language_v1", { language: "kotlin" }],
    ["int_room_language_v1", { language: "kotlin" }],
    ["int_multilanguage_room_v1"],
    ["int_step_language_v1", { language: "plaintext" }],
    ["int_room_language_v1", { language: "plaintext" }],
  ]);
});

test("the first candidate edit is counted after an interviewer edit in the same room", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  const edit = analytics.createRoomCodeEditTracker(12);
  const goals = () => calls.filter(call => call[1] === "reachGoal").map(call => call.slice(2));

  edit("interviewer");
  edit("interviewer");
  assert.deepEqual(goals(), [["prod_first_code_edit"]]);
  edit("candidate");
  edit("candidate");
  edit("interviewer");
  edit("candidate");
  assert.deepEqual(goals(), [
    ["prod_first_code_edit"],
    ["int_meaningful_candidate_activity_v1", { actor_role: "candidate", schema_version: "v1" }],
  ]);
});

test("a different room starts fresh edit goals and candidate role changes do not duplicate them", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  const firstRoom = analytics.createRoomCodeEditTracker(12);
  firstRoom("candidate");
  firstRoom("interviewer");
  firstRoom("candidate");
  const secondRoom = analytics.createRoomCodeEditTracker(12);
  secondRoom("candidate");
  const ownerOnlyRoom = analytics.createRoomCodeEditTracker(12);
  ownerOnlyRoom("owner");
  assert.deepEqual(calls.filter(call => call[1] === "reachGoal").map(call => call[2]), [
    "prod_first_code_edit", "int_meaningful_candidate_activity_v1",
    "prod_first_code_edit", "int_meaningful_candidate_activity_v1",
    "prod_first_code_edit",
  ]);
});

test("workspace page hits and initialization expose only supported sections and a fixed team placeholder", async () => {
  const calls = installBrowserStub();
  window.location.pathname = "/workspace/teams/private-team/interviews/new";
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  assert.equal(calls.find(call => call[1] === "init")[2].url,
    "https://interview.vtools.tech/workspace/teams/:teamId/interviews/new");

  const routes = [
    ["/profile", "/profile"],
    ...["interviews", "interviews/new", "library", "candidates"].map(section =>
      [`/workspace/personal/${section}`, `/workspace/personal/${section}`]),
    ...["interviews", "interviews/new", "library", "candidates", "tracks", "settings", "members", "profile"].map(section =>
      [`/workspace/teams/private-team/${section}`, `/workspace/teams/:teamId/${section}`]),
    ["/workspace/personal/profile", "/other"],
    ["/workspace/teams/private-team/private-person", "/other"],
    ["/workspace/teams/private-team/candidates/private-person", "/other"],
    ["/join/team/private-invite", "/other"],
  ];
  for (const [path, expected] of routes) {
    analytics.trackPageView(`${path}?search=private-query#private-fragment`);
    assert.equal(calls.at(-1)[1], "hit");
    assert.equal(calls.at(-1)[2], `https://interview.vtools.tech${expected}`);
  }
  assert.doesNotMatch(JSON.stringify(calls), /private-/);
});

test("learning goals accept only fixed module actions and category values", async () => {
  const calls = installBrowserStub();
  const analytics = await loadAnalyticsModule();
  analytics.initAnalytics();
  analytics.trackLearningEvent("room", "first_start", { source: "help", attemptType: "first", skipped: true, version: 2 });
  analytics.trackLearningEvent("private-room-id", "first_start", { source: "help", attemptType: "first", skipped: true });
  analytics.trackLearningEvent("room", "secret", { source: "help", attemptType: "first", skipped: true });
  assert.deepEqual(calls.filter(call => call[1] === "reachGoal").map(call => call.slice(2)), [[
    "learn_room_first_start_v1", {
      learning_module: "room", learning_version: "v2", learning_source: "help",
      learning_attempt: "first", learning_previously_skipped: true,
    },
  ]]);
});
