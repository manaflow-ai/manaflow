#!/usr/bin/env bun

import { Instance, InstanceStatus, MorphCloudClient } from "morphcloud";
import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

const DAYS_THRESHOLD: number = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function formatRelativeTime(instance: Instance): string {
  const diffMs = Date.now() - instance.created * 1000;
  const diffSeconds = Math.floor(diffMs / 1000);
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

function formatDayLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

const client = new MorphCloudClient();
const instances = await client.instances.list();

if (instances.length === 0) {
  console.log("No instances found.");
  process.exit(0);
}

const now = Date.now();
const thresholdMs = DAYS_THRESHOLD * MILLISECONDS_PER_DAY;
const stalePausedInstances = instances
  .filter((instance) => instance.status === InstanceStatus.PAUSED)
  .filter((instance) => now - instance.created * 1000 > thresholdMs)
  .sort((a, b) => a.created - b.created);

if (stalePausedInstances.length === 0) {
  console.log(
    `No paused instances older than ${formatDayLabel(DAYS_THRESHOLD)}.`,
  );
  process.exit(0);
}

console.log(
  `Found ${stalePausedInstances.length} paused instance${stalePausedInstances.length === 1 ? "" : "s"} older than ${formatDayLabel(DAYS_THRESHOLD)}:\n`,
);

for (const instance of stalePausedInstances) {
  const createdAt = new Date(instance.created * 1000).toISOString();
  console.log(
    `- ${instance.id} (${instance.status}) created ${createdAt} (${formatRelativeTime(instance)})`,
  );
}

const rl = createInterface({ input, output });
const answer = await rl.question(
  "\nType 'stop' to permanently stop these instances, or anything else to cancel: ",
);
rl.close();

if (answer.trim() !== "stop") {
  console.log("Did not stop any instances.");
  process.exit(0);
}

let failures = 0;
for (const instance of stalePausedInstances) {
  console.log(`Stopping ${instance.id}...`);
  try {
    await instance.stop();
    console.log(`Stopped ${instance.id}.`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to stop ${instance.id}: ${message}`);
  }
}

if (failures === 0) {
  console.log("\nFinished stopping all targeted instances.");
} else {
  console.log(
    `\nFinished with ${failures} failure${failures === 1 ? "" : "s"}.`,
  );
  process.exitCode = 1;
}
