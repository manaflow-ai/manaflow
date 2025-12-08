import { MorphCloudClient } from "morphcloud";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const client = new MorphCloudClient({
  apiKey: process.env.MORPH_API_KEY!,
});

const startTime = Date.now();
const log = (msg: string) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[${elapsed}s] ${msg}`);
};

(async () => {
  log("Loading vm-snapshots.json...");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const snapshotsPath = join(__dirname, "vm-snapshots.json");
  const snapshotsData = JSON.parse(readFileSync(snapshotsPath, "utf-8"));

  const preset = snapshotsData.presets[0];
  const latestVersion = preset.versions[preset.versions.length - 1];
  log(`Using snapshot: ${latestVersion.snapshotId} (version ${latestVersion.version})`);

  log("Starting instance...");
  const instance = await client.instances.start({
    snapshotId: latestVersion.snapshotId,
  });
  log(`Instance created: ${instance.id}`);

  log("Waiting for instance to be ready...");
  await instance.waitUntilReady(30);
  log("Instance is ready!");

  log("Fetching services...");
  const refreshedInstance = await client.instances.get({
    instanceId: instance.id,
  });

  const service = refreshedInstance.networking.httpServices.find(
    (s) => s.name === "port-4096"
  );

  if (service) {
    log(`\n=== READY ===`);
    console.log(`URL: ${service.url}`);
    console.log(`Instance: ${instance.id}`);
  } else {
    log("Warning: port-4096 service not found");
    console.log("Available services:", refreshedInstance.networking.httpServices);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  log(`Total time: ${totalTime}s`);
})();
