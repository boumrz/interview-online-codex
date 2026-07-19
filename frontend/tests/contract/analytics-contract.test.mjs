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

function installBrowserStub(hostname = "interview.vtools.tech") {
  const calls = [];
  globalThis.window = {
    location: {
      hostname,
      origin: `https://${hostname}`,
      pathname: "/",
    },
    dataLayer: [],
    ym: (...args) => calls.push(args),
  };
  globalThis.document = {
    scripts: [],
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  };
  return calls;
}

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

  const hit = calls.find((call) => call[1] === "hit");
  const verdict = calls.find((call) => call[1] === "reachGoal");
  const visitParams = calls.find((call) => call[1] === "params");
  assert.deepEqual(hit.slice(1), ["hit", "/room/:invite"]);
  assert.deepEqual(verdict.slice(1), ["reachGoal", analytics.PRODUCT_METRIKA_EVENT.verdictSaved, {
    verdict_code: "HIRE",
    has_comment: true,
  }]);
  assert.deepEqual(visitParams.slice(1), ["params", { auth_status: "authenticated" }]);
});
