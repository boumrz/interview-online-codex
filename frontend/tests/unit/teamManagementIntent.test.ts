import assert from "node:assert/strict";
import test from "node:test";
import {
  createManagementIntent,
  managementErrorKind,
} from "../../src/features/workspace/teamManagementIntent.ts";

test("management retry keeps one scoped idempotency key and original canonical body", () => {
  const body = { name: "Команда", revision: 7 };
  const intent = createManagementIntent(body, "4b0d3a48-2e4c-4c1a-824c-8f4f58c72f52");

  assert.deepEqual(intent, {
    idempotencyKey: "4b0d3a48-2e4c-4c1a-824c-8f4f58c72f52",
    body,
  });
  assert.deepEqual(intent.body, body);
});

test("management errors distinguish a preserved-draft CAS conflict from retryable transport failures", () => {
  assert.equal(
    managementErrorKind({ status: 409, data: { code: "MEMBER_REVISION_CONFLICT", currentRevision: 8 } }),
    "conflict",
  );
  assert.equal(managementErrorKind({ status: 503, data: { code: "TEAM_MANAGEMENT_BUSY" } }), "retryable");
  assert.equal(managementErrorKind({ status: 429, data: { code: "RATE_LIMITED" } }), "retryable");
  assert.equal(managementErrorKind({ status: "FETCH_ERROR" }), "retryable");
  assert.equal(managementErrorKind({ status: 403, data: { code: "TEAM_OWNER_REQUIRED" } }), "terminal");
});
