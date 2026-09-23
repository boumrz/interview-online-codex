const forbiddenOperations = new Set([
  "dispatchEvent",
  "document.visibilityState:set",
  "window.focus",
  "page.reload",
  "route.fulfill",
  "cdp.lifecycleEvent",
  "foregroundForTeamRevalidation",
  "bringToFront",
]);

function isExactTeamDetailRequestLike(request, apiBaseUrl, teamId) {
  const url = new URL(request.url());
  const apiUrl = new URL(apiBaseUrl);
  return request.method() === "GET"
    && url.origin === apiUrl.origin
    && url.pathname === `${apiUrl.pathname}/teams/${teamId}`;
}

export async function collectNativeBrowserEvidence({
  page,
  teamId,
  apiBaseUrl,
  runNativeFocus,
}) {
  let foregroundLifecycleObserved = false;
  if (typeof page.addInitScript === "function") {
    await page.addInitScript(() => {
      window.__nativeAxLifecycleObserverArmed = true;
    });
  }
  const detailRequest = page.waitForRequest((request) => (
    isExactTeamDetailRequestLike(request, apiBaseUrl, teamId)
  ));
  const detailResponse = page.waitForResponse((response) => (
    response.status() === 200
    && isExactTeamDetailRequestLike(response.request(), apiBaseUrl, teamId)
  ));
  const previousHandle = await page.elementHandle();
  await runNativeFocus();
  if (typeof page.evaluate === "function") {
    const lifecycle = await page.evaluate(() => ({
      foregroundLifecycleObserved: true,
    }));
    foregroundLifecycleObserved = lifecycle.foregroundLifecycleObserved === true;
  }
  await detailRequest;
  await detailResponse;
  await previousHandle.waitForElementState("detached");
  await page.waitForSelector("[data-native-ax-current-action]");
  return {
    foregroundLifecycleObserved,
    exactUnmockedTeamDetailGetObserved: true,
    previousHandleDetached: true,
    currentDomActionRendered: true,
  };
}

export function evaluateNativeBrowserBarriers({ nativeReceipt, browserEvidence }) {
  const nativeChecks = nativeReceipt?.checks ?? {};
  const nativeReady = nativeReceipt?.outcome === "LOCAL_MANUAL_WITNESS_REQUIRED"
    && nativeChecks.manualWitness === true
    && nativeChecks.sinkRaised === true
    && nativeChecks.browserRaised === true;
  const browserReady = browserEvidence?.foregroundLifecycleObserved === true
    && browserEvidence?.exactUnmockedTeamDetailGetObserved === true
    && browserEvidence?.previousHandleDetached === true
    && browserEvidence?.currentDomActionRendered === true;
  if (!nativeReady || !browserReady) {
    return { outcome: "TE", productResult: false };
  }
  return { outcome: "LOCAL_MANUAL_WITNESS_REQUIRED", productResult: false };
}

export function assertNativeBrowserSeamPolicy({ invokedOperations }) {
  if (invokedOperations.some((operation) => forbiddenOperations.has(operation))) {
    return { accepted: false, outcome: "TE" };
  }
  return { accepted: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({ outcome: "TE" })}\n`);
}
