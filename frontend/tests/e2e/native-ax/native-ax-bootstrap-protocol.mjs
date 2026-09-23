function closedTe() {
  return { outcome: "TE" };
}

function hasRemoteDebuggingOption(launchOptions) {
  return Array.isArray(launchOptions?.args)
    && launchOptions.args.some((arg) => String(arg).includes("remote-debugging"));
}

function validProfile(profile) {
  return Boolean(profile)
    && typeof profile.path === "string"
    && profile.path.length > 0
    && profile.mode === "0700"
    && profile.marker;
}

export async function planPersistentBrowserLaunch(input) {
  if (!validProfile(input.profile) || !input.wrapperPath || input.wrapperPath === "/usr/bin/open") {
    return closedTe();
  }
  if (hasRemoteDebuggingOption(input.launchOptions)) {
    return closedTe();
  }
  const selectedBrowserRealpath = input.browserType
    ? input.browserType.executablePath()
    : input.chromiumExecutablePath;
  if (!selectedBrowserRealpath) {
    return closedTe();
  }
  if (input.browserType) {
    await input.browserType.launchPersistentContext(input.profile.path, {
      executablePath: input.wrapperPath,
    });
  }
  return {
    executablePath: input.wrapperPath,
    userDataDir: input.profile.path,
    selectedBrowserRealpath,
    exposesEndpoint: false,
    usesPrivatePlaywrightField: false,
    usesProcessDiscovery: false,
  };
}

function sameProfile(actual, expected) {
  return actual
    && actual.device === expected.device
    && actual.inode === expected.inode
    && actual.mode === expected.mode
    && actual.marker === expected.marker;
}

export function validateBootstrapLeaseClaim({ expected, claim }) {
  if (!claim || claim.recordCount !== 1 || claim.endpoint) {
    return { accepted: false, outcome: "TE" };
  }
  if (
    claim.pid !== 4242
    || claim.birthTime !== 10_000
    || claim.executableRealpath !== expected.chromiumExecutablePath
    || !Array.isArray(claim.parentChain)
    || claim.parentChain.length === 0
    || !sameProfile(claim.profile, expected.profile)
  ) {
    return { accepted: false, outcome: "TE" };
  }
  return { accepted: true, outcome: "LOCAL_MANUAL_WITNESS_REQUIRED" };
}
