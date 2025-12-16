#!/usr/bin/env bun

import process from "node:process";
import {
  DEFAULT_MORPHCLOUD_BASE_URL,
  createMorphCloudClient,
  listInstancesInstanceGet,
  type InstanceModel,
  type InstanceStatus,
} from "@cmux/morphcloud-openapi-client";

const MORPH_API_KEY = process.env.MORPH_API_KEY;
const MORPH_API_BASE_URL =
  process.env.MORPH_API_BASE_URL ?? DEFAULT_MORPHCLOUD_BASE_URL;

if (!MORPH_API_KEY) {
  console.error(
    "MORPH_API_KEY is required. Export it before running this script."
  );
  process.exit(1);
}

const ACTIVE_STATUSES: InstanceStatus[] = ["pending", "ready", "saving"];

const morphClient = createMorphCloudClient({
  baseUrl: MORPH_API_BASE_URL,
  auth: MORPH_API_KEY,
});

function formatRelativeTime(secondsSinceEpoch: number): string {
  const diffSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1000 - secondsSinceEpoch)
  );
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
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

function formatMetadata(
  metadata: Record<string, string> | undefined
): string | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  const entries = Object.entries(metadata)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return entries.join(", ");
}

function isActiveInstance(
  instance: InstanceModel
): instance is InstanceModel & { status: InstanceStatus } {
  return (
    typeof instance.status === "string" &&
    ACTIVE_STATUSES.includes(instance.status)
  );
}

function printInstance(instance: InstanceModel & { status: InstanceStatus }) {
  const created = new Date(instance.created * 1000).toISOString();
  const runtime = formatRelativeTime(instance.created);
  const metadata = formatMetadata(instance.metadata);
  const { snapshot_id: snapshotId, image_id: imageId } = instance.refs;
  const services = instance.networking.http_services ?? [];
  const ttlSeconds = instance.ttl.ttl_seconds;
  const ttlExpireAt = instance.ttl.ttl_expire_at;

  console.log(
    `- ${instance.id} (${instance.status}) — created ${created} (${runtime})`
  );
  console.log(
    `  snapshot=${snapshotId} image=${imageId} vcpu=${instance.spec.vcpus} mem=${instance.spec.memory}MB`
  );

  if (ttlSeconds) {
    const ttlHours = (ttlSeconds / 3600).toFixed(1);
    const expireLabel = ttlExpireAt
      ? `expires ${new Date(ttlExpireAt * 1000).toISOString()}`
      : "no expire timestamp";
    console.log(`  TTL: ${ttlSeconds}s (${ttlHours}h), ${expireLabel}`);
  } else {
    console.log("  TTL: not set");
  }

  if (metadata) {
    console.log(`  metadata: ${metadata}`);
  }

  if (services.length === 0) {
    console.log("  HTTP services: none");
  } else {
    console.log("  HTTP services:");
    for (const service of services) {
      const portInfo =
        typeof service.port === "number" ? `:${service.port}` : "";
      const authMode = service.auth_mode ? ` (${service.auth_mode})` : "";
      console.log(
        `    • ${service.name ?? "service"}${portInfo}${authMode} → ${
          service.url
        }`
      );
    }
  }

  console.log("");
}

async function main() {
  console.log(
    `[Morph HTTP] Fetching instances from ${MORPH_API_BASE_URL.replace(
      /\/+$/,
      ""
    )}`
  );

  const response = await listInstancesInstanceGet({
    client: morphClient,
  });

  if (!response.data) {
    console.error(
      "Failed to list instances:",
      response.error ?? "Unknown error"
    );
    process.exit(1);
  }

  const instances = response.data.data ?? [];
  const activeInstances = instances.filter(isActiveInstance);

  if (activeInstances.length === 0) {
    console.log("No active MorphCloud instances found.");
    return;
  }

  console.log(
    `Found ${activeInstances.length} active instance${
      activeInstances.length === 1 ? "" : "s"
    }:\n`
  );

  for (const instance of activeInstances.sort(
    (a, b) => b.created - a.created
  )) {
    printInstance(instance);
  }
}

await main().catch((error) => {
  console.error("Unexpected error while listing MorphCloud instances:", error);
  process.exit(1);
});
