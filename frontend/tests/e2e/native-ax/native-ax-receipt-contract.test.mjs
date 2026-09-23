import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const nativeRoot = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(
  path.join(nativeRoot, "fixtures/receipt-contract.json"),
  "utf8",
));
const protocolUrl = pathToFileURL(path.join(nativeRoot, "native-ax-protocol.mjs")).href;

async function protocol() {
  try {
    return await import(protocolUrl);
  } catch {
    assert.fail("NATIVE_AX_PROTOCOL_SOURCE_MISSING");
  }
}

function syntheticCapability(byte) {
  return new Uint8Array(32).fill(byte);
}

function privacySinks() {
  const calls = [];
  return {
    calls,
    print(value) {
      calls.push(["print", value]);
    },
    persist(value) {
      calls.push(["persist", value]);
    },
    attach(value) {
      calls.push(["attach", value]);
    },
  };
}

function assertRejectedWithoutDisclosure(validateReceipt, input, marker) {
  const sinks = privacySinks();
  assert.deepEqual(
    validateReceipt({ ...input, sinks }),
    { accepted: false, outcome: "TE" },
    marker,
  );
  assert.deepEqual(sinks.calls, [], `${marker}:DISCLOSED_REJECTED_BYTES`);
}

const closedPhaseChecks = {
  ready: {
    admitted: false,
    leasesVerified: false,
    manualWitness: false,
  },
  focus: {
    sinkRaised: false,
    browserBackgroundWitnessed: false,
    browserRaised: false,
  },
  cleanup: {
    normalCloseRequested: false,
    ownedDescendantsExited: false,
    descriptorCleanupCompleted: false,
  },
};

test("native AX creates a fresh 256-bit capability and separates marker and receipt MAC domains", async () => {
  const { createCapability, deriveProfileMarker, createReceiptMac } = await protocol();
  const first = createCapability(() => syntheticCapability(1));
  const second = createCapability(() => syntheticCapability(2));
  assert.equal(first.byteLength, 32, "NATIVE_AX_CAPABILITY_NOT_256_BIT");
  assert.notDeepEqual(first, second, "NATIVE_AX_CAPABILITY_REUSED");
  const marker = deriveProfileMarker(first, { role: "browser", device: 10, inode: 20 });
  const receiptMac = createReceiptMac(first, JSON.stringify(contract.receipt));
  assert.notEqual(marker, receiptMac, "NATIVE_AX_MAC_DOMAIN_NOT_SEPARATED");
  assert.notEqual(
    deriveProfileMarker(first, { role: "sink", device: 10, inode: 20 }),
    marker,
    "NATIVE_AX_PROFILE_MARKER_ROLE_SUBSTITUTION_ACCEPTED",
  );
});

test("native AX accepts only one canonical privacy-safe receipt", async () => {
  const { encodeReceipt, validateReceipt } = await protocol();
  const capability = syntheticCapability(3);
  const line = encodeReceipt(capability, contract.receipt);
  assert.equal(Buffer.byteLength(line, "utf8") <= 1024, true, "NATIVE_AX_RECEIPT_OVERSIZE");
  assert.deepEqual(
    validateReceipt({ capability, stdout: line, stderr: new Uint8Array() }),
    { accepted: true, receipt: contract.receipt },
    "NATIVE_AX_CANONICAL_RECEIPT_REJECTED",
  );
  for (const field of contract.forbiddenFields) {
    const tampered = { ...contract.receipt, [field]: "redacted" };
    assert.deepEqual(
      validateReceipt({ capability, stdout: JSON.stringify(tampered), stderr: new Uint8Array() }),
      { accepted: false, outcome: "TE" },
      `NATIVE_AX_FORBIDDEN_RECEIPT_FIELD_ACCEPTED:${field}`,
    );
  }
});

test("native AX receipt schema is closed by phase and type", async () => {
  const { encodeReceipt, validateReceipt } = await protocol();
  const capability = syntheticCapability(5);
  for (const [phase, checks] of Object.entries(closedPhaseChecks)) {
    const receipt = { ...contract.receipt, phase, checks };
    assert.deepEqual(
      validateReceipt({ capability, stdout: encodeReceipt(capability, receipt), stderr: new Uint8Array() }),
      { accepted: true, receipt },
      `NATIVE_AX_PHASE_RECEIPT_REJECTED:${phase}`,
    );
    for (const tampered of [
      { ...receipt, phase: phase.toUpperCase() },
      { ...receipt, outcome: "GREEN" },
      { ...receipt, timestampMs: -1 },
      { ...receipt, timestampMs: "1735689600000" },
      { ...receipt, checks: { ...checks, unexpected: false } },
      { ...receipt, checks: Object.fromEntries(Object.entries(checks).slice(1)) },
      { ...receipt, checks: { ...checks, [Object.keys(checks)[0]]: "false" } },
      { ...receipt, version: "1" },
      { ...receipt, testId: "teams/other-native-ax" },
    ]) {
      assertRejectedWithoutDisclosure(
        validateReceipt,
        { capability, stdout: JSON.stringify(tampered), stderr: new Uint8Array() },
        `NATIVE_AX_CLOSED_SCHEMA_ACCEPTED:${phase}`,
      );
    }
  }
});

test("native AX discards stderr and every malformed or multiple receipt", async () => {
  const { encodeReceipt, validateReceipt } = await protocol();
  const capability = syntheticCapability(4);
  const valid = encodeReceipt(capability, contract.receipt);
  for (const stdout of [
    "",
    `${valid}\n${valid}`,
    JSON.stringify({ ...contract.receipt, mac: "invalid" }),
    `{"version":1,"version":1}`,
    "x".repeat(1025),
  ]) {
    assertRejectedWithoutDisclosure(
      validateReceipt,
      { capability, stdout, stderr: new Uint8Array() },
      "NATIVE_AX_INVALID_RECEIPT_ACCEPTED",
    );
  }
  assertRejectedWithoutDisclosure(
    validateReceipt,
    { capability, stdout: valid, stderr: new TextEncoder().encode("unexpected") },
    "NATIVE_AX_STDERR_NOT_DISCARDED",
  );
  assertRejectedWithoutDisclosure(
    validateReceipt,
    { capability, stdout: valid, stderr: new Uint8Array(65_536).fill(65) },
    "NATIVE_AX_STDERR_OVERFLOW_NOT_DISCARDED",
  );
  assertRejectedWithoutDisclosure(
    validateReceipt,
    { capability, stdoutBytes: new Uint8Array([0xff, 0xfe]), stderr: new Uint8Array() },
    "NATIVE_AX_INVALID_UTF8_ACCEPTED",
  );
});
