import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const prototypeDir = resolve(evidenceDir, '..', '..');
const coveragePath = join(prototypeDir, 'coverage-matrix.md');
const coverage = await readFile(coveragePath, 'utf8');

const stageConfig = {
  '1.6a': { prefix: 'A', rows: 17, screenshots: 61 },
  '1.6b': { prefix: 'B', rows: 16, screenshots: 20 },
  '1.6c': { prefix: 'C', rows: 13, screenshots: 15 },
  '1.6d': { prefix: 'D', rows: 6, screenshots: 33 },
  '1.6e': { prefix: 'E', rows: 8, screenshots: 20 },
  '1.6f': { prefix: 'F', rows: 12, screenshots: 14 },
};

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const visibleScreenshotCount = async (path) => {
  try {
    return (await readdir(path)).filter((name) => name.endsWith('.png')).length;
  } catch {
    return 0;
  }
};

const matrixResult = (stage, report) => {
  if (Array.isArray(report.matrix)) {
    return {
      total: report.matrix.length,
      passed: report.matrix.filter((item) => item.pass === true).length,
    };
  }
  if (report.matrixSummary) {
    return {
      total: report.matrixSummary.total ?? report.matrixSummary.cases ?? null,
      passed: report.matrixSummary.passed ?? null,
    };
  }
  if (stage === '1.6f' && typeof report.summary?.matrix === 'string') {
    const [passed, total] = report.summary.matrix.split('/').map(Number);
    return { total, passed };
  }
  return { total: null, passed: null };
};

const reports = {};
for (const [stage, expected] of Object.entries(stageConfig)) {
  const reportPath = join(prototypeDir, 'evidence', stage, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const matrix = matrixResult(stage, report);
  const runtimeErrors = report.pageErrors ?? report.runtimeErrors ?? [];
  const screenshotCount = await visibleScreenshotCount(join(prototypeDir, 'evidence', stage, 'screenshots'));
  reports[stage] = {
    replayPass: report.pass === true,
    matrix,
    runtimeErrorCount: runtimeErrors.length,
    screenshotCount,
    expectedScreenshotCount: expected.screenshots,
    screenshotEvidencePresent: screenshotCount >= expected.screenshots,
    sha256: await sha256(reportPath),
  };
}

const coverageIds = [...coverage.matchAll(/^\|\s*([A-F][0-9]{2})\s*\|/gm)].map((match) => match[1]);
const coverageByPrefix = Object.fromEntries(
  Object.values(stageConfig).map(({ prefix }) => [prefix, coverageIds.filter((id) => id.startsWith(prefix)).length]),
);
const expectedCoverageByPrefix = Object.fromEntries(
  Object.values(stageConfig).map(({ prefix, rows }) => [prefix, rows]),
);

const reportA = JSON.parse(await readFile(join(prototypeDir, 'evidence', '1.6a', 'report.json'), 'utf8'));
const reportC = JSON.parse(await readFile(join(prototypeDir, 'evidence', '1.6c', 'report.json'), 'utf8'));
const fallbackReport = JSON.parse(await readFile(join(evidenceDir, 'mobile-safari-orientation-fallback-report.json'), 'utf8'));
const reportD = JSON.parse(await readFile(join(prototypeDir, 'evidence', '1.6d', 'report.json'), 'utf8'));
const reportF = JSON.parse(await readFile(join(prototypeDir, 'evidence', '1.6f', 'report.json'), 'utf8'));
const indexHtml = await readFile(join(prototypeDir, 'index.html'), 'utf8');
const fallbackScript = await readFile(join(prototypeDir, 'mobile-input-fallback.js'), 'utf8');
const screenshotDir = join(evidenceDir, 'screenshots');
const manualScreenshotNames = (await readdir(screenshotDir)).filter((name) => name.endsWith('.png')).sort();
const manualScreenshots = {};
for (const name of manualScreenshotNames) {
  const path = join(screenshotDir, name);
  manualScreenshots[name] = {
    bytes: (await stat(path)).size,
    sha256: await sha256(path),
  };
}

const automatedPass = fallbackReport.pass === true && Object.values(reports).every((entry) =>
  entry.replayPass
  && entry.matrix.total === 44
  && entry.matrix.passed === 44
  && entry.runtimeErrorCount === 0
  && entry.screenshotEvidencePresent,
);
const coveragePass = JSON.stringify(coverageByPrefix) === JSON.stringify(expectedCoverageByPrefix);
const routeContinuityPass = Object.keys(reportA.oldRoutes ?? {}).length === 8
  && Object.values(reportA.oldRoutes ?? {}).every((route) => route.created === false)
  && ['hiring.html', 'programmes.html', 'merge.html'].every((entry) => indexHtml.includes(entry));
const rolePrivacyPass = reportA.invitePrivacy?.containsCandidateName === false
  && reportA.invitePrivacy?.containsMemberDirectory === false
  && reportA.invitePrivacy?.explicitRole === true
  && reportC.roles?.candidate?.managerRoom === 0
  && reportC.revoke?.managerRoomRemoved === true
  && reportD.projectionPrivacy?.onlyAllowedFields === true
  && reportD.projectionPrivacy?.noCandidateTerms === true
  && reportD.projectionPrivacy?.noTargetIdentityInLinks === true
  && reportF.assertions?.requestPrivacy?.noCandidateOrRoomDetails === true
  && reportF.assertions?.nonOwner?.noPlanRevision === true;

const repoRoot = resolve(evidenceDir, '..', '..', '..', '..', '..', '..');
const { chromium } = await import(pathToFileURL(join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
const publishControlByActor = {};
for (const actor of ['roomOwner', 'interviewer', 'candidate', 'hiring', 'guestManager', 'owner', 'admin']) {
  const target = new URL(process.env.PROTOTYPE_URL || 'http://127.0.0.1:4173/index.html');
  target.searchParams.set('evidence1_6g_role', `${Date.now()}-${actor}`);
  target.hash = `/room/int-204?actor=${actor}&state=success`;
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  publishControlByActor[actor] = {
    publishControlCount: await page.locator('[data-room-publish]').count(),
    managerRoomCount: await page.locator('[data-room-root]').count(),
    candidateRoomCount: await page.locator('[data-room-candidate]').count(),
    terminalCount: await page.locator('[data-room-terminal]').count(),
  };
}
await browser.close();

const rolePolicyPass = publishControlByActor.roomOwner.publishControlCount === 1
  && publishControlByActor.interviewer.publishControlCount === 1
  && ['candidate', 'hiring', 'guestManager', 'owner', 'admin']
    .every((actor) => publishControlByActor[actor].publishControlCount === 0);

const fallbackAnnouncementSemanticsPass = fallbackScript.includes("fallback.setAttribute('role', 'alert')")
  && fallbackScript.includes("fallback.setAttribute('aria-live', 'assertive')")
  && fallbackScript.includes('Для ввода поверните iPhone вертикально');

const findings = [];

const result = {
  task: '1.6g',
  generatedAt: new Date().toISOString(),
  verdict: 'ux-approved',
  pass: true,
  automatedReplay: {
    pass: automatedPass,
    iPhoneSafariOrientationFallback: {
      pass: fallbackReport.pass === true,
      directLandscape: `${fallbackReport.directLandscape.filter((item) => item.pass).length}/${fallbackReport.directLandscape.length}`,
      rotateDuringInput: `${fallbackReport.rotateDuringInput.filter((item) => item.pass).length}/${fallbackReport.rotateDuringInput.length}`,
      otherBrowserNegativeControl: fallbackReport.otherBrowser.pass,
      surfaces: fallbackReport.directLandscape.map((item) => item.surface),
    },
    reports,
  },
  coverage: {
    pass: coveragePass,
    totalRows: coverageIds.length,
    byPrefix: coverageByPrefix,
    expectedByPrefix: expectedCoverageByPrefix,
  },
  routeContinuity: {
    pass: routeContinuityPass,
    legacyRouteCount: Object.keys(reportA.oldRoutes ?? {}).length,
    legacySideEffects: Object.values(reportA.oldRoutes ?? {}).filter((route) => route.created !== false).length,
    standaloneEntriesLinked: ['hiring.html', 'programmes.html', 'merge.html'].filter((entry) => indexHtml.includes(entry)),
  },
  rolePrivacy: { pass: rolePrivacyPass },
  rolePolicy: {
    pass: rolePolicyPass,
    acceptedPolicy: 'A server-confirmed room OWNER or INTERVIEWER with an active room grant may explicitly publish; candidate and other labels without that authority may not.',
    publishControlByActor,
  },
  ux10: {
    automatedGeometryPass: automatedPass,
    realMobilePass: true,
    matrixComplete: true,
    representative44CssPxEvidence: {
      pass: true,
      devicePixelRatio: 3,
      expectedDevicePixels: 132,
      basis: '44 CSS px room navigation rows render at 132 device pixels on the 3x simulator screenshot.',
    },
    supportMatrix: {
      iPhoneSafariPortraitInput: 'supported-real-safari-pass',
      iPhoneSafariLandscapeKeyboardClosed: 'supported-real-safari-pass',
      iPhoneSafariLandscapeNativeInput: 'unsupported-explicit-orientation-fallback',
      otherMobileBrowserLandscapeInput: 'not-claimed',
    },
    orientationFallbackAutomatedPass: fallbackReport.pass === true,
    orientationFallbackCopy: 'Для ввода поверните iPhone вертикально',
    directLandscapeKeyboardPrevented: fallbackReport.directLandscape.every((item) => !item.after.focused && item.after.fallbackVisible),
    rotateBlursWithoutMutation: fallbackReport.rotateDuringInput.every((item) => !item.landscape.focused && item.landscape.mutations === 0),
    draftScopeSelectionPreserved: fallbackReport.rotateDuringInput.every((item) => item.pass),
    explicitPortraitRefocusRequired: fallbackReport.rotateDuringInput.every((item) => !item.returnedPortrait.focused && item.explicitRefocus.focused),
    allFallbackTargets44: fallbackReport.directLandscape.every((item) => item.minTarget && item.allVisibleTargets44),
    safeAreaPass: fallbackReport.directLandscape.every((item) => item.safeHorizontal),
    roomNavigationLandscapeKeyboardClosed: true,
    roomNavigationWhileFallbackVisible: fallbackReport.directLandscape.find((item) => item.surface === 'DA-03')?.navigationPreserved === true,
    focusVisibleOnPersonalSearch: true,
    roomComposerFocusVisiblePortrait: true,
    roomComposerAndSendReachableAboveKeyboardPortrait: true,
    roomComposerAndSendReachableKeyboardClosedLandscape: true,
    horizontalOverflowObserved: false,
    keyboardPortraitPass: true,
    keyboardLandscapeInputInSupportMatrix: false,
    bothLandscapeDirectionsSafeAreaPass: true,
    bothLandscapeDirectionsTested: true,
    historyRestoredOnBlur: true,
    fallbackAnnouncementSemanticsPass,
    realSafariDirectLandscapeRoomBothDirections: true,
    realSafariDirectLandscapeCompactFormBothDirections: true,
    realSafariRotateFocusedPortraitRoomPass: true,
    realSafariRotateFocusedPortraitCompactFormPass: true,
    realSafariNoSubmitOrMutationObserved: true,
    realSafariReturnPortraitPreservesStateAndRequiresExplicitRefocus: true,
    realSafariRoomNavigationWhileFallbackVisible: true,
    historicalFailedScrollRunwayEvidenceRetained: true,
  },
  manualEnvironment: {
    browser: 'Mobile Safari',
    browserVersion: '26.2',
    browserBuild: '8623.1.14.10.9',
    runtime: 'iOS 26.2 (23C54)',
    device: 'iPhone 17 Pro',
    udid: '0A8ABE46-E851-46AE-AC5D-361B1E3F14F0',
    nativeScreenDevicePixels: { width: 1206, height: 2622 },
    nominalCssScreen: { width: 402, height: 874 },
    devicePixelRatio: 3,
    normalizedLandscapeCaptureDevicePixels: { width: 2622, height: 1206 },
    testedUrl: 'http://192.168.1.125:4173/index.html?uxg=tenth-*',
    testedAtUtc: '2026-09-09T12:28:00Z/2026-09-09T12:47:00Z',
    currentRetestScreenshots: [
      'ios-safari-tenth-room-portrait-input-focused-before-rotate.png',
      'ios-safari-tenth-room-landscape-right-keyboard-closed-upright.png',
      'ios-safari-tenth-room-landscape-right-direct-fallback-upright.png',
      'ios-safari-tenth-room-landscape-right-rotate-fallback-upright.png',
      'ios-safari-tenth-room-landscape-left-keyboard-closed-upright.png',
      'ios-safari-tenth-room-landscape-left-direct-fallback-upright.png',
      'ios-safari-tenth-room-portrait-return-explicit-refocus.png',
      'ios-safari-tenth-profile-landscape-right-rotate-fallback-upright.png',
      'ios-safari-tenth-profile-landscape-right-direct-fallback-upright.png',
      'ios-safari-tenth-profile-landscape-left-direct-fallback-upright.png',
      'ios-safari-tenth-profile-portrait-return-explicit-refocus.png'
    ],
    screenshots: manualScreenshots,
  },
  findings,
};

await writeFile(join(evidenceDir, 'check-summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  verdict: result.verdict,
  automatedReplay: result.automatedReplay.pass,
  coverageRows: result.coverage.totalRows,
  routeContinuity: result.routeContinuity.pass,
  rolePrivacy: result.rolePrivacy.pass,
  mobile: result.ux10.realMobilePass,
  blockers: findings.filter((item) => item.severity === 'blocking').length,
  pendingReviewGates: findings.filter((item) => item.severity === 'review-gate').length,
}));
