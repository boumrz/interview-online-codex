import { createHmac, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";

const testId = "teams/invitation-native-ax-lifecycle";
const witnessPhrase = "I WITNESS ONLY THE TEMPORARY BROWSER AND SINK";
const requiredOptIns = {
  E2E_TEAM_INVITATIONS_NATIVE_AX: "1",
  E2E_NATIVE_AX_LOCAL_ONLY: "1",
  E2E_NATIVE_AX_ALLOW_OS_FOCUS: "1",
  E2E_NATIVE_AX_TEST_ID: testId,
};

const phaseChecks = {
  ready: ["admitted", "leasesVerified", "manualWitness"],
  focus: ["sinkRaised", "browserBackgroundWitnessed", "browserRaised"],
  cleanup: ["normalCloseRequested", "ownedDescendantsExited", "descriptorCleanupCompleted"],
};

const forbiddenFields = new Set([
  "path",
  "pid",
  "parent",
  "executable",
  "argument",
  "ax",
  "url",
  "endpoint",
  "token",
  "credential",
  "cookie",
  "header",
  "idempotency",
  "capability",
  "marker",
  "identity",
  "diagnostic",
]);

function closedTe() {
  return { outcome: "TE", manualWitness: false, mayLaunch: false };
}

function validTestId(value) {
  return value === testId && !value.startsWith("/") && !value.includes("..");
}

function noLaunch(targets) {
  return targets;
}

export async function evaluateAdmission(input, { targets } = {}) {
  noLaunch(targets);
  if (
    input.platform !== "darwin"
    || input.ci
    || input.stdinIsTTY !== true
    || input.stdoutIsTTY !== true
    || !validTestId(input.testId)
    || input.toolchainAvailable !== true
    || input.displayAvailable !== true
    || input.accessibilityTrusted !== true
  ) {
    return closedTe();
  }
  for (const [key, value] of Object.entries(requiredOptIns)) {
    if (input.optIns?.[key] !== value) {
      return closedTe();
    }
  }
  return { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED", manualWitness: false, mayLaunch: false };
}

export async function confirmManualWitness(readLine, { source = "tty", targets } = {}) {
  noLaunch(targets);
  if (source !== "tty") {
    await readLine();
    return closedTe();
  }
  const supplied = await readLine();
  if (supplied !== witnessPhrase) {
    return closedTe();
  }
  return { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED", manualWitness: true, mayLaunch: true };
}

export function createCapability(rng = randomBytes) {
  const value = rng(32);
  const capability = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (capability.byteLength !== 32) {
    throw new Error("NATIVE_AX_CAPABILITY_RNG_NOT_256_BIT");
  }
  return capability;
}

function hmacHex(capability, domain, payload) {
  return createHmac("sha256", Buffer.from(capability))
    .update(domain)
    .update(payload)
    .digest("hex");
}

export function deriveProfileMarker(capability, { role, device, inode }) {
  return hmacHex(
    capability,
    "native-ax/profile-marker/v1",
    `${role}:${device}:${inode}`,
  );
}

export function createReceiptMac(capability, canonicalReceiptWithoutMac) {
  return hmacHex(capability, "native-ax/receipt/v1", canonicalReceiptWithoutMac);
}

function orderedReceipt(receipt) {
  return {
    version: receipt.version,
    testId: receipt.testId,
    phase: receipt.phase,
    outcome: receipt.outcome,
    timestampMs: receipt.timestampMs,
    checks: receipt.checks,
  };
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

export function encodeReceipt(capability, receipt) {
  const payload = orderedReceipt(receipt);
  const mac = createReceiptMac(capability, canonicalJson(payload));
  return `${canonicalJson({ ...payload, mac })}\n`;
}

function reject() {
  return { accepted: false, outcome: "TE" };
}

function stdoutToString({ stdout, stdoutBytes }) {
  if (stdoutBytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(stdoutBytes);
    } catch {
      return undefined;
    }
  }
  return typeof stdout === "string" ? stdout : "";
}

function hasDuplicateTopLevelKey(raw) {
  const matches = [...raw.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]);
  return new Set(matches).size !== matches.length;
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFields.has(key)) {
      return true;
    }
    if (containsForbiddenKey(child)) {
      return true;
    }
  }
  return false;
}

function validChecks(phase, checks) {
  const expected = phaseChecks[phase];
  if (!expected || !checks || typeof checks !== "object" || Array.isArray(checks)) {
    return false;
  }
  const keys = Object.keys(checks);
  return keys.length === expected.length
    && expected.every((key) => checks[key] === false || checks[key] === true)
    && keys.every((key) => expected.includes(key));
}

function stripMac(receipt) {
  const { mac: _mac, ...withoutMac } = receipt;
  return withoutMac;
}

export function validateReceipt(input) {
  if (input.stderr?.byteLength > 0) {
    return reject();
  }
  const stdout = stdoutToString(input);
  if (!stdout || Buffer.byteLength(stdout, "utf8") > 1024 || !stdout.endsWith("\n")) {
    return reject();
  }
  const trimmed = stdout.trimEnd();
  if (!trimmed || trimmed.includes("\n") || hasDuplicateTopLevelKey(trimmed)) {
    return reject();
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return reject();
  }
  const keys = Object.keys(parsed);
  const expectedKeys = ["version", "testId", "phase", "outcome", "timestampMs", "checks", "mac"];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    return reject();
  }
  if (
    parsed.version !== 1
    || parsed.testId !== testId
    || !["ready", "focus", "cleanup"].includes(parsed.phase)
    || !["TE", "LOCAL_MANUAL_WITNESS_REQUIRED"].includes(parsed.outcome)
    || !Number.isInteger(parsed.timestampMs)
    || parsed.timestampMs < 0
    || typeof parsed.mac !== "string"
    || !/^[0-9a-f]{64}$/.test(parsed.mac)
    || containsForbiddenKey(parsed)
    || !validChecks(parsed.phase, parsed.checks)
  ) {
    return reject();
  }
  const payload = stripMac(parsed);
  const expectedMac = createReceiptMac(input.capability, canonicalJson(payload));
  if (parsed.mac !== expectedMac) {
    return reject();
  }
  return { accepted: true, receipt: payload };
}
