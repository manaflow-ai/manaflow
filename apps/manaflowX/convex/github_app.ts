import { v } from "convex/values";
import { base64urlFromBytes } from "./_shared/encoding";
import { hmacSha256 } from "./_shared/crypto";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

// Get install state secret from environment
const getInstallStateSecret = (): string => {
  const secret = process.env.INSTALL_STATE_SECRET;
  if (!secret) throw new Error("Missing INSTALL_STATE_SECRET environment variable");
  return secret;
};

// Mint a signed, single-use install state token for mapping installation -> user
export const mintInstallState = mutation({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { returnUrl }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const secret = getInstallStateSecret();
    const userId = identity.subject;

    // Generate random nonce
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = Date.now();
    const exp = now + 10 * 60 * 1000; // 10 minutes
    const payloadObj = {
      ver: 1,
      userId,
      iat: now,
      exp,
      nonce,
      ...(returnUrl ? { returnUrl } : {}),
    } as const;
    const payload = JSON.stringify(payloadObj);
    const sigBuf = await hmacSha256(secret, payload);
    const payloadB64 = base64urlFromBytes(new TextEncoder().encode(payload));
    const sigB64 = base64urlFromBytes(new Uint8Array(sigBuf));
    const token = `v2.${payloadB64}.${sigB64}`;

    await ctx.db.insert("installStates", {
      nonce,
      userId,
      iat: now,
      exp,
      status: "pending",
      createdAt: now,
      ...(returnUrl ? { returnUrl } : {}),
    });

    return { state: token } as const;
  },
});

export const getInstallStateByNonce = internalQuery({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    return await ctx.db
      .query("installStates")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .first();
  },
});

export const consumeInstallState = internalMutation({
  args: { nonce: v.string(), expire: v.optional(v.boolean()) },
  handler: async (ctx, { nonce, expire }) => {
    const row = await ctx.db
      .query("installStates")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .first();
    if (!row) return { ok: false as const };
    await ctx.db.patch(row._id, { status: expire ? "expired" : "used" });
    return { ok: true as const };
  },
});

export const upsertProviderConnectionFromInstallation = internalMutation({
  args: {
    installationId: v.number(),
    accountLogin: v.optional(v.string()),
    accountId: v.optional(v.number()),
    accountType: v.optional(
      v.union(v.literal("User"), v.literal("Organization"))
    ),
    userId: v.optional(v.string()),
    connectedByUserId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      installationId,
      accountLogin,
      accountId,
      accountType,
      userId,
      connectedByUserId,
      isActive,
    }
  ) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("providerConnections")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", installationId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(accountLogin !== undefined ? { accountLogin } : {}),
        ...(accountId !== undefined ? { accountId } : {}),
        ...(accountType !== undefined ? { accountType } : {}),
        userId: userId ?? existing.userId,
        connectedByUserId: connectedByUserId ?? existing.connectedByUserId,
        isActive: isActive ?? true,
        updatedAt: now,
      });
      return existing._id;
    }
    const id = await ctx.db.insert("providerConnections", {
      installationId,
      accountLogin,
      accountId,
      accountType,
      userId,
      connectedByUserId,
      type: "github_app",
      isActive: isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const deactivateProviderConnection = internalMutation({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    const existing = await ctx.db
      .query("providerConnections")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", installationId)
      )
      .first();
    if (!existing) return { ok: true } as const;
    await ctx.db.patch(existing._id, {
      isActive: false,
      updatedAt: Date.now(),
    });
    return { ok: true } as const;
  },
});

export const getProviderConnectionByInstallationId = internalQuery({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    return await ctx.db
      .query("providerConnections")
      .withIndex("by_installationId", (q) =>
        q.eq("installationId", installationId)
      )
      .first();
  },
});

// List provider connections for the current user
export const listProviderConnections = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    const rows = await ctx.db
      .query("providerConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return rows
      .filter((r) => r.isActive !== false)
      .map((r) => ({
        id: r._id,
        installationId: r.installationId,
        accountLogin: r.accountLogin,
        accountType: r.accountType,
        type: r.type,
        isActive: r.isActive ?? true,
      }));
  },
});
