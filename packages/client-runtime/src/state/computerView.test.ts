import type { ComputerViewFrameEvent } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { applyComputerViewStreamEvent, EMPTY_COMPUTER_VIEW_STATE } from "./computerView.ts";

const frame: ComputerViewFrameEvent = {
  type: "frame",
  displayIndex: 0,
  mimeType: "image/jpeg",
  data: "b64",
  width: 960,
  height: 600,
  screenX: 0,
  screenY: 0,
  screenWidth: 2880,
  screenHeight: 1800,
};

const display = {
  index: 0,
  label: "Built-in Display",
  width: 2880,
  height: 1800,
  x: 0,
  y: 0,
  primary: true,
};

describe("applyComputerViewStreamEvent", () => {
  it("records displays and the selection on ready", () => {
    const state = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      type: "ready",
      displays: [display],
      selectedDisplay: 0,
    });
    expect(state.displays).toEqual([display]);
    expect(state.selectedDisplay).toBe(0);
    expect(state.frame).toBeNull();
  });

  it("keeps the latest frame and clears a stale status", () => {
    const withStatus = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      type: "status",
      message: "capturing…",
    });
    expect(withStatus.status).toBe("capturing…");
    const withFrame = applyComputerViewStreamEvent(withStatus, frame);
    expect(withFrame.frame).toBe(frame);
    expect(withFrame.status).toBeNull();
  });

  it("drops the previous frame when a new ready event arrives", () => {
    const withFrame = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, frame);
    const reannounced = applyComputerViewStreamEvent(withFrame, {
      type: "ready",
      displays: [display],
      selectedDisplay: 0,
    });
    expect(reannounced.frame).toBeNull();
  });

  it("keeps the last frame visible while statuses stream", () => {
    const withFrame = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, frame);
    const stalled = applyComputerViewStreamEvent(withFrame, {
      type: "status",
      message: "Screen capture failed.",
    });
    expect(stalled.frame).toBe(frame);
    expect(stalled.status).toBe("Screen capture failed.");
  });

  it("keeps each cursor shape once and reuses it when the image is omitted", () => {
    const base = {
      type: "cursor",
      visible: true,
      hotspotX: 0,
      hotspotY: 0,
      width: 32,
      height: 32,
    } as const;
    const arrow = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      ...base,
      id: "0x10003",
      x: 10,
      y: 20,
      image: "ARROW",
    });
    const hand = applyComputerViewStreamEvent(arrow, {
      ...base,
      id: "0x1001f",
      x: 11,
      y: 21,
      image: "HAND",
    });
    const backToArrow = applyComputerViewStreamEvent(hand, {
      ...base,
      id: "0x10003",
      x: 12,
      y: 22,
    });
    expect(backToArrow.cursor).toMatchObject({ id: "0x10003", x: 12, y: 22, image: "ARROW" });
  });

  it("forgets cursor shapes when the stream restarts", () => {
    const withCursor = applyComputerViewStreamEvent(EMPTY_COMPUTER_VIEW_STATE, {
      type: "cursor",
      id: "0x10003",
      visible: true,
      x: 0,
      y: 0,
      hotspotX: 0,
      hotspotY: 0,
      width: 32,
      height: 32,
      image: "ARROW",
    });
    const restarted = applyComputerViewStreamEvent(withCursor, {
      type: "ready",
      displays: [],
      selectedDisplay: 0,
    });
    expect(restarted.cursor).toBeNull();
    expect(restarted.cursorImages).toEqual({});
  });
});
