import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const productSurfaces = [
  ["registration", new URL("../../src/pages/LoginPage.tsx", import.meta.url)],
  ["dashboard", new URL("../../src/pages/DashboardPage.tsx", import.meta.url)],
  ["room creation", new URL("../../src/pages/dashboard/CreateRoomSection.tsx", import.meta.url)],
  ["profile", new URL("../../src/pages/dashboard/HrProfileSection.tsx", import.meta.url)],
  ["dashboard navigation", new URL("../../src/pages/dashboard/dashboardConstants.ts", import.meta.url)],
  ["invitation ID", new URL("../../src/features/hr/CopyHrId.tsx", import.meta.url)],
  ["room participants", new URL("../../src/features/room/TopBar.tsx", import.meta.url)],
  ["room interview panel", new URL("../../src/features/room/RoomInterviewPanel.tsx", import.meta.url)],
  ["room page", new URL("../../src/pages/RoomPage.tsx", import.meta.url)],
] as const;

const apiErrorSurfaces = [
  ["preview controller", new URL("../../../backend/src/main/kotlin/com/interviewonline/controller/HiringManagerPreviewController.kt", import.meta.url)],
  ["room controller", new URL("../../../backend/src/main/kotlin/com/interviewonline/controller/RoomController.kt", import.meta.url)],
  ["preview service", new URL("../../../backend/src/main/kotlin/com/interviewonline/service/HiringManagerPreviewService.kt", import.meta.url)],
  ["room service", new URL("../../../backend/src/main/kotlin/com/interviewonline/service/RoomService.kt", import.meta.url)],
  ["interview service", new URL("../../../backend/src/main/kotlin/com/interviewonline/service/HrInterviewService.kt", import.meta.url)],
  ["room tracking service", new URL("../../../backend/src/main/kotlin/com/interviewonline/service/RoomHrTrackingService.kt", import.meta.url)],
] as const;

// The audit deliberately reads only quoted, rendered-copy candidates. The
// following technical/protocol forms are outside that scope and remain valid:
// `isHr`/`Hr*` identifiers, `HR_DASHBOARD_SECTION`, lower-case `/hr` routes,
// CSS/test ids and existing API/fixture field names. Test files are not inputs.
const technicalProtocolAllowlist = [
  "identifiers and imports",
  "API routes and JSON fields",
  "CSS classes and test ids",
  "fixtures and protocol names",
];

function quotedLiterals(source: string): string[] {
  return source.split("\n").flatMap((line) => {
    const matches = line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g);
    return Array.from(matches, (match) => match[1] ?? match[2] ?? match[3] ?? "");
  });
}

test("product and API error copy use compact hiring terminology without renaming technical contracts", async () => {
  assert.ok(technicalProtocolAllowlist.length > 0, "technical/protocol allowlist must remain explicit and narrow");
  const findings: string[] = [];
  for (const [surface, file] of [...productSurfaces, ...apiErrorSurfaces]) {
    assert.equal(file.pathname.includes("/tests/"), false, "the source audit must not scan tests");
    const source = await readFile(file, "utf8");
    for (const literal of quotedLiterals(source)) {
      if (/\bHR\b/u.test(literal)) findings.push(`${surface}: ${literal}`);
      if (/нанимающ\p{L}*\s+менеджер\p{L}*/iu.test(literal)) findings.push(`${surface}: ${literal}`);
    }
  }

  assert.deepEqual(
    findings,
    [],
    "Rendered product/API copy must use compact ‘нанимающий’ forms; technical HR/hiring-manager contracts remain outside this literal audit.",
  );
});
