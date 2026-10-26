import { RelayApi } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

export const makeRelayEnvironmentClient = Effect.fn("RelayEnvironmentClient.make")(
  function* (connection: { readonly url: string; readonly environmentCredential: string }) {
    const providedClient = yield* Effect.serviceOption(HttpClient.HttpClient);
    const makeClient = HttpApiClient.make(RelayApi, {
      baseUrl: connection.url,
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.setHeader("authorization", `Bearer ${connection.environmentCredential}`),
      ),
    });
    return yield* Option.isSome(providedClient)
      ? makeClient.pipe(Effect.provideService(HttpClient.HttpClient, providedClient.value))
      : makeClient.pipe(Effect.provide(FetchHttpClient.layer));
  },
);
