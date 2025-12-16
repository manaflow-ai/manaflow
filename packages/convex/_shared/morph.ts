"use node";

import { MorphCloudClient } from "morphcloud";
import { env } from "./convex-env";

let _morphClient: MorphCloudClient | null = null;

/**
 * Get the shared MorphCloudClient instance.
 * Creates a new client on first call, reuses it on subsequent calls.
 * Returns null if MORPH_API_KEY is not configured.
 */
export function getMorphClient(): MorphCloudClient | null {
  if (!env.MORPH_API_KEY) {
    return null;
  }
  if (!_morphClient) {
    _morphClient = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
  }
  return _morphClient;
}

/**
 * Get the shared MorphCloudClient instance or throw if not configured.
 */
export function requireMorphClient(): MorphCloudClient {
  const client = getMorphClient();
  if (!client) {
    throw new Error("MORPH_API_KEY is not configured");
  }
  return client;
}
