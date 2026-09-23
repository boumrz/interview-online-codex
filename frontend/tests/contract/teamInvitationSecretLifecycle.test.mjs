import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";

const source = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

let tokenSource;
let managementSource;
let managementStyles;
let joinStyles;

before(async () => {
  [tokenSource, managementSource, managementStyles, joinStyles] = await Promise.all([
    source("src/features/workspace/teamInvitationToken.ts"),
    source("src/features/workspace/TeamInvitationManagement.tsx"),
    source("src/features/workspace/TeamInvitationManagement.module.css"),
    source("src/pages/workspace/TeamInvitationJoinPage.module.css"),
  ]);
});

test("AC-03 secret contract: invitee token uses only the exact tab-local sessionStorage key", () => {
  assert.match(tokenSource, /const SESSION_KEY = ["']interview-online:team-invitation["'];/);
  assert.doesNotMatch(tokenSource, /\b(?:let|var)\s+\w*(?:token|secret)\w*\s*:/i, "AC03_MODULE_GLOBAL_RAW_TOKEN_FORBIDDEN");
  assert.doesNotMatch(tokenSource, /localStorage|indexedDB/i, "AC03_INVITEE_TOKEN_MUST_NOT_USE_PERSISTENT_BROWSER_STORAGE");
});

test("AC-03 secret contract: URL-bearing create and reissue DTOs never enter invitation state", () => {
  assert.doesNotMatch(
    managementSource,
    /setInvitation\(\s*(?:created|replacement)\s*\)/,
    "AC03_URL_BEARING_INVITATION_DTO_IN_COMPONENT_STATE",
  );
});

test("AC-03 secret contract: recovery registry is metadata-only", () => {
  const registryStart = managementSource.indexOf("type PendingInvitationRecovery");
  const registryEnd = managementSource.indexOf("function publishPageRecovery", registryStart);
  assert.notEqual(registryStart, -1, "AC03_CREATE_RECOVERY_REGISTRY_MISSING");
  assert.notEqual(registryEnd, -1, "AC03_CREATE_RECOVERY_REGISTRY_BOUNDARY_MISSING");
  const registryDeclaration = managementSource.slice(registryStart, registryEnd);
  assert.doesNotMatch(registryDeclaration, /\burl\??\s*:|\.url\b/, "AC03_RECOVERY_REGISTRY_MUST_NOT_STORE_RAW_URL");
});

test("AC-03 intent contract: reissue and revoke retry paths cannot mint a fresh UUID", () => {
  const mutationStart = managementSource.indexOf("const runMutation");
  const mutationEnd = managementSource.indexOf("const revoke", mutationStart);
  assert.notEqual(mutationStart, -1, "AC03_MUTATION_HANDLER_MISSING");
  assert.notEqual(mutationEnd, -1, "AC03_MUTATION_HANDLER_BOUNDARY_MISSING");
  const mutation = managementSource.slice(mutationStart, mutationEnd);
  assert.match(mutation, /mutationIntentRef\.current\.get\(intentKey\)\s*\?\?\s*crypto\.randomUUID\(\)/);
  assert.match(mutation, /mutationIntentRef\.current\.set\(intentKey, idempotencyKey\)/);
  assert.match(mutation, /if \(!policy\.preserveIntent && intentKey\) mutationIntentRef\.current\.delete\(intentKey\)/);
});

test("AC-03 scope contract: invitation UI adds no phone/mobile media rules", () => {
  const viewportWidthMedia = /@media\s*\([^)]*(?:max-width|min-width|\bwidth\b)[^)]*\)/i;
  assert.doesNotMatch(managementStyles, viewportWidthMedia, "AC03_MANAGEMENT_PHONE_MOBILE_CSS_OUT_OF_SCOPE");
  assert.doesNotMatch(joinStyles, viewportWidthMedia, "AC03_JOIN_PHONE_MOBILE_CSS_OUT_OF_SCOPE");
});
