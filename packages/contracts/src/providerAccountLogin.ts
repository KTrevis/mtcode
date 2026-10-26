import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";

// Device codes work across machines; OAuth callbacks require a reachable environment.
export const ProviderAccountLoginMode = Schema.Literals(["oauth", "deviceCode", "apiKey"]);
export type ProviderAccountLoginMode = typeof ProviderAccountLoginMode.Type;

export const ProviderAccountLoginInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  mode: ProviderAccountLoginMode,
  /** Required when `mode` is `apiKey`, ignored otherwise. */
  apiKey: Schema.optionalKey(Schema.String),
});
export type ProviderAccountLoginInput = typeof ProviderAccountLoginInput.Type;

export const ProviderAccountLoginEvent = Schema.Union([
  /** Open `url` in a browser; the flow completes on its own afterwards. */
  Schema.Struct({
    type: Schema.Literal("authUrl"),
    url: Schema.String,
  }),
  /** Open `url` in a browser and enter `userCode` there. */
  Schema.Struct({
    type: Schema.Literal("deviceCode"),
    url: Schema.String,
    userCode: Schema.String,
  }),
  /**
   * Open `url` in a browser, then paste the resulting code back through
   * `server.submitProviderLoginCode`.
   */
  Schema.Struct({
    type: Schema.Literal("awaitingCode"),
    url: Schema.String,
  }),
  /** The account is signed in; provider snapshots are being refreshed. */
  Schema.Struct({
    type: Schema.Literal("complete"),
  }),
]);
export type ProviderAccountLoginEvent = typeof ProviderAccountLoginEvent.Type;

export class ProviderAccountLoginError extends Schema.TaggedError<ProviderAccountLoginError>()(
  "ProviderAccountLoginError",
  {
    instanceId: ProviderInstanceId,
    message: Schema.String,
  },
) {}

export const ProviderLoginCodeInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  code: Schema.String,
});
export type ProviderLoginCodeInput = typeof ProviderLoginCodeInput.Type;

export const ProviderAccountLogoutInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderAccountLogoutInput = typeof ProviderAccountLogoutInput.Type;
