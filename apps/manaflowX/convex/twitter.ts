import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchTwitterUser, refreshTwitterToken } from "./_shared/twitterApi";

// Generate a random string for state/PKCE
function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate PKCE code verifier (43-128 characters)
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Base64url encode without padding
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return base64;
}

// Generate PKCE code challenge from verifier (S256 method)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return base64;
}

// Create a signed OAuth state for Twitter OAuth 2.0 flow
// Reference: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
export const mintTwitterOAuthState = mutation({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { returnUrl }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const state = generateRandomString(32);
    const codeVerifier = generateCodeVerifier();

    const now = Date.now();
    const exp = now + 10 * 60 * 1000; // 10 minutes

    await ctx.db.insert("twitterOAuthStates", {
      state,
      codeVerifier,
      userId,
      iat: now,
      exp,
      status: "pending",
      createdAt: now,
      ...(returnUrl ? { returnUrl } : {}),
    });

    // Generate code challenge for PKCE
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    return {
      state,
      codeChallenge,
      codeChallengeMethod: "S256" as const,
    };
  },
});

// Get Twitter OAuth state by state string
export const getTwitterOAuthStateByState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    return await ctx.db
      .query("twitterOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
  },
});

// Consume (mark as used) a Twitter OAuth state
export const consumeTwitterOAuthState = internalMutation({
  args: { state: v.string(), expire: v.optional(v.boolean()) },
  handler: async (ctx, { state, expire }) => {
    const row = await ctx.db
      .query("twitterOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
    if (!row) return { ok: false as const };
    await ctx.db.patch(row._id, { status: expire ? "expired" : "used" });
    return { ok: true as const, codeVerifier: row.codeVerifier, userId: row.userId, returnUrl: row.returnUrl };
  },
});

// Upsert Twitter connection after successful OAuth
export const upsertTwitterConnection = internalMutation({
  args: {
    userId: v.string(),
    twitterUserId: v.string(),
    twitterUsername: v.string(),
    twitterName: v.optional(v.string()),
    twitterProfileImageUrl: v.optional(v.string()),
    twitterAccessToken: v.string(),
    twitterRefreshToken: v.optional(v.string()),
    twitterTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if connection already exists for this Twitter user
    const existingByTwitter = await ctx.db
      .query("providerConnections")
      .withIndex("by_twitterUserId", (q) => q.eq("twitterUserId", args.twitterUserId))
      .first();

    if (existingByTwitter) {
      await ctx.db.patch(existingByTwitter._id, {
        userId: args.userId,
        twitterUsername: args.twitterUsername,
        twitterName: args.twitterName,
        twitterProfileImageUrl: args.twitterProfileImageUrl,
        twitterAccessToken: args.twitterAccessToken,
        twitterRefreshToken: args.twitterRefreshToken,
        twitterTokenExpiresAt: args.twitterTokenExpiresAt,
        isActive: true,
        updatedAt: now,
      });
      return existingByTwitter._id;
    }

    // Create new connection
    const id = await ctx.db.insert("providerConnections", {
      userId: args.userId,
      connectedByUserId: args.userId,
      type: "twitter_oauth",
      twitterUserId: args.twitterUserId,
      twitterUsername: args.twitterUsername,
      twitterName: args.twitterName,
      twitterProfileImageUrl: args.twitterProfileImageUrl,
      twitterAccessToken: args.twitterAccessToken,
      twitterRefreshToken: args.twitterRefreshToken,
      twitterTokenExpiresAt: args.twitterTokenExpiresAt,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

// Get Twitter connection for current user
export const getTwitterConnection = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const userId = identity.subject;
    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_type_userId", (q) =>
        q.eq("type", "twitter_oauth").eq("userId", userId)
      )
      .first();

    if (!connection || connection.isActive === false) return null;

    return {
      id: connection._id,
      twitterUserId: connection.twitterUserId,
      twitterUsername: connection.twitterUsername,
      twitterName: connection.twitterName,
      twitterProfileImageUrl: connection.twitterProfileImageUrl,
      isActive: connection.isActive ?? true,
    };
  },
});

// Disconnect Twitter account
export const disconnectTwitter = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_type_userId", (q) =>
        q.eq("type", "twitter_oauth").eq("userId", userId)
      )
      .first();

    if (!connection) return { ok: false as const };

    await ctx.db.patch(connection._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return { ok: true as const };
  },
});

// Get Twitter access token for API calls (internal use)
export const getTwitterAccessToken = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_type_userId", (q) =>
        q.eq("type", "twitter_oauth").eq("userId", userId)
      )
      .first();

    if (!connection || connection.isActive === false) return null;

    return {
      accessToken: connection.twitterAccessToken,
      refreshToken: connection.twitterRefreshToken,
      expiresAt: connection.twitterTokenExpiresAt,
    };
  },
});

// Update Twitter tokens after refresh
export const updateTwitterTokens = internalMutation({
  args: {
    twitterUserId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { twitterUserId, accessToken, refreshToken, expiresAt }) => {
    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_twitterUserId", (q) => q.eq("twitterUserId", twitterUserId))
      .first();

    if (!connection) return { ok: false as const };

    await ctx.db.patch(connection._id, {
      twitterAccessToken: accessToken,
      ...(refreshToken ? { twitterRefreshToken: refreshToken } : {}),
      ...(expiresAt ? { twitterTokenExpiresAt: expiresAt } : {}),
      updatedAt: Date.now(),
    });

    return { ok: true as const };
  },
});

/**
 * Test the Twitter API connection by fetching the authenticated user's profile.
 * This action will automatically refresh the token if it's expired.
 * Reference: GET /2/users/me
 */
export const testTwitterConnection = action({
  args: {},
  handler: async (ctx): Promise<{
    success: boolean;
    user?: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, error: "Not authenticated" };
    }

    const userId = identity.subject;

    // Get current tokens
    const tokens = await ctx.runQuery(internal.twitter.getTwitterAccessToken, { userId });
    if (!tokens || !tokens.accessToken) {
      return { success: false, error: "No X account connected" };
    }

    let accessToken = tokens.accessToken;

    // Check if token is expired and refresh if needed
    const now = Date.now();
    if (tokens.expiresAt && tokens.expiresAt < now && tokens.refreshToken) {
      const clientId = process.env.X_API_KEY;
      const clientSecret = process.env.X_API_KEY_SECRET;

      if (!clientId || !clientSecret) {
        return { success: false, error: "X API not configured" };
      }

      const refreshResult = await refreshTwitterToken({
        refreshToken: tokens.refreshToken,
        clientId,
        clientSecret,
      });

      if (!refreshResult.success) {
        return { success: false, error: `Token refresh failed: ${refreshResult.error}` };
      }

      // Update tokens in database
      // Need to get twitterUserId first
      const connection = await ctx.runQuery(internal.twitter.getTwitterConnectionInternal, { userId });
      if (connection?.twitterUserId) {
        await ctx.runMutation(internal.twitter.updateTwitterTokens, {
          twitterUserId: connection.twitterUserId,
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken,
          expiresAt: refreshResult.expiresAt,
        });
      }

      accessToken = refreshResult.accessToken;
    }

    // Fetch user profile
    const userResult = await fetchTwitterUser(accessToken);

    if (!userResult.success) {
      return { success: false, error: userResult.error };
    }

    return {
      success: true,
      user: userResult.user,
    };
  },
});

// Internal query to get Twitter connection with twitterUserId
export const getTwitterConnectionInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db
      .query("providerConnections")
      .withIndex("by_type_userId", (q) =>
        q.eq("type", "twitter_oauth").eq("userId", userId)
      )
      .first();

    if (!connection || connection.isActive === false) return null;

    return {
      twitterUserId: connection.twitterUserId,
      twitterUsername: connection.twitterUsername,
    };
  },
});
