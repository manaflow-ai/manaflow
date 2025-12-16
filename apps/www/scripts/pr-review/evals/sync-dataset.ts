#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EVAL_DATASET } from "./dataset";
import { fetchPRData, persistPRData } from "./fetch-pr-data";

const OUTPUT_DIR = join(process.cwd(), "apps/www/scripts/pr-review/evals/data");

async function syncDataset(): Promise<void> {
  // Try to get GitHub token from gh CLI if not in env
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    try {
      const token = execSync("gh auth token", {
        stdio: ["ignore", "pipe", "pipe"],
      })
        .toString()
        .trim();
      if (token) {
        process.env.GITHUB_TOKEN = token;
        console.log("✓ Using GitHub token from gh CLI\n");
      }
    } catch {
      // gh CLI not available or not authenticated
    }
  }

  console.log(`Syncing ${EVAL_DATASET.prs.length} PRs to ${OUTPUT_DIR}...\n`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const pr of EVAL_DATASET.prs) {
    console.log(`Fetching ${pr.id}: ${pr.url}`);
    try {
      const data = await fetchPRData(pr.url);
      console.log(
        `  ├─ ${data.metadata.filesChanged} files, +${data.metadata.additions} -${data.metadata.deletions}`
      );

      await persistPRData(pr, data, OUTPUT_DIR);
      console.log(`  └─ Saved to ${join(OUTPUT_DIR, pr.id)}/\n`);
    } catch (error) {
      console.error(`  └─ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log("Sync complete!");
  console.log(`\nTo inspect a PR, check: ${OUTPUT_DIR}/<pr-id>/README.md`);
}

await syncDataset().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
