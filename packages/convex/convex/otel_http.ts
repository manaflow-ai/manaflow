import { Effect } from "effect";
import { jwtVerify } from "jose";
import { z } from "zod";
import { EnvService, LiveServices } from "./effect/services";
import { httpError, runHttpEffect } from "./effect/http";
import { withObservability } from "./effect/observability";
import { httpAction } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";

const makeIdSchema = <TableName extends TableNames>() =>
  z.string().min(1).transform((value) => value as Id<TableName>);

const sandboxIdSchema = makeIdSchema<"acpSandboxes">();

const sandboxJwtPayload = z.object({
  sandboxId: sandboxIdSchema,
  teamId: z.string(),
});

type SandboxJwtPayload = z.infer<typeof sandboxJwtPayload>;

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  const lower = trimmed.toLowerCase();
  const prefix = "bearer ";
  if (!lower.startsWith(prefix)) {
    return null;
  }
  const token = trimmed.slice(prefix.length).trim();
  if (token.length === 0) {
    return null;
  }
  return token;
}

function verifySandboxJwt(
  token: string
): Effect.Effect<SandboxJwtPayload | null, never, EnvService> {
  return Effect.gen(function* () {
    const env = yield* EnvService;
    const secret = env.ACP_CALLBACK_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
    if (!secret) {
      console.error("[otel.proxy] ACP_CALLBACK_SECRET not configured");
      return null;
    }

    const payload = yield* Effect.tryPromise({
      try: () => jwtVerify(token, new TextEncoder().encode(secret)),
      catch: (error) =>
        error instanceof Error ? error : new Error("JWT verification failed"),
    }).pipe(
      Effect.catchAll((error) => {
        console.error("[otel.proxy] JWT verification failed:", error);
        return Effect.succeed(null);
      })
    );

    if (!payload) {
      return null;
    }

    const parsed = sandboxJwtPayload.safeParse(payload.payload);
    if (!parsed.success) {
      console.error("[otel.proxy] JWT payload invalid", parsed.error);
      return null;
    }
    return parsed.data;
  });
}

/**
 * Normalize Axiom domain to ensure it has https:// prefix.
 */
function normalizeAxiomDomain(domain: string): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }
  return `https://${domain}`;
}

/**
 * Extract a string attribute value from OTLP resource attributes.
 */
function getResourceAttribute(
  attributes: Array<{ key: string; value: { stringValue?: string } }> | undefined,
  key: string
): string | undefined {
  if (!attributes) return undefined;
  const attr = attributes.find((a) => a.key === key);
  return attr?.value?.stringValue;
}

/**
 * Rewrite trace IDs in OTLP JSON data to link Claude Code spans to Convex traces.
 *
 * Claude Code generates its own trace IDs, but we pass the parent Convex trace context
 * as resource attributes (parent_trace_id, parent_span_id). This function rewrites
 * the spans so they share the same trace_id as the Convex trace, creating a unified
 * distributed trace view in Axiom.
 */
function rewriteTraceIds(data: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otlp = data as any;
  if (!otlp?.resourceSpans || !Array.isArray(otlp.resourceSpans)) {
    return data;
  }

  for (const resourceSpan of otlp.resourceSpans) {
    const attributes = resourceSpan?.resource?.attributes;
    const parentTraceId = getResourceAttribute(attributes, "parent_trace_id");
    const parentSpanId = getResourceAttribute(attributes, "parent_span_id");

    // Only rewrite if we have parent trace context
    if (!parentTraceId) {
      continue;
    }

    // Track which spanIds are roots (have no parent within this batch)
    const spanIds = new Set<string>();
    const parentSpanIds = new Set<string>();

    // First pass: collect all span IDs and parent span IDs
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        if (span.spanId) spanIds.add(span.spanId);
        if (span.parentSpanId) parentSpanIds.add(span.parentSpanId);
      }
    }

    // Second pass: rewrite trace IDs and link root spans
    for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
      for (const span of scopeSpan?.spans ?? []) {
        // Rewrite trace ID to match parent Convex trace
        span.traceId = parentTraceId;

        // If this span's parent is not in this batch, it's a root span
        // Link it to the Convex parent span
        if (parentSpanId && (!span.parentSpanId || !spanIds.has(span.parentSpanId))) {
          span.parentSpanId = parentSpanId;
        }
      }
    }
  }

  return data;
}

/**
 * OTel traces proxy - validates sandbox JWT and forwards to Axiom.
 *
 * This endpoint receives OTLP trace data from Claude Code running in sandboxes,
 * validates the sandbox JWT, rewrites trace IDs to link with Convex traces,
 * and forwards to Axiom with server-side credentials.
 */
export const otelTracesProxyEffect = (req: Request) =>
  Effect.gen(function* () {
    const token = getBearerToken(req);
    if (!token) {
      console.warn("[otel.proxy] Missing bearer token");
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Unauthorized" })
      );
    }

    const jwtPayload = yield* verifySandboxJwt(token);

    if (!jwtPayload) {
      console.warn("[otel.proxy] Invalid JWT");
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Invalid token" })
      );
    }

    const env = yield* EnvService;

    const axiomDomain = env.AXIOM_DOMAIN;
    const axiomToken = env.AXIOM_TOKEN;
    const axiomDataset = env.AXIOM_TRACES_DATASET;

    if (!axiomDomain || !axiomToken || !axiomDataset) {
      console.error("[otel.proxy] Axiom configuration missing");
      return yield* Effect.fail(
        httpError(503, { code: 503, message: "OTel backend not configured" })
      );
    }

    const contentType =
      req.headers.get("content-type") ?? "application/x-protobuf";
    const isJson = contentType.includes("json");

    let body: ArrayBuffer | string;

    if (isJson) {
      // Parse JSON, rewrite trace IDs, and re-serialize
      const text = yield* Effect.tryPromise({
        try: () => req.text(),
        catch: (error) => {
          console.error("[otel.proxy] Failed to read request body:", error);
          return httpError(400, { code: 400, message: "Failed to read body" });
        },
      });

      try {
        const data = JSON.parse(text);
        const rewritten = rewriteTraceIds(data);
        body = JSON.stringify(rewritten);
      } catch (error) {
        console.error("[otel.proxy] Failed to parse/rewrite JSON:", error);
        // Fall back to forwarding as-is
        body = text;
      }
    } else {
      // Protobuf - forward as-is (can't easily rewrite)
      body = yield* Effect.tryPromise({
        try: () => req.arrayBuffer(),
        catch: (error) => {
          console.error("[otel.proxy] Failed to read request body:", error);
          return httpError(400, { code: 400, message: "Failed to read body" });
        },
      });
    }

    // Forward to Axiom
    const axiomUrl = `${normalizeAxiomDomain(axiomDomain)}/v1/traces`;

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(axiomUrl, {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            Authorization: `Bearer ${axiomToken}`,
            "X-Axiom-Dataset": axiomDataset,
          },
          body,
        }),
      catch: (error) => {
        console.error("[otel.proxy] Failed to forward to Axiom:", error);
        return httpError(502, { code: 502, message: "Failed to forward traces" });
      },
    });

    if (!response.ok) {
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () =>
          httpError(502, { code: 502, message: "Failed to read Axiom response" }),
      });
      console.error(`[otel.proxy] Axiom returned ${response.status}: ${text}`);
      // Return success to client anyway - we don't want to fail telemetry
      // just log the error for debugging
    }

    // Return success - OTLP expects empty 200 response
    return new Response(null, { status: 200 });
  }).pipe(
    withObservability("otel.traces.proxy", {
      endpoint: "otel.traces.proxy",
      method: req.method,
    })
  );

/**
 * OTel traces proxy endpoint.
 *
 * Sandboxes POST OTLP trace data to this endpoint with:
 * - Authorization: Bearer <sandbox_jwt>
 * - Content-Type: application/x-protobuf or application/json
 * - Body: OTLP trace data
 */
export const otelTracesProxy = httpAction(async (_ctx, req) => {
  return runHttpEffect(
    otelTracesProxyEffect(req).pipe(Effect.provide(LiveServices))
  );
});

/**
 * OTel metrics stub - returns 200 OK to prevent SDK errors.
 * Metrics are not forwarded to Axiom (traces only for now).
 */
export const otelMetricsStub = httpAction(async (_ctx, req) => {
  const token = getBearerToken(req);
  if (!token) {
    return new Response(JSON.stringify({ code: 401, message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Just return 200 - we don't forward metrics currently
  return new Response(null, { status: 200 });
});

/**
 * OTel logs stub - returns 200 OK to prevent SDK errors.
 * Logs are not forwarded to Axiom (traces only for now).
 */
export const otelLogsStub = httpAction(async (_ctx, req) => {
  const token = getBearerToken(req);
  if (!token) {
    return new Response(JSON.stringify({ code: 401, message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Just return 200 - we don't forward logs currently
  return new Response(null, { status: 200 });
});
