import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSplitValue,
  overviewChatHeightBounds,
  overviewRightColumnBounds,
  reduceSplitValue,
  workAuxiliaryBounds,
} from "../../src/features/room/roomContextPanelLayout.ts";

test("work split clamps to the editor/context minima and integer CSS pixels", () => {
  const bounds = workAuxiliaryBounds(1_000);

  assert.deepEqual(bounds, { min: 320, max: 490 });
  assert.equal(clampSplitValue(319.8, bounds), 320);
  assert.equal(clampSplitValue(510.7, bounds), 490);
  assert.equal(clampSplitValue(401.9, bounds), 402);
});

test("overview bounds expose no split when the three columns or two rows cannot fit", () => {
  assert.equal(workAuxiliaryBounds(829), null);
  assert.deepEqual(workAuxiliaryBounds(830), { min: 320, max: 320 });
  assert.equal(overviewRightColumnBounds(1_059), null);
  assert.equal(overviewChatHeightBounds(569), null);
  assert.deepEqual(overviewRightColumnBounds(1_060), { min: 320, max: 320 });
  assert.deepEqual(overviewChatHeightBounds(570), { min: 320, max: 320 });
});

test("keyboard reducer moves every split by 16px and Home/End select dynamic bounds", () => {
  const vertical = { min: 320, max: 416 };
  const horizontal = { min: 320, max: 384 };

  assert.equal(reduceSplitValue(352, vertical, "ArrowRight", "vertical"), 368);
  assert.equal(reduceSplitValue(352, vertical, "ArrowLeft", "vertical"), 336);
  assert.equal(reduceSplitValue(408, vertical, "ArrowRight", "vertical"), 416);
  assert.equal(reduceSplitValue(328, vertical, "ArrowLeft", "vertical"), 320);
  assert.equal(reduceSplitValue(368, vertical, "Home", "vertical"), 320);
  assert.equal(reduceSplitValue(368, vertical, "End", "vertical"), 416);
  assert.equal(reduceSplitValue(352, horizontal, "ArrowDown", "horizontal"), 368);
  assert.equal(reduceSplitValue(352, horizontal, "ArrowUp", "horizontal"), 336);
  assert.equal(reduceSplitValue(352, horizontal, "ArrowLeft", "horizontal"), 352);
});
