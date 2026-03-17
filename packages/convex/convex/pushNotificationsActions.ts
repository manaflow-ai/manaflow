"use node";

import { ConvexError, v } from "convex/values";
import { SignJWT, importPKCS8 } from "jose";
import { env } from "../_shared/convex-env";
import { internalAction } from "./_generated/server";

const pushTargetValidator = v.object({
  token: v.string(),
  environment: v.union(v.literal("development"), v.literal("production")),
  bundleId: v.string(),
  deviceId: v.optional(v.string()),
});

async function makeApnsToken() {
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY_BASE64) {
    return null;
  }

  const privateKeyPem = Buffer.from(
    env.APNS_PRIVATE_KEY_BASE64,
    "base64",
  ).toString("utf8");
  const privateKey = await importPKCS8(privateKeyPem, "ES256");

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID })
    .setIssuer(env.APNS_TEAM_ID)
    .setAudience("https://apple.com")
    .setIssuedAt()
    .sign(privateKey);
}

async function dispatchNotification(args: {
  tokens: Array<{
    token: string;
    environment: "development" | "production";
    bundleId: string;
  }>;
  title: string;
  body: string;
  routePayload?: {
    kind: "workspace";
    workspaceId: string;
    machineId?: string;
  };
}) {
  if (args.tokens.length === 0) {
    return { delivered: 0, skipped: 0 };
  }

  const authToken = await makeApnsToken();
  if (!authToken) {
    return { delivered: 0, skipped: args.tokens.length };
  }

  let delivered = 0;
  for (const token of args.tokens) {
    const endpoint =
      token.environment === "development"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";

    const payload = {
      aps: {
        alert: {
          title: args.title,
          body: args.body,
        },
        sound: "default",
      },
      ...(args.routePayload ? { route: args.routePayload } : {}),
    };

    const response = await fetch(`${endpoint}/3/device/${token.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${authToken}`,
        "apns-push-type": "alert",
        "apns-topic": token.bundleId,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ConvexError(
        `APNS send failed (${response.status}): ${body || "unknown error"}`,
      );
    }

    delivered += 1;
  }

  return { delivered, skipped: 0 };
}

export const sendWorkspaceEvent = internalAction({
  args: {
    tokens: v.array(pushTargetValidator),
    workspaceId: v.string(),
    machineId: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    return await dispatchNotification({
      tokens: args.tokens,
      title: args.title,
      body: args.body,
      routePayload: {
        kind: "workspace",
        workspaceId: args.workspaceId,
        machineId: args.machineId,
      },
    });
  },
});

export const sendTestPush = internalAction({
  args: {
    tokens: v.array(pushTargetValidator),
    title: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    return await dispatchNotification({
      tokens: args.tokens,
      title: args.title,
      body: args.body,
    });
  },
});
