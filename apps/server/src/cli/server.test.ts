import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { GlobalFlag } from "effect/cli";
import { expect, vi } from "vite-plus/test";
import type { CliServerFlags } from "./config.ts";
import { runDefaultServerCommand } from "./server.ts";

const dependencies = vi.hoisted(() => ({ attach: vi.fn(), launch: vi.fn(), run: vi.fn() }));
vi.mock("../server.ts", async () => {
  const Effect = await import("effect/Effect");
  return { runServer: Effect.sync(() => dependencies.run()) };
});
vi.mock("./config.ts", async () => {
  const Effect = await import("effect/Effect");
  return {
    sharedServerCommandFlags: {},
    resolveServerConfig: () => Effect.succeed({ mode: "web" }),
  };
});
vi.mock("./project.ts", () => ({ openLiveProjectIfPresent: dependencies.attach }));
vi.mock("./desktopLaunch.ts", () => ({ tryLaunchDesktopApp: dependencies.launch }));

function setup() {
  dependencies.attach.mockReset().mockReturnValue(Effect.succeed(true));
  dependencies.launch.mockReset().mockReturnValue(Effect.succeed(false));
  dependencies.run.mockReset();
}

const run = (flags: Partial<CliServerFlags>) =>
  runDefaultServerCommand({
    mode: Option.none(),
    port: Option.none(),
    host: Option.none(),
    baseDir: Option.none(),
    cwd: Option.none(),
    devUrl: Option.none(),
    noBrowser: Option.none(),
    bootstrapFd: Option.none(),
    autoBootstrapProjectFromCwd: Option.none(),
    logWebSocketEvents: Option.none(),
    tailscaleServeEnabled: Option.none(),
    tailscaleServePort: Option.none(),
    ...flags,
  }).pipe(
    Effect.provide(Layer.mergeAll(NetService.layer, NodeServices.layer)),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(GlobalFlag.LogLevel, Option.none()),
  );

it.effect(
  "opens an explicit directory in the live environment without starting another server",
  () =>
    Effect.gen(function* () {
      setup();
      yield* run({ cwd: Option.some(".") });
      expect(dependencies.attach).toHaveBeenCalledWith({
        cwd: Option.some("."),
        baseDir: Option.none(),
        clearOnFailure: false,
      });
      expect(dependencies.run).not.toHaveBeenCalled();
      expect(dependencies.launch).not.toHaveBeenCalled();
    }),
);

it.effect(
  "starts a server when neither a live environment nor an installed desktop is available",
  () =>
    Effect.gen(function* () {
      setup();
      dependencies.attach.mockReturnValue(Effect.succeed(false));
      yield* run({ cwd: Option.some(".") });
      expect(dependencies.launch).toHaveBeenCalledOnce();
      expect(dependencies.run).toHaveBeenCalledOnce();
    }),
);

it.effect.each([
  { host: Option.some("0.0.0.0") },
  { port: Option.some(4773) },
  { mode: Option.some("web" as const) },
  { noBrowser: Option.some(true) },
  { bootstrapFd: Option.some(3) },
  { tailscaleServeEnabled: Option.some(true) },
] satisfies Partial<CliServerFlags>[])(
  "honors explicit server options instead of redirecting to desktop: %o",
  (options) =>
    Effect.gen(function* () {
      setup();
      yield* run({ cwd: Option.some("."), ...options });
      expect(dependencies.attach).not.toHaveBeenCalled();
      expect(dependencies.launch).not.toHaveBeenCalled();
      expect(dependencies.run).toHaveBeenCalledOnce();
    }),
);

it.effect("attaches the directory once the launched desktop becomes ready", () =>
  Effect.gen(function* () {
    setup();
    dependencies.attach.mockReturnValueOnce(Effect.succeed(false));
    dependencies.launch.mockReturnValue(Effect.succeed(true));
    const opening = yield* run({ cwd: Option.some(".") }).pipe(Effect.forkScoped);
    yield* TestClock.adjust("500 millis");
    yield* Fiber.join(opening);
    expect(dependencies.attach).toHaveBeenCalledTimes(2);
    expect(dependencies.launch).toHaveBeenCalledOnce();
    expect(dependencies.run).not.toHaveBeenCalled();
  }).pipe(Effect.scoped),
);
