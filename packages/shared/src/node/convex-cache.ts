import { ConvexHttpClient } from "convex/browser";
import { decodeJwt } from "jose";

interface CacheEntry {
  client: ConvexHttpClient;
  expiry: number;
  accessToken: string;
}

class ConvexClientCache {
  private cache = new Map<string, CacheEntry>();
  private lastCleanupMs = 0;
  private readonly cleanupEveryMs = 60_000; // sweep at most once per minute on access

  private cleanupExpired(): void {
    const now = Date.now() / 1000;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key);
      }
    }
  }

  private maybeCleanup(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastCleanupMs >= this.cleanupEveryMs) {
      this.cleanupExpired();
      this.lastCleanupMs = nowMs;
    }
  }

  private getCacheKey(accessToken: string, convexUrl: string): string | null {
    try {
      const jwt = decodeJwt(accessToken);
      const sub = jwt.sub || "";
      const iat = jwt.iat || 0;
      return `${sub}-${iat}-${convexUrl}`;
    } catch (error) {
      console.warn("Failed to decode JWT for cache key:", error);
      return null;
    }
  }

  get(accessToken: string, convexUrl: string): ConvexHttpClient | null {
    this.maybeCleanup();
    const cacheKey = this.getCacheKey(accessToken, convexUrl);
    if (!cacheKey) {
      return null;
    }

    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }

    const now = Date.now() / 1000;
    if (entry.expiry < now) {
      this.cache.delete(cacheKey);
      return null;
    }

    if (entry.accessToken !== accessToken) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.client;
  }

  set(accessToken: string, convexUrl: string, client: ConvexHttpClient): void {
    this.maybeCleanup();
    const cacheKey = this.getCacheKey(accessToken, convexUrl);
    if (!cacheKey) {
      return;
    }

    try {
      const jwt = decodeJwt(accessToken);
      const expiry = jwt.exp || Date.now() / 1000 + 3600; // default 1h if no exp

      this.cache.set(cacheKey, {
        client,
        expiry,
        accessToken,
      });
    } catch (error) {
      console.warn("Failed to cache Convex client:", error);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  destroy(): void {
    this.clear();
  }
}

export const convexClientCache = new ConvexClientCache();

export { ConvexHttpClient };
