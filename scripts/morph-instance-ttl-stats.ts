#!/usr/bin/env bun

import "dotenv/config";

import process from "node:process";
import { MorphCloudClient } from "morphcloud";

const DAYS_5_SECONDS = 5 * 24 * 60 * 60;

const IGNORED_METADATA_KEYS = new Set(["instance", "taskRunJwt"]);

function requireMorphEnv(): void {
  const key = process.env.MORPH_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing required environment variable: MORPH_API_KEY");
  }
}

function formatRelativeTime(timestampSeconds: number): string {
  const diffMs = Date.now() - timestampSeconds * 1000;
  const diffSeconds = Math.max(Math.floor(diffMs / 1000), 0);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatTTLExpiry(ttlExpireAt: number | undefined): string {
  if (ttlExpireAt === undefined) {
    return "no expiry";
  }
  const nowSeconds = Date.now() / 1000;
  const diffSeconds = ttlExpireAt - nowSeconds;
  if (diffSeconds <= 0) {
    return "expired";
  }
  if (diffSeconds < 60) {
    return `expires in ${Math.floor(diffSeconds)}s`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `expires in ${diffMinutes}m`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  return `expires in ${diffHours}h`;
}

function formatMetadata(
  metadata: Record<string, unknown> | undefined,
): string {
  if (!metadata) return "{}";
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (IGNORED_METADATA_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        pairs.push(`${key}=${trimmed}`);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      pairs.push(`${key}=${String(value)}`);
    }
  }
  return pairs.length > 0 ? `{${pairs.join(", ")}}` : "{}";
}

type TTLStats = {
  ttlAction: string;
  ttlSeconds: number | undefined;
  count: number;
};

async function main(): Promise<void> {
  requireMorphEnv();

  console.log("Fetching Morph instances...");
  const morphClient = new MorphCloudClient();
  const allInstances = await morphClient.instances.list();

  const cutoffSeconds = Date.now() / 1000 - DAYS_5_SECONDS;
  const recentInstances = allInstances.filter(
    (instance) => instance.created >= cutoffSeconds,
  );

  console.log(
    `Found ${allInstances.length} total instances, ${recentInstances.length} from last 5 days\n`,
  );

  if (recentInstances.length === 0) {
    console.log("No instances from the last 5 days.");
    return;
  }

  // Sort by creation time, newest first
  const sortedInstances = [...recentInstances].sort(
    (a, b) => b.created - a.created,
  );

  console.log("Instance TTL details:");
  console.log("-".repeat(120));

  const ttlStatsMap = new Map<string, TTLStats>();

  for (const instance of sortedInstances) {
    const ttl = instance.ttl;
    const ttlAction = ttl?.ttlAction ?? "none";
    const ttlSeconds = ttl?.ttlSeconds;
    const ttlExpireAt = ttl?.ttlExpireAt;

    const createdIso = new Date(instance.created * 1000).toISOString();
    const relativeCreated = formatRelativeTime(instance.created);
    const expiryStr = formatTTLExpiry(ttlExpireAt);
    const metadataStr = formatMetadata(instance.metadata);

    console.log(
      [
        instance.id.padEnd(18),
        `status=${instance.status.toLowerCase().padEnd(8)}`,
        `created=${createdIso} (${relativeCreated.padEnd(8)})`,
        `ttlAction=${ttlAction.padEnd(6)}`,
        `ttlSeconds=${ttlSeconds !== undefined ? String(ttlSeconds).padEnd(6) : "unset ".padEnd(6)}`,
        expiryStr.padEnd(16),
        `metadata=${metadataStr}`,
      ].join(" | "),
    );

    // Aggregate stats
    const key = `${ttlAction}:${ttlSeconds ?? "unset"}`;
    const existing = ttlStatsMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      ttlStatsMap.set(key, { ttlAction, ttlSeconds, count: 1 });
    }
  }

  console.log("\n" + "-".repeat(120));
  console.log("\nTTL Summary (instances from last 5 days):");

  const sortedStats = [...ttlStatsMap.values()].sort((a, b) => b.count - a.count);
  for (const stat of sortedStats) {
    const ttlSecondsStr =
      stat.ttlSeconds !== undefined ? `${stat.ttlSeconds}s` : "unset";
    console.log(
      `  ttlAction=${stat.ttlAction}, ttlSeconds=${ttlSecondsStr}: ${stat.count} instance${stat.count === 1 ? "" : "s"}`,
    );
  }

  // Status breakdown
  const statusCounts = new Map<string, number>();
  for (const instance of sortedInstances) {
    const status = instance.status.toLowerCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  console.log("\nStatus breakdown:");
  for (const [status, count] of [...statusCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${status}: ${count}`);
  }
}

main().catch((error) => {
  console.error("Failed to fetch Morph instance TTL stats:", error);
  process.exitCode = 1;
});
