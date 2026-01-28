import { Effect } from "effect";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createUploadUrlEffect,
  resolveUrlEffect,
} from "./acp_storage_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import type { Id } from "./_generated/dataModel";

const TEST_SECRET = "acp_storage_test_secret";

async function makeJwt(payload: { conversationId: string; teamId: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("acp_storage_http", () => {
  const envLayer = makeEnvLayer({
    CMUX_CONVERSATION_JWT_SECRET: TEST_SECRET,
    CMUX_TASK_RUN_JWT_SECRET: "unused",
  } satisfies EnvValues);

  const storageCtx = {
    storage: {
      generateUploadUrl: async () => "https://storage.example/upload",
      getUrl: async (_id: Id<"_storage">) => "https://storage.example/file",
    },
  };

  it("rejects missing bearer token for upload url", async () => {
    const req = new Request("http://localhost/api/acp/storage/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await runHttpEffect(
      createUploadUrlEffect(storageCtx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid bearer token for upload url", async () => {
    const req = new Request("http://localhost/api/acp/storage/upload-url", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await runHttpEffect(
      createUploadUrlEffect(storageCtx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("returns upload url with valid JWT", async () => {
    const token = await makeJwt({
      conversationId: "conv_1",
      teamId: "team_1",
    });
    const req = new Request("http://localhost/api/acp/storage/upload-url", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fileName: "sample.png" }),
    });

    const response = await runHttpEffect(
      createUploadUrlEffect(storageCtx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ uploadUrl: "https://storage.example/upload" });
  });

  it("returns resolved url with valid JWT", async () => {
    const token = await makeJwt({
      conversationId: "conv_2",
      teamId: "team_2",
    });
    const req = new Request("http://localhost/api/acp/storage/resolve-url", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ storageId: "storage_1" }),
    });

    const response = await runHttpEffect(
      resolveUrlEffect(storageCtx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ url: "https://storage.example/file" });
  });
});
