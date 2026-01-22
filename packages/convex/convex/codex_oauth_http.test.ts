import { Effect, Layer } from "effect";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { codexOAuthRefreshEffect } from "./codex_oauth_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer, makeHttpClientLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import type { ActionCtx } from "./_generated/server";

describe("codex_oauth_http", () => {
  const envLayer = makeEnvLayer({} satisfies EnvValues);

  it("rejects invalid content-type", async () => {
    const req = new Request("http://localhost/api/oauth/codex/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      codexOAuthRefreshEffect(ctx, req).pipe(
        Effect.provide(Layer.mergeAll(envLayer, makeHttpClientLayer(async () => new Response())))
      )
    );

    expect(response.status).toBe(400);
  });

  it("rejects missing refresh token", async () => {
    const req = new Request("http://localhost/api/oauth/codex/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token" }).toString(),
    });

    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      codexOAuthRefreshEffect(ctx, req).pipe(
        Effect.provide(Layer.mergeAll(envLayer, makeHttpClientLayer(async () => new Response())))
      )
    );

    expect(response.status).toBe(400);
  });

  it("returns 401 when proxy token not found", async () => {
    const req = new Request("http://localhost/api/oauth/codex/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "proxy_missing",
      }).toString(),
    });

    const runMutation: ActionCtx["runMutation"] = async (_mutation, ...args) => {
      const proxyArgs = z.object({ proxyToken: z.string() }).safeParse(args[0]);
      if (proxyArgs.success && proxyArgs.data.proxyToken === "proxy_missing") {
        return null;
      }
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      codexOAuthRefreshEffect(ctx, req).pipe(
        Effect.provide(Layer.mergeAll(envLayer, makeHttpClientLayer(async () => new Response())))
      )
    );

    expect(response.status).toBe(401);
  });

  it("refreshes tokens and updates stored refresh token", async () => {
    const req = new Request("http://localhost/api/oauth/codex/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "proxy_ok",
      }).toString(),
    });

    const updates: Array<{ userId: string; teamId: string; refreshToken: string }> = [];
    const updateArgsSchema = z.object({
      userId: z.string(),
      teamId: z.string(),
      refreshToken: z.string(),
    });
    const proxyArgsSchema = z.object({ proxyToken: z.string() });
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ...args) => {
      const proxyArgs = proxyArgsSchema.safeParse(args[0]);
      if (proxyArgs.success && proxyArgs.data.proxyToken === "proxy_ok") {
        return {
          userId: "user_1",
          teamId: "team_1",
          refreshToken: "real_refresh",
        };
      }
      const updateArgs = updateArgsSchema.safeParse(args[0]);
      if (updateArgs.success) {
        updates.push(updateArgs.data);
      }
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const httpLayer = makeHttpClientLayer(async () => {
      return new Response(
        JSON.stringify({
          access_token: "access_1",
          refresh_token: "refresh_2",
          expires_in: 3600,
          token_type: "bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const response = await runHttpEffect(
      codexOAuthRefreshEffect(ctx, req).pipe(
        Effect.provide(Layer.mergeAll(envLayer, httpLayer))
      )
    );

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.refreshToken).toBe("refresh_2");
  });
});
