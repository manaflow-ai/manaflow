import { ConvexHttpClient } from "convex/browser";
import { decodeJwt } from "jose";

interface CacheEntry {
  client: ConvexHttpClient;
  expiry: number;
  accessToken: string;
}

const MAX_CACHE_SIZE = 50;

class ConvexClientCache {
  private cache = new Map<string, CacheEntry>();
  private lastCleanupMs = 0;
  private readonly cleanupEveryMs = 60_000; // sweep at most once per minute on access
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup timer to ensure expired entries are removed
    // even when the cache isn't being accessed
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupEveryMs);

    // Ensure the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupExpired(): void {
    const now = Date.now() / 1000;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key);
      }
    }

    // Enforce max size by removing oldest entries if needed
    if (this.cache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].expiry - b[1].expiry);
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
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
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

export const convexClientCache = new ConvexClientCache();

export { ConvexHttpClient };
