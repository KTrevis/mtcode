/**
 * Computer History server helpers: context injection for all providers and a
 * background summarization loop when running in desktop mode.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import {
  defaultCodexHome,
  buildComputerHistoryContextBlock,
  loadRecentContextMarkdown,
  resolveComputerHistoryRoot,
  runSummarizationPass,
} from "@t3tools/shared/computerHistory";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";

const loadComputerHistoryContext = Effect.fn("computerHistory.loadContext")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const snapshot = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
  if (!snapshot?.computerHistory.enabled || snapshot.computerHistory.paused) {
    return undefined;
  }
  const root = resolveComputerHistoryRoot(config.stateDir);
  const markdown = yield* Effect.tryPromise(() => loadRecentContextMarkdown(root)).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  if (!markdown) return undefined;
  return buildComputerHistoryContextBlock(markdown);
});

/**
 * Adapter-local load: capture `ServerConfig` / `ServerSettingsService` at
 * construction so `sendTurn` keeps `R = never` while every provider can inject
 * the same Computer History block.
 */
export const loadComputerHistoryContextProvided = (
  serverConfig: ServerConfig.ServerConfig["Service"],
  serverSettings: ServerSettings.ServerSettingsService["Service"],
) =>
  loadComputerHistoryContext().pipe(
    Effect.provideService(ServerConfig.ServerConfig, serverConfig),
    Effect.provideService(ServerSettings.ServerSettingsService, serverSettings),
    Effect.orElseSucceed((): string | undefined => undefined),
  );

const runComputerHistorySummarization = Effect.fn("computerHistory.summarize")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const snapshot = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
  if (!snapshot?.computerHistory.enabled) {
    return { created: 0 };
  }
  const root = resolveComputerHistoryRoot(config.stateDir);
  const codexHome = defaultCodexHome();
  return yield* Effect.tryPromise(() =>
    runSummarizationPass(root, {
      mirrorToCodex: snapshot.computerHistory.mirrorToCodex,
      codexHome,
    }),
  ).pipe(Effect.orElseSucceed(() => ({ created: 0 })));
});

// Desktop IPC owns control.json; syncing stale server settings here could undo its enablement changes.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runComputerHistorySummarization().pipe(Effect.ignore);

    yield* Effect.repeat(
      runComputerHistorySummarization().pipe(Effect.ignore),
      Schedule.spaced(Duration.minutes(1)),
    ).pipe(Effect.forkScoped);
  }),
);
