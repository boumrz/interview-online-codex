import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const nativeRoot = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(
  path.join(nativeRoot, "fixtures/admission-contract.json"),
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

function admittedEnvironment(overrides = {}) {
  return {
    platform: "darwin",
    ci: "",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    testId: contract.testId,
    optIns: contract.optIns,
    toolchainAvailable: true,
    displayAvailable: true,
    accessibilityTrusted: true,
    ...overrides,
  };
}

function assertClosedTe(result, marker) {
  assert.deepEqual(result, {
    outcome: "TE",
    manualWitness: false,
    mayLaunch: false,
  }, marker);
}

function createLaunchSpy() {
  const calls = [];
  return {
    calls,
    createProfile() {
      calls.push("profile");
    },
    createSink() {
      calls.push("sink");
    },
    launchBrowser() {
      calls.push("browser");
    },
    startHelper() {
      calls.push("helper");
    },
  };
}

function assertNoLaunchSideEffects(spy, marker) {
  assert.deepEqual(spy.calls, [], marker);
}

test("native AX admission rejects every non-local precondition before launch", async () => {
  const { evaluateAdmission } = await protocol();
  for (const [marker, input] of [
    ["NON_DARWIN", admittedEnvironment({ platform: "linux" })],
    ["CI", admittedEnvironment({ ci: "1" })],
    ["STDIN_NOT_TTY", admittedEnvironment({ stdinIsTTY: false })],
    ["STDOUT_NOT_TTY", admittedEnvironment({ stdoutIsTTY: false })],
    ["TEST_ID", admittedEnvironment({ testId: "../teams/invitation-native-ax-lifecycle" })],
    ["TOOLCHAIN", admittedEnvironment({ toolchainAvailable: false })],
    ["DISPLAY", admittedEnvironment({ displayAvailable: false })],
    ["AX_TRUST", admittedEnvironment({ accessibilityTrusted: false })],
  ]) {
    assertClosedTe(await evaluateAdmission(input), `NATIVE_AX_ADMISSION_${marker}`);
  }
});

test("native AX admission never creates targets when a precondition fails", async () => {
  const { evaluateAdmission } = await protocol();
  for (const [marker, input] of [
    ["NON_DARWIN", admittedEnvironment({ platform: "linux" })],
    ["CI", admittedEnvironment({ ci: "1" })],
    ["STDIN_NOT_TTY", admittedEnvironment({ stdinIsTTY: false })],
    ["STDOUT_NOT_TTY", admittedEnvironment({ stdoutIsTTY: false })],
    ["ABSOLUTE_TEST_ID", admittedEnvironment({ testId: "/teams/invitation-native-ax-lifecycle" })],
    ["PARENT_TEST_ID", admittedEnvironment({ testId: "../teams/invitation-native-ax-lifecycle" })],
    ["UNALLOWLISTED_TEST_ID", admittedEnvironment({ testId: "teams/other-native-ax" })],
    ["TOOLCHAIN", admittedEnvironment({ toolchainAvailable: false })],
    ["DISPLAY", admittedEnvironment({ displayAvailable: false })],
    ["AX_TRUST", admittedEnvironment({ accessibilityTrusted: false })],
  ]) {
    const spy = createLaunchSpy();
    assertClosedTe(
      await evaluateAdmission(input, { targets: spy }),
      `NATIVE_AX_ADMISSION_${marker}`,
    );
    assertNoLaunchSideEffects(spy, `NATIVE_AX_ADMISSION_LAUNCHED_TARGET:${marker}`);
  }
});

test("native AX admission requires every exact opt-in", async () => {
  const { evaluateAdmission } = await protocol();
  for (const key of Object.keys(contract.optIns)) {
    const absent = { ...contract.optIns };
    delete absent[key];
    const missingSpy = createLaunchSpy();
    assertClosedTe(
      await evaluateAdmission(admittedEnvironment({ optIns: absent }), { targets: missingSpy }),
      `NATIVE_AX_ADMISSION_OPTIN_MISSING:${key}`,
    );
    assertNoLaunchSideEffects(missingSpy, `NATIVE_AX_ADMISSION_OPTIN_MISSING_LAUNCHED:${key}`);
    const wrongSpy = createLaunchSpy();
    assertClosedTe(
      await evaluateAdmission(admittedEnvironment({
        optIns: { ...contract.optIns, [key]: "wrong" },
      }), { targets: wrongSpy }),
      `NATIVE_AX_ADMISSION_OPTIN_WRONG:${key}`,
    );
    assertNoLaunchSideEffects(wrongSpy, `NATIVE_AX_ADMISSION_OPTIN_WRONG_LAUNCHED:${key}`);
  }
});

test("native AX accepts only the exact same-TTY witness phrase", async () => {
  const { confirmManualWitness } = await protocol();
  assert.deepEqual(
    await confirmManualWitness(async () => contract.witnessPhrase),
    { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED", manualWitness: true, mayLaunch: true },
    "NATIVE_AX_WITNESS_EXACT_PHRASE_REJECTED",
  );
  for (const supplied of [undefined, "", contract.witnessPhrase.toLowerCase(), `${contract.witnessPhrase} `]) {
    assertClosedTe(
      await confirmManualWitness(async () => supplied),
      "NATIVE_AX_WITNESS_INVALID_INPUT_ACCEPTED",
    );
  }
});

test("native AX rejects every non-TTY witness substitute and discards the phrase", async () => {
  const { confirmManualWitness } = await protocol();
  const substitutedInputs = [
    { marker: "ENV", source: "environment", readLine: async () => contract.witnessPhrase },
    { marker: "ARG", source: "argument", readLine: async () => contract.witnessPhrase },
    { marker: "FILE", source: "file", readLine: async () => contract.witnessPhrase },
    { marker: "BROWSER_CALLBACK", source: "browser-callback", readLine: async () => contract.witnessPhrase },
    { marker: "AUTOMATION", source: "automation", readLine: async () => contract.witnessPhrase },
    { marker: "EOF", source: "tty", readLine: async () => undefined },
    { marker: "CASE", source: "tty", readLine: async () => contract.witnessPhrase.toLowerCase() },
    { marker: "TRAILING_SPACE", source: "tty", readLine: async () => `${contract.witnessPhrase} ` },
  ];
  for (const input of substitutedInputs) {
    const spy = createLaunchSpy();
    const result = await confirmManualWitness(input.readLine, {
      source: input.source,
      targets: spy,
    });
    assertClosedTe(result, `NATIVE_AX_WITNESS_SUBSTITUTE_ACCEPTED:${input.marker}`);
    assertNoLaunchSideEffects(spy, `NATIVE_AX_WITNESS_SUBSTITUTE_LAUNCHED:${input.marker}`);
    assert.equal(
      Object.values(result).some((value) => value === contract.witnessPhrase),
      false,
      `NATIVE_AX_WITNESS_PHRASE_PERSISTED:${input.marker}`,
    );
  }
});
