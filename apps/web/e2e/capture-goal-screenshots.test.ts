// @effect-diagnostics nodeBuiltinImport:off - manual capture script: writes screenshot PNGs from disk paths.
// Manual PR capture; opt in so regular E2E runs never rewrite evidence.
// cd apps/web && T3CODE_CAPTURE_GOAL_SCREENSHOTS=1 vp test run --project e2e e2e/capture-goal-screenshots.test.ts
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { afterAll, beforeAll, describe, it } from "vite-plus/test";

import { startIsolatedWebApp, type IsolatedWebApp } from "./harness.ts";

const SCREENSHOT_DIR = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "goal-state-screenshots",
);

const STATE_IDS = [
  "goal-active",
  "goal-running",
  "goal-paused",
  "goal-blocked",
  "goal-usage-limited",
  "goal-complete",
] as const;

let app: IsolatedWebApp | undefined;

async function shotState(id: (typeof STATE_IDS)[number]): Promise<void> {
  const page = requireApp().page;
  const section = page.locator(`[data-goal-screenshot="${id}"]`);
  await section.scrollIntoViewIfNeeded();
  await section.waitFor({ state: "visible" });
  await NodeFSP.mkdir(SCREENSHOT_DIR, { recursive: true });
  await section.screenshot({
    path: NodePath.join(SCREENSHOT_DIR, `${id}.png`),
  });
}

describe("capture goal state screenshots", { concurrent: false }, () => {
  beforeAll(async () => {
    app = await startIsolatedWebApp({ addFixtureProject: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("writes composer Goal state PNGs from /dev/goal-chips", async () => {
    const page = requireApp().page;
    await page.goto(`${requireApp().origin}/dev/goal-chips`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Goal composer states" }).waitFor({ state: "visible" });

    for (const id of STATE_IDS) {
      await shotState(id);
    }
  });
});

function requireApp(): IsolatedWebApp {
  if (app === undefined) {
    throw new Error("Isolated web app was not started.");
  }
  return app;
}
