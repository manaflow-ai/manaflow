#!/usr/bin/env bun

import { Instance, InstanceStatus, MorphCloudClient } from "morphcloud";
import process from "node:process";

const ONE_HOUR_SECONDS = 60 * 60;

async function main(): Promise<void> {
  const client = new MorphCloudClient();
  const nowSeconds = Date.now() / 1000;
  const cutoff = nowSeconds - ONE_HOUR_SECONDS;

  const instances = await client.instances.list();
  const candidates = instances.filter((instance: Instance) => {
    if (instance.status !== InstanceStatus.READY) {
      return false;
    }
    return instance.created <= cutoff;
  });

  if (candidates.length === 0) {
    console.log("No ready sandboxes older than one hour detected.");
    return;
  }

  let pausedCount = 0;
  let failedCount = 0;

  await Promise.all(
    candidates.map(async (instance) => {
      const sandboxLabel = instance.metadata?.name ?? instance.id;
      process.stdout.write(`Pausing ${sandboxLabel}... `);
      try {
        await instance.pause();
        pausedCount += 1;
        console.log("done");
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.log(`failed (${message})`);
      }
    })
  );

  console.log(
    `Finished. Paused ${pausedCount} sandbox${pausedCount === 1 ? "" : "es"}.` +
      (failedCount > 0 ? ` ${failedCount} failure${failedCount === 1 ? "" : "s"}.` : "")
  );
}

await main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Unexpected error: ${message}`);
  process.exitCode = 1;
});
