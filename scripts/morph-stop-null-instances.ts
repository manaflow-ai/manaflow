#!/usr/bin/env bun

import "dotenv/config";

import process from "node:process";
import { MorphCloudClient } from "morphcloud";

const DAYS_5_SECONDS = 5 * 24 * 60 * 60;

const IGNORED_METADATA_KEYS = new Set(["instance", "taskRunJwt"]);

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

async function main(): Promise<void> {
  const key = process.env.MORPH_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing required environment variable: MORPH_API_KEY");
  }

  console.log("Fetching Morph instances...");
  const morphClient = new MorphCloudClient();
  const allInstances = await morphClient.instances.list();

  const cutoffSeconds = Date.now() / 1000 - DAYS_5_SECONDS;
  const recentInstances = allInstances.filter(
    (instance) => instance.created >= cutoffSeconds,
  );

  // Filter for ttlAction=stop and ttlSeconds=null
  const stopNullInstances = recentInstances.filter((instance) => {
    const ttl = instance.ttl;
    const ttlAction = ttl?.ttlAction ?? "none";
    const ttlSeconds = ttl?.ttlSeconds;
    return ttlAction === "stop" && (ttlSeconds === null || ttlSeconds === undefined);
  });

  console.log(
    `Found ${stopNullInstances.length} instances with ttlAction=stop, ttlSeconds=null (from last 5 days)\n`,
  );

  if (stopNullInstances.length === 0) {
    return;
  }

  // Sort by creation time, newest first
  const sortedInstances = [...stopNullInstances].sort(
    (a, b) => b.created - a.created,
  );

  for (const instance of sortedInstances) {
    const createdIso = new Date(instance.created * 1000).toISOString();
    const relativeCreated = formatRelativeTime(instance.created);
    const metadataStr = formatMetadata(instance.metadata);

    console.log(
      [
        instance.id.padEnd(18),
        `status=${instance.status.toLowerCase().padEnd(8)}`,
        `created=${createdIso} (${relativeCreated.padEnd(8)})`,
        `metadata=${metadataStr}`,
      ].join(" | "),
    );
  }
}

main().catch((error) => {
  console.error("Failed to fetch instances:", error);
  process.exitCode = 1;
});
