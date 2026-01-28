import { Effect } from "effect";
import { jwtVerify } from "jose";
import { z } from "zod";
import { EnvService, LiveServices } from "./effect/services";
import {
  httpError,
  jsonResponse,
  parseJsonBody,
  requireJsonContentType,
  runHttpEffect,
} from "./effect/http";
import { withObservability } from "./effect/observability";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";

type StorageContext = {
  storage: {
    generateUploadUrl: () => Promise<string>;
    getUrl: (id: Id<"_storage">) => Promise<string | null>;
  };
};

type ConversationJwtPayload = {
  conversationId: string;
  teamId: string;
};

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

function verifyConversationJwt(
  token: string
): Effect.Effect<ConversationJwtPayload | null, never, EnvService> {
  return Effect.gen(function* () {
    const env = yield* EnvService;
    const secret =
      env.CMUX_CONVERSATION_JWT_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
    if (!secret) {
      console.error("[acp.storage] CMUX_CONVERSATION_JWT_SECRET not configured");
      return null;
    }

    const payload = yield* Effect.tryPromise({
      try: () => jwtVerify(token, new TextEncoder().encode(secret)),
      catch: (error) =>
        error instanceof Error ? error : new Error("JWT verification failed"),
    }).pipe(
      Effect.catchAll((error) => {
        console.error("[acp.storage] JWT verification failed:", error);
        return Effect.succeed(null);
      })
    );

    if (!payload) {
      return null;
    }

    const parsed = z
      .object({
        conversationId: z.string().min(1),
        teamId: z.string().min(1),
      })
      .safeParse(payload.payload);

    if (!parsed.success) {
      console.error("[acp.storage] JWT payload invalid", parsed.error);
      return null;
    }
    return parsed.data;
  });
}

const uploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

const storageIdSchema = z.custom<Id<"_storage">>(
  (value) => typeof value === "string" && value.length > 0
);

const resolveUrlRequestSchema = z.object({
  storageId: storageIdSchema,
});

function parseJsonRequest<T>(
  req: Request,
  schema: z.ZodSchema<T>
): Effect.Effect<T, ReturnType<typeof httpError>> {
  return Effect.gen(function* () {
    yield* requireJsonContentType(req);
    const body = yield* parseJsonBody(req);
    return yield* Effect.try({
      try: () => schema.parse(body),
      catch: (error) => {
        console.error("[acp.storage] Invalid request body:", error);
        return httpError(400, { code: 400, message: "Invalid input" });
      },
    });
  });
}

export const createUploadUrlEffect = (ctx: StorageContext, req: Request) =>
  Effect.gen(function* () {
    const token = getBearerToken(req);
    if (!token) {
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Unauthorized" })
      );
    }

    const jwtPayload = yield* verifyConversationJwt(token);
    if (!jwtPayload) {
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Invalid conversation token" })
      );
    }

    yield* parseJsonRequest(req, uploadUrlRequestSchema);

    const uploadUrl = yield* Effect.tryPromise({
      try: () => ctx.storage.generateUploadUrl(),
      catch: (error) => {
        console.error("[acp.storage] Failed to generate upload URL:", error);
        return httpError(500, { code: 500, message: "Upload URL failed" });
      },
    });

    return jsonResponse({ uploadUrl });
  }).pipe(
    withObservability("acp.storage.upload_url", {
      endpoint: "acp.storage.upload_url",
      method: req.method,
    })
  );

export const resolveUrlEffect = (ctx: StorageContext, req: Request) =>
  Effect.gen(function* () {
    const token = getBearerToken(req);
    if (!token) {
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Unauthorized" })
      );
    }

    const jwtPayload = yield* verifyConversationJwt(token);
    if (!jwtPayload) {
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Invalid conversation token" })
      );
    }

    const payload = yield* parseJsonRequest(req, resolveUrlRequestSchema);

    const url = yield* Effect.tryPromise({
      try: () => ctx.storage.getUrl(payload.storageId),
      catch: (error) => {
        console.error("[acp.storage] Failed to resolve storage URL:", error);
        return httpError(500, { code: 500, message: "Storage URL failed" });
      },
    });

    if (!url) {
      return yield* Effect.fail(
        httpError(404, { code: 404, message: "Storage URL not found" })
      );
    }

    return jsonResponse({ url });
  }).pipe(
    withObservability("acp.storage.resolve_url", {
      endpoint: "acp.storage.resolve_url",
      method: req.method,
    })
  );

export const acpStorageUploadUrl = httpAction(async (ctx, req) => {
  return runHttpEffect(
    createUploadUrlEffect(ctx, req).pipe(Effect.provide(LiveServices))
  );
});

export const acpStorageResolveUrl = httpAction(async (ctx, req) => {
  return runHttpEffect(
    resolveUrlEffect(ctx, req).pipe(Effect.provide(LiveServices))
  );
});
