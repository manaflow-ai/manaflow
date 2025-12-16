#!/usr/bin/env bun

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { EVAL_DATASET } from "./dataset";

const DATA_DIR = join(process.cwd(), "apps/www/scripts/pr-review/evals/data");

async function inspect(prId: string, file?: string): Promise<void> {
  const pr = EVAL_DATASET.prs.find((p) => p.id === prId);
  if (!pr) {
    console.error(`PR ${prId} not found in dataset`);
    console.error(`Available PRs: ${EVAL_DATASET.prs.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  const prDir = join(DATA_DIR, prId);

  if (!file) {
    const readmePath = join(prDir, "README.md");
    const readme = await readFile(readmePath, "utf8");
    console.log(readme);

    console.log("\n📁 Available files:");
    const files = await readdir(prDir);
    for (const f of files) {
      if (f.endsWith(".diff") && f !== "full.diff") {
        console.log(`  - ${f.replace(/_/g, "/").replace(".diff", "")}`);
      }
    }
    console.log("\nTo view a specific file diff:");
    console.log(`  bun run evals/inspect.ts ${prId} <filename>`);
    console.log("\nTo view full diff:");
    console.log(`  cat ${join(prDir, "full.diff")}`);
    return;
  }

  const safeName = file.replace(/[^a-zA-Z0-9._-]/g, "_");
  const diffPath = join(prDir, `${safeName}.diff`);

  try {
    const diff = await readFile(diffPath, "utf8");
    console.log(`\n=== ${file} ===\n`);
    console.log(diff);
  } catch {
    console.error(`File diff not found: ${diffPath}`);
    console.error("\nTry running: bun run evals/sync-dataset.ts");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prId = args[0];
  const file = args[1];

  if (!prId) {
    console.log("Usage: bun run evals/inspect.ts <pr-id> [filename]\n");
    console.log("Available PRs:");
    for (const pr of EVAL_DATASET.prs) {
      console.log(`  ${pr.id}: ${pr.title}`);
      console.log(`    ${pr.url}`);
      console.log(`    Tags: ${pr.tags.join(", ")}\n`);
    }
    process.exit(1);
  }

  await inspect(prId, file);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
