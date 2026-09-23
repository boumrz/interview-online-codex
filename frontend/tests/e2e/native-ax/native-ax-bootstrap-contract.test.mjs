import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const nativeRoot = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(
  path.join(nativeRoot, "fixtures/bootstrap-provenance-contract.json"),
  "utf8",
));
const bootstrapPath = path.join(nativeRoot, contract.bootstrapSource);
const bootstrapContractUrl = pathToFileURL(
  path.join(nativeRoot, "native-ax-bootstrap-protocol.mjs"),
).href;

async function bootstrapContract() {
  try {
    return await import(bootstrapContractUrl);
  } catch {
    assert.fail("NATIVE_AX_BOOTSTRAP_CONTRACT_SOURCE_MISSING");
  }
}

function readBootstrapSource() {
  assert.equal(
    existsSync(bootstrapPath),
    true,
    "NATIVE_AX_BOOTSTRAP_SOURCE_MISSING",
  );
  return readFileSync(bootstrapPath, "utf8");
}

function validLaunchInput(overrides = {}) {
  return {
    browserType: undefined,
    chromiumExecutablePath: "/tmp/native-ax/Chromium.app/Contents/MacOS/Chromium",
    profile: {
      path: "/tmp/native-ax/run/browser-profile",
      device: 100,
      inode: 200,
      mode: "0700",
      marker: "profile-marker",
    },
    wrapperPath: "/tmp/native-ax/BrowserLeaseBootstrap",
    ...overrides,
  };
}

function fakePublicBrowserType() {
  const calls = [];
  const browserType = {
    executablePath() {
      calls.push(["executablePath"]);
      return "/tmp/native-ax/Chromium.app/Contents/MacOS/Chromium";
    },
    launchPersistentContext(profileDirectory, options) {
      calls.push(["launchPersistentContext", profileDirectory, options]);
      return Promise.resolve({ close: async () => {} });
    },
    connectOverCDP() {
      calls.push(["connectOverCDP"]);
      throw new Error("NATIVE_AX_CONNECT_OVER_CDP_CALLED");
    },
  };
  Object.defineProperty(browserType, "_browser", {
    get() {
      calls.push(["privateField"]);
      throw new Error("NATIVE_AX_PRIVATE_PLAYWRIGHT_FIELD_READ");
    },
  });
  return { browserType, calls };
}

function validLeaseClaim(overrides = {}) {
  return {
    pid: 4242,
    birthTime: 10_000,
    executableRealpath: "/tmp/native-ax/Chromium.app/Contents/MacOS/Chromium",
    parentChain: [{ pid: 3000, birthTime: 9000 }],
    profile: {
      device: 100,
      inode: 200,
      mode: "0700",
      marker: "profile-marker",
    },
    recordCount: 1,
    ...overrides,
  };
}

test("native AX bootstrap plans only a public persistent-context launch", async () => {
  const { planPersistentBrowserLaunch } = await bootstrapContract();
  const { browserType, calls } = fakePublicBrowserType();
  const plan = await planPersistentBrowserLaunch(validLaunchInput({ browserType }));
  assert.deepEqual(
    {
      executablePath: plan.executablePath,
      userDataDir: plan.userDataDir,
      selectedBrowserRealpath: plan.selectedBrowserRealpath,
      exposesEndpoint: plan.exposesEndpoint,
      usesPrivatePlaywrightField: plan.usesPrivatePlaywrightField,
      usesProcessDiscovery: plan.usesProcessDiscovery,
    },
    {
      executablePath: "/tmp/native-ax/BrowserLeaseBootstrap",
      userDataDir: "/tmp/native-ax/run/browser-profile",
      selectedBrowserRealpath: "/tmp/native-ax/Chromium.app/Contents/MacOS/Chromium",
      exposesEndpoint: false,
      usesPrivatePlaywrightField: false,
      usesProcessDiscovery: false,
    },
    "NATIVE_AX_BOOTSTRAP_PUBLIC_PLAYWRIGHT_PLAN_MISMATCH",
  );
  assert.deepEqual(
    calls,
    [
      ["executablePath"],
      [
        "launchPersistentContext",
        "/tmp/native-ax/run/browser-profile",
        { executablePath: "/tmp/native-ax/BrowserLeaseBootstrap" },
      ],
    ],
    "NATIVE_AX_BOOTSTRAP_PUBLIC_PLAYWRIGHT_CALLS_MISMATCH",
  );
  for (const unsafe of [
    { chromiumExecutablePath: "" },
    { profile: { ...validLaunchInput().profile, mode: "0755" } },
    { profile: { ...validLaunchInput().profile, marker: "" } },
    { wrapperPath: "/usr/bin/open" },
    { launchOptions: { args: ["--remote-debugging-port=0"] } },
  ]) {
    assert.equal(
      (await planPersistentBrowserLaunch(validLaunchInput(unsafe))).outcome,
      "TE",
      "NATIVE_AX_BOOTSTRAP_UNSAFE_LAUNCH_ACCEPTED",
    );
  }
});

test("native AX bootstrap accepts exactly one fresh lease claim", async () => {
  const { validateBootstrapLeaseClaim } = await bootstrapContract();
  assert.deepEqual(
    validateBootstrapLeaseClaim({
      expected: validLaunchInput(),
      claim: validLeaseClaim(),
    }),
    { accepted: true, outcome: "LOCAL_MANUAL_WITNESS_REQUIRED" },
    "NATIVE_AX_BOOTSTRAP_VALID_CLAIM_REJECTED",
  );
  for (const [marker, claim] of [
    ["MISSING", undefined],
    ["DUPLICATE", validLeaseClaim({ recordCount: 2 })],
    ["STALE_PID", validLeaseClaim({ birthTime: 9999 })],
    ["WRONG_EXECUTABLE", validLeaseClaim({ executableRealpath: "/Applications/Chrome.app/Chrome" })],
    ["WRONG_PARENT", validLeaseClaim({ parentChain: [] })],
    ["WRONG_DEVICE", validLeaseClaim({ profile: { ...validLeaseClaim().profile, device: 101 } })],
    ["WRONG_INODE", validLeaseClaim({ profile: { ...validLeaseClaim().profile, inode: 201 } })],
    ["WRONG_MODE", validLeaseClaim({ profile: { ...validLeaseClaim().profile, mode: "0755" } })],
    ["WRONG_MARKER", validLeaseClaim({ profile: { ...validLeaseClaim().profile, marker: "other" } })],
    ["ENDPOINT", validLeaseClaim({ endpoint: "ws://127.0.0.1/devtools" })],
  ]) {
    assert.deepEqual(
      validateBootstrapLeaseClaim({ expected: validLaunchInput(), claim }),
      { accepted: false, outcome: "TE" },
      `NATIVE_AX_BOOTSTRAP_INVALID_CLAIM_ACCEPTED:${marker}`,
    );
  }
});

test("native AX bootstrap records one wrapper PID before execve", () => {
  const source = readBootstrapSource();
  for (const required of contract.requiredTokens) {
    assert.equal(
      source.includes(required),
      true,
      `NATIVE_AX_BOOTSTRAP_REQUIRED_TOKEN_MISSING:${required}`,
    );
  }
});

test("native AX bootstrap never gains focus or browser-discovery authority", () => {
  const source = readBootstrapSource();
  for (const forbidden of contract.forbiddenTokens) {
    assert.equal(
      source.includes(forbidden),
      false,
      `NATIVE_AX_BOOTSTRAP_FORBIDDEN_TOKEN_PRESENT:${forbidden}`,
    );
  }
});

test("native AX bootstrap contract remains an executable-wrapper boundary", () => {
  const source = readBootstrapSource();
  assert.equal(
    source.includes("BrowserLeaseBootstrap"),
    true,
    "NATIVE_AX_BOOTSTRAP_IDENTITY_MISSING",
  );
  assert.equal(
    source.includes("user-data-dir"),
    true,
    "NATIVE_AX_BOOTSTRAP_PROFILE_BOUNDARY_MISSING",
  );
});
