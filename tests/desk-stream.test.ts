import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESK_PAUSE,
  DESK_RESUME,
  deskStreamType,
  shouldReconnectRfb,
  shouldStreamDesktop,
} from "../src/ui/desk-stream.js";

describe("desk RFB idle (no live host)", () => {
  const visible = {
    visibilityState: "visible",
    deskHidden: false,
    hasSrc: true,
    columnDisplay: "flex",
    columnVisibility: "visible",
    columnWidth: 640,
    columnHeight: 693,
  };

  it("TC-DESK-009: stream only when the computer column is on screen", () => {
    assert.equal(shouldStreamDesktop(visible), true);
    assert.equal(deskStreamType(true), DESK_RESUME);
    assert.equal(shouldStreamDesktop({ ...visible, visibilityState: "hidden" }), false);
    assert.equal(shouldStreamDesktop({ ...visible, deskHidden: true }), false);
    assert.equal(shouldStreamDesktop({ ...visible, hasSrc: false }), false);
    assert.equal(shouldStreamDesktop({ ...visible, columnDisplay: "none" }), false);
    assert.equal(shouldStreamDesktop({ ...visible, columnWidth: 0, columnHeight: 0 }), false);
    assert.equal(deskStreamType(false), DESK_PAUSE);
  });

  it("TC-DESK-010: paused RFB must not reconnect", () => {
    assert.equal(shouldReconnectRfb({ paused: false, generation: 2, eventGeneration: 2 }), true);
    assert.equal(shouldReconnectRfb({ paused: true, generation: 2, eventGeneration: 2 }), false);
    assert.equal(shouldReconnectRfb({ paused: false, generation: 3, eventGeneration: 2 }), false);
  });
});
