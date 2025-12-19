#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { Instance, InstanceStatus, MorphCloudClient } from "morphcloud";
import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

const DEFAULT_HOURS_THRESHOLD = 6;

const { values } = parseArgs({
  options: {
    hours: {
      type: "string",
      short: "h",
    },
  },
});

const HOURS_THRESHOLD = values.hours ? Number(values.hours) : DEFAULT_HOURS_THRESHOLD;

if (Number.isNaN(HOURS_THRESHOLD) || HOURS_THRESHOLD <= 0) {
  console.error("Error: --hours must be a positive number");
  process.exit(1);
}
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const STOP_THRESHOLD_DAYS = 3;

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

function formatHourLabel(hours: number): string {
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

const client = new MorphCloudClient();
const instances = await client.instances.list();

if (instances.length === 0) {
  console.log("No instances found.");
  process.exit(0);
}

const now = Date.now();
const thresholdMs = HOURS_THRESHOLD * MILLISECONDS_PER_HOUR;
const staleActiveInstances = instances
  .filter((instance) => instance.status === InstanceStatus.READY)
  .filter((instance) => now - instance.created * 1000 > thresholdMs)
  .sort((a, b) => a.created - b.created);

// Split into instances to pause (< 3 days) and stop (>= 3 days)
const stopThresholdMs = STOP_THRESHOLD_DAYS * MILLISECONDS_PER_DAY;
const instancesToPause = staleActiveInstances.filter(
  (instance) => now - instance.created * 1000 < stopThresholdMs,
);
const instancesToStop = staleActiveInstances.filter(
  (instance) => now - instance.created * 1000 >= stopThresholdMs,
);

if (staleActiveInstances.length === 0) {
  console.log(
    `No active instances older than ${formatHourLabel(HOURS_THRESHOLD)}.`,
  );
  process.exit(0);
}

console.log(
  `Found ${staleActiveInstances.length} active instance${staleActiveInstances.length === 1 ? "" : "s"} older than ${formatHourLabel(HOURS_THRESHOLD)}:\n`,
);

if (instancesToStop.length > 0) {
  console.log(`Will PAUSE, or STOP if pause fails (>= ${STOP_THRESHOLD_DAYS} days old):`);
  for (const instance of instancesToStop) {
    const createdAt = new Date(instance.created * 1000).toISOString();
    console.log(
      `- ${instance.id} (${instance.status}) created ${createdAt} (${formatRelativeTime(instance)})`,
    );
  }
  console.log();
}

if (instancesToPause.length > 0) {
  console.log(`Will PAUSE (< ${STOP_THRESHOLD_DAYS} days old):`);
  for (const instance of instancesToPause) {
    const createdAt = new Date(instance.created * 1000).toISOString();
    console.log(
      `- ${instance.id} (${instance.status}) created ${createdAt} (${formatRelativeTime(instance)})`,
    );
  }
}

const rl = createInterface({ input, output });
const answer = await rl.question(
  "\nPress Enter to proceed, or type anything else to cancel: ",
);
await rl.close();

if (answer.trim() !== "") {
  console.log("Cancelled.");
  process.exit(0);
}

const CONCURRENCY = 10;
let failures = 0;
let inFlight = 0;
let index = 0;

const stopSet = new Set(instancesToStop.map((i) => i.id));

async function processInstance(instance: Instance): Promise<void> {
  const isOld = stopSet.has(instance.id);
  console.log(`Pausing ${instance.id}...`);
  try {
    await instance.pause();
    console.log(`Paused ${instance.id}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to pause ${instance.id}: ${message}`);
    if (isOld) {
      console.log(`Falling back to stopping ${instance.id}...`);
      try {
        await instance.stop();
        console.log(`Stopped ${instance.id}.`);
      } catch (stopError) {
        failures += 1;
        const stopMessage =
          stopError instanceof Error ? stopError.message : String(stopError);
        console.error(`Failed to stop ${instance.id}: ${stopMessage}`);
      }
    } else {
      failures += 1;
    }
  }
}

await new Promise<void>((resolve) => {
  function next() {
    while (inFlight < CONCURRENCY && index < staleActiveInstances.length) {
      const instance = staleActiveInstances[index++];
      inFlight++;
      processInstance(instance).finally(() => {
        inFlight--;
        next();
      });
    }
    if (inFlight === 0 && index >= staleActiveInstances.length) {
      resolve();
    }
  }
  next();
});

if (failures === 0) {
  console.log("\nFinished processing all targeted instances.");
} else {
  console.log(
    `\nFinished with ${failures} failure${failures === 1 ? "" : "s"}.`,
  );
  process.exitCode = 1;
}
