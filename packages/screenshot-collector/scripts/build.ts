#!/usr/bin/env bun
/**
 * Build script that bundles the screenshot collector into a single executable file.
 * The bundled script can be served from the www server and fetched/executed by workers.
 *
 * This script builds from packages/screenshot-collector/src/index.ts (isolated)
 * NOT from apps/worker/src which would pull in all worker dependencies.
 */

import { build } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const ENTRY_FILE = path.join(ROOT_DIR, "src/index.ts");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "screenshot-collector.js");

async function main() {
  console.log("Building screenshot collector bundle...");
  console.log(`  Entry: ${ENTRY_FILE}`);
  console.log(`  Output: ${OUTPUT_FILE}`);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const result = await build({
    entrypoints: [ENTRY_FILE],
    outdir: OUTPUT_DIR,
    target: "bun",
    minify: false, // Keep readable for debugging
    sourcemap: "none",
    naming: "screenshot-collector.js",
    // Bundle all dependencies into a single file
    external: [], // Don't externalize anything - bundle everything
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Read the output file and ensure single shebang at the top
  let outputContent = await fs.readFile(OUTPUT_FILE, "utf-8");
  // Remove any existing shebangs from the bundled output
  outputContent = outputContent.replace(/^#!.*\n/gm, "");
  const withShebang = `#!/usr/bin/env bun\n${outputContent}`;
  await fs.writeFile(OUTPUT_FILE, withShebang);

  const stats = await fs.stat(OUTPUT_FILE);
  console.log(`\nBuild successful!`);
  console.log(`  Output: ${OUTPUT_FILE}`);
  console.log(`  Size: ${(stats.size / 1024).toFixed(2)} KB`);

  // Also copy to www public assets for serving
  const wwwPublicDir = path.resolve(ROOT_DIR, "../../apps/www/public/scripts");
  const wwwOutputFile = path.join(wwwPublicDir, "screenshot-collector.js");

  try {
    await fs.mkdir(wwwPublicDir, { recursive: true });
    await fs.copyFile(OUTPUT_FILE, wwwOutputFile);
    console.log(`  Copied to: ${wwwOutputFile}`);
  } catch (error) {
    console.warn(
      `  Warning: Could not copy to www public dir: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

main().catch((error) => {
  console.error("Build script failed:", error);
  process.exit(1);
});
