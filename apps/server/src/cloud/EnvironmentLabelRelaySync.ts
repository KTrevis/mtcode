import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { HttpClientError } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { makeRelayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";
import * as ServerSettings from "../serverSettings.ts";
import { RELAY_ENVIRONMENT_CREDENTIAL_SECRET, RELAY_URL_SECRET } from "./config.ts";

const retrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30))),
  ),
  Schedule.upTo({ duration: "10 minutes" }),
);

// Older relays lack this cosmetic route; only transient failures merit startup retries.
export const isRetryableRelayFailure = (error: unknown): boolean => {
  if (!HttpClientError.isHttpClientError(error) || error.response === undefined) {
    // Transport faults and non-HTTP failures stay retryable.
    return true;
  }
  const { status } = error.response;
  if (status === 408 || status === 429) {
    return true;
  }
  return status < 400 || status >= 500;
};

const readSecretString = (secrets: ServerSecretStore.ServerSecretStore["Service"], name: string) =>
  secrets.get(name).pipe(
    Effect.map(
      Option.match({
        onNone: () => null,
        onSome: (bytes) => new TextDecoder().decode(bytes),
      }),
    ),
  );

export const synchronizeCurrentEnvironmentLabelWithRelay = Effect.fn(
  "synchronizeCurrentEnvironmentLabelWithRelay",
)(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const [relayUrl, environmentCredential] = yield* Effect.all([
    readSecretString(secrets, RELAY_URL_SECRET),
    readSecretString(secrets, RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
  ]);
  if (!relayUrl || !environmentCredential) return;

  const descriptor = yield* environment.getDescriptor;
  const client = yield* makeRelayEnvironmentClient({ url: relayUrl, environmentCredential });
  yield* client.server.updateEnvironmentLabel({
    params: { environmentId: descriptor.environmentId },
    payload: { label: descriptor.label },
  });
  yield* Effect.logDebug("synchronized environment label with relay", {
    environmentId: descriptor.environmentId,
  });
});

export const runEnvironmentLabelRelaySync = Effect.fn("runEnvironmentLabelRelaySync")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;

  const synchronize = Effect.fn("synchronizeEnvironmentLabel")(function* (
    _environmentLabel: string,
  ) {
    yield* synchronizeCurrentEnvironmentLabelWithRelay();
  });

  const changes = yield* settings.subscribeChanges;
  const initialSettings = yield* settings.getSettings;
  const synchronizeWithRetry = (environmentLabel: string) =>
    synchronize(environmentLabel).pipe(
      Effect.retry({ schedule: retrySchedule, while: isRetryableRelayFailure }),
      Effect.catch((cause) =>
        isRetryableRelayFailure(cause)
          ? Effect.logWarning("failed to synchronize environment label with relay", { cause })
          : // Expected against a relay deployment without the label route; the
            // label is cosmetic, so stay quiet rather than warn on every boot.
            Effect.logDebug("relay does not accept environment label updates", { cause }),
      ),
    );

  yield* Stream.concat(
    Stream.make(initialSettings.environmentLabel),
    changes.pipe(
      Stream.map((next) => next.environmentLabel),
      Stream.changes,
    ),
  ).pipe(
    Stream.switchMap((environmentLabel) =>
      Stream.fromEffect(synchronizeWithRetry(environmentLabel)),
    ),
    Stream.runDrain,
  );
});
