import * as OtlpTracer from "@effect/opentelemetry/OtlpTracer";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import { Effect, Layer } from "effect";
import { env as convexEnv } from "../../_shared/convex-env";

const SERVICE_NAME = "convex";
const sentryDsn = convexEnv.SENTRY_DSN;
const axiomDomain = convexEnv.AXIOM_DOMAIN;
const axiomToken = convexEnv.AXIOM_TOKEN;
const axiomTracesDataset = convexEnv.AXIOM_TRACES_DATASET;

type ParsedSentryDsn = {
  baseUrl: string;
  projectId: string;
  publicKey: string;
  secret?: string;
};

const parseSentryDsn = (dsn: string): ParsedSentryDsn | null => {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (!projectId || !url.username || !url.host) {
      return null;
    }
    return {
      baseUrl: `${url.protocol}//${url.host}`,
      projectId,
      publicKey: url.username,
      secret: url.password ? url.password : undefined,
    };
  } catch {
    return null;
  }
};

const buildSentryAuthHeader = (parsed: ParsedSentryDsn): string => {
  const parts = [`sentry_key=${parsed.publicKey}`, "sentry_version=7"];
  if (parsed.secret) {
    parts.push(`sentry_secret=${parsed.secret}`);
  }
  return `sentry ${parts.join(", ")}`;
};

const normalizeAxiomDomain = (domain: string): string => {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

type AxiomConfig = {
  url: string;
  headers: Record<string, string>;
};

const getAxiomConfig = (): AxiomConfig | null => {
  if (!axiomDomain || !axiomToken || !axiomTracesDataset) {
    return null;
  }
  const baseUrl = normalizeAxiomDomain(axiomDomain);
  return {
    url: `${baseUrl}/v1/traces`,
    headers: {
      Authorization: `Bearer ${axiomToken}`,
      "X-Axiom-Dataset": axiomTracesDataset,
    },
  };
};

const createTracingLayer = Effect.try({
  try: () => {
    const axiomConfig = getAxiomConfig();
    if (axiomConfig) {
      return OtlpTracer.layer({
        url: axiomConfig.url,
        headers: axiomConfig.headers,
        resource: { serviceName: SERVICE_NAME },
      }).pipe(Layer.provide(FetchHttpClient.layer));
    }

    const hasPartialAxiomConfig =
      Boolean(axiomDomain || axiomToken || axiomTracesDataset) && !axiomConfig;
    if (hasPartialAxiomConfig) {
      console.error(
        "[effect.tracing] AXIOM_DOMAIN, AXIOM_TOKEN, and AXIOM_TRACES_DATASET must all be set"
      );
      return Layer.empty;
    }

    if (!sentryDsn) {
      return Layer.empty;
    }
    const parsed = parseSentryDsn(sentryDsn);
    if (!parsed) {
      throw new Error("Invalid SENTRY_DSN");
    }
    return OtlpTracer.layer({
      url: `${parsed.baseUrl}/api/${parsed.projectId}/integration/otlp/v1/traces`,
      headers: {
        "x-sentry-auth": buildSentryAuthHeader(parsed),
      },
      resource: { serviceName: SERVICE_NAME },
    }).pipe(Layer.provide(FetchHttpClient.layer));
  },
  catch: (error) =>
    error instanceof Error ? error : new Error("Failed to initialize tracing"),
}).pipe(
  Effect.tapError((error) => {
    console.error("[effect.tracing] Failed to initialize tracing", error);
    return Effect.void;
  }),
  Effect.catchAll(() => Effect.succeed(Layer.empty))
);

export const TracingLive = Layer.unwrapEffect(createTracingLayer);
