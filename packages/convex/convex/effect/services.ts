import { Context, Effect, Layer } from "effect";
import { env as convexEnv } from "../../_shared/convex-env";
import { TracingLive } from "./tracing";

export type EnvValues = {
  ACP_CALLBACK_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  AWS_BEARER_TOKEN_BEDROCK?: string;
  CMUX_CONVERSATION_JWT_SECRET?: string;
  CMUX_TASK_RUN_JWT_SECRET?: string;
  CONVEX_SITE_URL?: string;
  OPENAI_API_KEY?: string;
  SENTRY_DSN?: string;
  AXIOM_DOMAIN?: string;
  AXIOM_TOKEN?: string;
  AXIOM_TRACES_DATASET?: string;
};

export class EnvService extends Context.Tag("EnvService")<
  EnvService,
  EnvValues
>() {}

export const EnvLive = Layer.succeed(EnvService, {
  ACP_CALLBACK_SECRET: convexEnv.ACP_CALLBACK_SECRET,
  ANTHROPIC_API_KEY: convexEnv.ANTHROPIC_API_KEY,
  AWS_BEARER_TOKEN_BEDROCK: convexEnv.AWS_BEARER_TOKEN_BEDROCK,
  CMUX_CONVERSATION_JWT_SECRET: convexEnv.CMUX_CONVERSATION_JWT_SECRET,
  CMUX_TASK_RUN_JWT_SECRET: convexEnv.CMUX_TASK_RUN_JWT_SECRET,
  CONVEX_SITE_URL: convexEnv.CONVEX_SITE_URL,
  OPENAI_API_KEY: convexEnv.OPENAI_API_KEY,
  SENTRY_DSN: convexEnv.SENTRY_DSN,
  AXIOM_DOMAIN: convexEnv.AXIOM_DOMAIN,
  AXIOM_TOKEN: convexEnv.AXIOM_TOKEN,
  AXIOM_TRACES_DATASET: convexEnv.AXIOM_TRACES_DATASET,
});

export type HttpClient = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Effect.Effect<Response, Error>;
};

export class HttpClientService extends Context.Tag("HttpClientService")<
  HttpClientService,
  HttpClient
>() {}

export const HttpClientLive = Layer.succeed(HttpClientService, {
  fetch: (input, init) =>
    Effect.tryPromise({
      try: () => fetch(input, init),
      catch: (error) =>
        error instanceof Error ? error : new Error("Failed to fetch"),
    }),
});

export const LiveServices = Layer.mergeAll(
  EnvLive,
  HttpClientLive,
  TracingLive
);
