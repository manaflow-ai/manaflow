import { Effect, Layer } from "effect";
import type { EnvValues } from "./services";
import { EnvService, HttpClientService } from "./services";

export function makeEnvLayer(values: EnvValues): Layer.Layer<EnvService> {
  return Layer.succeed(EnvService, values);
}

export function makeHttpClientLayer(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): Layer.Layer<HttpClientService> {
  return Layer.succeed(HttpClientService, {
    fetch: (input, init) =>
      Effect.tryPromise({
        try: () => fetchImpl(input, init),
        catch: (error: unknown) =>
          error instanceof Error ? error : new Error("Fetch failed"),
      }),
  });
}
