#!/usr/bin/env bun
/**
 * Deploy minimal WebSocket reproduction to Freestyle
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FreestyleSandboxes } from "freestyle-sandboxes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
const DOMAIN = "ws-repro.proxy.cmux.sh";

if (!FREESTYLE_API_KEY) {
  console.error("FREESTYLE_API_KEY is required");
  process.exit(1);
}

const api = new FreestyleSandboxes({
  apiKey: FREESTYLE_API_KEY,
});

// Bundle first
console.log("Bundling ws-repro.ts...");
const bundleResult = Bun.spawnSync({
  cmd: ["bun", "build", "src/ws-repro.ts", "--outfile=dist/ws-repro.js", "--target=node"],
  cwd: PROJECT_ROOT,
});
if (bundleResult.exitCode !== 0) {
  console.error("Bundle failed:", bundleResult.stderr.toString());
  process.exit(1);
}
console.log("Bundle complete");

const bundlePath = join(PROJECT_ROOT, "dist", "ws-repro.js");
const bundleContent = await readFile(bundlePath, "utf-8");

console.log(`Deploying WebSocket reproduction to ${DOMAIN}...`);

try {
  const result = await api.deployWeb(
    {
      kind: "files",
      files: {
        "index.js": {
          content: bundleContent,
          encoding: "utf-8",
        },
      },
    },
    {
      domains: [DOMAIN],
      entrypoint: "index.js",
    }
  );

  console.log("Deployment ID:", result.deploymentId);
  console.log("\nDeployment complete!");
  console.log(`\nTest commands:`);
  console.log(`  1. Check health: curl https://${DOMAIN}/`);
  console.log(`  2. Debug headers: curl https://${DOMAIN}/debug-headers -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="`);
  console.log(`  3. Test WebSocket: websocat wss://${DOMAIN}/echo`);
} catch (err) {
  console.error("Deploy failed:", err);
  process.exit(1);
}
