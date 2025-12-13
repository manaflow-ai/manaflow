#!/usr/bin/env bun
/**
 * Deploy to Freestyle using freestyle-sandboxes SDK
 *
 * Per Freestyle support: wildcard domain mapping must be done via the
 * dedicated insertDomainMapping API call, not in the deployment domains list.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FreestyleSandboxes } from "freestyle-sandboxes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
const BASE_DOMAIN = "proxy.cmux.sh";
const WILDCARD_DOMAIN = "*.proxy.cmux.sh";

if (!FREESTYLE_API_KEY) {
  console.error("FREESTYLE_API_KEY is required");
  process.exit(1);
}

const api = new FreestyleSandboxes({
  apiKey: FREESTYLE_API_KEY,
});

// Bundle first
console.log("Bundling index.ts...");
const bundleResult = Bun.spawnSync({
  cmd: ["bun", "build", "src/index.ts", "--outfile=dist/index.js", "--target=node"],
  cwd: PROJECT_ROOT,
});
if (bundleResult.exitCode !== 0) {
  console.error("Bundle failed:", bundleResult.stderr.toString());
  process.exit(1);
}
console.log("Bundle complete");

const bundlePath = join(PROJECT_ROOT, "dist", "index.js");
const bundleContent = await readFile(bundlePath, "utf-8");

console.log(`Deploying to ${BASE_DOMAIN}...`);

try {
  // Step 1: Deploy with base domain only
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
      domains: [BASE_DOMAIN],
      entrypoint: "index.js",
    }
  );

  console.log("Deployment ID:", result.deploymentId);

  // Step 2: Add wildcard domain mapping via dedicated API
  console.log(`Adding wildcard domain mapping: ${WILDCARD_DOMAIN}...`);

  const mappingResult = await api.insertDomainMapping({
    domain: WILDCARD_DOMAIN,
    deploymentId: result.deploymentId,
  });

  console.log("Wildcard domain mapping added:", mappingResult);
  console.log("\nDeployment complete!");
  console.log(`  Base domain: https://${BASE_DOMAIN}`);
  console.log(`  Wildcard: https://${WILDCARD_DOMAIN.replace("*", "test")}`);
} catch (err) {
  console.error("Deploy failed:", err);
  process.exit(1);
}
