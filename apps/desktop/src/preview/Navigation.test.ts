import * as NodeEvents from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { navigateWebContents } from "./Navigation.ts";

function guest() {
  const events = new NodeEvents.EventEmitter();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const load = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { wc: Object.assign(events, { loadURL: vi.fn(() => load) }), resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("preview navigation", () => {
  it("returns at DOM readiness while a subresource still blocks load", async () => {
    const { wc, reject } = guest();
    const result = navigateWebContents(wc, "https://example.com", {
      readiness: "domContentLoaded",
    });
    wc.emit("dom-ready");
    await result;
    expect(wc.listenerCount("dom-ready")).toBe(0);
    reject(new Error("late aborted load"));
  });

  it("starts once and returns immediately for none, consuming late failures", async () => {
    const { wc, reject } = guest();
    await navigateWebContents(wc, "https://example.com", { readiness: "none" });
    expect(wc.loadURL).toHaveBeenCalledOnce();
    reject(new Error("connection refused"));
  });

  it("bounds a stalled load and removes its readiness listener", async () => {
    vi.useFakeTimers();
    const { wc, resolve } = guest();
    const result = navigateWebContents(wc, "https://example.com", {
      readiness: "domContentLoaded",
      timeoutMs: 80,
    });
    const assertion = expect(result).rejects.toThrow("did not reach domContentLoaded");
    await vi.advanceTimersByTimeAsync(80);
    await assertion;
    expect(wc.listenerCount("dom-ready")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    resolve();
    expect(wc.loadURL).toHaveBeenCalledOnce();
  });

  it("preserves a connection failure before readiness", async () => {
    const { wc, reject } = guest();
    const result = navigateWebContents(wc, "https://example.com", {
      readiness: "domContentLoaded",
    });
    const error = new Error("ERR_CONNECTION_REFUSED");
    reject(error);
    await expect(result).rejects.toBe(error);
    expect(wc.listenerCount("dom-ready")).toBe(0);
  });
});
